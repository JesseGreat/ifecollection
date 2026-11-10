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
