-- Database bootstrap for the local end-to-end stack (real GoTrue + real PostgREST, no Docker).
-- Mirrors the roles and default grants a Supabase project has. NOT used in production.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin login superuser; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
alter role supabase_auth_admin set search_path = auth;

create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Minimal Storage tables (the gateway's storage stand-in uses the files on disk; policies are checked via is_admin()).
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text, owner uuid
);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects to authenticated, service_role;
