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
