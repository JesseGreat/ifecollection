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
