-- Registration bounds, a returning mother, correcting a mother's details (update_mother, find_mother) and care-team
-- reassignment checks (supabase/migrations/20261005000980_register_edit.sql). Rolled back; synthetic data only.
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

\ir _fixtures.psql

-- Another hospital with its own units, so "a woman known only elsewhere" can be tried.
\set h2_unit  '00000000-0000-4000-8001-0000000000c1'
\set h2_paeds '00000000-0000-4000-8001-0000000000c2'
insert into public.teams (id, hospital_id, name, kind, specialty) values
  (:'h2_unit', :'h2', 'Other OB Unit', 'unit', 'obstetrics'), (:'h2_paeds', :'h2', 'Other Paediatrics', 'unit', 'paediatrics');
insert into public.team_members (team_id, staff_id) select :'h2_unit', s.id from public.staff s where s.phone = '919000000009';

create function pg_temp.call(fn text, p jsonb) returns text language sql as $$ select format('select public.%s(%L::jsonb)', fn, p) $$;
create function pg_temp.key(n int) returns text language sql as $$ select '00000000-0000-4000-a000-0000000090' || lpad(n::text, 2, '0') $$;

-- A registration payload (a new mother, ~11 weeks, dated by LMP) the checks below vary one field at a time.
select jsonb_build_object(
  'idempotency_key', pg_temp.key(1),
  'mother', jsonb_build_object('id', '00000000-0000-4000-8003-0000000090a1', 'phone', '919000000201', 'name', 'Roopa D', 'age', 26,
                               'lang', 'kn', 'village', 'Demo Village'),
  'pregnancy', jsonb_build_object('id', '00000000-0000-4000-8004-0000000090a1', 'gravida', 2, 'para', 1, 'living', 1, 'abortions', 0),
  'dating', jsonb_build_object('method', 'lmp', 'lmp', current_date - 77, 'lmp_certain', true, 'edd', current_date + 203),
  'team_id', :'t_unit_a', 'intensity', 'routine', 'ga_days', 77
)::text as reg \gset

select version as lak_v from public.mothers where id = :'m_lakshmi' \gset
-- Outside demo mode (no time travel), as on a real deployment.
update public.app_settings set value = 'false' where key = 'demo_mode';

set local role authenticated;
select pg_temp.as_user(:'priya');

-- ════════════════════════════════════════════════════════════════════════════════
-- Registration: every bound the form mirrors is refused with a clear PT422
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,age}', '61')), 'G001 age above 60', '%Age must be a whole number from 10 to 60%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,age}', '24.5')), 'G002 a fractional age', '%whole number%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,name}', to_jsonb(repeat('a', 121)))), 'G003 a name over 120 characters', '%full name%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{pregnancy,para}', '2')), 'G004 P + A above G − 1', '%P + A must be at most G%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{pregnancy,gravida}', '21')), 'G005 gravida above 20', '%Gravida%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{pregnancy,living}', '1.5')), 'G006 a fractional count', '%Living children must be a whole number%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{ga_days}', '330')), 'G007 a GA beyond 320 days', '%Gestational age at registration%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{dating,edd}', to_jsonb(current_date + 210))), 'G008 an EDD that is not LMP + 280', '%LMP + 280%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(jsonb_set(:'reg'::jsonb, '{dating,lmp}', to_jsonb(current_date + 5)), '{dating,edd}', to_jsonb(current_date + 285))),
  'G009 an LMP in the future', '%cannot be in the future%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{dating}', jsonb_build_object('method', 'scan', 'scan_on', current_date - 3, 'ga_at_scan_days', 20, 'edd', current_date + 257))),
  'G010 a scan GA under 4 weeks', '%at the scan%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{history}', '{"height_cm": 90}')), 'G011 a height under 100 cm', '%Height must be 100%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{history}', '{"blood_group": "Unknown"}')), 'G012 a blood group that is not a code', '%Blood group must be one of%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{history}', '{"previous": [{"year": 1950, "outcome": "live_birth"}]}')),
  'G013 a previous pregnancy before 1960', '%previous pregnancies%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{history}', '{"previous": [{"year": 2023, "outcome": "Live birth"}]}')),
  'G014 a previous outcome given as a label, not a code', '%previous pregnancies%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,emergency_contact}', '{"name": "Ravi", "relation": "Husband", "phone": "12345"}')),
  'G015 an emergency contact without a valid mobile', '%emergency contact needs%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,emergency_contact}', '{"name": "Ravi", "phone": "919000000202", "address": "x"}')),
  'G016 an emergency contact with an unknown field', '%unexpected field(s) in emergency_contact%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,pincode}', '"012345"')), 'G017 a PIN code starting with 0', '%PIN code%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,rch_id}', '"12345"')), 'G018 an RCH id that is not 12 digits', '%RCH id has 12 digits%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{pregnancy,fetuses}', '5')), 'G019 more than 4 fetuses', '%fetuses%', 'PT422');
reset role;
select pg_temp.ok(not exists (select 1 from public.mothers where phone = '919000000201'), 'G020 refused registrations left nothing behind');
set local role authenticated;
select pg_temp.as_user(:'priya');

-- Everything the form can send: scan dating with an LMP, back-dated registration, the RCH / ABHA ids, address,
-- alternate phone, husband, emergency contact with a relation, fetuses, tag note, previous pregnancies as rows.
select public.register_pregnancy(jsonb_build_object(
  'idempotency_key', pg_temp.key(2),
  'mother', jsonb_build_object('id', '00000000-0000-4000-8003-0000000090a2', 'phone', '919000000203', 'alt_phone', '919000000204',
     'name', 'Kusuma H', 'marital_status', 'married', 'husband_name', 'Mahesh H', 'dob', '1998-04-12', 'dob_estimated', false, 'age', 28, 'lang', 'hi',
     'village', 'Demo Village', 'district', 'Demo District', 'state', 'Karnataka', 'pincode', '560001',
     'rch_id', '100000000203', 'abha_number', '10000000000203', 'abha_address', 'kusuma.h@abdm',
     'emergency_contact', jsonb_build_object('name', 'Mahesh H', 'relation', 'Husband', 'phone', '919000000205')),
  'pregnancy', jsonb_build_object('id', '00000000-0000-4000-8004-0000000090a2', 'registered_on', now() - interval '3 days',
     'gravida', 3, 'para', 1, 'living', 1, 'abortions', 1, 'fetuses', 2),
  'dating', jsonb_build_object('method', 'scan', 'scan_on', current_date - 2, 'ga_at_scan_days', 86, 'lmp', current_date - 90,
     'lmp_certain', false, 'edd', current_date - 2 + 194, 'note', 'Dating scan at district hospital'),
  'history', jsonb_build_object('height_cm', 152, 'blood_group', 'B+', 'medicines', jsonb_build_array('Thyroxine'),
     'conditions', jsonb_build_array('Other: documented thalassaemia trait'),
     'previous', jsonb_build_array(
        jsonb_build_object('year', 2022, 'outcome', 'live_birth', 'mode', 'lscs', 'gestation_weeks', 38, 'complications', jsonb_build_array('PPH'), 'note', 'At district hospital'),
        jsonb_build_object('year', 2024, 'outcome', 'ectopic'))),
  'team_id', :'t_unit_a', 'intensity', 'enhanced', 'tags', jsonb_build_array('multiple'), 'tag_note', 'Two sacs on the dating scan',
  'ga_days', 85));
reset role;
select pg_temp.ok((select m.alt_phone = '919000000204' and m.husband_name = 'Mahesh H' and m.dob = '1998-04-12' and m.district = 'Demo District'
    and m.state = 'Karnataka' and m.pincode = '560001' and m.emergency_contact ->> 'relation' = 'Husband'
  from public.mothers m where m.id = '00000000-0000-4000-8003-0000000090a2'), 'G021 the address, phones, husband and emergency contact are stored as entered');
select pg_temp.ok((select count(*) from public.patient_identifiers where mother_id = '00000000-0000-4000-8003-0000000090a2'
  and system in ('rch','abha_number','abha_address')) = 3, 'G022 the RCH id and ABHA ids are recorded');
select pg_temp.ok((select g.fetuses = 2 and g.registered_on < now() - interval '2 days' from public.pregnancies g where g.id = '00000000-0000-4000-8004-0000000090a2')
  and (select d.method = 'scan' and d.lmp_certain = false and d.ga_at_scan_days = 86 and d.note like 'Dating scan%'
       from public.pregnancy_datings d where d.pregnancy_id = '00000000-0000-4000-8004-0000000090a2' and d.is_current),
  'G023 fetuses, the back-dated registration and the scan dating (with its note and LMP certainty) are stored');
select pg_temp.ok((select count(*) from public.previous_pregnancies where mother_id = '00000000-0000-4000-8003-0000000090a2') = 2
  and exists (select 1 from public.previous_pregnancies where mother_id = '00000000-0000-4000-8003-0000000090a2' and outcome = 'live_birth'
              and mode = 'lscs' and gestation_weeks = 38 and complications = '{PPH}')
  and exists (select 1 from public.tags where pregnancy_id = '00000000-0000-4000-8004-0000000090a2' and note = 'Two sacs on the dating scan'),
  'G024 previous pregnancies are rows as documented, and the tag keeps its note');

-- ════════════════════════════════════════════════════════════════════════════════
-- A returning mother (second pregnancy)
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'priya');
select pg_temp.ok((select f ->> 'mother_id' = :'m_meena' and f ->> 'name' = 'Meena T' and not (f ->> 'active_pregnancy')::boolean
                   and (f ->> 'pregnancies')::int = 1 and f::text not like '%91900000%'
                   from public.find_mother('{"phone": "919000000006"}') f), 'F001 the desk finds a returning mother of this hospital by phone (no numbers returned)');
select pg_temp.ok(public.find_mother('{"phone": "919000000299"}') is null, 'F002 an unknown number returns nothing');
call pg_temp.fails($$select public.find_mother('{"phone": "12345"}')$$, 'F003 a malformed number is refused', '%10-digit%', 'PT422');
call pg_temp.fails($$select public.find_mother('{"phone": "919000000006", "name": "x"}')$$, 'F004 find_mother takes a phone only', '%unexpected field%', 'PT422');
select pg_temp.as_user(:'arjun');
call pg_temp.fails($$select public.find_mother('{"phone": "919000000006"}')$$, 'F005 only obstetricians look mothers up', '%role%', 'PT403');
select pg_temp.as_user(:'other');
select pg_temp.ok(public.find_mother('{"phone": "919000000006"}') is null, 'F006 another hospital learns nothing about the number');
reset role;
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'lookup_mother' and entity_id = :'m_meena'), 'F007 a lookup is audited');

-- Rule 1: the clinician confirmed it is her (mother.id) → her record is reused and corrected from the form.
set local role authenticated;
select pg_temp.as_user(:'priya');
select jsonb_set(jsonb_set(jsonb_set(:'reg'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.key(3))),
  '{mother}', jsonb_build_object('id', :'m_meena', 'phone', '919000000006', 'name', 'Meena T R', 'age', 28, 'lang', 'kn', 'village', 'New Village')),
  '{pregnancy,id}', '"00000000-0000-4000-8004-0000000090a3"')::text as back \gset
savepoint s_back;
select public.register_pregnancy(:'back'::jsonb);
reset role;
select pg_temp.ok((select count(*) from public.mothers where phone = '919000000006') = 1
  and (select m.name = 'Meena T R' and m.village = 'New Village' and m.user_id = :'meena_u' from public.mothers m where m.id = :'m_meena')
  and (select mother_id from public.pregnancies where id = '00000000-0000-4000-8004-0000000090a3') = :'m_meena',
  'G025 a confirmed returning mother keeps one record (and her login), corrected from the form');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'returning_mother_confirmed' and entity_id = :'m_meena'),
  'G026 confirming a returning mother is audited');
rollback to savepoint s_back;

-- Rule 2: the same phone and the same name (ignoring case and spacing), at this hospital → reused, details kept.
set local role authenticated;
select pg_temp.as_user(:'priya');
savepoint s_back2;
select public.register_pregnancy(jsonb_set(jsonb_set(:'back'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.key(4))),
  '{mother}', jsonb_build_object('id', '00000000-0000-4000-8003-0000000090a4', 'phone', '919000000006', 'name', '  meena   t ', 'age', 28,
                                 'village', 'Typed Elsewhere')));
reset role;
select pg_temp.ok((select m.name = 'Meena T' and m.village is null from public.mothers m where m.id = :'m_meena')
  and not exists (select 1 from public.mothers where id = '00000000-0000-4000-8003-0000000090a4'),
  'G027 a matching name reuses her record without overwriting details nobody confirmed');
rollback to savepoint s_back2;

set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(jsonb_set(:'back'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.key(5))),
  '{mother}', jsonb_build_object('phone', '919000000006', 'name', 'Someone Else', 'age', 30))),
  'G028 the same phone with another name is refused', '%already belongs to another patient%', 'PT409');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(jsonb_set(:'back'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.key(6))),
  '{mother,phone}', '"919000000010"')),
  'G029 a confirmed mother cannot take a phone that belongs to someone else', '%already belongs to another patient%', 'PT409');
select pg_temp.as_user(:'other');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(jsonb_set(jsonb_set(:'back'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.key(7))),
  '{team_id}', to_jsonb(:'h2_unit'::text)), '{mother}', jsonb_build_object('phone', '919000000006', 'name', 'Meena T', 'age', 28))),
  'G030 another hospital cannot take over a woman by phone and name', '%already belongs to another patient%', 'PT409');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(jsonb_set(:'back'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.key(8))),
  '{team_id}', to_jsonb(:'h2_unit'::text))),
  'G031 …nor by naming her record id', 'Not found', 'PT404');

-- ════════════════════════════════════════════════════════════════════════════════
-- update_mother: correcting her details
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'arjun');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(10), 'mother_id', :'m_lakshmi', 'village', 'X')),
  'U001 a paediatrician cannot correct a mother''s details', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(11), 'mother_id', :'m_lakshmi', 'village', 'X')),
  'U002 an obstetrician outside her team gets "not found"', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(12), 'mother_id', :'m_lakshmi', 'blood_group', 'B+')),
  'U003 only her details can be changed here', '%unexpected field(s) in request: blood_group%', 'PT422');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(13), 'mother_id', :'m_lakshmi', 'version', :lak_v + 1, 'village', 'X')),
  'U004 a stale version is refused', '%Someone else updated%', 'PT409');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(14), 'mother_id', :'m_lakshmi', 'phone', '919000000010')),
  'U005 a phone that belongs to another patient is refused', 'This phone number already belongs to another patient. Use a different number.', 'PT409');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(15), 'mother_id', :'m_lakshmi', 'age', 61)),
  'U006 the same bounds as registration', '%Age must be%', 'PT422');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(16), 'mother_id', :'m_lakshmi', 'age', null, 'dob', null)),
  'U007 she keeps an age or a date of birth', '%age or her date of birth%', 'PT422');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(17), 'mother_id', :'m_lakshmi')),
  'U008 an empty correction is refused', '%Nothing to change%', 'PT422');

select public.update_mother(jsonb_build_object('idempotency_key', pg_temp.key(18), 'mother_id', :'m_lakshmi', 'version', :lak_v,
  'name', 'Lakshmi Kumari', 'village', 'Demo Village', 'district', 'Demo District', 'pincode', '560002', 'alt_phone', '919000000206',
  'marital_status', 'married', 'husband_name', 'Ravi K', 'emergency_contact', jsonb_build_object('name', 'Ravi K', 'relation', 'Husband', 'phone', '919000000004'),
  'rch_id', '100000000003'))::text as upd \gset
select pg_temp.ok((:'upd'::jsonb ->> 'version')::int = :lak_v + 1, 'U009 a correction returns the new version');
select pg_temp.ok(public.update_mother(jsonb_build_object('idempotency_key', pg_temp.key(18), 'mother_id', :'m_lakshmi', 'version', :lak_v,
  'name', 'Lakshmi Kumari', 'village', 'Demo Village', 'district', 'Demo District', 'pincode', '560002', 'alt_phone', '919000000206',
  'marital_status', 'married', 'husband_name', 'Ravi K', 'emergency_contact', jsonb_build_object('name', 'Ravi K', 'relation', 'Husband', 'phone', '919000000004'),
  'rch_id', '100000000003')) = :'upd'::jsonb, 'U010 a replay returns the same response');
select pg_temp.ok((select m.name = 'Lakshmi Kumari' and m.pincode = '560002' and m.alt_phone = '919000000206' and m.age_at_registration = 24
  and m.lang = 'kn' and m.emergency_contact ->> 'relation' = 'Husband' from public.mothers m where m.id = :'m_lakshmi'),
  'U011 the fields sent are corrected; the others keep their value');
select pg_temp.as_user(:'meera');
select public.update_mother(jsonb_build_object('idempotency_key', pg_temp.key(19), 'mother_id', :'m_lakshmi', 'village', '', 'state', 'Karnataka'));
select pg_temp.ok((select m.village is null and m.state = 'Karnataka' from public.mothers m where m.id = :'m_lakshmi'),
  'U012 a member of her obstetric team can correct her details; an empty text clears a field');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(20), 'mother_id', :'m_lakshmi', 'rch_id', '100000000099')),
  'U013 a different RCH id is not silently added', '%different RCH id is already recorded%', 'PT409');
reset role;
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'update_mother' and entity_id = :'m_lakshmi'
    and meta -> 'fields' ? 'pincode' and meta::text not like '%560002%' and meta::text not like '%Kumari%'),
  'U014 the correction is audited by field name, never by value');

-- A corrected phone moves her login: the old number's account loses her record; the new number links on sign-in.
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.update_mother(jsonb_build_object('idempotency_key', pg_temp.key(21), 'mother_id', :'m_lakshmi', 'phone', '919000000207'));
reset role;
select pg_temp.ok((select m.phone = '919000000207' and m.user_id is null from public.mothers m where m.id = :'m_lakshmi'),
  'U015 a new number unlinks the old account');
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok((select w -> 'mother' = 'null'::jsonb from public.whoami() w), 'U016 …which no longer opens her record');
reset role;
select pg_temp.ok((app.hook_before_user_created('{"user":{"phone":"919000000207"}}') = '{}'), 'U017 the corrected number may sign up');
insert into auth.users (id, phone) values ('00000000-0000-4000-9000-0000000090f1', '919000000207');
select pg_temp.ok((select user_id from public.mothers where id = :'m_lakshmi') = '00000000-0000-4000-9000-0000000090f1',
  'U018 her first sign-in with the corrected number links her record');
insert into auth.users (id, phone) values ('00000000-0000-4000-9000-0000000090f2', '919000000208');
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.update_mother(jsonb_build_object('idempotency_key', pg_temp.key(22), 'mother_id', :'m_lakshmi', 'phone', '919000000208'));
reset role;
select pg_temp.ok((select user_id from public.mothers where id = :'m_lakshmi') = '00000000-0000-4000-9000-0000000090f2',
  'U019 a number that already has an account links at once');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'update_mother' and entity_id = :'m_lakshmi'
    and (meta ->> 'login_relinked')::boolean), 'U020 the re-link is audited');

-- ════════════════════════════════════════════════════════════════════════════════
-- assign_care: team and doctor are checked
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.call('assign_care', jsonb_build_object('idempotency_key', pg_temp.key(30), 'pregnancy_id', :'p_lakshmi',
  'specialty', 'obstetrics', 'team_id', :'h2_unit', 'reason', 'Moving')), 'A001 a team of another hospital is refused', '%obstetric unit of this hospital%', 'PT422');
call pg_temp.fails(pg_temp.call('assign_care', jsonb_build_object('idempotency_key', pg_temp.key(31), 'pregnancy_id', :'p_lakshmi',
  'specialty', 'obstetrics', 'team_id', :'t_obs', 'reason', 'Moving')), 'A002 a department is not a unit', '%obstetric unit%', 'PT422');
call pg_temp.fails(pg_temp.call('assign_care', jsonb_build_object('idempotency_key', pg_temp.key(32), 'pregnancy_id', :'p_lakshmi',
  'specialty', 'obstetrics', 'team_id', :'t_unit_a', 'primary_staff_id', :'s_neha', 'reason', 'Cover')),
  'A003 the named doctor must be a member of the chosen team', '%current member of OB Unit A%', 'PT422');
call pg_temp.fails(pg_temp.call('assign_care', jsonb_build_object('idempotency_key', pg_temp.key(33), 'pregnancy_id', :'p_lakshmi',
  'specialty', 'obstetrics', 'primary_staff_id', :'s_arjun', 'reason', 'Cover')),
  'A004 a paediatrician cannot be the obstetric doctor', '%current member%', 'PT422');
call pg_temp.fails(pg_temp.call('assign_care', jsonb_build_object('idempotency_key', pg_temp.key(34), 'pregnancy_id', :'p_lakshmi',
  'specialty', 'obstetrics', 'team_id', :'t_unit_a', 'primary_staff_id', :'s_priya', 'reason', 'Same')),
  'A005 nothing to change', '%already the current team%', 'PT409');
select public.assign_care(jsonb_build_object('idempotency_key', pg_temp.key(35), 'pregnancy_id', :'p_lakshmi',
  'specialty', 'obstetrics', 'team_id', :'t_unit_a', 'primary_staff_id', :'s_meera', 'reason', 'Priya on leave'));
reset role;
select pg_temp.ok((select team_id = :'t_unit_a' and primary_staff_id = :'s_meera' from public.care_assignments
  where pregnancy_id = :'p_lakshmi' and specialty = 'obstetrics' and to_at is null), 'A006 a doctor of the same team takes over');
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.assign_care(jsonb_build_object('idempotency_key', pg_temp.key(36), 'pregnancy_id', :'p_lakshmi',
  'specialty', 'obstetrics', 'team_id', :'t_unit_b', 'reason', 'Moved near Unit B clinic'));
reset role;
select pg_temp.ok((select team_id = :'t_unit_b' and primary_staff_id is null from public.care_assignments
  where pregnancy_id = :'p_lakshmi' and specialty = 'obstetrics' and to_at is null), 'A007 a team can be assigned without a named doctor');

-- Paediatrics: the baby's team, by the paediatric team only.
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.call('assign_care', jsonb_build_object('idempotency_key', pg_temp.key(37), 'baby_id', :'b_meena',
  'specialty', 'paediatrics', 'reason', 'x')), 'A008 an obstetrician cannot change a baby''s team', '%cannot change%', 'PT403');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(pg_temp.call('assign_care', jsonb_build_object('idempotency_key', pg_temp.key(38), 'baby_id', :'b_meena',
  'specialty', 'paediatrics', 'team_id', :'h2_paeds', 'reason', 'x')), 'A009 a paediatric team of another hospital is refused', '%paediatric unit of this hospital%', 'PT422');
select public.assign_care(jsonb_build_object('idempotency_key', pg_temp.key(39), 'baby_id', :'b_meena',
  'specialty', 'paediatrics', 'team_id', :'t_paeds_unit', 'reason', 'Team follow-up'));
reset role;
select pg_temp.ok((select team_id = :'t_paeds_unit' and primary_staff_id is null and reason = 'Team follow-up' from public.care_assignments
  where baby_id = :'b_meena' and to_at is null), 'A010 the paediatric team reassigns a baby (team only)');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'reassign' and meta ->> 'specialty' = 'paediatrics'),
  'A011 a reassignment is audited with its specialty');

select format('  090_register_edit: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
