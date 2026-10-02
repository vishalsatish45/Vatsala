-- Care Team fixes (audit of 2 Oct 2026). Tests: supabase/tests/096_care_fixes.sql.
--
--  1. set_intensity  re-plans ANC visits only for an ongoing pregnancy (status 'active'; an admission keeps it
--                    active). A delivered or closed pregnancy records the new intensity, and a request that cancels
--                    or plans ANC visits for it is refused (PT409) instead of creating visits the family would see.
--  2. set_tags       takes deltas: `add` and `remove` (codes). The old full-list `codes` ended every active tag not
--                    in the list, so a tag another clinician set meanwhile was silently removed. Now only the named
--                    codes change; removing still needs a reason (NULL-safe), adding one already active and removing
--                    one already removed are no-ops. `codes` is no longer accepted (PT422, unknown key).
--  3. advance_referral  scheduling needs the place as well as the time (the family's appointment shows both).
--
-- Each function keeps its allowlist, idempotency, role/object checks and version checks; only the parts above change.

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. Intensity: no ANC re-plan after delivery
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function public.set_intensity(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  t timestamptz;
  g public.pregnancies;
  b public.babies;
  before text;
  cancelled int := 0;
  created int := 0;
  m uuid;
  replans boolean;
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','baby_id','version','intensity','note','cancel_task_ids','new_tasks','at']);
  perform app.only_keys_each(p -> 'new_tasks', array['id','kind','title','due_from','due_by','appointment_at','place'], 'new_tasks');
  prior := app.idem_begin('set_intensity', p);
  if prior is not null then return prior; end if;

  s := app.require_writer(v_preg, v_baby);
  t := app.event_time(p ->> 'at');
  -- a non-empty list of visits to cancel or to plan
  replans := coalesce(jsonb_array_length(case when jsonb_typeof(p -> 'new_tasks') = 'array' then p -> 'new_tasks' end), 0) > 0
          or coalesce(jsonb_array_length(case when jsonb_typeof(p -> 'cancel_task_ids') = 'array' then p -> 'cancel_task_ids' end), 0) > 0;
  if v_preg is not null then
    select * into g from public.pregnancies where id = v_preg for update;
    perform app.check_version(g.version, p);
    -- ANC visits belong to an ongoing pregnancy ('active', admitted or not); after delivery none are planned
    if g.status <> 'active' and replans then
      raise exception 'ANC visits are planned only for an ongoing pregnancy' using errcode = 'PT409';
    end if;
    before := g.intensity;
    m := g.mother_id;
    update public.pregnancies set intensity = p ->> 'intensity', intensity_set_by = s.id, intensity_set_at = t where id = g.id;
    select * into g from public.pregnancies where id = v_preg;
    if g.status = 'active' then
      cancelled := app.cancel_tasks(g.id, p -> 'cancel_task_ids', 'anc_visit', 'Re-planned: follow-up intensity changed', t);
      created := app.add_tasks(g, coalesce(p -> 'new_tasks', '[]'::jsonb), array['anc_visit'], 'protocol');
    end if;
  else
    if replans then
      raise exception 'A baby''s follow-up visits are not re-planned here' using errcode = 'PT422';
    end if;
    select * into b from public.babies where id = v_baby for update;
    perform app.check_version(b.version, p);
    before := b.intensity;
    m := b.mother_id;
    update public.babies set intensity = p ->> 'intensity' where id = b.id;
  end if;
  perform app.audit_event('set_intensity', case when v_preg is null then 'babies' else 'pregnancies' end,
                          coalesce(v_preg, v_baby)::text, m,
                          jsonb_build_object('from', before, 'to', p ->> 'intensity', 'note', p ->> 'note'));
  return app.idem_finish(p, jsonb_build_object('intensity', p ->> 'intensity', 'cancelled', cancelled, 'created', created));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. Tags as deltas
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function public.set_tags(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  m uuid;
  v_add text[];
  v_remove text[];
  v_reason text;
  t timestamptz;
  removed text[] := '{}';
  added text[];
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','baby_id','add','remove','note','removal_reason','at']);
  prior := app.idem_begin('set_tags', p);
  if prior is not null then return prior; end if;

  s := app.require_writer(v_preg, v_baby);
  m := coalesce((select mother_id from public.pregnancies where id = v_preg), (select mother_id from public.babies where id = v_baby));
  v_add := coalesce(app.text_array(p -> 'add', 'add'), '{}');
  v_remove := coalesce(app.text_array(p -> 'remove', 'remove'), '{}');
  if cardinality(v_add) = 0 and cardinality(v_remove) = 0 then
    raise exception 'Name the tags to add or remove' using errcode = 'PT422';
  end if;
  if v_add && v_remove then
    raise exception 'A tag cannot be added and removed in one change' using errcode = 'PT422';
  end if;
  t := app.event_time(p ->> 'at');

  if cardinality(v_remove) > 0 then
    -- the reason is required for any removal request (checked before anything changes)
    v_reason := app.require_reason(p ->> 'removal_reason', 'Removing a tag');
    with r as (
      update public.tags set removed_at = t, removed_by = s.id, removed_reason = v_reason
        where (pregnancy_id = v_preg or baby_id = v_baby) and removed_at is null and code = any(v_remove)
        returning code)
    select coalesce(array_agg(code order by code), '{}') into removed from r;
  end if;

  -- only codes not already active are added (a tag someone else set meanwhile stays one tag)
  select coalesce(array_agg(x order by x), '{}') into added from (select distinct x from unnest(v_add) x) d
    where not exists (select 1 from public.tags g where (g.pregnancy_id = v_preg or g.baby_id = v_baby)
                        and g.removed_at is null and g.code = d.x);
  insert into public.tags (mother_id, pregnancy_id, baby_id, code, note, set_by, set_at)
  select m, v_preg, v_baby, c, nullif(trim(p ->> 'note'), ''), s.id, t from unnest(added) c;

  perform app.audit_event('set_tags', case when v_preg is null then 'babies' else 'pregnancies' end,
                          coalesce(v_preg, v_baby)::text, m, jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed)));
  return app.idem_finish(p, jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed)));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. Referral appointments need their place
-- ════════════════════════════════════════════════════════════════════════════════

-- The receiving department accepts/declines, schedules, sees and answers; the referring team closes or cancels.
create or replace function public.advance_referral(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  r public.referrals;
  t timestamptz;
  dest text := p ->> 'to';
  receiving boolean;
  referring boolean;
  dept text;
  hosp uuid;
begin
  perform app.only_keys(p, array['idempotency_key','id','version','to','scheduled_at','place','recommendations','note',
                                 'appointment_task_id','at']);
  prior := app.idem_begin('advance_referral', p);
  if prior is not null then return prior; end if;

  s := app.require_staff();
  select * into r from public.referrals where id = (p ->> 'id')::uuid for update;
  if r.id is null or not app.can_see_subject(r.pregnancy_id, r.baby_id) then perform app.not_visible(); end if;
  perform app.check_version(r.version, p);
  receiving := exists (select 1 from public.team_members tm where tm.team_id = r.to_team_id and tm.staff_id = s.id and tm.to_at is null);
  referring := s.role = case when r.baby_id is null then 'obstetrician' else 'paediatrician' end
               and coalesce(r.pregnancy_id, r.baby_id) is not null
               and (r.mother_id in (select app.full_mother_ids()) or coalesce(r.pregnancy_id, r.baby_id) in (
                      select coalesce(g.pregnancy_id, g.baby_id) from app.my_grants() g where g.source <> 'referral'));

  if not ((r.status = 'requested' and dest in ('accepted','declined') and receiving)
       or (r.status in ('accepted','scheduled') and dest = 'scheduled' and receiving)
       or (r.status = 'scheduled' and dest = 'seen' and receiving)
       or (r.status = 'seen' and dest = 'recommendations' and receiving)
       or (r.status = 'recommendations' and dest = 'closed' and referring)
       or (r.status in ('requested','accepted','scheduled') and dest = 'cancelled' and referring)) then
    if dest in ('requested','accepted','declined','scheduled','seen','recommendations','closed','cancelled') then
      raise exception 'A % referral cannot be moved to % by %', r.status, dest,
        case when receiving then 'the receiving department' when referring then 'the referring team' else 'you' end
        using errcode = 'PT409';
    end if;
    raise exception 'Unknown referral status %', dest using errcode = 'PT422';
  end if;
  if dest = 'scheduled' and p ->> 'scheduled_at' is null then
    raise exception 'Scheduling needs a date and time' using errcode = 'PT422';
  end if;
  if dest = 'scheduled' and nullif(trim(p ->> 'place'), '') is null then
    raise exception 'Scheduling needs the place' using errcode = 'PT422';
  end if;
  if dest = 'recommendations' and nullif(trim(p ->> 'recommendations'), '') is null then
    raise exception 'Write the recommendations' using errcode = 'PT422';
  end if;
  if dest in ('declined','cancelled') then perform app.require_reason(p ->> 'note', initcap(dest)); end if;

  t := app.event_time(p ->> 'at');
  update public.referrals set status = dest,
         scheduled_at = coalesce((p ->> 'scheduled_at')::timestamptz, scheduled_at),
         place = coalesce(nullif(trim(p ->> 'place'), ''), place),
         recommendations = coalesce(nullif(trim(p ->> 'recommendations'), ''), recommendations),
         ended_at = case when dest in ('closed','declined','cancelled') then t end
    where id = r.id;
  -- strictly after the previous event, so "latest event" is unambiguous
  insert into public.referral_events (referral_id, mother_id, status, at, by_staff, note)
  values (r.id, r.mother_id, dest,
          greatest(t, (select max(e.at) + interval '1 millisecond' from public.referral_events e where e.referral_id = r.id)),
          s.id, nullif(trim(p ->> 'note'), ''));

  -- The appointment is a task the family sees; it follows the referral.
  if dest in ('scheduled','declined','cancelled') then
    update public.tasks set cancelled_at = t,
           override_reason = case dest when 'scheduled' then 'Appointment rescheduled' else 'Referral ' || dest end
      where referral_id = r.id and completed_at is null and cancelled_at is null;
  end if;
  if dest = 'scheduled' then
    select x.name, x.hospital_id into dept, hosp from public.teams x where x.id = r.to_team_id;
    insert into public.tasks (id, mother_id, pregnancy_id, baby_id, kind, title, referral_id, place, due_from, due_by,
                              appointment_at, generated_by)
    values (coalesce((p ->> 'appointment_task_id')::uuid, gen_random_uuid()), r.mother_id, r.pregnancy_id, r.baby_id,
            'referral_appt', dept || ' appointment', r.id, nullif(trim(p ->> 'place'), ''),
            app.local_date(hosp, (p ->> 'scheduled_at')::timestamptz), app.local_date(hosp, (p ->> 'scheduled_at')::timestamptz),
            (p ->> 'scheduled_at')::timestamptz, 'clinician');
  end if;
  if dest = 'seen' then
    update public.tasks set completed_at = t where referral_id = r.id and completed_at is null and cancelled_at is null;
  end if;
  select * into r from public.referrals where id = r.id;
  return app.idem_finish(p, jsonb_build_object('id', r.id, 'status', r.status, 'version', r.version));
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
