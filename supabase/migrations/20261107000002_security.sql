-- IfeCollection: time rules, role helpers, RLS and grants.

-- ---------------------------------------------------------------- time helpers
-- Current wall-clock time in Lagos, from the DATABASE clock (never the phone).
create or replace function public.lagos_now() returns timestamp
language sql stable set search_path = public, pg_temp as $$
  select (now() at time zone 'Africa/Lagos')
$$;

-- Is the shop open for staff at the given instant? Supports overnight windows (open > close).
create or replace function public.staff_hours_open_at(p_at timestamptz) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((
    select case
      when s.staff_open_time = s.staff_close_time then false
      when s.staff_open_time < s.staff_close_time then
        (p_at at time zone 'Africa/Lagos')::time >= s.staff_open_time
        and (p_at at time zone 'Africa/Lagos')::time < s.staff_close_time
      else
        (p_at at time zone 'Africa/Lagos')::time >= s.staff_open_time
        or (p_at at time zone 'Africa/Lagos')::time < s.staff_close_time
    end
    from public.settings s where s.id = 1
  ), false)
$$;

create or replace function public.is_within_staff_hours() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.staff_hours_open_at(now())
$$;

-- ---------------------------------------------------------------- role helpers
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
  )
$$;

-- Active admin at any time, or active staff inside working hours.
create or replace function public.can_use_app() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.role = 'admin' or public.is_within_staff_hours())
  )
$$;

-- Internal audit writer (not callable by clients).
create or replace function public.write_audit(
  p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb
) returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, details)
  values (auth.uid(), p_action, p_entity, p_entity_id, coalesce(p_details, '{}'::jsonb));
$$;

-- What the app needs on every request: who am I, am I allowed in right now, when do we close.
create or replace function public.session_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_now      timestamptz := now();
  v_local    timestamp := now() at time zone 'Africa/Lagos';
  v_prof     public.profiles;
  v_set      public.settings;
  v_open     boolean;
  v_close_at timestamptz;
  v_secs     int;
begin
  if auth.uid() is null then
    return jsonb_build_object('signed_in', false);
  end if;
  select * into v_prof from public.profiles where id = auth.uid();
  select * into v_set from public.settings where id = 1;
  v_open := public.staff_hours_open_at(v_now);

  if v_open then
    v_close_at := ((v_local::date + v_set.staff_close_time) at time zone 'Africa/Lagos');
    if v_close_at <= v_now then
      v_close_at := v_close_at + interval '1 day';
    end if;
    v_secs := floor(extract(epoch from (v_close_at - v_now)))::int;
  end if;

  return jsonb_build_object(
    'signed_in', true,
    'user_id', auth.uid(),
    'found', v_prof.id is not null,
    'role', v_prof.role,
    'full_name', v_prof.full_name,
    'username', v_prof.username,
    'active', coalesce(v_prof.active, false),
    'within_hours', v_open,
    'allowed', coalesce(v_prof.active, false) and (v_prof.role = 'admin' or v_open),
    'server_time', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'today', to_char(v_local, 'YYYY-MM-DD'),
    'open_time', to_char(v_set.staff_open_time, 'HH24:MI'),
    'close_time', to_char(v_set.staff_close_time, 'HH24:MI'),
    'warn_minutes', v_set.warn_minutes,
    'seconds_until_close', case when v_prof.role = 'staff' and v_open then v_secs end
  );
end $$;

-- Login / logout events from the app.
create or replace function public.log_auth_event(p_action text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_action not in ('login', 'login_blocked_hours', 'login_blocked_inactive', 'logout', 'auto_logout') then
    raise exception 'INVALID_ACTION';
  end if;
  perform public.write_audit(p_action, 'profile', auth.uid()::text, '{}'::jsonb);
end $$;

-- ---------------------------------------------------------------- new auth users -> profiles
-- Accounts are only created by the admin (service role). Username/name/role come from app_metadata,
-- which ordinary users cannot edit. Supabase Auth inserts the user first and writes app_metadata in a
-- second step, so we also sync on UPDATE of raw_app_meta_data.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  m jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (id, username, full_name, role)
  values (
    new.id,
    lower(coalesce(m ->> 'username', split_part(new.email, '@', 1))),
    coalesce(m ->> 'full_name', split_part(new.email, '@', 1)),
    coalesce((m ->> 'role')::public.user_role, 'staff')
  )
  on conflict (id) do update set
    username  = coalesce(lower(m ->> 'username'), public.profiles.username),
    full_name = coalesce(m ->> 'full_name', public.profiles.full_name),
    role      = coalesce((m ->> 'role')::public.user_role, public.profiles.role);
  return new;
end $$;

create trigger on_auth_user_created
  after insert or update of raw_app_meta_data on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- price-change audit
create or replace function public.audit_price_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Nested IFs: plpgsql must not even look at new.price on a variant row.
  if tg_table_name = 'products' then
    if new.price is distinct from old.price then
      perform public.write_audit('price_change', 'product', new.id::text,
        jsonb_build_object('name', new.name, 'old', old.price, 'new', new.price));
    end if;
  else
    if new.price_override is distinct from old.price_override then
      perform public.write_audit('price_change', 'variant', new.id::text,
        jsonb_build_object('size', new.size, 'colour', new.colour,
                           'old', old.price_override, 'new', new.price_override));
    end if;
  end if;
  return new;
end $$;

create trigger products_price_audit after update of price on public.products
  for each row execute function public.audit_price_change();
create trigger variants_price_audit after update of price_override on public.product_variants
  for each row execute function public.audit_price_change();

-- ---------------------------------------------------------------- RLS
alter table public.profiles          enable row level security;
alter table public.categories        enable row level security;
alter table public.products          enable row level security;
alter table public.product_images    enable row level security;
alter table public.product_variants  enable row level security;
alter table public.sales             enable row level security;
alter table public.sale_items        enable row level security;
alter table public.sale_payments     enable row level security;
alter table public.stock_movements   enable row level security;
alter table public.receipt_counters  enable row level security;
alter table public.settings          enable row level security;
alter table public.audit_log         enable row level security;

-- profiles
create policy profiles_select on public.profiles for select to authenticated
  using ((select public.is_admin()) or (id = auth.uid() and (select public.can_use_app())));

-- categories
create policy categories_select on public.categories for select to authenticated
  using ((select public.can_use_app()) and (active or (select public.is_admin())));
create policy categories_admin_insert on public.categories for insert to authenticated
  with check ((select public.is_admin()));
create policy categories_admin_update on public.categories for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- products (created through save_product RPC; admin may archive/unarchive directly)
create policy products_select on public.products for select to authenticated
  using ((select public.can_use_app()) and (not archived or (select public.is_admin())));
create policy products_admin_update on public.products for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- product images
create policy product_images_select on public.product_images for select to authenticated
  using ((select public.can_use_app()));
create policy product_images_admin_insert on public.product_images for insert to authenticated
  with check ((select public.is_admin()));
create policy product_images_admin_update on public.product_images for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy product_images_admin_delete on public.product_images for delete to authenticated
  using ((select public.is_admin()));

-- variants (read only; all writes go through RPCs so every stock change is logged)
create policy product_variants_select on public.product_variants for select to authenticated
  using ((select public.can_use_app()) and (active or (select public.is_admin())));

-- sales: admin sees all; staff see only their own sales from today (Lagos), only during hours
create policy sales_select on public.sales for select to authenticated
  using (
    (select public.is_admin())
    or (
      staff_id = auth.uid()
      and (select public.can_use_app())
      and created_at >= ((select public.lagos_now())::date::timestamp at time zone 'Africa/Lagos')
    )
  );
create policy sale_items_select on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));
create policy sale_payments_select on public.sale_payments for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id));

create policy stock_movements_select on public.stock_movements for select to authenticated
  using ((select public.is_admin()));
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.is_admin()));

create policy settings_select on public.settings for select to authenticated
  using ((select public.can_use_app()));
create policy settings_admin_update on public.settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- receipt_counters: no policies -> no direct access.

-- ---------------------------------------------------------------- grants
-- Start from nothing, then grant only what the policies above are meant to allow.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on public.profiles, public.categories, public.products, public.product_images,
  public.product_variants, public.sales, public.sale_items, public.sale_payments,
  public.stock_movements, public.settings, public.audit_log to authenticated;
grant insert, update on public.categories to authenticated;
grant update (archived, name, description, category_id, price) on public.products to authenticated;
grant insert, update, delete on public.product_images to authenticated;
grant update (staff_open_time, staff_close_time, warn_minutes, store_phone, store_address,
  receipt_footer, updated_by) on public.settings to authenticated;
-- Deliberately NO insert/update/delete on sales, sale_items, sale_payments, product_variants,
-- stock_movements, audit_log, profiles for authenticated or anon.
