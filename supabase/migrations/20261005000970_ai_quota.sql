-- AI call quota (free-tier model API). Both Edge Functions call public.ai_quota BEFORE the model is asked, so
--  1. a caller who could not save the draft anyway (wrong role, record not visible) is refused without spending a
--     model call (previously the role was checked only when the draft was saved), and
--  2. calls are capped per clinician and for the whole project; over a cap the function answers PT429 and the app
--     shows "try again later". Every allowed call is counted, whether or not the model then succeeds.
-- Caps: 6 per clinician per hour, 25 per clinician per day, 8 per minute and 150 per day for the project.

create table app.ai_calls (
  id bigint generated always as identity primary key,
  staff_id uuid not null references public.staff(id),
  fn text not null check (fn in ('ai-brief', 'capture-transcribe')),
  at timestamptz not null default now()
);
create index ai_calls_staff_at on app.ai_calls(staff_id, at);
create index ai_calls_at on app.ai_calls(at);

create function public.ai_quota(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.staff;
  v_fn text := p ->> 'fn';
  n_hour int;
  n_day int;
  all_minute int;
  all_day int;
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
  select count(*) filter (where at > now() - interval '1 minute'), count(*)
    into all_minute, all_day from app.ai_calls where at > now() - interval '1 day';
  if n_hour >= 6 or n_day >= 25 then
    raise exception 'You have used your AI drafts for now. Try again later.' using errcode = 'PT429';
  end if;
  if all_minute >= 8 or all_day >= 150 then
    raise exception 'AI drafting is busy. Try again later.' using errcode = 'PT429';
  end if;

  insert into app.ai_calls (staff_id, fn) values (s.id, v_fn);
  return jsonb_build_object('ok', true, 'left_this_hour', 5 - n_hour, 'left_today', 24 - n_day);
end $$;

insert into app.api_functions values ('public','ai_quota');

do $$ begin perform app.apply_api_grants(); end $$;
