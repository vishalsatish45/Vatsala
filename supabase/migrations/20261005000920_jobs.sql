-- Scheduled jobs: reminders, call-back escalation, staff digest. Each job only inserts
-- notifications (kind + target id; never names or clinical detail, PRD F-04); the `push` Edge Function delivers
-- them. Every job takes the time as a parameter so tests can run it for any moment, and is safe to re-run.
--
-- The job functions are created everywhere; they are SCHEDULED only where pg_cron exists (Supabase). The laptop
-- has no pg_cron, so there the block below does nothing and the tests call the functions directly.
-- None of them is callable from the app (not in app.api_functions).

-- Family members who chose app reminders: app.family_users (consented mother, or active consented caregivers
-- holding the scope) filtered to those whose consent includes the reminders_app purpose.
create function app.reminder_users(p_mother uuid, p_scope text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u), '{}') from unnest(app.family_users(p_mother, p_scope)) u
  where app.consent_active(p_mother, u, 'reminders_app')
$$;

-- Reminders for visits and vaccines due TOMORROW (in the hospital's time zone). A visit's day is its booked
-- appointment, else the start of its window, else its due date. One notification per person, kind and target
-- per local day: re-running the job (it runs hourly) adds nothing.
--   visit_reminder   → target task
--   vaccine_reminder → target baby (UIP) or pregnancy (Td): one reminder per child however many doses are due
create function app.job_reminders(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  with hosp as (
    select h.id, h.timezone, (p_now at time zone h.timezone)::date as today from public.hospitals h
  ),
  due as (
    select k.mother_id, case when k.baby_id is null then 'schedule' else 'baby' end as scope,
           'visit_reminder' as kind, 'task' as target_type, k.id as target_id, h.timezone, h.today
    from public.tasks k
    join public.pregnancies g on g.id = coalesce(k.pregnancy_id, (select b.pregnancy_id from public.babies b where b.id = k.baby_id))
    join hosp h on h.id = g.hospital_id
    where k.completed_at is null and k.cancelled_at is null and k.lost_at is null
      and coalesce((k.appointment_at at time zone h.timezone)::date, k.due_from, k.due_by) = h.today + 1
    union
    select z.mother_id, case when z.baby_id is null then 'schedule' else 'baby' end,
           'vaccine_reminder', case when z.baby_id is null then 'pregnancy' else 'baby' end,
           coalesce(z.baby_id, z.pregnancy_id), h.timezone, h.today
    from public.immunizations z
    join public.pregnancies g on g.id = coalesce(z.pregnancy_id, (select b.pregnancy_id from public.babies b where b.id = z.baby_id))
    join hosp h on h.id = g.hospital_id
    where z.status = 'due' and z.due_on = h.today + 1
  ),
  recipients as (
    select distinct u as user_id, d.kind, d.target_type, d.target_id, d.timezone, d.today
    from due d cross join lateral unnest(app.reminder_users(d.mother_id, d.scope)) u
  )
  insert into public.notifications (user_id, kind, target_type, target_id, at)
  select r.user_id, r.kind, r.target_type, r.target_id, p_now from recipients r
  where not exists (select 1 from public.notifications x
                    where x.user_id = r.user_id and x.kind = r.kind and x.target_id = r.target_id
                      and x.at >= p_now - interval '2 days'
                      and (x.at at time zone r.timezone)::date = r.today);
  get diagnostics n = row_count;
  return n;
end $$;

-- A call-back still open 30 minutes after it was asked for: notify the whole treating team (the team that got the
-- first notice, app.callback_team, and its primary clinician) once more. Once per call-back.
create function app.job_callback_escalation(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  a public.care_assignments;
  n int := 0;
begin
  for c in select cb.id, cb.mother_id from public.callbacks cb
           where cb.closed_at is null and cb.at <= p_now - interval '30 minutes'
             and not exists (select 1 from public.notifications x
                             where x.kind = 'callback_waiting' and x.target_type = 'callback' and x.target_id = cb.id)
           order by cb.at limit 500 loop
    a := app.callback_team(c.mother_id);
    continue when a.id is null;
    insert into public.notifications (user_id, kind, target_type, target_id, at)
    select distinct s.user_id, 'callback_waiting', 'callback', c.id, p_now from public.staff s
    where s.active and s.user_id is not null
      and (s.id = a.primary_staff_id
           or s.id in (select tm.staff_id from public.team_members tm where tm.team_id = a.team_id and tm.to_at is null));
    n := n + 1;
  end loop;
  return n;
end $$;

-- 08:00 IST: one 'daily_digest' per active clinician who has patients in care (primary clinician, or member of a
-- team holding a current assignment, or of a department with an open referral). Once per local day. The digest
-- carries no content: the app opens the worklist.
create function app.job_staff_digest(p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  insert into public.notifications (user_id, kind, at)
  select s.user_id, 'daily_digest', p_now
  from public.staff s join public.hospitals h on h.id = s.hospital_id
  where s.active and s.user_id is not null and s.role in ('obstetrician','paediatrician','specialist')
    and (exists (select 1 from public.care_assignments ca where ca.to_at is null and ca.primary_staff_id = s.id)
         or exists (select 1 from public.care_assignments ca
                    join public.team_members tm on tm.team_id = ca.team_id and tm.to_at is null
                    where ca.to_at is null and tm.staff_id = s.id)
         or exists (select 1 from public.referrals r
                    join public.team_members tm on tm.team_id = r.to_team_id and tm.to_at is null
                    where r.ended_at is null and tm.staff_id = s.id))
    and not exists (select 1 from public.notifications x
                    where x.user_id = s.user_id and x.kind = 'daily_digest' and x.at >= p_now - interval '2 days'
                      and (x.at at time zone h.timezone)::date = (p_now at time zone h.timezone)::date);
  get diagnostics n = row_count;
  return n;
end $$;

-- Schedule on Supabase only (UTC cron): reminders hourly 07:30–20:30 IST (never in quiet hours), escalation every
-- 5 minutes, digest 08:00 IST. cron.schedule with a job name replaces an existing job of that name.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    execute $s$select cron.schedule('vatsala-reminders', '0 2-15 * * *', 'select app.job_reminders()')$s$;
    execute $s$select cron.schedule('vatsala-callback-escalation', '*/5 * * * *', 'select app.job_callback_escalation()')$s$;
    execute $s$select cron.schedule('vatsala-staff-digest', '30 2 * * *', 'select app.job_staff_digest()')$s$;
  end if;
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
