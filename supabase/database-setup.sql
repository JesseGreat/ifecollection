-- IfeCollection: full database setup for a NEW, empty project (all parts, in order). Do NOT run on a project that is already set up.
begin;

-- ===================== 20261107000001_schema.sql =====================
-- IfeCollection: core schema
-- Money is stored as whole naira (bigint). Times are timestamptz; business rules use Africa/Lagos.

create type public.user_role as enum ('admin', 'staff');
create type public.sale_status as enum ('completed', 'voided');
create type public.payment_method as enum ('cash', 'transfer', 'pos');
create type public.movement_reason as enum ('initial', 'restock', 'sale', 'adjustment', 'void');

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  full_name   text not null check (length(btrim(full_name)) between 1 and 80),
  role        public.user_role not null default 'staff',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- catalogue
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (length(btrim(name)) between 1 and 40),
  sort_order  int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.products (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(btrim(name)) between 1 and 120),
  category_id  uuid references public.categories (id) on delete set null,
  price        bigint not null check (price >= 0),
  description  text check (description is null or length(description) <= 1000),
  archived     boolean not null default false,
  created_by   uuid references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index products_category_idx on public.products (category_id);

create table public.product_images (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products (id) on delete cascade,
  path        text not null,
  thumb_path  text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
create index product_images_product_idx on public.product_images (product_id, sort_order);

create table public.product_variants (
  id                   uuid primary key default gen_random_uuid(),
  product_id           uuid not null references public.products (id) on delete cascade,
  size                 text not null default '' check (length(size) <= 20),
  colour               text not null default '' check (length(colour) <= 30),
  sku                  text unique,
  price_override       bigint check (price_override is null or price_override >= 0),
  quantity             int not null default 0 check (quantity >= 0),
  low_stock_threshold  int not null default 3 check (low_stock_threshold >= 0),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (product_id, size, colour)
);
create index product_variants_product_idx on public.product_variants (product_id);

-- ---------------------------------------------------------------- sales
create table public.sales (
  id               uuid primary key default gen_random_uuid(),
  receipt_no       text not null unique,
  staff_id         uuid not null references public.profiles (id),
  customer_name    text check (customer_name is null or length(customer_name) <= 80),
  customer_phone   text check (customer_phone is null or length(customer_phone) <= 20),
  total            bigint not null check (total >= 0),
  status           public.sale_status not null default 'completed',
  void_reason      text,
  voided_by        uuid references public.profiles (id),
  voided_at        timestamptz,
  idempotency_key  uuid not null,
  created_at       timestamptz not null default now(),
  unique (staff_id, idempotency_key),
  check (status = 'completed'
         or (void_reason is not null and voided_by is not null and voided_at is not null))
);
create index sales_created_idx on public.sales (created_at);
create index sales_staff_created_idx on public.sales (staff_id, created_at);

create table public.sale_items (
  id            uuid primary key default gen_random_uuid(),
  sale_id       uuid not null references public.sales (id),
  variant_id    uuid not null references public.product_variants (id),
  product_name  text not null,
  size          text not null,
  colour        text not null,
  unit_price    bigint not null check (unit_price >= 0),
  qty           int not null check (qty > 0),
  line_total    bigint not null check (line_total >= 0)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_variant_idx on public.sale_items (variant_id);

create table public.sale_payments (
  id         uuid primary key default gen_random_uuid(),
  sale_id    uuid not null references public.sales (id),
  method     public.payment_method not null,
  amount     bigint not null check (amount > 0),
  reference  text check (reference is null or length(reference) <= 60)
);
create index sale_payments_sale_idx on public.sale_payments (sale_id);

create table public.stock_movements (
  id              bigint generated always as identity primary key,
  variant_id      uuid not null references public.product_variants (id),
  qty_change      int not null check (qty_change <> 0),
  quantity_after  int not null,
  reason          public.movement_reason not null,
  note            text,
  sale_id         uuid references public.sales (id),
  actor_id        uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);
create index stock_movements_variant_idx on public.stock_movements (variant_id, created_at);

create table public.receipt_counters (
  day      date primary key,
  last_no  int not null
);

-- ---------------------------------------------------------------- settings & audit
create table public.settings (
  id                smallint primary key default 1 check (id = 1),
  staff_open_time   time not null default '08:00',
  staff_close_time  time not null default '20:00',
  warn_minutes      int not null default 10 check (warn_minutes between 1 and 60),
  store_phone       text,
  store_address     text,
  receipt_footer    text not null default 'Thank you for shopping with us!',
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles (id)
);
insert into public.settings (id) values (1);

create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity      text,
  entity_id   text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- ---------------------------------------------------------------- timestamps
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger product_variants_touch before update on public.product_variants
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- ===================== 20261107000002_security.sql =====================
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

-- ===================== 20261107000003_rpc.sql =====================
-- IfeCollection: business RPCs. Every function re-checks role, active flag and working hours itself.

-- Internal: who is calling, and are they allowed in right now?
create or replace function public.require_user(p_admin_only boolean default false)
returns public.profiles
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.profiles;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select * into v from public.profiles where id = auth.uid();
  if not found or not v.active then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if p_admin_only and v.role <> 'admin' then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  if v.role = 'staff' and not public.is_within_staff_hours() then
    raise exception 'STORE_CLOSED' using errcode = '42501';
  end if;
  return v;
end $$;

-- Internal: a sale as JSON (used for the RPC result).
create or replace function public.sale_json(p_sale_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', s.id, 'receipt_no', s.receipt_no, 'total', s.total, 'status', s.status,
    'created_at', s.created_at, 'staff_id', s.staff_id, 'staff_name', p.full_name,
    'customer_name', s.customer_name, 'customer_phone', s.customer_phone,
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'variant_id', i.variant_id, 'product_name', i.product_name, 'size', i.size,
        'colour', i.colour, 'unit_price', i.unit_price, 'qty', i.qty, 'line_total', i.line_total)
        order by i.product_name, i.size)
      from public.sale_items i where i.sale_id = s.id), '[]'::jsonb),
    'payments', coalesce((select jsonb_agg(jsonb_build_object(
        'method', m.method, 'amount', m.amount, 'reference', m.reference) order by m.method)
      from public.sale_payments m where m.sale_id = s.id), '[]'::jsonb)
  )
  from public.sales s join public.profiles p on p.id = s.staff_id
  where s.id = p_sale_id
$$;

-- ---------------------------------------------------------------- create_sale
-- p_items:    [{"variant_id": uuid, "qty": int}, ...]
-- p_payments: [{"method": "cash"|"transfer"|"pos", "amount": int|null, "reference": text?}, ...]
--             A single payment with amount null means "the full total".
-- p_expected_total: the total the phone showed; if DB prices differ we refuse (PRICE_CHANGED).
create or replace function public.create_sale(
  p_items jsonb,
  p_payments jsonb,
  p_idempotency_key uuid,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_expected_total bigint default null
) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user     public.profiles;
  v_sale_id  uuid;
  v_total    bigint := 0;
  v_paid     bigint := 0;
  v_row      record;
  v_n        int;
  v_day      date := (now() at time zone 'Africa/Lagos')::date;
  v_receipt  text;
  v_after    int;
  v_payments jsonb;
begin
  v_user := public.require_user(false);

  if p_idempotency_key is null then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED';
  end if;

  -- Serialise retries of the same submission, then return the earlier result if it exists.
  perform pg_advisory_xact_lock(hashtextextended(v_user.id::text || ':' || p_idempotency_key::text, 0));
  select id into v_sale_id from public.sales
   where staff_id = v_user.id and idempotency_key = p_idempotency_key;
  if found then
    return public.sale_json(v_sale_id) || jsonb_build_object('duplicate', true);
  end if;

  -- Validate cart shape.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART';
  end if;
  if jsonb_array_length(p_items) > 100 then
    raise exception 'TOO_MANY_ITEMS';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e -> 'qty') <> 'number' or (e ->> 'qty')::numeric <= 0
       or (e ->> 'qty')::numeric <> trunc((e ->> 'qty')::numeric)
       or (e ->> 'variant_id') is null
  ) then
    raise exception 'INVALID_ITEM';
  end if;

  -- Lock the variant rows in a fixed order (prevents deadlocks between two tills).
  perform 1 from public.product_variants v
   where v.id in (select (e ->> 'variant_id')::uuid from jsonb_array_elements(p_items) e)
   order by v.id
   for update;

  -- Pass 1: check stock and compute total from DATABASE prices.
  for v_row in
    select x.variant_id, x.qty, v.id as found_id, v.quantity, v.active, p.archived, p.name
         , coalesce(v.price_override, p.price) as unit_price
      from (select (e ->> 'variant_id')::uuid as variant_id, sum((e ->> 'qty')::int) as qty
              from jsonb_array_elements(p_items) e group by 1) x
      left join public.product_variants v on v.id = x.variant_id
      left join public.products p on p.id = v.product_id
     order by x.variant_id
  loop
    if v_row.found_id is null then
      raise exception 'VARIANT_NOT_FOUND';
    end if;
    if not v_row.active or v_row.archived then
      raise exception 'PRODUCT_UNAVAILABLE: %', v_row.name;
    end if;
    if v_row.qty > v_row.quantity then
      raise exception 'INSUFFICIENT_STOCK: % (only % left)', v_row.name, v_row.quantity
        using errcode = 'P0001', hint = v_row.variant_id::text;
    end if;
    v_total := v_total + v_row.unit_price * v_row.qty;
  end loop;

  if p_expected_total is not null and p_expected_total <> v_total then
    raise exception 'PRICE_CHANGED: total is now %', v_total;
  end if;

  -- Payments.
  if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'PAYMENT_REQUIRED';
  end if;
  if jsonb_array_length(p_payments) > 3 then
    raise exception 'INVALID_PAYMENT';
  end if;
  if exists (select 1 from jsonb_array_elements(p_payments) e
             where coalesce(e ->> 'method', '') not in ('cash', 'transfer', 'pos')) then
    raise exception 'INVALID_PAYMENT';
  end if;
  v_payments := p_payments;
  -- One payment with no amount = "customer paid the full total this way".
  if jsonb_array_length(p_payments) = 1
     and coalesce(jsonb_typeof(p_payments -> 0 -> 'amount'), 'null') = 'null' then
    v_payments := jsonb_build_array((p_payments -> 0) || jsonb_build_object('amount', v_total));
  end if;
  if v_total = 0 then
    v_payments := '[]'::jsonb;  -- nothing to pay (e.g. free gift items)
  elsif exists (select 1 from jsonb_array_elements(v_payments) e
                where jsonb_typeof(e -> 'amount') <> 'number'
                   or (e ->> 'amount')::numeric <= 0
                   or (e ->> 'amount')::numeric <> trunc((e ->> 'amount')::numeric)) then
    raise exception 'INVALID_PAYMENT';
  end if;
  select coalesce(sum((e ->> 'amount')::bigint), 0) into v_paid from jsonb_array_elements(v_payments) e;
  if v_paid <> v_total then
    raise exception 'PAYMENT_MISMATCH: paid % but total is %', v_paid, v_total;
  end if;

  -- Receipt number, per Lagos day.
  insert into public.receipt_counters as rc (day, last_no) values (v_day, 1)
  on conflict (day) do update set last_no = rc.last_no + 1
  returning last_no into v_n;
  v_receipt := 'IFE-' || to_char(v_day, 'YYMMDD') || '-' || lpad(v_n::text, 4, '0');

  insert into public.sales (receipt_no, staff_id, customer_name, customer_phone, total, idempotency_key)
  values (v_receipt, v_user.id,
          nullif(left(btrim(coalesce(p_customer_name, '')), 80), ''),
          nullif(left(regexp_replace(coalesce(p_customer_phone, ''), '[^0-9+]', '', 'g'), 20), ''),
          v_total, p_idempotency_key)
  returning id into v_sale_id;

  -- Pass 2: items, stock, movements.
  for v_row in
    select x.variant_id, x.qty, p.name, v.size, v.colour, coalesce(v.price_override, p.price) as unit_price
      from (select (e ->> 'variant_id')::uuid as variant_id, sum((e ->> 'qty')::int) as qty
              from jsonb_array_elements(p_items) e group by 1) x
      join public.product_variants v on v.id = x.variant_id
      join public.products p on p.id = v.product_id
     order by x.variant_id
  loop
    insert into public.sale_items (sale_id, variant_id, product_name, size, colour, unit_price, qty, line_total)
    values (v_sale_id, v_row.variant_id, v_row.name, v_row.size, v_row.colour,
            v_row.unit_price, v_row.qty, v_row.unit_price * v_row.qty);

    update public.product_variants set quantity = quantity - v_row.qty
     where id = v_row.variant_id
     returning quantity into v_after;

    insert into public.stock_movements (variant_id, qty_change, quantity_after, reason, sale_id, actor_id, note)
    values (v_row.variant_id, -v_row.qty, v_after, 'sale', v_sale_id, v_user.id, v_receipt);
  end loop;

  insert into public.sale_payments (sale_id, method, amount, reference)
  select v_sale_id, (e ->> 'method')::public.payment_method, (e ->> 'amount')::bigint,
         nullif(left(btrim(coalesce(e ->> 'reference', '')), 60), '')
    from jsonb_array_elements(v_payments) e;

  return public.sale_json(v_sale_id) || jsonb_build_object('duplicate', false);
end $$;

-- ---------------------------------------------------------------- void_sale (admin only)
create or replace function public.void_sale(p_sale_id uuid, p_reason text) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user  public.profiles;
  v_sale  public.sales;
  v_row   record;
  v_after int;
begin
  v_user := public.require_user(true);
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then
    raise exception 'SALE_NOT_FOUND';
  end if;
  if v_sale.status = 'voided' then
    raise exception 'ALREADY_VOIDED';
  end if;

  perform 1 from public.product_variants
   where id in (select variant_id from public.sale_items where sale_id = p_sale_id)
   order by id for update;

  for v_row in
    select variant_id, sum(qty)::int as qty from public.sale_items
     where sale_id = p_sale_id group by variant_id order by variant_id
  loop
    update public.product_variants set quantity = quantity + v_row.qty
     where id = v_row.variant_id returning quantity into v_after;
    insert into public.stock_movements (variant_id, qty_change, quantity_after, reason, sale_id, actor_id, note)
    values (v_row.variant_id, v_row.qty, v_after, 'void', p_sale_id, v_user.id,
            'Void ' || v_sale.receipt_no || ': ' || btrim(p_reason));
  end loop;

  update public.sales
     set status = 'voided', void_reason = btrim(p_reason), voided_by = v_user.id, voided_at = now()
   where id = p_sale_id;

  perform public.write_audit('sale_void', 'sale', p_sale_id::text,
    jsonb_build_object('receipt_no', v_sale.receipt_no, 'total', v_sale.total, 'reason', btrim(p_reason)));

  return public.sale_json(p_sale_id);
end $$;

-- ---------------------------------------------------------------- stock (admin only)
create or replace function public.restock_variant(p_variant_id uuid, p_qty int, p_note text default null)
returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_user public.profiles; v_after int;
begin
  v_user := public.require_user(true);
  if p_qty is null or p_qty <= 0 or p_qty > 100000 then
    raise exception 'INVALID_QTY';
  end if;
  update public.product_variants set quantity = quantity + p_qty
   where id = p_variant_id returning quantity into v_after;
  if not found then
    raise exception 'VARIANT_NOT_FOUND';
  end if;
  insert into public.stock_movements (variant_id, qty_change, quantity_after, reason, actor_id, note)
  values (p_variant_id, p_qty, v_after, 'restock', v_user.id, nullif(btrim(coalesce(p_note, '')), ''));
  perform public.write_audit('stock_restock', 'variant', p_variant_id::text,
    jsonb_build_object('qty', p_qty, 'quantity_after', v_after, 'note', p_note));
  return v_after;
end $$;

create or replace function public.adjust_stock(p_variant_id uuid, p_new_quantity int, p_reason text)
returns int
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_user public.profiles; v_old int; v_delta int;
begin
  v_user := public.require_user(true);
  if p_new_quantity is null or p_new_quantity < 0 or p_new_quantity > 100000 then
    raise exception 'INVALID_QTY';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'REASON_REQUIRED';
  end if;
  select quantity into v_old from public.product_variants where id = p_variant_id for update;
  if not found then
    raise exception 'VARIANT_NOT_FOUND';
  end if;
  v_delta := p_new_quantity - v_old;
  if v_delta = 0 then
    return v_old;
  end if;
  update public.product_variants set quantity = p_new_quantity where id = p_variant_id;
  insert into public.stock_movements (variant_id, qty_change, quantity_after, reason, actor_id, note)
  values (p_variant_id, v_delta, p_new_quantity, 'adjustment', v_user.id, btrim(p_reason));
  perform public.write_audit('stock_adjust', 'variant', p_variant_id::text,
    jsonb_build_object('old', v_old, 'new', p_new_quantity, 'reason', btrim(p_reason)));
  return p_new_quantity;
end $$;

-- ---------------------------------------------------------------- save_product (admin only)
-- p: {id?, name, category_id?, price, description?,
--     variants: [{id?, size, colour, sku?, price_override?, low_stock_threshold?, quantity?}]}
-- quantity is only used for NEW variants (initial stock). Existing stock changes use restock/adjust.
-- Variants missing from the list are deactivated (never deleted, sales may point to them).
create or replace function public.save_product(p jsonb) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user   public.profiles;
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_is_new boolean := v_id is null;
  v_var    jsonb;
  v_vid    uuid;
  v_keep   uuid[] := '{}';
  v_qty    int;
  v_size   text;
  v_colour text;
begin
  v_user := public.require_user(true);

  if length(btrim(coalesce(p ->> 'name', ''))) = 0 then
    raise exception 'NAME_REQUIRED';
  end if;
  if (p ->> 'price') is null or (p ->> 'price')::bigint < 0 then
    raise exception 'INVALID_PRICE';
  end if;
  if jsonb_typeof(p -> 'variants') <> 'array' or jsonb_array_length(p -> 'variants') = 0 then
    raise exception 'VARIANTS_REQUIRED';
  end if;

  if v_is_new then
    insert into public.products (name, category_id, price, description, created_by)
    values (btrim(p ->> 'name'), nullif(p ->> 'category_id', '')::uuid, (p ->> 'price')::bigint,
            nullif(btrim(coalesce(p ->> 'description', '')), ''), v_user.id)
    returning id into v_id;
  else
    update public.products
       set name = btrim(p ->> 'name'),
           category_id = nullif(p ->> 'category_id', '')::uuid,
           price = (p ->> 'price')::bigint,
           description = nullif(btrim(coalesce(p ->> 'description', '')), '')
     where id = v_id;
    if not found then
      raise exception 'PRODUCT_NOT_FOUND';
    end if;
  end if;

  for v_var in select * from jsonb_array_elements(p -> 'variants') loop
    v_size   := left(btrim(coalesce(v_var ->> 'size', '')), 20);
    v_colour := left(btrim(coalesce(v_var ->> 'colour', '')), 30);
    v_vid    := nullif(v_var ->> 'id', '')::uuid;

    if v_vid is null then
      select id into v_vid from public.product_variants
       where product_id = v_id and size = v_size and colour = v_colour;
    end if;

    if v_vid is not null then
      update public.product_variants
         set size = v_size, colour = v_colour,
             sku = nullif(btrim(coalesce(v_var ->> 'sku', '')), ''),
             price_override = nullif(v_var ->> 'price_override', '')::bigint,
             low_stock_threshold = coalesce(nullif(v_var ->> 'low_stock_threshold', '')::int, 3),
             active = true
       where id = v_vid and product_id = v_id;
      if not found then
        raise exception 'VARIANT_NOT_FOUND';
      end if;
    else
      v_qty := coalesce(nullif(v_var ->> 'quantity', '')::int, 0);
      if v_qty < 0 then
        raise exception 'INVALID_QTY';
      end if;
      insert into public.product_variants
        (product_id, size, colour, sku, price_override, low_stock_threshold, quantity)
      values (v_id, v_size, v_colour, nullif(btrim(coalesce(v_var ->> 'sku', '')), ''),
              nullif(v_var ->> 'price_override', '')::bigint,
              coalesce(nullif(v_var ->> 'low_stock_threshold', '')::int, 3), v_qty)
      returning id into v_vid;
      if v_qty > 0 then
        insert into public.stock_movements (variant_id, qty_change, quantity_after, reason, actor_id, note)
        values (v_vid, v_qty, v_qty, 'initial', v_user.id, 'New variant');
      end if;
    end if;
    v_keep := v_keep || v_vid;
  end loop;

  update public.product_variants set active = false
   where product_id = v_id and not (id = any (v_keep)) and active;

  perform public.write_audit(case when v_is_new then 'product_create' else 'product_update' end,
    'product', v_id::text, jsonb_build_object('name', btrim(p ->> 'name'), 'price', (p ->> 'price')::bigint));
  return v_id;
end $$;

-- ---------------------------------------------------------------- settings (admin only)
create or replace function public.update_settings(p jsonb) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_user public.profiles; v_old public.settings;
begin
  v_user := public.require_user(true);
  select * into v_old from public.settings where id = 1;
  update public.settings set
    staff_open_time  = coalesce((p ->> 'staff_open_time')::time, staff_open_time),
    staff_close_time = coalesce((p ->> 'staff_close_time')::time, staff_close_time),
    warn_minutes     = coalesce((p ->> 'warn_minutes')::int, warn_minutes),
    store_phone      = case when p ? 'store_phone' then nullif(btrim(p ->> 'store_phone'), '') else store_phone end,
    store_address    = case when p ? 'store_address' then nullif(btrim(p ->> 'store_address'), '') else store_address end,
    receipt_footer   = coalesce(nullif(btrim(p ->> 'receipt_footer'), ''), receipt_footer),
    updated_by       = v_user.id
  where id = 1;
  perform public.write_audit('settings_update', 'settings', '1',
    jsonb_build_object('old_open', v_old.staff_open_time, 'old_close', v_old.staff_close_time, 'new', p));
end $$;

-- ---------------------------------------------------------------- dashboard (admin only)
create or replace function public.dashboard_summary(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_start timestamptz := (p_from::timestamp at time zone 'Africa/Lagos');
  v_end   timestamptz := ((p_to + 1)::timestamp at time zone 'Africa/Lagos');
  r jsonb;
begin
  perform public.require_user(true);
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'INVALID_RANGE';
  end if;

  with s as (
    select * from public.sales where created_at >= v_start and created_at < v_end
  ), ok as (
    select * from s where status = 'completed'
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'total', (select coalesce(sum(total), 0) from ok),
    'count', (select count(*) from ok),
    'units', (select coalesce(sum(i.qty), 0) from public.sale_items i join ok on ok.id = i.sale_id),
    'by_method', jsonb_build_object(
      'cash',     (select coalesce(sum(m.amount), 0) from public.sale_payments m join ok on ok.id = m.sale_id where m.method = 'cash'),
      'transfer', (select coalesce(sum(m.amount), 0) from public.sale_payments m join ok on ok.id = m.sale_id where m.method = 'transfer'),
      'pos',      (select coalesce(sum(m.amount), 0) from public.sale_payments m join ok on ok.id = m.sale_id where m.method = 'pos')
    ),
    'by_staff', coalesce((
      select jsonb_agg(x order by x.total desc) from (
        select p.id as staff_id, p.full_name, count(*) as count, sum(ok.total) as total
          from ok join public.profiles p on p.id = ok.staff_id
         group by p.id, p.full_name) x), '[]'::jsonb),
    'best_sellers', coalesce((
      select jsonb_agg(x order by x.units desc, x.revenue desc) from (
        select i.variant_id, i.product_name, i.size, i.colour, sum(i.qty) as units, sum(i.line_total) as revenue
          from public.sale_items i join ok on ok.id = i.sale_id
         group by i.variant_id, i.product_name, i.size, i.colour
         order by units desc, revenue desc
         limit 10) x), '[]'::jsonb),
    'sold_by_variant', coalesce((
      select jsonb_object_agg(variant_id, units) from (
        select i.variant_id, sum(i.qty) as units
          from public.sale_items i join ok on ok.id = i.sale_id group by i.variant_id) x), '{}'::jsonb),
    'voided', coalesce((
      select jsonb_agg(x order by x.voided_at desc) from (
        select s.id, s.receipt_no, s.total, s.void_reason, s.voided_at, s.created_at,
               st.full_name as staff_name, vb.full_name as voided_by_name
          from s
          join public.profiles st on st.id = s.staff_id
          left join public.profiles vb on vb.id = s.voided_by
         where s.status = 'voided') x), '[]'::jsonb)
  ) into r;
  return r;
end $$;

-- ---------------------------------------------------------------- public: opening hours for the login page
create or replace function public.store_hours() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'open_time', to_char(staff_open_time, 'HH24:MI'),
    'close_time', to_char(staff_close_time, 'HH24:MI'),
    'open_now', public.is_within_staff_hours())
  from public.settings where id = 1
$$;

-- ---------------------------------------------------------------- function grants
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.lagos_now(),
  public.staff_hours_open_at(timestamptz),
  public.is_within_staff_hours(),
  public.is_admin(),
  public.can_use_app(),
  public.session_status(),
  public.log_auth_event(text),
  public.create_sale(jsonb, jsonb, uuid, text, text, bigint),
  public.void_sale(uuid, text),
  public.restock_variant(uuid, int, text),
  public.adjust_stock(uuid, int, text),
  public.save_product(jsonb),
  public.update_settings(jsonb),
  public.dashboard_summary(date, date)
to authenticated;
grant execute on function public.store_hours() to anon, authenticated;

-- Make sure functions created later are not executable by default either.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ===================== 20261107000004_storage.sql =====================
-- IfeCollection: product photo bucket.
-- Public READ (so photos load fast from the CDN without a token); only the admin can upload/change/delete.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152,
        array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "product images: admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_admin()));
create policy "product images: admin update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));
create policy "product images: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_admin()));
create policy "product images: signed-in read" on storage.objects for select to authenticated
  using (bucket_id = 'product-images');

-- ===================== 20261108000005_cloudinary_images.sql =====================
-- IfeCollection: product photos can live on Cloudinary (recommended) or Supabase Storage (fallback).
--   provider = 'cloudinary': path = Cloudinary secure_url, external_id = Cloudinary public_id,
--                            thumb_path is NULL (thumbnails are made by Cloudinary from the URL).
--   provider = 'supabase':   path / thumb_path = object paths in the product-images bucket (as before).
alter table public.product_images
  add column provider text not null default 'supabase' check (provider in ('supabase', 'cloudinary')),
  add column external_id text,
  alter column thumb_path drop not null;

alter table public.product_images
  add constraint product_images_provider_fields check (
    (provider = 'supabase' and thumb_path is not null)
    or (provider = 'cloudinary' and path like 'https://res.cloudinary.com/%' and external_id is not null)
  );

-- ===================== 20261108000006_single_session.sql =====================
-- IfeCollection: one device per account ("newest login wins"), for staff AND admin.
-- On login the app calls claim_session(), which records the login's session id (from the JWT).
-- Every check (RLS via is_admin()/can_use_app(), every RPC via require_user(), the proxy via
-- session_status()) then refuses any other session of that account, so the old device is cut off.

alter table public.profiles add column current_session_id uuid;

-- Session id of the current request's JWT (Supabase puts it in the "session_id" claim).
create or replace function public.jwt_session_id() returns uuid
language sql stable set search_path = public, pg_temp as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid
$$;

-- Is this request coming from the account's one allowed login?
-- (No session recorded yet = allowed, so accounts work before their first app login.)
create or replace function public.is_current_session() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.current_session_id is null or p.current_session_id = public.jwt_session_id())
  )
$$;

-- Called by the app right after a successful login: this device becomes the only one.
create or replace function public.claim_session() returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_sid uuid := public.jwt_session_id();
  v_old uuid;
begin
  if auth.uid() is null or v_sid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select current_session_id into v_old from public.profiles where id = auth.uid() for update;
  update public.profiles set current_session_id = v_sid where id = auth.uid();
  if v_old is not null and v_old <> v_sid then
    perform public.write_audit('session_replaced', 'profile', auth.uid()::text, '{}'::jsonb);
  end if;
end $$;

-- ---------------------------------------------------------------- add the session check everywhere
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
      and (current_session_id is null or current_session_id = public.jwt_session_id())
  )
$$;

create or replace function public.can_use_app() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active
      and (p.current_session_id is null or p.current_session_id = public.jwt_session_id())
      and (p.role = 'admin' or public.is_within_staff_hours())
  )
$$;

create or replace function public.require_user(p_admin_only boolean default false)
returns public.profiles
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v public.profiles;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  select * into v from public.profiles where id = auth.uid();
  if not found or not v.active then
    raise exception 'ACCOUNT_INACTIVE' using errcode = '42501';
  end if;
  if v.current_session_id is not null and v.current_session_id is distinct from public.jwt_session_id() then
    raise exception 'SESSION_REPLACED' using errcode = '42501';
  end if;
  if p_admin_only and v.role <> 'admin' then
    raise exception 'ADMIN_ONLY' using errcode = '42501';
  end if;
  if v.role = 'staff' and not public.is_within_staff_hours() then
    raise exception 'STORE_CLOSED' using errcode = '42501';
  end if;
  return v;
end $$;

create or replace function public.session_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_now      timestamptz := now();
  v_local    timestamp := now() at time zone 'Africa/Lagos';
  v_prof     public.profiles;
  v_set      public.settings;
  v_open     boolean;
  v_current  boolean;
  v_close_at timestamptz;
  v_secs     int;
begin
  if auth.uid() is null then
    return jsonb_build_object('signed_in', false);
  end if;
  select * into v_prof from public.profiles where id = auth.uid();
  select * into v_set from public.settings where id = 1;
  v_open := public.staff_hours_open_at(v_now);
  v_current := v_prof.current_session_id is null or v_prof.current_session_id = public.jwt_session_id();

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
    'replaced', v_prof.id is not null and not v_current,
    'within_hours', v_open,
    'allowed', coalesce(v_prof.active, false) and v_current and (v_prof.role = 'admin' or v_open),
    'server_time', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'today', to_char(v_local, 'YYYY-MM-DD'),
    'open_time', to_char(v_set.staff_open_time, 'HH24:MI'),
    'close_time', to_char(v_set.staff_close_time, 'HH24:MI'),
    'warn_minutes', v_set.warn_minutes,
    'seconds_until_close', case when v_prof.role = 'staff' and v_open then v_secs end
  );
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.jwt_session_id(), public.is_current_session(), public.claim_session()
  from public, anon;
grant execute on function public.jwt_session_id(), public.is_current_session(), public.claim_session()
  to authenticated;

-- ===================== 20261108000007_login_location.sql =====================
-- IfeCollection: record where/how a login happened (device, network location, GPS) in the audit log,
-- and log refused logins when a staff phone does not share its location.
-- Only a small, fixed set of fields is kept, with length limits, whatever the client sends.

drop function if exists public.log_auth_event(text);

create or replace function public.log_auth_event(p_action text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  d jsonb := coalesce(p_details, '{}'::jsonb);
  v jsonb := '{}'::jsonb;
  k text;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_action not in ('login', 'login_blocked_hours', 'login_blocked_inactive', 'login_blocked_location',
                      'logout', 'auto_logout') then
    raise exception 'INVALID_ACTION';
  end if;
  if jsonb_typeof(d) <> 'object' then
    d := '{}'::jsonb;
  end if;
  -- Text fields (trimmed to 120 characters).
  foreach k in array array['device', 'ip', 'city', 'region', 'country', 'location_error'] loop
    if jsonb_typeof(d -> k) = 'string' then
      v := v || jsonb_build_object(k, left(d ->> k, 120));
    end if;
  end loop;
  -- GPS numbers (only if they are real coordinates).
  if jsonb_typeof(d -> 'lat') = 'number' and jsonb_typeof(d -> 'lng') = 'number'
     and (d ->> 'lat')::numeric between -90 and 90 and (d ->> 'lng')::numeric between -180 and 180 then
    v := v || jsonb_build_object('lat', round((d ->> 'lat')::numeric, 6), 'lng', round((d ->> 'lng')::numeric, 6));
    if jsonb_typeof(d -> 'accuracy') = 'number' and (d ->> 'accuracy')::numeric >= 0 then
      v := v || jsonb_build_object('accuracy', round(least((d ->> 'accuracy')::numeric, 1000000)));
    end if;
  end if;
  perform public.write_audit(p_action, 'profile', auth.uid()::text, v);
end $$;

revoke execute on function public.log_auth_event(text, jsonb) from public, anon;
grant execute on function public.log_auth_event(text, jsonb) to authenticated;

-- ===================== 20261109000008_stock_counts.sql =====================
-- IfeCollection: daily stock counts per sales person.
--   Opening count (morning): REQUIRED before that person can record any sale that day.
--   Closing count (evening): counted, or skipped ("late, count tomorrow"); either one closes their day.
--   Every active item must be counted; differences are kept for the admin to accept (corrects stock) or dismiss.
-- Each count line keeps the system quantity at the moment the count started ("expected") and what was counted.

create type public.count_kind as enum ('opening', 'closing');
create type public.count_status as enum ('in_progress', 'submitted', 'skipped');

create table public.stock_counts (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references public.profiles (id),
  kind          public.count_kind not null,
  business_day  date not null,                     -- Lagos date
  status        public.count_status not null default 'in_progress',
  started_at    timestamptz not null default now(),
  submitted_at  timestamptz,
  skip_reason   text,
  unique (staff_id, business_day, kind)
);
create index stock_counts_day_idx on public.stock_counts (business_day);

create table public.stock_count_lines (
  id            uuid primary key default gen_random_uuid(),
  count_id      uuid not null references public.stock_counts (id) on delete cascade,
  variant_id    uuid not null references public.product_variants (id),
  product_name  text not null,
  size          text not null,
  colour        text not null,
  expected      int not null,
  counted       int check (counted is null or counted >= 0),
  reviewed_at   timestamptz,
  reviewed_by   uuid references public.profiles (id),
  resolution    text check (resolution in ('accepted', 'dismissed')),
  unique (count_id, variant_id)
);
create index stock_count_lines_count_idx on public.stock_count_lines (count_id);

-- ---------------------------------------------------------------- read access (writes only via functions below)
alter table public.stock_counts enable row level security;
alter table public.stock_count_lines enable row level security;

create policy stock_counts_select on public.stock_counts for select to authenticated
  using (
    (select public.is_admin())
    or (staff_id = auth.uid() and (select public.can_use_app()) and business_day = (select public.lagos_now())::date)
  );
create policy stock_count_lines_select on public.stock_count_lines for select to authenticated
  using (exists (select 1 from public.stock_counts c where c.id = count_id));

revoke all on public.stock_counts, public.stock_count_lines from anon, authenticated;
grant select on public.stock_counts, public.stock_count_lines to authenticated;

-- ---------------------------------------------------------------- helpers
create or replace function public.lagos_today() returns date
language sql stable set search_path = public, pg_temp as $$
  select (now() at time zone 'Africa/Lagos')::date
$$;

create or replace function public.count_json(p_count_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', c.id, 'kind', c.kind, 'status', c.status, 'business_day', c.business_day,
    'started_at', c.started_at, 'submitted_at', c.submitted_at, 'skip_reason', c.skip_reason,
    'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'variant_id', l.variant_id, 'product_name', l.product_name, 'size', l.size, 'colour', l.colour,
        'expected', l.expected, 'counted', l.counted) order by l.product_name, l.colour, l.size)
      from public.stock_count_lines l where l.count_id = c.id), '[]'::jsonb)
  )
  from public.stock_counts c where c.id = p_count_id
$$;

-- ---------------------------------------------------------------- start (or resume) today's count
create or replace function public.start_stock_count(p_kind public.count_kind) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user public.profiles;
  v_day  date := public.lagos_today();
  v_id   uuid;
begin
  v_user := public.require_user(false);
  if p_kind = 'closing' and not exists (
    select 1 from public.stock_counts
     where staff_id = v_user.id and business_day = v_day and kind = 'opening' and status = 'submitted'
  ) then
    raise exception 'OPENING_COUNT_REQUIRED';
  end if;

  select id into v_id from public.stock_counts
   where staff_id = v_user.id and business_day = v_day and kind = p_kind;
  if found then
    return public.count_json(v_id);  -- resume, or show it is already done
  end if;

  insert into public.stock_counts (staff_id, kind, business_day) values (v_user.id, p_kind, v_day)
  returning id into v_id;

  -- Snapshot of EVERY item that can be sold, including ones at 0 (counting confirms nothing is hidden).
  insert into public.stock_count_lines (count_id, variant_id, product_name, size, colour, expected)
  select v_id, v.id, p.name, v.size, v.colour, v.quantity
    from public.product_variants v join public.products p on p.id = v.product_id
   where v.active and not p.archived;

  return public.count_json(v_id);
end $$;

-- ---------------------------------------------------------------- submit: every line must be counted
-- p_lines: [{"variant_id": uuid, "counted": int}, ...]
create or replace function public.submit_stock_count(p_count_id uuid, p_lines jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user  public.profiles;
  v_count public.stock_counts;
  v_missing int;
  v_summary jsonb;
begin
  v_user := public.require_user(false);
  select * into v_count from public.stock_counts where id = p_count_id for update;
  if not found or v_count.staff_id <> v_user.id or v_count.business_day <> public.lagos_today() then
    raise exception 'COUNT_NOT_FOUND';
  end if;
  if v_count.status <> 'in_progress' then
    raise exception 'COUNT_ALREADY_DONE';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'COUNT_INCOMPLETE';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lines) e
             where jsonb_typeof(e -> 'counted') <> 'number' or (e ->> 'counted')::numeric < 0
                or (e ->> 'counted')::numeric <> trunc((e ->> 'counted')::numeric)
                or (e ->> 'counted')::numeric > 1000000) then
    raise exception 'INVALID_QTY';
  end if;

  update public.stock_count_lines l
     set counted = (e ->> 'counted')::int
    from jsonb_array_elements(p_lines) e
   where l.count_id = p_count_id and l.variant_id = (e ->> 'variant_id')::uuid;

  -- Nothing may be left out.
  select count(*) into v_missing from public.stock_count_lines where count_id = p_count_id and counted is null;
  if v_missing > 0 then
    raise exception 'COUNT_INCOMPLETE: % items not counted', v_missing;
  end if;

  update public.stock_counts set status = 'submitted', submitted_at = now() where id = p_count_id;

  select jsonb_build_object(
    'kind', v_count.kind,
    'items', count(*),
    'units', coalesce(sum(counted), 0),
    'mismatches', count(*) filter (where counted <> expected),
    'missing', coalesce(sum(expected - counted) filter (where counted < expected), 0),
    'extra', coalesce(sum(counted - expected) filter (where counted > expected), 0)
  ) into v_summary
  from public.stock_count_lines where count_id = p_count_id;

  perform public.write_audit('stock_count', 'stock_count', p_count_id::text, v_summary);
  return public.count_json(p_count_id) || jsonb_build_object('summary', v_summary);
end $$;

-- ---------------------------------------------------------------- closing: "late, count tomorrow"
create or replace function public.skip_closing_count(p_reason text default null) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user public.profiles;
  v_day  date := public.lagos_today();
  v_reason text := coalesce(nullif(left(btrim(coalesce(p_reason, '')), 200), ''), 'Late – will count tomorrow');
begin
  v_user := public.require_user(false);
  if exists (select 1 from public.stock_counts
              where staff_id = v_user.id and business_day = v_day and kind = 'closing' and status = 'submitted') then
    raise exception 'COUNT_ALREADY_DONE';
  end if;
  insert into public.stock_counts (staff_id, kind, business_day, status, submitted_at, skip_reason)
  values (v_user.id, 'closing', v_day, 'skipped', now(), v_reason)
  on conflict (staff_id, business_day, kind) do update
    set status = 'skipped', submitted_at = now(), skip_reason = excluded.skip_reason;
  delete from public.stock_count_lines
   where count_id = (select id from public.stock_counts where staff_id = v_user.id and business_day = v_day and kind = 'closing');
  perform public.write_audit('stock_count_skipped', 'stock_count', v_day::text, jsonb_build_object('reason', v_reason));
end $$;

-- ---------------------------------------------------------------- admin: accept (correct stock) or dismiss a difference
create or replace function public.resolve_count_line(p_line_id uuid, p_accept boolean) returns void
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_user  public.profiles;
  v_line  public.stock_count_lines;
  v_count public.stock_counts;
  v_diff  int;
  v_old   int;
  v_new   int;
  v_who   text;
begin
  v_user := public.require_user(true);
  select * into v_line from public.stock_count_lines where id = p_line_id for update;
  if not found or v_line.counted is null or v_line.counted = v_line.expected then
    raise exception 'NOTHING_TO_RESOLVE';
  end if;
  if v_line.reviewed_at is not null then
    raise exception 'ALREADY_RESOLVED';
  end if;
  select * into v_count from public.stock_counts where id = v_line.count_id;
  select full_name into v_who from public.profiles where id = v_count.staff_id;
  v_diff := v_line.counted - v_line.expected;

  if p_accept then
    -- Apply the DIFFERENCE (not the old count), so sales made since the count are not undone.
    select quantity into v_old from public.product_variants where id = v_line.variant_id for update;
    v_new := greatest(v_old + v_diff, 0);
    if v_new <> v_old then
      update public.product_variants set quantity = v_new where id = v_line.variant_id;
      insert into public.stock_movements (variant_id, qty_change, quantity_after, reason, actor_id, note)
      values (v_line.variant_id, v_new - v_old, v_new, 'adjustment', v_user.id,
              format('%s count %s by %s: %s', initcap(v_count.kind::text), v_count.business_day, v_who,
                     case when v_diff < 0 then abs(v_diff) || ' missing' else v_diff || ' extra' end));
    end if;
  end if;

  update public.stock_count_lines
     set reviewed_at = now(), reviewed_by = v_user.id, resolution = case when p_accept then 'accepted' else 'dismissed' end
   where id = p_line_id;

  perform public.write_audit(case when p_accept then 'stock_count_accept' else 'stock_count_dismiss' end,
    'stock_count_line', p_line_id::text,
    jsonb_build_object('product', v_line.product_name, 'size', v_line.size, 'colour', v_line.colour,
                       'expected', v_line.expected, 'counted', v_line.counted, 'staff', v_who,
                       'kind', v_count.kind, 'day', v_count.business_day));
end $$;

-- ---------------------------------------------------------------- admin: daily report per sales person
create or replace function public.daily_count_report(p_day date) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_start timestamptz := (p_day::timestamp at time zone 'Africa/Lagos');
  v_end   timestamptz := ((p_day + 1)::timestamp at time zone 'Africa/Lagos');
begin
  perform public.require_user(true);
  return coalesce((
    select jsonb_agg(r order by r ->> 'full_name')
    from (
      select jsonb_build_object(
        'staff_id', p.id,
        'full_name', p.full_name,
        'opening', (select jsonb_build_object(
            'id', c.id, 'status', c.status, 'started_at', c.started_at, 'submitted_at', c.submitted_at,
            'items', count(l.id), 'units', coalesce(sum(l.counted), 0),
            'mismatches', count(l.id) filter (where l.counted <> l.expected),
            'unresolved', count(l.id) filter (where l.counted <> l.expected and l.reviewed_at is null),
            'missing', coalesce(sum(l.expected - l.counted) filter (where l.counted < l.expected), 0),
            'extra', coalesce(sum(l.counted - l.expected) filter (where l.counted > l.expected), 0))
          from public.stock_counts c left join public.stock_count_lines l on l.count_id = c.id
          where c.staff_id = p.id and c.business_day = p_day and c.kind = 'opening'
          group by c.id),
        'closing', (select jsonb_build_object(
            'id', c.id, 'status', c.status, 'started_at', c.started_at, 'submitted_at', c.submitted_at,
            'skip_reason', c.skip_reason,
            'items', count(l.id), 'units', coalesce(sum(l.counted), 0),
            'mismatches', count(l.id) filter (where l.counted <> l.expected),
            'unresolved', count(l.id) filter (where l.counted <> l.expected and l.reviewed_at is null),
            'missing', coalesce(sum(l.expected - l.counted) filter (where l.counted < l.expected), 0),
            'extra', coalesce(sum(l.counted - l.expected) filter (where l.counted > l.expected), 0))
          from public.stock_counts c left join public.stock_count_lines l on l.count_id = c.id
          where c.staff_id = p.id and c.business_day = p_day and c.kind = 'closing'
          group by c.id),
        'sales', (select count(*) from public.sales s
                   where s.staff_id = p.id and s.status = 'completed' and s.created_at >= v_start and s.created_at < v_end),
        'units_sold', (select coalesce(sum(i.qty), 0) from public.sale_items i join public.sales s on s.id = i.sale_id
                        where s.staff_id = p.id and s.status = 'completed' and s.created_at >= v_start and s.created_at < v_end),
        'total', (select coalesce(sum(s.total), 0) from public.sales s
                   where s.staff_id = p.id and s.status = 'completed' and s.created_at >= v_start and s.created_at < v_end)
      ) as r
      from public.profiles p
      where p.role = 'staff'
        and (p.active
             or exists (select 1 from public.stock_counts c where c.staff_id = p.id and c.business_day = p_day)
             or exists (select 1 from public.sales s where s.staff_id = p.id and s.created_at >= v_start and s.created_at < v_end))
    ) x
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- the rule: no opening count -> no sales
create or replace function public.enforce_count_before_sale() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_role public.user_role;
  v_day  date := public.lagos_today();
begin
  select role into v_role from public.profiles where id = new.staff_id;
  if v_role = 'staff' then
    if not exists (select 1 from public.stock_counts
                    where staff_id = new.staff_id and business_day = v_day and kind = 'opening' and status = 'submitted') then
      raise exception 'OPENING_COUNT_REQUIRED';
    end if;
    if exists (select 1 from public.stock_counts
                where staff_id = new.staff_id and business_day = v_day and kind = 'closing' and status in ('submitted', 'skipped')) then
      raise exception 'DAY_CLOSED';
    end if;
  end if;
  return new;
end $$;

create trigger sales_require_opening_count before insert on public.sales
  for each row execute function public.enforce_count_before_sale();

-- ---------------------------------------------------------------- session_status: + opening_done / closing_done
create or replace function public.session_status() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_now      timestamptz := now();
  v_local    timestamp := now() at time zone 'Africa/Lagos';
  v_prof     public.profiles;
  v_set      public.settings;
  v_open     boolean;
  v_current  boolean;
  v_close_at timestamptz;
  v_secs     int;
begin
  if auth.uid() is null then
    return jsonb_build_object('signed_in', false);
  end if;
  select * into v_prof from public.profiles where id = auth.uid();
  select * into v_set from public.settings where id = 1;
  v_open := public.staff_hours_open_at(v_now);
  v_current := v_prof.current_session_id is null or v_prof.current_session_id = public.jwt_session_id();

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
    'replaced', v_prof.id is not null and not v_current,
    'within_hours', v_open,
    'allowed', coalesce(v_prof.active, false) and v_current and (v_prof.role = 'admin' or v_open),
    'server_time', to_char(v_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'today', to_char(v_local, 'YYYY-MM-DD'),
    'open_time', to_char(v_set.staff_open_time, 'HH24:MI'),
    'close_time', to_char(v_set.staff_close_time, 'HH24:MI'),
    'warn_minutes', v_set.warn_minutes,
    'seconds_until_close', case when v_prof.role = 'staff' and v_open then v_secs end,
    'opening_done', exists (select 1 from public.stock_counts
                             where staff_id = auth.uid() and business_day = v_local::date
                               and kind = 'opening' and status = 'submitted'),
    'closing_done', exists (select 1 from public.stock_counts
                             where staff_id = auth.uid() and business_day = v_local::date
                               and kind = 'closing' and status in ('submitted', 'skipped'))
  );
end $$;

-- ---------------------------------------------------------------- grants
revoke execute on function public.count_json(uuid), public.enforce_count_before_sale() from public, anon, authenticated;
revoke execute on function public.lagos_today(), public.start_stock_count(public.count_kind),
  public.submit_stock_count(uuid, jsonb), public.skip_closing_count(text),
  public.resolve_count_line(uuid, boolean), public.daily_count_report(date) from public, anon;
grant execute on function public.lagos_today(), public.start_stock_count(public.count_kind),
  public.submit_stock_count(uuid, jsonb), public.skip_closing_count(text),
  public.resolve_count_line(uuid, boolean), public.daily_count_report(date) to authenticated;

commit;
