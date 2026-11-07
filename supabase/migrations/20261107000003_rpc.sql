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
