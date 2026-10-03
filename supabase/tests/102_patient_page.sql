-- Patient page rework (20261005001060–1062): a visit recorded at its own date and time; corrections that write the new
-- version and withdraw the old one atomically (correct_visit, correct_newborn_obs, correct_result, correct_fact);
-- moving a test's due window (reschedule_investigation). Called as real users. Rolled back; synthetic data only.
begin;

create temp table t_count (n int not null);
insert into t_count values (0);
grant all on t_count to authenticated;

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  update t_count set n = n + 1;
  if not coalesce(cond, false) then raise exception 'FAIL: %', what; end if;
end $$;

create procedure pg_temp.fails(stmt text, what text, msg_like text default '%', code text default null) language plpgsql as $$
begin
  update t_count set n = n + 1;
  begin
    execute stmt;
  exception when others then
    if sqlerrm not like msg_like or (code is not null and sqlstate <> code) then
      raise exception 'FAIL: % (wrong error: % [%])', what, sqlerrm, sqlstate;
    end if;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', what;
end $$;

create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.k() returns text language sql volatile as $$ select gen_random_uuid()::text $$;
create function pg_temp.rpc(fn text, p jsonb) returns text language sql as $$ select format('select public.%I(%L::jsonb)', fn, p) $$;

\ir _fixtures.psql

\set v1 '00000000-0000-4000-8005-000000001021'
\set v2 '00000000-0000-4000-8005-000000001022'
\set v_sun '00000000-0000-4000-8005-000000001023'
\set n1 '00000000-0000-4000-8005-000000001024'
\set n2 '00000000-0000-4000-8005-000000001025'
\set i_hb '00000000-0000-4000-8008-000000001021'
\set i_ogtt '00000000-0000-4000-8008-000000001022'
\set i_sun '00000000-0000-4000-8008-000000001023'
\set r1 '00000000-0000-4000-8009-000000001021'
\set r2 '00000000-0000-4000-8009-000000001022'
\set r_sun '00000000-0000-4000-8009-000000001023'
\set c1 '00000000-0000-4000-800a-000000001021'
\set c2 '00000000-0000-4000-800a-000000001022'
\set a1 '00000000-0000-4000-800a-000000001023'
\set pp1 '00000000-0000-4000-800a-000000001024'
\set pp2 '00000000-0000-4000-800a-000000001025'
\set c_sun '00000000-0000-4000-800a-000000001026'

-- Tests and documented history to correct (as the table owner).
insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by) values
  (:'i_hb',   :'m_lakshmi', :'p_lakshmi', 'hb1',  'Haemoglobin (Hb)', current_date - 20, current_date + 5),
  (:'i_ogtt', :'m_lakshmi', :'p_lakshmi', 'ogtt', 'OGTT',             current_date + 1,  current_date + 14),
  (:'i_sun',  :'m_sunita',  :'p_sunita',  'hb1',  'Haemoglobin (Hb)', current_date - 20, current_date + 5);
insert into public.documented_conditions (id, mother_id, pregnancy_id, label, recorded_by) values
  (:'c1', :'m_lakshmi', :'p_lakshmi', 'Asthma', :'s_priya'),
  (:'c_sun', :'m_sunita', :'p_sunita', 'Thyroid disorder', :'s_neha');
insert into public.allergies (id, mother_id, substance, recorded_by) values (:'a1', :'m_lakshmi', 'Penicilin', :'s_priya');
insert into public.previous_pregnancies (id, mother_id, documented_in, year, outcome, mode, recorded_by) values
  (:'pp1', :'m_lakshmi', :'p_lakshmi', 2022, 'live_birth', 'vaginal', :'s_priya');
select id as t_lak from public.tasks where pregnancy_id = :'p_lakshmi' and kind = 'anc_visit' \gset

set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. record_visit at the date and time of the visit
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
select public.record_visit(jsonb_build_object('idempotency_key', pg_temp.k(), 'encounter_id', :'v1', 'pregnancy_id', :'p_lakshmi',
  'at', now() - interval '3 days', 'ga_days', 228, 'close_task_id', :'t_lak', 'complaints', '["headache"]'::jsonb,
  'observations', jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 61),
                                    jsonb_build_object('code', 'bp_sys', 'value_num', 120), jsonb_build_object('code', 'bp_dia', 'value_num', 80)),
  'checklist', jsonb_build_array(jsonb_build_object('component', 'bp', 'state', 'done'), jsonb_build_object('component', 'weight', 'state', 'done'))));
reset role;
select pg_temp.ok((select at::date from public.encounters where id = :'v1') = (now() - interval '3 days')::date,
  'P001 a visit is recorded at the date the doctor gave (three days ago)');
select pg_temp.ok((select completed_by_encounter_id = :'v1' and completed_at::date = (now() - interval '3 days')::date
                   from public.tasks where id = :'t_lak'), 'P002 …and closes its planned visit at that date');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('record_visit', jsonb_build_object('idempotency_key', pg_temp.k(), 'encounter_id', pg_temp.k(),
  'pregnancy_id', :'p_lakshmi', 'at', now() - interval '21 weeks')),
  'P003 a visit cannot be dated before the pregnancy was registered', '%before the pregnancy was registered%', 'PT422');
reset role;
update public.app_settings set value = 'false' where key = 'demo_mode';
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('record_visit', jsonb_build_object('idempotency_key', pg_temp.k(), 'encounter_id', pg_temp.k(),
  'pregnancy_id', :'p_lakshmi', 'at', now() + interval '1 day')), 'P004 outside demo mode a visit cannot be in the future', '%future%', 'PT422');
call pg_temp.fails(pg_temp.rpc('correct_visit', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'v1', 'encounter_id', pg_temp.k(),
  'at', now() + interval '1 day')), 'P005 …nor corrected into the future', '%future%', 'PT422');
reset role;
update public.app_settings set value = 'true' where key = 'demo_mode';
set local role authenticated;
select pg_temp.ok((select count(*) from public.encounters where pregnancy_id = :'p_lakshmi' and kind = 'anc') = 1,
  'P006 …and nothing of the refused visits is saved');

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. correct_visit: new version + old withdrawn, in one step
-- ════════════════════════════════════════════════════════════════════════════════
select jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000001021', 'id', :'v1', 'encounter_id', :'v2',
  'at', now() - interval '4 days', 'ga_days', 227, 'complaints', '[]'::jsonb, 'counselling', '["nutrition"]'::jsonb, 'note', 'Weight re-checked',
  'observations', jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 62.5),
                                    jsonb_build_object('code', 'bp_sys', 'value_num', 122), jsonb_build_object('code', 'bp_dia', 'value_num', 80)),
  'checklist', jsonb_build_array(jsonb_build_object('component', 'bp', 'state', 'done'), jsonb_build_object('component', 'weight', 'state', 'done')),
  'completeness', 1)::text as fix \gset
select pg_temp.as_user(:'arjun');
call pg_temp.fails(pg_temp.rpc('correct_visit', :'fix'::jsonb), 'P007 a paediatrician cannot correct an ANC visit', '%role%', 'PT403');
select pg_temp.as_user(:'kiran');
call pg_temp.fails(pg_temp.rpc('correct_visit', :'fix'::jsonb), 'P008 a specialist cannot correct an ANC visit', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(pg_temp.rpc('correct_visit', :'fix'::jsonb), 'P009 another unit''s obstetrician gets "not found"', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('correct_visit', :'fix'::jsonb || '{"pregnancy_id":"00000000-0000-4000-8004-000000000001"}'),
  'P010 unknown fields are refused (the visit is found by its own id)', '%unexpected field%', 'PT422');
call pg_temp.fails(pg_temp.rpc('correct_visit', :'fix'::jsonb || jsonb_build_object('idempotency_key', pg_temp.k(),
  'observations', jsonb_build_array(jsonb_build_object('code', 'bp_sys', 'value_num', 900)))),
  'P011 an impossible value refuses the whole correction', '%not a possible entry%');
reset role;
select pg_temp.ok((select status = 'final' from public.encounters where id = :'v1') and not exists (select 1 from public.encounters where id = :'v2'),
  'P012 …atomically: the old visit is still live and no new version exists');
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.correct_visit(:'fix'::jsonb)::text as fix_out \gset
select pg_temp.ok((:'fix_out'::jsonb ->> 'encounter_id') = :'v2' and (:'fix_out'::jsonb ->> 'replaces') = :'v1',
  'P013 the obstetrician corrects her visit');
select pg_temp.ok(public.correct_visit(:'fix'::jsonb) = :'fix_out'::jsonb, 'P014 an offline retry returns the same answer');
reset role;
select pg_temp.ok((select status = 'entered_in_error' and eie_reason = 'Corrected' and eie_by = :'s_priya' from public.encounters where id = :'v1'),
  'P015 the old version is withdrawn as "Corrected", by whom and when (kept, not overwritten)');
select pg_temp.ok((select count(*) from public.observations where encounter_id = :'v1' and status = 'entered_in_error') = 3
  and (select value_num from public.observations where encounter_id = :'v1' and code = 'weight') = 61,
  'P016 …with its measurements, whose values stay as first recorded');
select pg_temp.ok((select status = 'final' and supersedes = :'v1' and at::date = (now() - interval '4 days')::date and note = 'Weight re-checked'
                     and counselling = '{nutrition}' from public.encounters where id = :'v2')
  and (select count(*) from public.encounter_checklist where encounter_id = :'v2') = 2,
  'P017 the new version is live, points at the old one and carries the corrected date, values and checklist');
select pg_temp.ok((select o.supersedes = (select x.id from public.observations x where x.encounter_id = :'v1' and x.code = 'weight')
                   from public.observations o where o.encounter_id = :'v2' and o.code = 'weight'),
  'P018 each corrected measurement points at the one it replaces');
select pg_temp.ok((select completed_by_encounter_id = :'v2' and completed_at::date = (now() - interval '4 days')::date
                   from public.tasks where id = :'t_lak'), 'P019 the planned visit it closed now links the corrected visit');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'record_corrected' and entity_id = :'v1' and meta ->> 'replaced_by' = :'v2')
  and exists (select 1 from public.audit_log where action = 'insert' and entity_type = 'encounters' and entity_id = :'v2')
  and exists (select 1 from public.audit_log where action = 'update' and entity_type = 'encounters' and entity_id = :'v1'
              and meta -> 'status' ->> 'to' = 'entered_in_error'),
  'P020 both rows are audited, and the correction names old and new');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('correct_visit', :'fix'::jsonb || jsonb_build_object('idempotency_key', pg_temp.k(), 'encounter_id', pg_temp.k())),
  'P021 a version already corrected cannot be corrected again (stale)', '%already corrected%', 'PT409');
call pg_temp.fails(pg_temp.rpc('correct_visit', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'v2', 'encounter_id', pg_temp.k(),
  'at', now() - interval '21 weeks')), 'P022 a correction cannot date the visit before the registration', '%before the pregnancy was registered%', 'PT422');
select pg_temp.ok((public.correct_visit(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'v2', 'encounter_id', pg_temp.k(),
  'observations', jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 62.4)))) ->> 'replaces') = :'v2',
  'P023 the corrected version can itself be corrected (its time kept when none is given)');
reset role;
select pg_temp.ok((select count(*) from public.encounters where pregnancy_id = :'p_lakshmi' and kind = 'anc' and status = 'final') = 1
  and (select at from public.encounters where pregnancy_id = :'p_lakshmi' and kind = 'anc' and status = 'final')
      = (select at from public.encounters where id = :'v2'),
  'P024 one live version of the visit at any time');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('mark_entered_in_error', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'encounter', 'id', :'v2',
  'reason', 'Corrected')), 'P025 an old version cannot be withdrawn twice', '%lready%', 'PT409');

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. correct_newborn_obs (paediatrician)
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'arjun');
select public.add_newborn_obs(jsonb_build_object('idempotency_key', pg_temp.k(), 'encounter_id', :'n1', 'baby_id', :'b_meena',
  'at', now() - interval '1 day', 'observations', jsonb_build_array(jsonb_build_object('code', 'nb_weight', 'value_num', 2850))));
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('correct_newborn_obs', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'n1', 'encounter_id', :'n2')),
  'P026 an obstetrician cannot correct a baby''s observation', '%role%', 'PT403');
call pg_temp.fails(pg_temp.rpc('correct_visit', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'n1', 'encounter_id', :'n2')),
  'P027 …nor reach it as a "visit"', '%role%', 'PT403');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(pg_temp.rpc('correct_newborn_obs', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'n1', 'encounter_id', :'n2',
  'at', now() - interval '5 days')), 'P028 an observation cannot be dated before the birth', '%before the time of birth%', 'PT422');
call pg_temp.fails(pg_temp.rpc('correct_newborn_obs', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'v2', 'encounter_id', :'n2')),
  'P029 a paediatrician cannot correct an ANC visit as a newborn observation', '%role%', 'PT403');
select pg_temp.ok((public.correct_newborn_obs(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'n1', 'encounter_id', :'n2',
  'observations', jsonb_build_array(jsonb_build_object('code', 'nb_weight', 'value_num', 2805)), 'note', 'Re-weighed'))
  ->> 'encounter_id') = :'n2', 'P030 the paediatrician corrects the observation');
reset role;
select pg_temp.ok((select status = 'entered_in_error' and eie_reason = 'Corrected' from public.encounters where id = :'n1')
  and (select status = 'final' and supersedes = :'n1' and baby_id = :'b_meena' from public.encounters where id = :'n2')
  and (select value_num from public.observations where encounter_id = :'n2' and code = 'nb_weight') = 2805,
  'P031 …the old one withdrawn, the new one live for the same baby');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. correct_result: value, unit, note, date tested
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
select public.record_result(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'r1', 'investigation_id', :'i_hb',
  'value_num', 11.2, 'unit', 'g/dL', 'reported_at', now() - interval '2 days'));
select public.update_investigation(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_hb', 'action', 'review', 'follow_up', 'none'));
reset role;
select version as hb_v from public.investigations where id = :'i_hb' \gset
set local role authenticated;
select jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000001022', 'result_id', :'r1', 'id', :'r2', 'version', :hb_v,
  'value_num', 11.4, 'unit', 'g/dL', 'note', 'Transcription corrected', 'reported_at', now() - interval '3 days')::text as fixr \gset
select pg_temp.as_user(:'kiran');
call pg_temp.fails(pg_temp.rpc('correct_result', :'fixr'::jsonb), 'P032 a specialist reading the record cannot correct a maternal result', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(pg_temp.rpc('correct_result', :'fixr'::jsonb), 'P033 another unit''s obstetrician gets "not found"', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('correct_result', :'fixr'::jsonb || jsonb_build_object('idempotency_key', pg_temp.k(), 'version', :hb_v - 1)),
  'P034 a correction based on a stale test version is refused', '%updated this a moment ago%', 'PT409');
call pg_temp.fails(pg_temp.rpc('correct_result', jsonb_build_object('idempotency_key', pg_temp.k(), 'result_id', :'r1', 'id', pg_temp.k(),
  'unit', 'g/dL')), 'P035 a correction needs the result as reported', '%Enter the result%', 'PT422');
select public.correct_result(:'fixr'::jsonb)::text as fixr_out \gset
select pg_temp.ok((:'fixr_out'::jsonb ->> 'result_id') = :'r2' and (:'fixr_out'::jsonb ->> 'replaces') = :'r1', 'P036 the result is corrected');
reset role;
select pg_temp.ok((select status = 'entered_in_error' and eie_reason = 'Corrected' and value_num = 11.2 from public.investigation_results where id = :'r1')
  and (select status = 'corrected' and supersedes = :'r1' and value_num = 11.4 and reported_at::date = (now() - interval '3 days')::date
         and note = 'Transcription corrected' from public.investigation_results where id = :'r2'),
  'P037 old result withdrawn as entered, new one live with its value, note and date tested');
select pg_temp.ok((select status = 'resulted' and reviewed_at is null and follow_up is null and version > :hb_v from public.investigations where id = :'i_hb')
  and (select count(*) from public.investigation_results where investigation_id = :'i_hb' and status <> 'entered_in_error') = 1,
  'P038 the test awaits a fresh review, with exactly one live result (never "no result" in between)');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'record_corrected' and entity_id = :'r1' and meta ->> 'replaced_by' = :'r2'),
  'P039 the result correction is audited');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('correct_result', jsonb_build_object('idempotency_key', pg_temp.k(), 'result_id', :'r1', 'id', pg_temp.k(),
  'value_num', 12)), 'P040 the withdrawn version cannot be corrected again', '%already corrected%', 'PT409');

-- ════════════════════════════════════════════════════════════════════════════════
-- 5. correct_fact: condition, allergy, previous pregnancy
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'arjun');
call pg_temp.fails(pg_temp.rpc('correct_fact', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'allergy', 'id', :'a1',
  'substance', 'Penicillin')), 'P041 the mother''s history is the obstetric team''s', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(pg_temp.rpc('correct_fact', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'allergy', 'id', :'a1',
  'substance', 'Penicillin')), 'P042 another unit''s obstetrician gets "not found"', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('correct_fact', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'allergy', 'id', :'a1',
  'label', 'Penicillin')), 'P043 each kind takes only its own fields', '%unexpected field%', 'PT422');
call pg_temp.fails(pg_temp.rpc('correct_fact', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'medicine', 'id', :'a1')),
  'P044 an unknown kind is refused', '%Unknown history entry kind%', 'PT422');
call pg_temp.fails(pg_temp.rpc('correct_fact', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'condition', 'id', :'c1', 'label', '  ')),
  'P045 a condition needs its text', '%as documented%', 'PT422');
select pg_temp.ok((public.correct_fact(jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'condition', 'id', :'c1', 'new_id', :'c2',
  'label', 'Asthma (since childhood)')) ->> 'id') = :'c2', 'P046 a documented condition is corrected');
select pg_temp.ok((public.correct_fact(jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'allergy', 'id', :'a1',
  'substance', 'Penicillin', 'reaction', 'Rash (as documented)')) ->> 'replaces') = :'a1', 'P047 an allergy is corrected');
call pg_temp.fails(pg_temp.rpc('correct_fact', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'previous_pregnancy', 'id', :'pp1',
  'year', 1900, 'outcome', 'live_birth')), 'P048 a previous pregnancy is checked like at registration', '%Check the previous pregnancy%', 'PT422');
select pg_temp.ok((public.correct_fact(jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'previous_pregnancy', 'id', :'pp1', 'new_id', :'pp2',
  'year', 2021, 'outcome', 'live_birth', 'mode', 'lscs', 'gestation_weeks', 38, 'complications', '["Documented PPH"]'::jsonb)) ->> 'id') = :'pp2',
  'P049 a previous pregnancy is corrected');
reset role;
select pg_temp.ok((select status = 'entered_in_error' and eie_reason = 'Corrected' from public.documented_conditions where id = :'c1')
  and (select status = 'final' and supersedes = :'c1' and label = 'Asthma (since childhood)' and pregnancy_id = :'p_lakshmi'
       from public.documented_conditions where id = :'c2')
  and (select count(*) from public.allergies where mother_id = :'m_lakshmi' and status = 'final' and substance = 'Penicillin' and supersedes = :'a1') = 1
  and (select status = 'entered_in_error' from public.allergies where id = :'a1')
  and (select year = 2021 and mode = 'lscs' and complications = '{"Documented PPH"}' and supersedes = :'pp1' and documented_in = :'p_lakshmi'
       from public.previous_pregnancies where id = :'pp2')
  and (select status = 'entered_in_error' from public.previous_pregnancies where id = :'pp1'),
  'P050 each corrected entry: old withdrawn as "Corrected", new one live and pointing at it');
select pg_temp.ok((select count(*) from public.audit_log where action = 'record_corrected' and entity_id in (:'c1', :'a1', :'pp1')) = 3,
  'P051 every history correction is audited');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('correct_fact', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'condition', 'id', :'c1', 'label', 'Asthma')),
  'P052 an entry already corrected is stale', '%already corrected%', 'PT409');
reset role;
-- a correction must point at a live entry of the same mother (database guard, whoever writes)
call pg_temp.fails(format($$insert into public.documented_conditions (mother_id, label, recorded_by, supersedes) values (%L, 'x', %L, %L)$$,
  :'m_sunita', :'s_neha', :'c2'), 'P053 a correction cannot point at another mother''s entry', '%same mother%');
call pg_temp.fails(format($$insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff, supersedes) values (%L, %L, 'anc', now(), %L, %L)$$,
  :'m_lakshmi', :'p_lakshmi', :'s_priya', :'v1'), 'P054 a withdrawn visit cannot be corrected (only the live version)', '%cannot be corrected%');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 6. reschedule_investigation: the doctor moves a test's due window
-- ════════════════════════════════════════════════════════════════════════════════
reset role;
select version as og_v from public.investigations where id = :'i_ogtt' \gset
set local role authenticated;
select pg_temp.as_user(:'kiran');
call pg_temp.fails(pg_temp.rpc('reschedule_investigation', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_ogtt', 'version', :og_v,
  'due_from', current_date + 3, 'due_by', current_date + 10, 'reason', 'OPD closed')), 'P055 a specialist reading the record cannot move a maternal test', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(pg_temp.rpc('reschedule_investigation', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_ogtt', 'version', :og_v,
  'due_from', current_date + 3, 'due_by', current_date + 10, 'reason', 'OPD closed')), 'P056 another unit''s obstetrician gets "not found"', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.rpc('reschedule_investigation', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_ogtt', 'version', :og_v,
  'due_from', current_date + 3, 'due_by', current_date + 10)), 'P057 moving a window needs a reason', '%needs a reason%', 'PT422');
call pg_temp.fails(pg_temp.rpc('reschedule_investigation', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_ogtt', 'version', :og_v,
  'due_from', current_date + 10, 'due_by', current_date + 3, 'reason', 'OPD closed')), 'P058 the window starts on or before its end', '%on or before%', 'PT422');
call pg_temp.fails(pg_temp.rpc('reschedule_investigation', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_ogtt', 'version', :og_v,
  'due_from', current_date + 40, 'due_by', current_date + 80, 'reason', 'OPD closed')), 'P059 the window stays inside the pregnancy', '%outside the pregnancy%', 'PT422');
call pg_temp.fails(pg_temp.rpc('reschedule_investigation', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_ogtt', 'version', :og_v - 1,
  'due_from', current_date + 3, 'due_by', current_date + 10, 'reason', 'OPD closed')), 'P060 a stale version is refused', '%updated this a moment ago%', 'PT409');
call pg_temp.fails(pg_temp.rpc('reschedule_investigation', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_hb',
  'due_from', current_date + 3, 'due_by', current_date + 10, 'reason', 'OPD closed')), 'P061 a test with a result is not moved (correct its date tested instead)',
  '%waiting for its result%', 'PT409');
select pg_temp.ok((public.reschedule_investigation(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_ogtt', 'version', :og_v,
  'due_from', current_date + 3, 'due_by', current_date + 10, 'reason', 'Lab closed that week')) ->> 'version')::int > :og_v,
  'P062 the obstetrician moves the window (version bumped)');
reset role;
select pg_temp.ok((select due_from = current_date + 3 and due_by = current_date + 10 from public.investigations where id = :'i_ogtt'),
  'P063 …to the dates she chose');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'reschedule_investigation' and entity_id = :'i_ogtt'
  and meta ->> 'reason' = 'Lab closed that week' and meta -> 'to' = jsonb_build_array(current_date + 3, current_date + 10)),
  'P064 …audited with the old and new window and the reason');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 7. A closed episode takes no corrections
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'neha');
select public.record_visit(jsonb_build_object('idempotency_key', pg_temp.k(), 'encounter_id', :'v_sun', 'pregnancy_id', :'p_sunita', 'ga_days', 182,
  'observations', jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 55))));
select public.record_result(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'r_sun', 'investigation_id', :'i_sun', 'value_num', 10.9, 'unit', 'g/dL'));
select public.end_pregnancy(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_sunita', 'reason', 'miscarriage', 'ended_on', current_date));
-- the episode's team no longer holds it; an emergency override reopens it for reading
select public.grant_override(jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_sunita', 'reason', 'Reviewing the closed record'));
call pg_temp.fails(pg_temp.rpc('correct_visit', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'v_sun', 'encounter_id', pg_temp.k(),
  'observations', jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 56)))), 'P065 a visit of a closed episode is not corrected', '%episode is closed%', 'PT409');
call pg_temp.fails(pg_temp.rpc('correct_result', jsonb_build_object('idempotency_key', pg_temp.k(), 'result_id', :'r_sun', 'id', pg_temp.k(), 'value_num', 11)),
  'P066 …nor a result', '%episode is closed%', 'PT409');
call pg_temp.fails(pg_temp.rpc('correct_fact', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'condition', 'id', :'c_sun', 'label', 'Hypothyroidism')),
  'P067 …nor her history when every episode is closed', '%episode is closed%', 'PT409');
call pg_temp.fails(pg_temp.rpc('reschedule_investigation', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'i_sun',
  'due_from', current_date + 3, 'due_by', current_date + 10, 'reason', 'x y z')), 'P068 …nor a test window moved', '%', 'PT409');
reset role;
select pg_temp.ok((select status = 'final' from public.encounters where id = :'v_sun') and (select status = 'final' from public.investigation_results where id = :'r_sun')
  and (select status = 'final' from public.documented_conditions where id = :'c_sun'), 'P069 …and nothing of the closed record changed');

select format('  102_patient_page: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
