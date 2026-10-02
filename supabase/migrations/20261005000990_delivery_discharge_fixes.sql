-- Admission → delivery → discharge → newborn fixes (audit of 2 Oct 2026). Same RPC contract as 20261005000600:
-- allowlist → idempotency → role + object access → checks → writes → audit → stored response.
--
--  1. Follow-up windows up to 92 days: a tag template may span weeks 6–12 after birth (tpl_glucose, 42 days wide);
--     the 31-day cap refused every GDM-tagged mother's discharge.
--  2. Times that would break a table constraint are refused with a clear PT422 instead of a constraint error:
--     an admission ending before it began, a discharge before the delivery or the admission, a death before birth.
--  3. A delivered episode closes after the mother's discharge checklist is complete (said plainly, PT409).
--  4. A recorded vaccine dose (given or not given) can be marked entered in error; the dose returns as due under a
--     new row (the caller may name its id), so it can be recorded again.

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. Follow-up plan plausibility
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function app.add_followups(p_mother uuid, p_pregnancy uuid, p_baby uuid, p_tasks jsonb, p_from date) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
  bad text;
begin
  perform app.only_keys_each(p_tasks, array['id','kind','title','template_key','due_from','due_by'], 'follow_up_tasks');
  -- a window may be up to 92 days wide (a quarter): hospital templates such as "weeks 6–12" are 6 weeks wide
  select string_agg(coalesce(x.title, '?'), ', ') into bad
  from jsonb_to_recordset(p_tasks) as x(kind text, title text, template_key text, due_from date, due_by date)
  where x.kind not in (case when p_baby is null then 'pn_visit' else 'nb_visit' end, 'template')
     or nullif(trim(x.title), '') is null or x.due_by is null
     or (x.kind = 'template') <> (x.template_key is not null)
     or (x.due_from is not null and (x.due_from > x.due_by or x.due_by - x.due_from > 92))
     or x.due_by < p_from or x.due_by > p_from + 400;
  if bad is not null then
    raise exception 'These follow-up visits are not possible: %', bad using errcode = 'PT422';
  end if;
  insert into public.tasks (id, mother_id, pregnancy_id, baby_id, kind, title, template_key, due_from, due_by, generated_by)
  select coalesce(x.id, gen_random_uuid()), p_mother, p_pregnancy, p_baby, x.kind, trim(x.title), x.template_key,
         x.due_from, x.due_by, case when x.kind = 'template' then 'template' else 'protocol' end
  from jsonb_to_recordset(p_tasks) as x(id uuid, kind text, title text, template_key text, due_from date, due_by date);
  get diagnostics n = row_count;
  return n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. Times in order
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function public.end_admission(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  a public.admissions;
  t timestamptz;
begin
  perform app.only_keys(p, array['idempotency_key','admission_id','at']);
  prior := app.idem_begin('end_admission', p);
  if prior is not null then return prior; end if;
  select * into a from public.admissions where id = (p ->> 'admission_id')::uuid for update;
  if a.id is null then perform app.not_visible(); end if;
  s := app.require_writer(a.pregnancy_id, null);
  if a.discharged_at is not null then
    raise exception 'This admission has ended' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.discharges d where d.admission_id = a.id) then
    raise exception 'Complete the discharge checklist instead' using errcode = 'PT409';
  end if;
  t := app.effective_time(p ->> 'at');
  if t < a.admitted_at then
    raise exception 'The admission cannot end before it began' using errcode = 'PT422';
  end if;
  update public.admissions set discharged_at = t, discharged_by = s.id where id = a.id;
  return app.idem_finish(p, jsonb_build_object('admission_id', a.id, 'ended', true));
end $$;

create or replace function public.complete_discharge(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  d public.discharges;
  t timestamptz;
  n int;
  hosp uuid;
begin
  perform app.only_keys(p, array['idempotency_key','discharge_id','version','follow_up_tasks','at']);
  prior := app.idem_begin('complete_discharge', p);
  if prior is not null then return prior; end if;
  select * into d from public.discharges where id = (p ->> 'discharge_id')::uuid for update;
  if d.id is null then perform app.not_visible(); end if;
  s := app.require_writer(d.pregnancy_id, d.baby_id);
  perform app.check_version(d.version, p);
  if d.completed_at is not null then
    raise exception 'This discharge is complete' using errcode = 'PT409';
  end if;
  t := app.effective_time(p ->> 'at');
  if t < d.started_at then
    raise exception 'The discharge cannot be before the delivery' using errcode = 'PT422';
  end if;
  if d.admission_id is not null and t < (select a.admitted_at from public.admissions a where a.id = d.admission_id) then
    raise exception 'The discharge cannot be before the admission' using errcode = 'PT422';
  end if;
  select g.hospital_id into hosp from public.pregnancies g
    where g.id = coalesce(d.pregnancy_id, (select b.pregnancy_id from public.babies b where b.id = d.baby_id));
  begin
    update public.discharges set completed_at = t, completed_by = s.id where id = d.id;
  exception when check_violation then
    raise exception 'Every checklist item must be done, N/A or deferred with a reason' using errcode = 'PT409';
  end;
  if d.admission_id is not null then
    update public.admissions set discharged_at = t, discharged_by = s.id where id = d.admission_id and discharged_at is null;
  end if;
  n := app.add_followups(d.mother_id, d.pregnancy_id, d.baby_id, coalesce(p -> 'follow_up_tasks', '[]'::jsonb), app.local_date(hosp, t));
  perform app.audit_event('complete_discharge', 'discharges', d.id::text, d.mother_id, jsonb_build_object('follow_ups', n));
  return app.idem_finish(p, jsonb_build_object('discharge_id', d.id, 'follow_ups', n));
end $$;

create or replace function public.record_baby_death(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  b public.babies;
  t timestamptz;
begin
  perform app.only_keys(p, array['idempotency_key','baby_id','version','at','note']);
  prior := app.idem_begin('record_baby_death', p);
  if prior is not null then return prior; end if;
  s := app.require_writer(null, (p ->> 'baby_id')::uuid);
  select * into b from public.babies where id = (p ->> 'baby_id')::uuid for update;
  perform app.check_version(b.version, p);
  if b.outcome <> 'live' or b.deceased_at is not null then
    raise exception 'Already recorded' using errcode = 'PT409';
  end if;
  t := app.effective_time(p ->> 'at');
  if t < b.dob then
    raise exception 'The time of death cannot be before the time of birth' using errcode = 'PT422';
  end if;
  update public.babies set deceased_at = t where id = b.id;
  update public.tasks set cancelled_at = t, override_reason = 'Baby died' where baby_id = b.id and completed_at is null and cancelled_at is null;
  update public.immunizations set status = 'not_given', not_given_reason = 'Baby died' where baby_id = b.id and status = 'due';
  update public.investigations set status = 'not_applicable', not_done_reason = 'Baby died'
    where baby_id = b.id and status in ('due','ordered','collected');
  -- an assignment made after the recorded time (e.g. a later handover) ends when it began, never before
  update public.care_assignments set to_at = greatest(t, from_at) where baby_id = b.id and to_at is null;
  perform app.audit_event('baby_death', 'babies', b.id::text, b.mother_id, jsonb_build_object('note', p ->> 'note'));
  return app.idem_finish(p, jsonb_build_object('baby_id', b.id, 'recorded', true));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. Closing a delivered episode
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function public.end_pregnancy(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  g public.pregnancies;
  reason text := p ->> 'reason';
  t timestamptz;
  v_note text;
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','version','reason','ended_on','note']);
  prior := app.idem_begin('end_pregnancy', p);
  if prior is not null then return prior; end if;
  s := app.require_writer((p ->> 'pregnancy_id')::uuid, null);
  select * into g from public.pregnancies where id = (p ->> 'pregnancy_id')::uuid for update;
  perform app.check_version(g.version, p);
  if g.status = 'closed' then
    raise exception 'This episode is already closed' using errcode = 'PT409';
  end if;
  if (reason = 'delivered') <> (g.status = 'delivered') then
    raise exception 'A delivered episode closes with reason "delivered"; an ongoing pregnancy ends with its outcome'
      using errcode = 'PT422';
  end if;
  if g.status = 'delivered' and exists (select 1 from public.discharges d where d.pregnancy_id = g.id and d.completed_at is null) then
    raise exception 'Complete the mother''s discharge checklist first' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.admissions a where a.pregnancy_id = g.id and a.discharged_at is null) then
    raise exception 'End the admission first' using errcode = 'PT409';
  end if;
  t := now();
  v_note := 'Pregnancy ended (' || reason || ')';
  update public.pregnancies set status = 'closed', end_reason = reason,
         ended_on = case when reason = 'delivered' then ended_on else coalesce((p ->> 'ended_on')::date, app.local_date(g.hospital_id, t)) end
    where id = g.id;
  update public.tasks set cancelled_at = t, override_reason = v_note
    where pregnancy_id = g.id and completed_at is null and cancelled_at is null;
  update public.investigations set status = 'not_applicable', not_done_reason = v_note
    where pregnancy_id = g.id and status in ('due','ordered','collected');
  update public.immunizations set status = 'not_given', not_given_reason = v_note where pregnancy_id = g.id and status = 'due';
  update public.medications set status = 'stopped', stopped_reason = v_note
    where pregnancy_id = g.id and status = 'active' and kind = 'prescription';
  if reason = 'maternal_death' then
    update public.mothers set deceased_at = coalesce((p ->> 'ended_on')::date::timestamptz, t) where id = g.mother_id;
  end if;
  perform app.audit_event('end_pregnancy', 'pregnancies', g.id::text, g.mother_id,
                          jsonb_build_object('reason', reason, 'note', p ->> 'note'));
  return app.idem_finish(p, jsonb_build_object('pregnancy_id', g.id, 'status', 'closed', 'end_reason', reason));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. Vaccine doses entered in error
-- ════════════════════════════════════════════════════════════════════════════════

-- A dose marked entered in error keeps its given_on (the fact as it was recorded); only due / not-given doses have none.
alter table public.immunizations drop constraint immunizations_check1;
alter table public.immunizations add constraint immunizations_given_on check (
  (status <> 'given' or given_on is not null) and (status not in ('due','not_given') or given_on is null));

-- The only way to retract a recorded fact (FHIR entered-in-error). An encounter takes its observations with it;
-- withdrawing a test's last result sends the test back to waiting (trigger). A vaccine dose (given or not given)
-- is replaced by a fresh row for the same dose — due again (or not given if the baby has died or the episode has
-- closed) — under `replacement_id` when the caller names one, so the phone can record it again at once.
create or replace function public.mark_entered_in_error(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  tbl text := case p ->> 'kind'
    when 'observation' then 'observations'        when 'encounter' then 'encounters'
    when 'investigation_result' then 'investigation_results'
    when 'care_note' then 'care_notes'            when 'self_log' then 'self_logs'
    when 'condition' then 'documented_conditions' when 'allergy' then 'allergies'
    when 'previous_pregnancy' then 'previous_pregnancies'
    when 'immunization' then 'immunizations' end;
  v_id uuid := (p ->> 'id')::uuid;
  reason text;
  row_json jsonb;
  t timestamptz;
  z public.immunizations;
  closed_why text;
  v_new uuid;
begin
  perform app.only_keys(p, array['idempotency_key','kind','id','reason','at','replacement_id']);
  prior := app.idem_begin('mark_entered_in_error', p);
  if prior is not null then return prior; end if;
  if tbl is null then
    raise exception 'Unknown record kind %', p ->> 'kind' using errcode = 'PT422';
  end if;
  if p ? 'replacement_id' and tbl <> 'immunizations' then
    raise exception 'replacement_id is only for a vaccine dose' using errcode = 'PT422';
  end if;
  execute format('select to_jsonb(x) from public.%I x where x.id = $1', tbl) into row_json using v_id;
  if row_json is null then perform app.not_visible(); end if;
  if row_json ->> 'status' = 'entered_in_error' then
    raise exception 'Already marked as entered in error' using errcode = 'PT409';
  end if;
  if tbl = 'investigation_results' then
    select to_jsonb(i) into row_json from public.investigations i where i.id = (row_json ->> 'investigation_id')::uuid;
  end if;
  -- the writer of that record's subject; mother-level history (conditions, allergies, past pregnancies) is the
  -- obstetric team's
  if row_json ? 'pregnancy_id' or row_json ? 'baby_id' then
    if row_json ->> 'pregnancy_id' is null and row_json ->> 'baby_id' is null then
      s := app.require_staff(array['obstetrician']);
      if not ((row_json ->> 'mother_id')::uuid in (select app.full_mother_ids())) then perform app.not_visible(); end if;
    else
      s := app.require_writer((row_json ->> 'pregnancy_id')::uuid, (row_json ->> 'baby_id')::uuid);
    end if;
  else
    s := app.require_staff(array['obstetrician']);
    if not ((row_json ->> 'mother_id')::uuid in (select app.full_mother_ids())) then perform app.not_visible(); end if;
  end if;
  if tbl = 'immunizations' and row_json ->> 'status' = 'due' then
    raise exception 'Nothing has been recorded for this dose yet' using errcode = 'PT409';
  end if;
  reason := app.require_reason(p ->> 'reason', 'Marking an entry as entered in error');
  t := app.event_time(p ->> 'at');
  if tbl = 'self_logs' then
    update public.self_logs set status = 'entered_in_error', eie_reason = reason, eie_at = t where id = v_id;
  else
    execute format('update public.%I set status = ''entered_in_error'', eie_reason = $2, eie_by = $3, eie_at = $4 where id = $1', tbl)
      using v_id, reason, s.id, t;
  end if;
  if tbl = 'encounters' then
    update public.observations set status = 'entered_in_error', eie_reason = reason, eie_by = s.id, eie_at = t
      where encounter_id = v_id and status <> 'entered_in_error';
  end if;
  if tbl = 'immunizations' then
    select * into z from public.immunizations where id = v_id;
    closed_why := case
      when z.baby_id is not null and exists (select 1 from public.babies b where b.id = z.baby_id and (b.outcome <> 'live' or b.deceased_at is not null))
        then 'Baby died'
      when z.pregnancy_id is not null and exists (select 1 from public.pregnancies g where g.id = z.pregnancy_id and g.status = 'closed')
        then 'Pregnancy episode closed' end;
    insert into public.immunizations (id, mother_id, pregnancy_id, baby_id, code, due_on, status, not_given_reason)
    values (coalesce((p ->> 'replacement_id')::uuid, gen_random_uuid()), z.mother_id, z.pregnancy_id, z.baby_id, z.code, z.due_on,
            case when closed_why is null then 'due' else 'not_given' end, closed_why)
    returning id into v_new;
    -- Td-2 was planned from Td-1's date: a withdrawn Td-1 withdraws a Td-2 nobody has recorded yet
    if z.code = 'td1' then
      update public.immunizations set status = 'entered_in_error', eie_reason = 'Td-1 entered in error', eie_by = s.id, eie_at = t
        where pregnancy_id = z.pregnancy_id and code = 'td2' and status = 'due';
    end if;
  end if;
  perform app.audit_event('entered_in_error', tbl, v_id::text, (row_json ->> 'mother_id')::uuid, jsonb_build_object('reason', reason));
  return app.idem_finish(p, jsonb_build_object('id', v_id, 'status', 'entered_in_error')
                            || case when v_new is null then '{}'::jsonb else jsonb_build_object('replacement_id', v_new) end);
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
