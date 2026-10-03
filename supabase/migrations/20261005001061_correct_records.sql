-- Corrections in one step (patient page rework, 3 Oct 2026). Tapping a recorded visit, result, newborn observation
-- or documented history entry opens it for editing; saving writes the corrected version and withdraws the old one in
-- ONE transaction:
--   * the new row is inserted with `supersedes` = the old row (app.check_supersedes: same patient, old row still live);
--   * the old row (and, for a visit, its observations) is marked entered in error with the reason "Corrected", by
--     whom and when — nothing is overwritten, the old version stays in the record and the audit trail;
--   * a semantic `record_corrected` audit event names the old and the new row (row changes are audited by trigger).
-- Writer rules mirror the RPCs that recorded the entry: a visit is the obstetrician's (record_visit), a newborn
-- observation the paediatrician's (add_newborn_obs), a result the subject's writer (record_result), the mother's
-- documented history the obstetric team's (mark_entered_in_error). A closed pregnancy episode takes no corrections
-- (PT409); a row already corrected or withdrawn is stale (PT409); a test result also checks the test's `version`.

create function app.require_open_episode(p_pregnancy uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_pregnancy is not null and exists (select 1 from public.pregnancies g where g.id = p_pregnancy and g.status = 'closed') then
    raise exception 'This pregnancy episode is closed; its record can no longer be changed' using errcode = 'PT409';
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Visits (ANC) and newborn observations
-- ════════════════════════════════════════════════════════════════════════════════

-- Shared body of correct_visit / correct_newborn_obs (the wrappers check their payload allowlist first).
-- security definer: writes encounters / observations / tasks after app.require_writer has checked role and access.
create function app.correct_encounter(p jsonb, p_rpc text, p_kind text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  prev public.encounters;
  g public.pregnancies;
  b public.babies;
  e public.encounters;
  t timestamptz;
  at_text text;
  relinked int;
begin
  prior := app.idem_begin(p_rpc, p);
  if prior is not null then return prior; end if;

  select * into prev from public.encounters where id = (p ->> 'id')::uuid for update;
  if prev.id is null then perform app.not_visible(); end if;
  s := app.require_writer(prev.pregnancy_id, prev.baby_id);
  if prev.kind <> p_kind then
    raise exception 'This record is not a % and cannot be corrected here', case p_kind when 'anc' then 'visit' else 'newborn observation' end
      using errcode = 'PT422';
  end if;
  if prev.status <> 'final' then
    raise exception 'This record was already corrected or removed. Refresh and try again.' using errcode = 'PT409';
  end if;
  at_text := coalesce(p ->> 'at', prev.at::text);
  if p_kind = 'anc' then
    select * into g from public.pregnancies where id = prev.pregnancy_id;
    perform app.require_open_episode(g.id);
    t := app.visit_time(g, at_text);
  else
    select * into b from public.babies where id = prev.baby_id;
    t := app.effective_time(at_text);
    if t < b.dob then
      raise exception 'An observation cannot be before the time of birth' using errcode = 'PT422';
    end if;
  end if;

  insert into public.encounters (id, mother_id, pregnancy_id, baby_id, kind, at, by_staff, source, document_id, ga_days,
                                 complaints, complaints_note, counselling, note, completeness, supersedes)
  values (coalesce((p ->> 'encounter_id')::uuid, gen_random_uuid()), prev.mother_id, prev.pregnancy_id, prev.baby_id, prev.kind, t, s.id,
          prev.source, prev.document_id, case when p ? 'ga_days' then (p ->> 'ga_days')::int else prev.ga_days end,
          coalesce(app.text_array(p -> 'complaints', 'complaints'), '{}'), nullif(trim(p ->> 'complaints_note'), ''),
          coalesce(app.text_array(p -> 'counselling', 'counselling'), '{}'), nullif(trim(p ->> 'note'), ''),
          (p ->> 'completeness')::numeric, prev.id)
  returning * into e;

  -- each measurement supersedes the same measurement of the old version, when it had one
  insert into public.observations (encounter_id, mother_id, pregnancy_id, baby_id, code, value_num, value_text, unit, at, by_staff, supersedes)
  select e.id, e.mother_id, e.pregnancy_id, e.baby_id, x.code, x.value_num, nullif(trim(x.value_text), ''), x.unit, e.at, s.id,
         (select o.id from public.observations o where o.encounter_id = prev.id and o.code = x.code and o.status <> 'entered_in_error'
          order by o.at desc, o.id limit 1)
  from jsonb_to_recordset(coalesce(p -> 'observations', '[]'::jsonb)) as x(code text, value_num numeric, value_text text, unit text);

  insert into public.encounter_checklist (encounter_id, mother_id, component, state, reason)
  select e.id, e.mother_id, x.component, x.state, nullif(trim(x.reason), '')
  from jsonb_to_recordset(coalesce(p -> 'checklist', '[]'::jsonb)) as x(component text, state text, reason text);

  -- the visit a task was closed by is now the corrected one (at its corrected time)
  update public.tasks set completed_by_encounter_id = e.id, completed_at = e.at where completed_by_encounter_id = prev.id;
  get diagnostics relinked = row_count;

  update public.observations set status = 'entered_in_error', eie_reason = 'Corrected', eie_by = s.id, eie_at = app.event_time(null)
    where encounter_id = prev.id and status <> 'entered_in_error';
  update public.encounters set status = 'entered_in_error', eie_reason = 'Corrected', eie_by = s.id, eie_at = app.event_time(null)
    where id = prev.id;

  perform app.audit_event('record_corrected', 'encounters', prev.id::text, prev.mother_id,
                          jsonb_build_object('replaced_by', e.id, 'reason', 'Corrected'));
  return app.idem_finish(p, jsonb_build_object('encounter_id', e.id, 'replaces', prev.id, 'tasks_relinked', relinked));
end $$;

-- A recorded ANC visit, corrected: date and time of the visit, measurements, checklist, complaints, counselling, note.
create function public.correct_visit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.only_keys(p, array['idempotency_key','id','encounter_id','at','ga_days','observations','checklist','complaints',
                                 'complaints_note','counselling','note','completeness']);
  perform app.only_keys_each(p -> 'observations', array['code','value_num','value_text','unit'], 'observations');
  perform app.only_keys_each(p -> 'checklist', array['component','state','reason'], 'checklist');
  return app.correct_encounter(p, 'correct_visit', 'anc');
end $$;

-- A recorded newborn observation, corrected: its time, measurements and note.
create function public.correct_newborn_obs(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.only_keys(p, array['idempotency_key','id','encounter_id','at','observations','note']);
  perform app.only_keys_each(p -> 'observations', array['code','value_num','value_text','unit'], 'observations');
  return app.correct_encounter(p, 'correct_newborn_obs', 'newborn');
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Test results
-- ════════════════════════════════════════════════════════════════════════════════

-- A result as entered, corrected: value, unit, note and the date tested. Like record_result, a corrected result needs
-- a fresh clinician review (the test goes back to "awaiting review"). Stale test version → PT409.
create function public.correct_result(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  i public.investigations;
  prev public.investigation_results;
  r public.investigation_results;
begin
  perform app.only_keys(p, array['idempotency_key','result_id','id','version','value_num','value_text','unit','note','reported_at']);
  prior := app.idem_begin('correct_result', p);
  if prior is not null then return prior; end if;

  select * into prev from public.investigation_results where id = (p ->> 'result_id')::uuid for update;
  if prev.id is null then perform app.not_visible(); end if;
  select * into i from public.investigations where id = prev.investigation_id for update;
  if not app.can_see_investigation(i) then perform app.not_visible(); end if;
  s := app.require_writer(i.pregnancy_id, i.baby_id);
  perform app.check_version(i.version, p);
  if prev.status = 'entered_in_error' then
    raise exception 'This result was already corrected or removed. Refresh and try again.' using errcode = 'PT409';
  end if;
  perform app.require_open_episode(i.pregnancy_id);
  if p ->> 'value_num' is null and nullif(trim(p ->> 'value_text'), '') is null then
    raise exception 'Enter the result as reported' using errcode = 'PT422';
  end if;

  insert into public.investigation_results (id, investigation_id, mother_id, value_num, value_text, unit, lab_flag, reported_at,
                                            entered_by, source, document_id, note, status, supersedes)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), i.id, i.mother_id, (p ->> 'value_num')::numeric,
          nullif(trim(p ->> 'value_text'), ''), nullif(trim(p ->> 'unit'), ''), prev.lab_flag,
          app.effective_time(coalesce(p ->> 'reported_at', prev.reported_at::text)), s.id, prev.source, prev.document_id,
          nullif(trim(p ->> 'note'), ''), 'corrected', prev.id)
  returning * into r;
  -- withdrawn after the new version exists, so the test never passes through "no result"
  update public.investigation_results set status = 'entered_in_error', eie_reason = 'Corrected', eie_by = s.id, eie_at = app.event_time(null)
    where id = prev.id;
  update public.investigations set status = 'resulted', reviewed_at = null, reviewed_by = null, follow_up = null where id = i.id;

  perform app.audit_event('record_corrected', 'investigation_results', prev.id::text, i.mother_id,
                          jsonb_build_object('replaced_by', r.id, 'investigation_id', i.id, 'reason', 'Corrected'));
  select * into i from public.investigations where id = i.id;
  return app.idem_finish(p, jsonb_build_object('result_id', r.id, 'replaces', prev.id, 'investigation_id', i.id, 'version', i.version));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- The mother's documented history
-- ════════════════════════════════════════════════════════════════════════════════

-- A documented condition, allergy or previous pregnancy, corrected (as documented; nothing is interpreted).
create function public.correct_fact(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  k text := p ->> 'kind';
  tbl text := case p ->> 'kind' when 'condition' then 'documented_conditions' when 'allergy' then 'allergies'
                                when 'previous_pregnancy' then 'previous_pregnancies' end;
  prev jsonb;
  v_old uuid := (p ->> 'id')::uuid;
  v_new uuid := coalesce((p ->> 'new_id')::uuid, gen_random_uuid());
  m uuid;
  label text;
begin
  perform app.only_keys(p, array['idempotency_key','kind','id','new_id'] || case k
    when 'condition' then array['label']
    when 'allergy' then array['substance','reaction']
    when 'previous_pregnancy' then array['year','outcome','mode','gestation_weeks','complications','note']
    else array[]::text[] end);
  if tbl is null then
    raise exception 'Unknown history entry kind %', k using errcode = 'PT422';
  end if;
  prior := app.idem_begin('correct_fact', p);
  if prior is not null then return prior; end if;

  execute format('select to_jsonb(x) from public.%I x where x.id = $1 for update', tbl) into prev using v_old;
  if prev is null then perform app.not_visible(); end if;
  m := (prev ->> 'mother_id')::uuid;
  -- mother-level history is the obstetric team's (mark_entered_in_error)
  s := app.require_staff(array['obstetrician']);
  if not (m in (select app.full_mother_ids())) then perform app.not_visible(); end if;
  if prev ->> 'status' <> 'final' then
    raise exception 'This entry was already corrected or removed. Refresh and try again.' using errcode = 'PT409';
  end if;
  if not exists (select 1 from public.pregnancies g where g.mother_id = m and g.status <> 'closed') then
    raise exception 'Her pregnancy episode is closed; her history can no longer be changed' using errcode = 'PT409';
  end if;

  if k = 'condition' then
    label := nullif(trim(p ->> 'label'), '');
    if label is null or length(label) > 200 then
      raise exception 'Write the condition as documented (up to 200 characters)' using errcode = 'PT422';
    end if;
    insert into public.documented_conditions (id, mother_id, pregnancy_id, label, clinical_status, recorded_by, supersedes)
    values (v_new, m, (prev ->> 'pregnancy_id')::uuid, label, prev ->> 'clinical_status', s.id, v_old);
  elsif k = 'allergy' then
    label := nullif(trim(p ->> 'substance'), '');
    if label is null or length(label) > 200 then
      raise exception 'Write the allergy as documented (up to 200 characters)' using errcode = 'PT422';
    end if;
    insert into public.allergies (id, mother_id, substance, reaction, recorded_by, supersedes)
    values (v_new, m, label, nullif(trim(p ->> 'reaction'), ''), s.id, v_old);
  else
    if jsonb_typeof(p -> 'year') is distinct from 'number' or (p ->> 'year') !~ '^[0-9]{4}$'
       or (p ->> 'year')::int not between 1960 and extract(year from now())::int
       or coalesce(p ->> 'outcome', '') not in ('live_birth','stillbirth','miscarriage','induced_abortion','ectopic','molar','neonatal_death')
       or (nullif(p ->> 'mode', '') is not null and p ->> 'mode' not in ('vaginal','assisted','lscs'))
       or (p ? 'gestation_weeks' and jsonb_typeof(p -> 'gestation_weeks') not in ('number','null'))
       or (jsonb_typeof(p -> 'gestation_weeks') = 'number'
           and ((p ->> 'gestation_weeks') !~ '^[0-9]+$' or (p ->> 'gestation_weeks')::int not between 4 and 45)) then
      raise exception 'Check the previous pregnancy (year 1960–this year, an outcome, gestation 4–45 weeks)' using errcode = 'PT422';
    end if;
    insert into public.previous_pregnancies (id, mother_id, documented_in, year, outcome, mode, gestation_weeks, complications, note,
                                             recorded_by, supersedes)
    values (v_new, m, (prev ->> 'documented_in')::uuid, (p ->> 'year')::int, p ->> 'outcome', nullif(p ->> 'mode', ''),
            (p ->> 'gestation_weeks')::int, coalesce(app.text_array(p -> 'complications', 'complications'), '{}'),
            nullif(trim(p ->> 'note'), ''), s.id, v_old);
  end if;
  execute format('update public.%I set status = ''entered_in_error'', eie_reason = ''Corrected'', eie_by = $2, eie_at = $3 where id = $1', tbl)
    using v_old, s.id, app.event_time(null);

  perform app.audit_event('record_corrected', tbl, v_old::text, m, jsonb_build_object('replaced_by', v_new, 'reason', 'Corrected'));
  return app.idem_finish(p, jsonb_build_object('id', v_new, 'replaces', v_old));
end $$;

insert into app.api_functions values
  ('public','correct_visit'), ('public','correct_newborn_obs'), ('public','correct_result'), ('public','correct_fact');

do $$ begin perform app.apply_api_grants(); end $$;
