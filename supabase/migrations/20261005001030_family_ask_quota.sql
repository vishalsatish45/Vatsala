-- Family "Ask" assistant quota (Edge Function family-ask). The function calls
-- public.family_ai_quota after its warning-sign check and BEFORE the model is asked, so
--  1. only a family user may spend a model call: the mother herself, or a caregiver who is not removed — and, as
--     on every Family screen, with consent (app.family_actor). Staff and unknown users → PT403; family without
--     consent → PT404 (the same answer the family read functions give);
--  2. calls are capped per user (5 per 10 minutes, 15 per day) and share the project-wide AI budget with the Care
--     Team's ai_quota (8 per minute, 150 per day across app.ai_calls AND app.family_ai_calls). Over a cap → PT429.
-- Only who and when are stored: never the question, the topics or the answer. Every allowed call is counted,
-- whether or not the model then succeeds.

create table app.family_ai_calls (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  at timestamptz not null default now()
);
create index family_ai_calls_user_at on app.family_ai_calls(user_id, at);
create index family_ai_calls_at on app.family_ai_calls(at);
-- Server-internal: no API role reads or writes it (only the security-definer quota functions do).
revoke all on app.family_ai_calls from public, anon, authenticated;

-- All AI calls in the project (Care Team drafts + family questions) in the last minute and the last day.
create function app.ai_project_usage(out last_minute int, out last_day int)
language sql stable security definer set search_path = '' as $$
  select (count(*) filter (where x.at > now() - interval '1 minute'))::int, count(*)::int
  from (select a.at from app.ai_calls a where a.at > now() - interval '1 day'
        union all
        select f.at from app.family_ai_calls f where f.at > now() - interval '1 day') x
$$;

-- The caller acts for at least one mother as a family member. Security definer: it reads mothers / caregivers /
-- consents for auth.uid() only, through app.family_actor (the helper every family RPC uses).
create function app.require_family_user() returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  c record;
begin
  if me is null then
    raise exception 'Ask is for mothers and their families.' using errcode = 'PT403';
  end if;
  if not exists (select 1 from public.mothers where user_id = me)
     and not exists (select 1 from public.caregivers where user_id = me and revoked_at is null) then
    raise exception 'Ask is for mothers and their families.' using errcode = 'PT403';
  end if;
  if exists (select 1 from public.mothers where user_id = me) then
    begin
      perform app.family_actor(null);
      return;
    exception when sqlstate 'PT404' then null;
    end;
  end if;
  for c in select x.mother_id from public.caregivers x where x.user_id = me and x.revoked_at is null loop
    begin
      perform app.family_actor(c.mother_id);
      return;
    exception when sqlstate 'PT404' then null;
    end;
  end loop;
  perform app.not_visible();
end $$;

create function public.family_ai_quota(p jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
-- Security definer: it writes app.family_ai_calls, which no API role can touch; app.require_family_user has
-- already established that the caller is a consented family user.
declare
  me uuid := (select auth.uid());
  n_10m int;
  n_day int;
  u record;
begin
  perform app.only_keys(p, array['fn']);
  if p ? 'fn' and (p ->> 'fn') is distinct from 'family-ask' then
    raise exception 'fn must be family-ask' using errcode = 'PT422';
  end if;
  perform app.require_family_user();

  -- the same lock as ai_quota: calls against the shared project cap are counted one at a time
  perform pg_advisory_xact_lock(hashtext('ai_quota'));
  select count(*) filter (where at > now() - interval '10 minutes'), count(*)
    into n_10m, n_day from app.family_ai_calls where user_id = me and at > now() - interval '1 day';
  if n_day >= 15 then
    raise exception 'You have asked a lot of questions today. Try again tomorrow, or tap "Ask the hospital to call me".' using errcode = 'PT429';
  end if;
  if n_10m >= 5 then
    raise exception 'You have asked a lot of questions just now. Try again in a few minutes.' using errcode = 'PT429';
  end if;
  select * into u from app.ai_project_usage();
  if u.last_minute >= 8 or u.last_day >= 150 then
    raise exception 'The assistant is busy. Try again later, or tap "Ask the hospital to call me".' using errcode = 'PT429';
  end if;

  insert into app.family_ai_calls (user_id) values (me);
  return jsonb_build_object('ok', true, 'left_today', 14 - n_day);
end $$;

-- The Care Team quota, unchanged except that its project-wide cap now counts family questions too.
create or replace function public.ai_quota(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.staff;
  v_fn text := p ->> 'fn';
  n_hour int;
  n_day int;
  u record;
begin
  perform app.only_keys(p, array['fn','pregnancy_id','baby_id']);
  if v_fn is null or v_fn not in ('ai-brief', 'capture-transcribe') then
    raise exception 'fn must be ai-brief or capture-transcribe' using errcode = 'PT422';
  end if;
  s := app.require_writer((p ->> 'pregnancy_id')::uuid, (p ->> 'baby_id')::uuid);

  -- one clinician's calls are counted one at a time (no two requests both slipping under a cap)
  perform pg_advisory_xact_lock(hashtext('ai_quota'));
  select count(*) filter (where at > now() - interval '1 hour'), count(*) filter (where at > now() - interval '1 day')
    into n_hour, n_day from app.ai_calls where staff_id = s.id and at > now() - interval '1 day';
  if n_hour >= 6 or n_day >= 25 then
    raise exception 'You have used your AI drafts for now. Try again later.' using errcode = 'PT429';
  end if;
  select * into u from app.ai_project_usage();
  if u.last_minute >= 8 or u.last_day >= 150 then
    raise exception 'AI drafting is busy. Try again later.' using errcode = 'PT429';
  end if;

  insert into app.ai_calls (staff_id, fn) values (s.id, v_fn);
  return jsonb_build_object('ok', true, 'left_this_hour', 5 - n_hour, 'left_today', 24 - n_day);
end $$;

insert into app.api_functions values ('public','family_ai_quota');

do $$ begin perform app.apply_api_grants(); end $$;
