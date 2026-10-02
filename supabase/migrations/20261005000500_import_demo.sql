-- Register import (PRD F-30), demo reset, and TRUNCATE protection.
--
--   confirm_import(p)  rows parsed and planned by the app (registerImport.ts + shared/domain) are registered one
--                      by one through register_pregnancy (source = import); a bad row is reported, never fatal.
--   reset_demo(p)      demo mode only: clears patient data and loads the synthetic demo cast (fake people only).
--
-- TRUNCATE skips row-level triggers, so it would bypass "clinical rows are never deleted". Every table that
-- forbids deletes now forbids TRUNCATE too; demo reset is the only exception (app.demo_reset).

-- ── TRUNCATE protection ─────────────────────────────────────────────────────────

create function app.forbid_truncate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if app.demo_reset_active() then return null; end if;
  raise exception '% cannot be truncated', tg_table_name;
end $$;

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
           and tablename not in ('notifications','push_tokens','idempotency_keys','audit_log') loop
    execute format('create trigger %I before truncate on public.%I for each statement execute function app.forbid_truncate()',
                   t || '_no_truncate', t);
  end loop;
end $$;

-- ── Register import ─────────────────────────────────────────────────────────────

-- Rows are the same payload as register_pregnancy (without idempotency_key). Each row gets a deterministic
-- request id derived from the import's id and its position, so re-sending an import never duplicates a row.
create function public.confirm_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  r jsonb;
  i int := 0;
  created jsonb := '[]';
  rejected jsonb := '[]';
  out jsonb;
  result jsonb;
begin
  perform app.only_keys(p, array['idempotency_key','file_name','rows']);
  prior := app.idem_begin('confirm_import', p);
  if prior is not null then return prior; end if;
  s := app.require_staff(array['obstetrician']);
  if jsonb_typeof(p -> 'rows') <> 'array' or jsonb_array_length(p -> 'rows') = 0 then
    raise exception 'Nothing to import' using errcode = 'PT422';
  end if;
  if jsonb_array_length(p -> 'rows') > 500 then
    raise exception 'Import at most 500 rows at a time' using errcode = 'PT422';
  end if;
  for r in select value from jsonb_array_elements(p -> 'rows') loop
    i := i + 1;
    begin
      out := public.register_pregnancy((r - 'idempotency_key') || jsonb_build_object(
               'idempotency_key', md5((p ->> 'idempotency_key') || ':' || i)::uuid, 'source', 'import'));
      created := created || jsonb_build_array(jsonb_build_object('row', i, 'pregnancy_id', out ->> 'pregnancy_id', 'mch_id', out ->> 'mch_id'));
    exception when others then
      rejected := rejected || jsonb_build_array(jsonb_build_object('row', i, 'reason', sqlerrm));
    end;
  end loop;
  perform app.audit_event('import', 'imports', p ->> 'idempotency_key', null,
    jsonb_build_object('file_name', p ->> 'file_name', 'rows', i, 'created', jsonb_array_length(created),
                       'rejected', jsonb_array_length(rejected)));
  result := jsonb_build_object('created', created, 'rejected', rejected);
  return app.idem_finish(p, result);
end $$;

-- ── Demo reset ──────────────────────────────────────────────────────────────────

-- One synthetic pregnancy with its history, dated relative to today. Used only by the demo loader.
-- Visits at the given weeks (each with weight, BP and a checklist), the ANC test set (results reviewed for
-- windows already closed), the obstetric and paediatric teams, Td-1, and the next visit p_next_in days away
-- (negative = missed).
create function app.demo_pregnancy(p_mother uuid, p_preg uuid, p_ga_days int, p_team uuid, p_primary uuid,
                                   p_intensity text, p_gpla int[], p_visit_weeks int[], p_next_in int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  h uuid := '00000000-0000-4000-8000-000000000001';
  paeds uuid := '00000000-0000-4000-8001-0000000000a2';
  edd date := current_date + (280 - p_ga_days);
  lmp date := current_date - p_ga_days;
  reg timestamptz := (lmp + 7 * coalesce(p_visit_weeks[1], p_ga_days / 7))::timestamp at time zone 'Asia/Kolkata';
  mch text := 'MCH-' || to_char(current_date, 'YYYY') || '-' || lpad(app.next_number(h, 'mch', to_char(current_date, 'YYYY'))::text, 6, '0');
  w int;
  e uuid;
  c record;
begin
  insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions,
                                  intensity, intensity_set_by, intensity_set_at, created_by)
  values (p_preg, mch, p_mother, h, reg, edd, p_gpla[1], p_gpla[2], p_gpla[3], p_gpla[4], p_intensity, p_primary, reg, p_primary);
  insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, lmp_certain, edd, decided_by, decided_at)
  values (p_preg, p_mother, 'lmp', lmp, true, edd, p_primary, reg);
  insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at, assigned_by, reason)
  values (p_mother, p_preg, 'obstetrics', p_team, p_primary, reg, p_primary, 'Registration'),
         (p_mother, p_preg, 'paediatrics', paeds, null, reg, p_primary, 'Registration (from 34 weeks)');
  insert into public.patient_identifiers (mother_id, system, value, hospital_id, assigned_by)
  values (p_mother, 'mrn', 'DDH-' || lpad(app.next_number(h, 'mrn', 'all')::text, 6, '0'), h, p_primary);

  -- past visits, each closing its own task
  foreach w in array p_visit_weeks loop
    e := gen_random_uuid();
    insert into public.encounters (id, mother_id, pregnancy_id, kind, at, by_staff, ga_days, counselling, completeness)
    values (e, p_mother, p_preg, case when w = p_visit_weeks[1] then 'registration' else 'anc' end,
            (lmp + w * 7)::timestamp at time zone 'Asia/Kolkata' + interval '10 hours', p_primary, w * 7, '{nutrition}', 0.9);
    insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, value_text, at, by_staff)
    select e, p_mother, p_preg, x.code, x.num, x.txt, (lmp + w * 7)::timestamp at time zone 'Asia/Kolkata' + interval '10 hours', p_primary
    from (values ('weight', 52 + w * 0.35, null), ('bp_sys', 112 + (w % 5), null), ('bp_dia', 72 + (w % 4), null),
                 ('urine_albumin', null, 'Nil')) x(code, num, txt);
    insert into public.encounter_checklist (encounter_id, mother_id, component, state)
    values (e, p_mother, 'bp', 'done'), (e, p_mother, 'weight', 'done'), (e, p_mother, 'urine_albumin', 'done');
    if w <> p_visit_weeks[1] then
      insert into public.tasks (mother_id, pregnancy_id, kind, title, due_from, due_by, generated_by, completed_at, completed_by_encounter_id)
      values (p_mother, p_preg, 'anc_visit', 'ANC visit · ' || w || ' weeks', lmp + w * 7 - 2, lmp + w * 7, 'protocol',
              (lmp + w * 7)::timestamp at time zone 'Asia/Kolkata' + interval '10 hours', e);
    end if;
  end loop;
  insert into public.tasks (mother_id, pregnancy_id, kind, title, due_from, due_by, generated_by)
  values (p_mother, p_preg, 'anc_visit', 'ANC visit · ' || ((p_ga_days + p_next_in) / 7) || ' weeks',
          current_date + p_next_in - 2, current_date + p_next_in, 'protocol');

  -- ANC tests: windows from the catalogue's standard schedule; closed windows have reviewed results
  for c in select * from (values ('hb1', 0, 14, 'num', 11.6), ('bg', 0, 14, 'B+', null), ('urine', 0, 14, 'Albumin nil · sugar nil', null),
                                 ('hiv', 0, 14, 'Non-reactive', null), ('vdrl', 0, 14, 'Non-reactive', null), ('hbsag', 0, 14, 'Non-reactive', null),
                                 ('rbs', 0, 14, 'num', 94), ('dating', 6, 14, 'Consistent with LMP', null), ('anomaly', 18, 22, 'Report documented', null),
                                 ('ogtt', 24, 28, '2-h 118 mg/dL', null), ('hb2', 24, 28, 'num', 11.0), ('hb3', 32, 36, 'num', 11.2))
                    as t(code, wk_from, wk_to, txt, num) loop
    declare
      inv uuid := gen_random_uuid();
      d_from date := greatest(lmp + c.wk_from * 7, reg::date);
      d_to date := greatest(lmp + c.wk_to * 7 + 6, reg::date + 14);
      done boolean := d_to < current_date;
    begin
      insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by, late, status, ordered_at, ordered_by)
      values (inv, p_mother, p_preg, c.code, (select label from public.investigation_catalogue where code = c.code), d_from, d_to,
              lmp + c.wk_to * 7 + 6 < reg::date, case when done then 'ordered' else 'due' end,
              case when done then d_from::timestamp at time zone 'Asia/Kolkata' end, case when done then p_primary end);
      if done then
        insert into public.investigation_results (investigation_id, mother_id, value_num, value_text, unit, reported_at, entered_by)
        values (inv, p_mother, c.num, case when c.txt = 'num' then null else c.txt end,
                (select default_unit from public.investigation_catalogue where code = c.code),
                (d_to - 2)::timestamp at time zone 'Asia/Kolkata', p_primary);
        update public.investigations set status = 'resulted' where id = inv;
        update public.investigations set status = 'reviewed', reviewed_at = (d_to - 1)::timestamp at time zone 'Asia/Kolkata',
               reviewed_by = p_primary, follow_up = 'none' where id = inv;
      end if;
    end;
  end loop;

  insert into public.immunizations (mother_id, pregnancy_id, code, due_on, status, given_on, primary_source, given_by)
  values (p_mother, p_preg, 'td1', reg::date, 'given', reg::date, true, p_primary);
  insert into public.medications (mother_id, pregnancy_id, kind, name, dose, slots, instructions, start_on, prescribed_by)
  values (p_mother, p_preg, 'prescription', 'IFA', '1 tablet', '{afternoon}', 'After lunch', reg::date, p_primary),
         (p_mother, p_preg, 'prescription', 'Calcium', '1 tablet', '{morning,night}', 'After breakfast and dinner', reg::date, p_primary);
end $$;

-- The synthetic demo cast (src/features/auth/demoAccounts.ts). None of these people exist.
create function app.load_demo_patients() returns void
language plpgsql security definer set search_path = '' as $$
declare
  unit_a uuid := '00000000-0000-4000-8001-0000000000a1';
  paeds uuid := '00000000-0000-4000-8001-0000000000a2';
  cardio uuid := '00000000-0000-4000-8001-000000000003';
  priya uuid := '00000000-0000-4000-8002-000000000001';
  arjun uuid := '00000000-0000-4000-8002-000000000002';
  kiran uuid := '00000000-0000-4000-8002-000000000007';
  lakshmi uuid := '00000000-0000-4000-8a03-000000000001';
  meena uuid := '00000000-0000-4000-8a03-000000000002';
  meera uuid := '00000000-0000-4000-8a03-000000000003';
  sunita uuid := '00000000-0000-4000-8a03-000000000004';
  asha uuid := '00000000-0000-4000-8a03-000000000005';
  kavya uuid := '00000000-0000-4000-8a03-000000000006';
  p_lakshmi uuid := '00000000-0000-4000-8a04-000000000001';
  p_meena uuid := '00000000-0000-4000-8a04-000000000002';
  p_kavya uuid := '00000000-0000-4000-8a04-000000000006';
  d_meena uuid := '00000000-0000-4000-8a0d-000000000001';
  b_meena uuid := '00000000-0000-4000-8a0c-000000000001';
  ref uuid := '00000000-0000-4000-8a0e-000000000001';
  dob timestamptz := now() - interval '2 days';
  v record;
begin
  insert into public.mothers (id, phone, name, age_at_registration, lang, village, husband_name, created_by,
                              emergency_contact) values
    (lakshmi, '919000000003', 'Lakshmi K', 24, 'kn', 'Hosahalli', 'Ravi K', priya, '{"name":"Ravi K","relation":"husband","phone":"919000000004"}'),
    (meena,   '919000000006', 'Meena T', 27, 'kn', 'Kanakapura', null, priya, null),
    (meera,   '919000000005', 'Meera S', 32, 'en', 'Demo Town', null, priya, null),
    (sunita,  '919000000010', 'Sunita R', 31, 'hi', 'Ramnagar', null, priya, null),
    (asha,    '919000000012', 'Asha P', 22, 'kn', 'Hosahalli', null, priya, null),
    (kavya,   '919000000013', 'Kavya N', 29, 'en', 'Demo Town', null, priya, null);

  perform app.demo_pregnancy(lakshmi, p_lakshmi, 231, unit_a, priya, 'close', array[2,1,1,0], array[12,20,26,30], 7);
  perform app.demo_pregnancy(meera, '00000000-0000-4000-8a04-000000000003', 140, unit_a, priya, 'routine', array[1,0,0,0], array[10,16], 14);
  perform app.demo_pregnancy(sunita, '00000000-0000-4000-8a04-000000000004', 182, unit_a, priya, 'enhanced', array[1,0,0,0], array[12,18,22], -5);
  perform app.demo_pregnancy(asha, '00000000-0000-4000-8a04-000000000005', 253, unit_a, priya, 'routine', array[1,0,0,0], array[14,22,28,32], 3);
  perform app.demo_pregnancy(kavya, p_kavya, 274, unit_a, priya, 'routine', array[2,1,1,0], array[12,20,28,34,36], 4);
  perform app.demo_pregnancy(meena, p_meena, 280, unit_a, priya, 'routine', array[1,0,0,0], array[12,20,28,34,38], 1);

  -- Lakshmi: tagged, an OGTT result awaiting review, an open Cardiology referral, a call-back, her husband as caregiver
  insert into public.tags (mother_id, pregnancy_id, code, set_by, set_at) values
    (lakshmi, p_lakshmi, 'prev_cs', priya, now() - interval '60 days'), (lakshmi, p_lakshmi, 'hypertensive', priya, now() - interval '20 days');
  update public.investigations set status = 'resulted', reviewed_at = null, reviewed_by = null, follow_up = null
    where pregnancy_id = p_lakshmi and code = 'ogtt';
  insert into public.referrals (id, mother_id, pregnancy_id, to_team_id, urgency, reason, question, status, created_by, created_at)
  values (ref, lakshmi, p_lakshmi, cardio, 'routine', 'Documented murmur', 'Fit for vaginal delivery?', 'accepted', priya, now() - interval '3 days');
  insert into public.referral_events (referral_id, mother_id, status, at, by_staff) values
    (ref, lakshmi, 'requested', now() - interval '3 days', priya), (ref, lakshmi, 'accepted', now() - interval '2 days', kiran);
  insert into public.callbacks (mother_id, requested_by_label, channel, signs, at)
  values (lakshmi, 'mother', 'app', '{headache_vision}', now() - interval '40 minutes');
  insert into public.caregivers (mother_id, phone, name, relation, scope_schedule, scope_baby, scope_logs, scope_tests)
  values (lakshmi, '919000000004', 'Ravi K', 'husband', true, true, false, false);
  insert into public.consents (mother_id, notice_version, lang, purposes, decision, recorded_by)
  values (lakshmi, 'v1', 'kn', '{caregiver_sharing}', 'accepted', priya);
  insert into public.self_logs (mother_id, kind, value, at, by_label) values (lakshmi, 'bp', '128/84', now() - interval '1 day', 'mother');

  -- Kavya: in the labour room
  insert into public.admissions (pregnancy_id, mother_id, ip_no, admitted_at, admitted_by, reason)
  values (p_kavya, kavya, 'IP-' || to_char(current_date, 'YYYY') || '-' || lpad(app.next_number('00000000-0000-4000-8000-000000000001', 'ip', to_char(current_date, 'YYYY'))::text, 6, '0'),
          now() - interval '3 hours', priya, 'Labour');

  -- Meena: delivered two days ago — baby girl, birth doses given, baby's discharge checklist open
  update public.tasks set cancelled_at = dob, override_reason = 'Delivered' where pregnancy_id = p_meena and completed_at is null;
  update public.pregnancies set status = 'delivered', end_reason = 'delivered', ended_on = dob::date where id = p_meena;
  insert into public.deliveries (id, pregnancy_id, mother_id, at, mode, recorded_by) values (d_meena, p_meena, meena, dob, 'vaginal', priya);
  insert into public.babies (id, child_id, mother_id, pregnancy_id, delivery_id, birth_order, dob, sex, birth_weight_g, ga_at_birth_days,
                             apgar1, apgar5, outcome, breastfed_within_1h, vitamin_k)
  values (b_meena, (select mch_id from public.pregnancies where id = p_meena) || '-B1', meena, p_meena, d_meena, 1, dob, 'F', 2900, 278, 8, 9, 'live', true, true);
  insert into public.care_assignments (mother_id, baby_id, specialty, team_id, primary_staff_id, from_at, assigned_by, reason)
  values (meena, b_meena, 'paediatrics', paeds, arjun, dob, priya, 'Birth');
  for v in select * from public.vaccine_catalogue where applies_to = 'baby' loop
    insert into public.immunizations (mother_id, baby_id, code, due_on, status, given_on, primary_source, given_by)
    values (meena, b_meena, v.code, dob::date + v.age_days,
            case when v.age_days = 0 then 'given' else 'due' end, case when v.age_days = 0 then dob::date end,
            case when v.age_days = 0 then true end, case when v.age_days = 0 then arjun end);
  end loop;
  insert into public.tasks (mother_id, pregnancy_id, baby_id, kind, title, due_from, due_by, generated_by) values
    (meena, p_meena, null, 'pn_visit', 'Postnatal check · day 7', dob::date + 7, dob::date + 8, 'protocol'),
    (meena, null, b_meena, 'nb_visit', 'Newborn check · day 7', dob::date + 7, dob::date + 8, 'protocol');
  insert into public.discharges (id, mother_id, baby_id, started_at) values ('00000000-0000-4000-8a12-000000000001', meena, b_meena, now());
  insert into public.discharge_items (discharge_id, mother_id, key)
  select '00000000-0000-4000-8a12-000000000001', meena, code from public.pick_lists where list = 'discharge_item' and grp = 'baby';
end $$;

-- Demo mode only, Care Team only: wipe patient data and reload the demo cast. Never runs in production
-- (app_settings.demo_mode = false); the audit log is kept and records the reset.
create function public.reset_demo(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.staff;
begin
  perform app.only_keys(p, array['confirm']);
  s := app.require_staff();
  if not app.is_demo() then
    raise exception 'Demo reset is disabled' using errcode = 'PT403';
  end if;
  if p ->> 'confirm' is distinct from 'RESET DEMO DATA' then
    raise exception 'Type the confirmation phrase' using errcode = 'PT422';
  end if;
  -- TRUNCATE refuses tables with pending commit-time checks: run them now (they must pass anyway), then defer again
  set constraints all immediate;
  set constraints all deferred;
  perform set_config('app.demo_reset', 'on', true);
  truncate public.mothers, public.id_counters, public.idempotency_keys, public.notifications cascade;
  perform app.load_demo_patients();
  perform set_config('app.demo_reset', '', true);
  perform app.audit_event('demo_reset', 'app_settings', 'demo_mode', null);
  return jsonb_build_object('reset', true, 'mothers', (select count(*) from public.mothers));
end $$;

insert into app.api_functions values ('public','confirm_import'), ('public','reset_demo');

do $$ begin perform app.apply_api_grants(); end $$;
