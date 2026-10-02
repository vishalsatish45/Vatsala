-- Push tokens. register_push_token (20261005000400) claims a token for the signed-in user; this
-- adds its counterpart for sign-out, so a phone shared within a family stops receiving the previous person's
-- pushes. Only one's own token can be removed; removing an unknown token is a no-op (nothing to probe).
-- register_push_token now also refuses malformed input instead of storing it.

create or replace function public.register_push_token(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.only_keys(p, array['token','platform']);
  if (select auth.uid()) is null then perform app.not_visible(); end if;
  if coalesce(p ->> 'token', '') !~ '^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]{1,200}\]$' then
    raise exception 'Not an Expo push token' using errcode = 'PT422';
  end if;
  if coalesce(p ->> 'platform', '') not in ('android','ios') then
    raise exception 'Unknown platform' using errcode = 'PT422';
  end if;
  insert into public.push_tokens (token, user_id, platform) values (p ->> 'token', (select auth.uid()), p ->> 'platform')
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  return jsonb_build_object('registered', true);
end $$;

create function public.unregister_push_token(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform app.only_keys(p, array['token']);
  if (select auth.uid()) is null then perform app.not_visible(); end if;
  delete from public.push_tokens where token = p ->> 'token' and user_id = (select auth.uid());
  get diagnostics n = row_count;
  return jsonb_build_object('removed', n);
end $$;

insert into app.api_functions values ('public','unregister_push_token');

do $$ begin perform app.apply_api_grants(); end $$;
