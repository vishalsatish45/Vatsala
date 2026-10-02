-- Family RPCs and read functions, called as the mother and her caregivers. Consent gating, caregiver scopes,
-- what each screen may and may not show, and the family writes. Rolled back; synthetic data only.
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

-- A fresh idempotency key per call where replay is not the point.
create function pg_temp.k() returns text language sql volatile as $$ select gen_random_uuid()::text $$;

\ir _fixtures.psql

-- ── Extra record for Lakshmi and Meena ──────────────────────────────────────────
insert into public.allergies (mother_id, substance, recorded_by) values (:'m_lakshmi', 'Penicillin', :'s_priya');
insert into public.encounters (id, mother_id, pregnancy_id, kind, at, by_staff) values
  ('00000000-0000-4000-8005-0000000000e1', :'m_lakshmi', :'p_lakshmi', 'anc', now() - interval '7 days', :'s_priya');
insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, value_text, at, by_staff) values
  ('00000000-0000-4000-8005-0000000000e1', :'m_lakshmi', :'p_lakshmi', 'weight', 61.4, null, now() - interval '7 days', :'s_priya'),
  ('00000000-0000-4000-8005-0000000000e1', :'m_lakshmi', :'p_lakshmi', 'blood_group', null, 'B+', now() - interval '7 days', :'s_priya');
insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by, status, ordered_at, ordered_by) values
  ('00000000-0000-4000-8008-0000000000e1', :'m_lakshmi', :'p_lakshmi', 'hb3', 'Repeat Hb (3rd trimester)', current_date - 20, current_date + 10, 'ordered', now(), :'s_priya'),
  ('00000000-0000-4000-8008-0000000000e2', :'m_lakshmi', :'p_lakshmi', 'hiv', 'HIV', current_date - 120, current_date - 90, 'ordered', now(), :'s_priya'),
  ('00000000-0000-4000-8008-0000000000e3', :'m_lakshmi', :'p_lakshmi', 'ogtt', 'OGTT 75 g', current_date - 60, current_date - 30, 'ordered', now(), :'s_priya');
insert into public.investigation_results (investigation_id, mother_id, value_num, value_text, unit, reported_at, entered_by) values
  ('00000000-0000-4000-8008-0000000000e1', :'m_lakshmi', 11.2, null, 'g/dL', now() - interval '3 days', :'s_priya'),
  ('00000000-0000-4000-8008-0000000000e2', :'m_lakshmi', null, 'Non-reactive', null, now() - interval '95 days', :'s_priya'),
  ('00000000-0000-4000-8008-0000000000e3', :'m_lakshmi', null, '2-h 118 mg/dL', null, now() - interval '35 days', :'s_priya');
update public.investigations set status = 'resulted' where id in ('00000000-0000-4000-8008-0000000000e1','00000000-0000-4000-8008-0000000000e2','00000000-0000-4000-8008-0000000000e3');
update public.investigations set status = 'reviewed', reviewed_at = now(), reviewed_by = :'s_priya', follow_up = 'discuss_next_visit'
  where id in ('00000000-0000-4000-8008-0000000000e1','00000000-0000-4000-8008-0000000000e2');
insert into public.medications (id, mother_id, pregnancy_id, kind, name, dose, slots, instructions, prescribed_by) values
  ('00000000-0000-4000-8010-0000000000e1', :'m_lakshmi', :'p_lakshmi', 'prescription', 'IFA', '1 tablet', '{afternoon}', 'After lunch', :'s_priya'),
  ('00000000-0000-4000-8010-0000000000e2', :'m_meena', :'p_meena', 'prescription', 'Calcium', '1 tablet', '{morning}', null, :'s_priya');
update public.tasks set due_by = due_by + 1, override_reason = 'Husband says she is unwell this week' where pregnancy_id = :'p_lakshmi';
insert into public.encounters (id, mother_id, baby_id, kind, at, by_staff) values
  ('00000000-0000-4000-8005-0000000000e2', :'m_meena', :'b_meena', 'newborn', now() - interval '1 day', :'s_arjun');
insert into public.observations (encounter_id, mother_id, baby_id, code, value_num, at, by_staff) values
  ('00000000-0000-4000-8005-0000000000e2', :'m_meena', :'b_meena', 'nb_weight', 2850, now() - interval '1 day', :'s_arjun');
insert into public.immunizations (mother_id, baby_id, code, due_on) values (:'m_meena', :'b_meena', 'bcg', current_date - 2);

\set ctx_ravi '{"mother_id":"00000000-0000-4000-8003-000000000001"}'
\set notice '"v1"'

set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Consent gates everything
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'ravi');
call pg_temp.fails(format('select public.family_context(%L::jsonb)', :'ctx_ravi'), 'F001 a caregiver who has not accepted the notice sees nothing', 'Not found', 'PT404');
call pg_temp.fails(format('select public.record_consent(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_lakshmi',
  'notice_version', 'v1', 'lang', 'kn', 'purposes', '["app","caregiver_sharing"]'::jsonb, 'decision', 'accepted')),
  'F002 a caregiver cannot consent to sharing on the mother''s behalf', '%Only the mother%', 'PT403');
call pg_temp.fails(format('select public.record_consent(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_lakshmi',
  'notice_version', 'v0', 'lang', 'kn', 'purposes', '["app"]'::jsonb, 'decision', 'accepted')),
  'F003 consent is to the current notice', '%current notice%', 'PT409');
select public.record_consent(jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_lakshmi', 'notice_version', 'v1', 'lang', 'kn',
  'purposes', '["app","reminders_app"]'::jsonb, 'decision', 'accepted'));
select pg_temp.ok((public.family_context(:'ctx_ravi'::jsonb) ->> 'role') = 'caregiver', 'F004 after accepting, the caregiver is in');

select pg_temp.as_user(:'meena_u');
call pg_temp.fails($$select public.family_context()$$, 'F005 a mother who has not consented sees nothing', 'Not found', 'PT404');
select public.record_consent(jsonb_build_object('idempotency_key', pg_temp.k(), 'notice_version', 'v1', 'lang', 'kn', 'purposes', '["app"]'::jsonb, 'decision', 'declined'));
call pg_temp.fails($$select public.family_context()$$, 'F006 declining keeps the app closed', 'Not found', 'PT404');
select public.record_consent(jsonb_build_object('idempotency_key', pg_temp.k(), 'notice_version', 'v1', 'lang', 'kn',
  'purposes', '["app","reminders_whatsapp"]'::jsonb, 'decision', 'accepted'));
select public.record_consent(jsonb_build_object('idempotency_key', pg_temp.k(), 'notice_version', 'v1', 'lang', 'kn',
  'purposes', '["app","reminders_sms"]'::jsonb, 'decision', 'accepted'));
select pg_temp.ok((public.family_context() ->> 'role') = 'mother', 'F007 accepting opens the app');
reset role;
select pg_temp.ok((select count(*) from public.consents where mother_id = :'m_meena' and decision = 'accepted' and withdrawn_at is null) = 1
  and (select purposes from public.consents where mother_id = :'m_meena' and decision = 'accepted' and withdrawn_at is null) = '{app,reminders_sms}',
  'F008 a new consent replaces the previous one (channels change by re-consenting)');
set local role authenticated;

savepoint s_withdraw;
select pg_temp.as_user(:'lakshmi_u');
select public.withdraw_consent(jsonb_build_object('idempotency_key', pg_temp.k(), 'reason', 'Not using the app'));
call pg_temp.fails($$select public.family_context()$$, 'F009 withdrawing consent closes the app for the mother', 'Not found', 'PT404');
select pg_temp.as_user(:'ravi');
call pg_temp.fails(format('select public.family_context(%L::jsonb)', :'ctx_ravi'), 'F010 …and for her caregivers', 'Not found', 'PT404');
rollback to savepoint s_withdraw;

-- ════════════════════════════════════════════════════════════════════════════════
-- What each screen shows
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'lakshmi_u');
select public.family_context()::text as ctx \gset
select pg_temp.ok((:'ctx'::jsonb ->> 'role') = 'mother' and (:'ctx'::jsonb -> 'card' ->> 'blood_group') = 'B+'
  and (:'ctx'::jsonb -> 'card' -> 'allergies') = '["Penicillin"]' and (:'ctx'::jsonb -> 'hospital' ->> 'phone_labour') is not null,
  'F011 home: her card facts and the hospital''s numbers');
select pg_temp.ok(:'ctx' not like '%919000000003%' and :'ctx' not like '%MCH-%' and :'ctx' not like '%intensity%'
  and (:'ctx'::jsonb -> 'pregnancy') ? 'closer_follow_up', 'F012 no phone, no MCH id, no intensity label — only "closer follow-up"');
select public.family_schedule()::text as sch \gset
select pg_temp.ok(jsonb_array_length(:'sch'::jsonb -> 'visits') = 1 and :'sch' not like '%unwell%' and :'sch' not like '%override%',
  'F013 schedule: her visit, without the staff''s notes on it');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(:'sch'::jsonb -> 'tests_due') t where t ->> 'label' = 'HIV'),
  'F014 sensitive tests never appear in the schedule');
select public.family_tests()::text as tests \gset
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(:'tests'::jsonb) t where t ->> 'label' = 'HIV'),
  'F015 sensitive tests never appear, not even as done');
select pg_temp.ok((select (t -> 'result' ->> 'value_num')::numeric = 11.2 and t -> 'result' ->> 'unit' = 'g/dL'
  from jsonb_array_elements(:'tests'::jsonb) t where t ->> 'label' like 'Repeat Hb%'), 'F016 a reviewed result shows its value, as entered, to the mother');
select pg_temp.ok((select t ->> 'status' = 'done' and t -> 'result' = 'null'::jsonb from jsonb_array_elements(:'tests'::jsonb) t
  where t ->> 'label' = 'OGTT 75 g'), 'F017 a result awaiting review shows "done" but no value yet');
select pg_temp.ok(:'tests' not like '%normal%' and :'tests' not like '%flag%' and :'tests' not like '%range%',
  'F018 no reference range, flag or "normal" label anywhere');
select public.family_readings()::text as rd \gset
select pg_temp.ok(jsonb_array_length(:'rd'::jsonb -> 'hospital') = 1 and (:'rd'::jsonb -> 'hospital' -> 0 ->> 'code') = 'weight',
  'F019 readings recorded at hospital (blood group is a card fact, not a reading)');

select pg_temp.as_user(:'ravi');
select public.family_context(:'ctx_ravi'::jsonb)::text as ctx_r \gset
select pg_temp.ok((:'ctx_r'::jsonb -> 'card') = 'null'::jsonb and (:'ctx_r'::jsonb -> 'mother' -> 'card_fields') = 'null'::jsonb,
  'F020 a caregiver never gets her card facts (allergies, conditions, blood group)');
select pg_temp.ok(jsonb_array_length(public.family_schedule(:'ctx_ravi'::jsonb) -> 'visits') = 1, 'F021 with the schedule scope he sees her visits');
call pg_temp.fails(format('select public.family_tests(%L::jsonb)', :'ctx_ravi'), 'F022 without the tests scope, no tests', 'Not found', 'PT404');
call pg_temp.fails(format('select public.family_readings(%L::jsonb)', :'ctx_ravi'), 'F023 without the logs scope, no readings', 'Not found', 'PT404');
call pg_temp.fails(format('select public.family_medicines(%L::jsonb)', :'ctx_ravi'), 'F024 without the logs scope, no medicines', 'Not found', 'PT404');
call pg_temp.fails($$select public.family_caregivers()$$, 'F025 only the mother manages caregivers (a caregiver acts for nobody here)', 'Not found', 'PT404');

-- ════════════════════════════════════════════════════════════════════════════════
-- Caregivers
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.add_caregiver(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'phone', '919000000003', 'name', 'Me', 'relation', 'self')), 'F026 her own number is not a caregiver (a shared phone needs none)', '%your own number%', 'PT422');
call pg_temp.fails(format('select public.add_caregiver(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'phone', '919000000004', 'name', 'Ravi', 'relation', 'husband')), 'F027 the same caregiver once', '%already your caregiver%', 'PT409');
call pg_temp.fails(format('select public.add_caregiver(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'phone', '919000000070', 'name', 'Kamala', 'relation', 'mother-in-law', 'scopes', jsonb_build_object('baby', true, 'admin', true))),
  'F028 unknown scopes are refused', '%unexpected field(s) in scopes: admin%', 'PT422');
select public.add_caregiver(jsonb_build_object('idempotency_key', pg_temp.k(), 'phone', '919000000070', 'name', 'Kamala',
  'relation', 'mother-in-law', 'scopes', jsonb_build_object('schedule', false, 'baby', true, 'logs', false, 'tests', false)));
select public.family_caregivers()::text as cgs \gset
select pg_temp.ok(jsonb_array_length(:'cgs'::jsonb) = 2, 'F029 she sees both caregivers and what each may see');
select (select c ->> 'id' from jsonb_array_elements(:'cgs'::jsonb) c where c ->> 'name' like 'Ravi%') as ravi_cg \gset
select pg_temp.as_user(:'ravi');
call pg_temp.fails(format('select public.add_caregiver(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'phone', '919000000071', 'name', 'X', 'relation', 'friend')), 'F030 a caregiver cannot add caregivers', 'Not found', 'PT404');
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.update_caregiver(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'id', :'ravi_cg', 'version', 99, 'scopes', jsonb_build_object('logs', true))), 'F031 a stale version is refused', '%Someone else updated%', 'PT409');
select public.update_caregiver(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'ravi_cg',
  'scopes', jsonb_build_object('logs', true, 'tests', true)));
select pg_temp.as_user(:'ravi');
select public.family_tests(:'ctx_ravi'::jsonb)::text as tests_r \gset
select pg_temp.ok(jsonb_array_length(:'tests_r'::jsonb) = 2 and not exists (select 1 from jsonb_array_elements(:'tests_r'::jsonb) t
  where t -> 'result' <> 'null'::jsonb), 'F032 with the tests scope a caregiver sees test status, never values');
select pg_temp.ok((public.family_readings(:'ctx_ravi'::jsonb) -> 'hospital') = 'null'::jsonb,
  'F033 with the logs scope he sees home readings but not hospital readings');

-- ════════════════════════════════════════════════════════════════════════════════
-- Call-backs, readings, medicines
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.request_callback(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'signs', '["Bleeding"]'::jsonb)), 'F034 warning signs are sent as codes', '%unknown warning_sign%');
call pg_temp.fails(format('select public.request_callback(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'voice_path', 'voice-notes/someone-else/x.m4a')), 'F035 the app cannot choose where a voice note is stored', '%unexpected field(s)%voice_path%', 'PT422');
select public.request_callback(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-0000000000f1', 'id', '00000000-0000-4000-800f-0000000000f1',
  'signs', '["headache_vision","swelling"]'::jsonb, 'voice_seconds', 12))::text as cb \gset
select pg_temp.ok((:'cb'::jsonb ->> 'voice_path') = 'voice-notes/' || :'m_lakshmi' || '/00000000-0000-4000-800f-0000000000f1.m4a',
  'F036 the server chooses the voice-note path inside her folder');
select pg_temp.ok(public.request_callback(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-0000000000f1', 'id', '00000000-0000-4000-800f-0000000000f1',
  'signs', '["headache_vision","swelling"]'::jsonb, 'voice_seconds', 12)) = :'cb'::jsonb, 'F037 a retry (offline outbox) sends the request once');
select pg_temp.as_user(:'ravi');
select public.request_callback(jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_lakshmi', 'signs', '["movements"]'::jsonb));
select pg_temp.ok(jsonb_array_length(public.family_callbacks(:'ctx_ravi'::jsonb)) = 1
  and (public.family_callbacks(:'ctx_ravi'::jsonb) -> 0 ->> 'by') = 'caregiver: Ravi K (husband)', 'F038 a caregiver asks on her behalf and sees only his own requests');
select pg_temp.as_user(:'priya');
select public.close_callback(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-800f-0000000000f1',
  'outcome', 'advised_to_come', 'note', 'Staff-only note: suspected pre-eclampsia'));
select pg_temp.as_user(:'lakshmi_u');
select public.family_callbacks()::text as cbs \gset
select pg_temp.ok(jsonb_array_length(:'cbs'::jsonb) = 2 and :'cbs' like '%"called_back": true%' and :'cbs' not like '%Staff-only%'
  and :'cbs' not like '%advised%', 'F039 the mother sees that the hospital called back — never the staff''s note or outcome');

select public.submit_self_log(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8016-0000000000f1', 'kind', 'bp', 'value', '128/84'));
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.family_readings() -> 'home') x where x ->> 'value' = '128/84'),
  'F040 a home reading is stored and shown as entered');
select pg_temp.as_user(:'ravi');
call pg_temp.fails(format('select public.retract_self_log(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_lakshmi',
  'id', '00000000-0000-4000-8016-0000000000f1', 'reason', 'x')), 'F041 a caregiver cannot withdraw the mother''s own reading', 'Not found', 'PT404');
call pg_temp.fails(format('select public.submit_self_log(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_lakshmi',
  'baby_id', :'b_meena', 'kind', 'feeding', 'value', 'Fed well')), 'F042 nobody logs for another mother''s baby', 'Not found', 'PT404');
select pg_temp.as_user(:'lakshmi_u');
select public.retract_self_log(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8016-0000000000f1', 'reason', 'Typed wrongly'));
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.family_readings() -> 'home') x where x ->> 'value' = '128/84'),
  'F043 a withdrawn reading disappears from her list (kept in the record)');

select pg_temp.ok((public.family_medicines() -> 0 ->> 'name') = 'IFA', 'F044 her prescribed medicines');
call pg_temp.fails(format('select public.log_dose(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'medication_id', '00000000-0000-4000-8010-0000000000e1', 'date', current_date, 'slot', 'morning', 'status', 'taken')),
  'F045 a dose only for a prescribed slot', '%not prescribed for the morning%', 'PT422');
select public.log_dose(jsonb_build_object('idempotency_key', pg_temp.k(), 'medication_id', '00000000-0000-4000-8010-0000000000e1',
  'date', current_date, 'slot', 'afternoon', 'status', 'skipped'));
select public.log_dose(jsonb_build_object('idempotency_key', pg_temp.k(), 'medication_id', '00000000-0000-4000-8010-0000000000e1',
  'date', current_date, 'slot', 'afternoon', 'status', 'taken'));
select pg_temp.ok((public.family_medicines() -> 0 -> 'doses') = jsonb_build_array(jsonb_build_object('date', current_date, 'slot', 'afternoon', 'status', 'taken')),
  'F046 logging the same slot again replaces the answer');
call pg_temp.fails(format('select public.log_dose(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'medication_id', '00000000-0000-4000-8010-0000000000e2', 'date', current_date, 'slot', 'morning', 'status', 'taken')),
  'F047 nobody logs another mother''s medicine', 'Not found', 'PT404');

-- ════════════════════════════════════════════════════════════════════════════════
-- Baby, card, notifications, edge cases
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'meena_u');
select public.family_baby(jsonb_build_object('baby_id', :'b_meena'))::text as baby \gset
select pg_temp.ok((:'baby'::jsonb ->> 'live')::boolean and jsonb_array_length(:'baby'::jsonb -> 'vaccines') = 1
  and (:'baby'::jsonb -> 'weights' -> 0 ->> 'grams')::numeric = 2850, 'F048 my baby: vaccines and weights');
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.family_baby(%L::jsonb)', jsonb_build_object('baby_id', :'b_meena')),
  'F049 another mother''s baby is not found', 'Not found', 'PT404');
reset role;
savepoint s_loss;
update public.babies set deceased_at = now() where id = :'b_meena';
set local role authenticated;
select pg_temp.as_user(:'meena_u');
select pg_temp.ok(jsonb_array_length(public.family_schedule() -> 'vaccines') = 0
  and not exists (select 1 from jsonb_array_elements(public.family_schedule() -> 'visits') v where v ->> 'baby_id' is not null)
  and jsonb_array_length(public.family_baby(jsonb_build_object('baby_id', :'b_meena')) -> 'vaccines') = 0,
  'F050 after a loss, no baby reminders or vaccine cards');
reset role;
rollback to savepoint s_loss;
set local role authenticated;

select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.set_card_fields(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'fields', '["name","hiv"]'::jsonb)),
  'F051 the card offers only the allowed fields', '%check constraint%');
select public.set_card_fields(jsonb_build_object('idempotency_key', pg_temp.k(), 'fields', '["name","blood","allergies","emergency"]'::jsonb));
select pg_temp.ok((public.family_context() -> 'mother' -> 'card_fields') = '["name","blood","allergies","emergency"]', 'F052 she chooses her card fields');
select pg_temp.as_user(:'ravi');
call pg_temp.fails(format('select public.set_card_fields(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'fields', '["name"]'::jsonb)),
  'F053 a caregiver cannot change her card', 'Not found', 'PT404');

reset role;
insert into public.notifications (id, user_id, kind) values
  ('00000000-0000-4000-8017-0000000000f1', :'lakshmi_u', 'visit_reminder'), ('00000000-0000-4000-8017-0000000000f2', :'ravi', 'visit_reminder');
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok((public.mark_notifications_read(jsonb_build_object('ids', jsonb_build_array('00000000-0000-4000-8017-0000000000f1',
  '00000000-0000-4000-8017-0000000000f2'))) ->> 'marked')::int = 1, 'F054 marking read touches only her own notifications');
select public.register_push_token('{"token":"ExponentPushToken[demo-1]","platform":"android"}');
select pg_temp.as_user(:'ravi');
select public.register_push_token('{"token":"ExponentPushToken[demo-1]","platform":"android"}');
reset role;
select pg_temp.ok((select user_id from public.push_tokens where token = 'ExponentPushToken[demo-1]') = :'ravi',
  'F055 a phone handed to someone else moves its push token with the sign-in');
set local role authenticated;

select pg_temp.as_user(:'priya');
call pg_temp.fails($$select public.family_context()$$, 'F056 Care Team users are not families', 'Not found', 'PT404');
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails($$select public.family_context('{"mother_id":"00000000-0000-4000-8003-000000000002"}')$$,
  'F057 a mother cannot open another mother''s app by id', 'Not found', 'PT404');
call pg_temp.fails($$select public.family_context('{"page":2}')$$, 'F058 unknown parameters are refused', '%unexpected field(s)%', 'PT422');
reset role;

-- Revocation is immediate.
update public.caregivers set revoked_at = now() where id = :'ravi_cg';
set local role authenticated;
select pg_temp.as_user(:'ravi');
call pg_temp.fails(format('select public.family_context(%L::jsonb)', :'ctx_ravi'), 'F059 a removed caregiver sees nothing on his next call', 'Not found', 'PT404');
reset role;

select format('  040_rpc_family: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
