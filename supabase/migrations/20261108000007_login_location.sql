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
