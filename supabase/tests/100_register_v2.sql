-- Registration v2 and dating as a later step (supabase/migrations/20261005001040–1042): a pregnancy registered without
-- a dating (no visits, no test windows, no paediatric access, edd null to the family), the first dating (plans them,
-- starts paediatric access, audited), a re-dating, the mother's new details and their bounds, update_mother with
-- them. Rolled back; synthetic data only.
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

create function pg_temp.call(fn text, p jsonb) returns text language sql as $$ select format('select public.%s(%L::jsonb)', fn, p) $$;
create function pg_temp.key(n int) returns text language sql as $$ select '00000000-0000-4000-a000-0000001000' || lpad(n::text, 2, '0') $$;

\set m_new '00000000-0000-4000-8003-0000000100a1'
\set p_new '00000000-0000-4000-8004-0000000100a1'
\set new_u '00000000-0000-4000-9000-0000000100f1'

-- The registration form's payload: NO dating, no ga_days, no plan; the new details; weight beside height.
select jsonb_build_object(
  'idempotency_key', pg_temp.key(1),
  'mother', jsonb_build_object('id', :'m_new', 'name', 'Shilpa R', 'dob', '1999-03-14', 'dob_estimated', true,
     'phone', '919000000301', 'alt_phone', '919000000302', 'email', 'shilpa.r@example.com', 'marital_status', 'married',
     'husband_name', 'Raghu R', 'husband_phone', '919000000303', 'address_line', '#4, 1st Cross, Temple Road',
     'village', 'Demo Village', 'district', 'Demo District', 'state', 'Karnataka', 'pincode', '560001',
     'rch_id', '100000000301', 'aadhaar_last4', '4321', 'lang', 'kn',
     'emergency_contact', jsonb_build_object('name', 'Raghu R', 'relation', 'Husband', 'phone', '919000000303')),
  'pregnancy', jsonb_build_object('id', :'p_new', 'gravida', 2, 'para', 1, 'living', 1, 'abortions', 0),
  'history', jsonb_build_object('height_cm', 154, 'weight_kg', 58.5, 'blood_group', 'O-', 'conditions', jsonb_build_array('Asthma')),
  'team_id', :'t_unit_a', 'intensity', 'routine', 'tags', jsonb_build_array('prev_cs'), 'tag_note', 'Risk factor as documented'
)::text as reg \gset

update public.app_settings set value = 'false' where key = 'demo_mode';
set local role authenticated;
select pg_temp.as_user(:'priya');

-- ════════════════════════════════════════════════════════════════════════════════
-- The mother's new details: bounds (PT422), nothing stored when refused
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,marital_status}', '"unmarried"')),
  'V001 a husband''s details are refused unless she is married', '%only when her marital status is married%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', (:'reg'::jsonb) #- '{mother,marital_status}'),
  'V002 …including when no marital status is given', '%only when her marital status is married%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,marital_status}', '"engaged"')),
  'V003 a marital status outside the list', '%Marital status must be%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,husband_phone}', '"919000000301"')),
  'V004 the husband''s mobile is not hers', '%must differ from her mobile%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,husband_phone}', '"12345"')),
  'V005 the husband''s mobile is a 10-digit mobile', '%Husband''s mobile must be a 10-digit%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,aadhaar_last4}', '"123456789012"')),
  'V006 a full Aadhaar number is refused (last 4 digits only)', '%only the last 4 digits%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,aadhaar_last4}', '"12a4"')),
  'V007 Aadhaar last 4 are digits', '%only the last 4 digits%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,email}', '"shilpa@"')),
  'V008 an email without a domain', '%email address%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,email}', to_jsonb(repeat('a', 115) || '@x.com'))),
  'V009 an email over 120 characters', '%email address%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,address_line}', to_jsonb(repeat('a', 201)))),
  'V010 a house / street line over 200 characters', '%House / street%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,dob}', to_jsonb(current_date - 365 * 5))),
  'V011 a date of birth must give an age from 10 to 60', '%age from 10 to 60%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{mother,aadhaar}', '"123456789012"')),
  'V012 there is no field for a full Aadhaar number', '%unexpected field(s) in mother: aadhaar%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{history,weight_kg}', '300')),
  'V013 weight within the observation code''s possible entries', '%Weight must be 20%250 kg%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{ga_days}', '70')),
  'V014 a gestational age needs a dating', '%needs a dating%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{tasks}', jsonb_build_array(jsonb_build_object(
    'kind', 'anc_visit', 'title', 'ANC visit', 'due_from', current_date + 5, 'due_by', current_date + 7)))),
  'V015 no ANC visit can be planned for an undated pregnancy', '%once the pregnancy is dated%', 'PT422');
call pg_temp.fails(pg_temp.call('register_pregnancy', jsonb_set(:'reg'::jsonb, '{investigations}', jsonb_build_array(jsonb_build_object(
    'code', 'hb1', 'due_from', current_date, 'due_by', current_date + 14)))),
  'V016 …nor a test window', '%once the pregnancy is dated%', 'PT422');
reset role;
select pg_temp.ok(not exists (select 1 from public.mothers where phone = '919000000301'), 'V017 refused registrations left nothing behind');

-- ════════════════════════════════════════════════════════════════════════════════
-- Registered without a dating
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.register_pregnancy(:'reg'::jsonb)::text as reg_out \gset
reset role;
select pg_temp.ok((:'reg_out'::jsonb ->> 'mch_id') ~ '^MCH-[0-9]{4}-[0-9]{6}$', 'R001 an undated pregnancy is registered with its MCH id');
select pg_temp.ok((select g.edd is null from public.pregnancies g where g.id = :'p_new')
  and not exists (select 1 from public.pregnancy_datings where pregnancy_id = :'p_new'),
  'R002 no EDD and no dating row');
select pg_temp.ok(not exists (select 1 from public.tasks where pregnancy_id = :'p_new')
  and not exists (select 1 from public.investigations where pregnancy_id = :'p_new'),
  'R003 no ANC visit schedule and no test windows');
select pg_temp.ok(exists (select 1 from public.immunizations where pregnancy_id = :'p_new' and code = 'td1'),
  'R004 the maternal Td dose is due as before (not tied to the dating)');
select pg_temp.ok((select e.ga_days is null from public.encounters e where e.pregnancy_id = :'p_new' and e.kind = 'registration')
  and exists (select 1 from public.observations o join public.encounters e on e.id = o.encounter_id
              where e.pregnancy_id = :'p_new' and e.kind = 'registration' and o.code = 'weight' and o.value_num = 58.5)
  and exists (select 1 from public.observations o join public.encounters e on e.id = o.encounter_id
              where e.pregnancy_id = :'p_new' and e.kind = 'registration' and o.code = 'height' and o.value_num = 154),
  'R005 weight and height are registration observations; no gestational age');
select pg_temp.ok((select m.marital_status = 'married' and m.husband_name = 'Raghu R' and m.husband_phone = '919000000303'
    and m.email = 'shilpa.r@example.com' and m.address_line = '#4, 1st Cross, Temple Road' and m.aadhaar_last4 = '4321'
    and m.dob = '1999-03-14' and m.dob_estimated and m.age_at_registration is null
  from public.mothers m where m.id = :'m_new'), 'R006 the new details are stored as entered (Aadhaar: the last 4 digits only)');
select pg_temp.ok(exists (select 1 from public.tags where pregnancy_id = :'p_new' and code = 'prev_cs' and note = 'Risk factor as documented'),
  'R007 risk factors are the clinician''s tags, with their note');
select pg_temp.ok((select g.valid_from = 'infinity'::timestamptz from public.access_grants g join public.care_assignments a on a.id = g.assignment_id
                   where a.pregnancy_id = :'p_new' and a.specialty = 'paediatrics' and g.team_id is not null)
  and app.paeds_start(:'p_new') = 'infinity'::timestamptz,
  'R008 the paediatric team''s 34-week access does not start while undated');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'register_pregnancy' and entity_id = :'p_new'
                          and meta ->> 'dated' = 'false'), 'R009 the registration is audited as undated');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'insert' and entity_type = 'mothers' and entity_id = :'m_new')
  and not exists (select 1 from public.audit_log where mother_id = :'m_new' and (meta::text like '%4321%' or meta::text like '%example.com%')),
  'R010 the audit trail never holds her email or Aadhaar digits');
set local role authenticated;
select pg_temp.as_user(:'arjun');
select pg_temp.ok((select count(*) from public.pregnancies where id = :'p_new') = 0, 'R011 the paediatrician cannot see the undated pregnancy');
select pg_temp.as_user(:'priya');
select pg_temp.ok((select count(*) from public.pregnancies where id = :'p_new') = 1, 'R012 her obstetrician can');
select (select version from public.pregnancies where id = :'p_new') as pv \gset
call pg_temp.fails(pg_temp.call('set_intensity', jsonb_build_object('idempotency_key', pg_temp.key(2), 'pregnancy_id', :'p_new',
    'intensity', 'close', 'new_tasks', jsonb_build_array(jsonb_build_object('kind', 'anc_visit', 'title', 'ANC visit',
    'due_from', current_date + 5, 'due_by', current_date + 7)))),
  'R013 re-planning visits waits for the dating', '%once the pregnancy is dated%', 'PT422');
select public.set_intensity(jsonb_build_object('idempotency_key', pg_temp.key(3), 'pregnancy_id', :'p_new', 'intensity', 'enhanced'));
reset role;
select pg_temp.ok((select intensity = 'enhanced' from public.pregnancies where id = :'p_new'), 'R014 the intensity alone is recorded while undated');

-- The family reads edd = null (consent given, her login linked by phone).
insert into auth.users (id, phone) values (:'new_u', '919000000301');
insert into public.consents (user_id, mother_id, notice_version, lang, purposes, decision)
values (:'new_u', :'m_new', 'v1', 'kn', '{app}', 'accepted');
set local role authenticated;
select pg_temp.as_user(:'new_u');
select pg_temp.ok((select (c -> 'pregnancy') ? 'edd' and c -> 'pregnancy' -> 'edd' = 'null'::jsonb and c -> 'pregnancy' ->> 'status' = 'active'
                   from public.family_context() c), 'R015 family_context: the pregnancy with edd null');
select pg_temp.ok((select jsonb_array_length(s -> 'visits') = 0 and jsonb_array_length(s -> 'tests_due') = 0 from public.family_schedule() s)
  and jsonb_array_length(public.family_tests()) = 0, 'R016 family_schedule / family_tests: nothing planned yet');
reset role;

-- An undated pregnancy cannot hold an EDD without its dating (commit-time invariant).
savepoint s_inv;
set constraints all immediate;
call pg_temp.fails(format('update public.pregnancies set edd = current_date + 30 where id = %L', :'p_new'),
  'R017 an EDD needs a current dating', '%exactly one current dating%');
rollback to savepoint s_inv;
set constraints all deferred;

-- ════════════════════════════════════════════════════════════════════════════════
-- First dating: the schedule, the test windows and paediatric access follow
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'priya');
-- LMP 250 days ago → EDD in 30 days (35+5 weeks today).
select jsonb_build_object('idempotency_key', pg_temp.key(4), 'pregnancy_id', :'p_new',
  'dating', jsonb_build_object('method', 'lmp', 'lmp', current_date - 250, 'lmp_certain', true, 'edd', current_date + 30),
  'new_tasks', jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-800b-0000001000a1', 'kind', 'anc_visit',
     'title', 'ANC visit · 36 weeks', 'due_from', current_date + 5, 'due_by', current_date + 7)),
  'investigations', jsonb_build_array(
     jsonb_build_object('id', '00000000-0000-4000-8009-0000001000a1', 'code', 'hb1', 'due_from', current_date, 'due_by', current_date + 14, 'late', true),
     jsonb_build_object('id', '00000000-0000-4000-8009-0000001000a2', 'code', 'hiv', 'due_from', current_date, 'due_by', current_date + 14, 'late', true))
)::text as first \gset
call pg_temp.fails(pg_temp.call('redate_pregnancy', jsonb_set(:'first'::jsonb, '{dating,edd}', to_jsonb(current_date + 31))),
  'D001 the first dating is checked like any dating (LMP + 280)', '%LMP + 280%', 'PT422');
call pg_temp.fails(pg_temp.call('redate_pregnancy', (:'first'::jsonb) - 'dating'),
  'D002 a dating is required', '%Record the dating%', 'PT422');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(pg_temp.call('redate_pregnancy', :'first'::jsonb), 'D003 only the obstetric side dates a pregnancy', '%role%', 'PT403');
select pg_temp.as_user(:'priya');
select public.redate_pregnancy(:'first'::jsonb)::text as first_out \gset
reset role;
select pg_temp.ok((:'first_out'::jsonb ->> 'first_dating')::boolean and (:'first_out'::jsonb ->> 'tests')::int = 2
  and (:'first_out'::jsonb ->> 'created')::int = 1, 'D004 the first dating reports what it planned');
select pg_temp.ok((select edd = current_date + 30 from public.pregnancies where id = :'p_new')
  and (select count(*) from public.pregnancy_datings where pregnancy_id = :'p_new' and is_current and method = 'lmp' and lmp_certain) = 1,
  'D005 the EDD follows the dating');
select pg_temp.ok((select count(*) from public.tasks where pregnancy_id = :'p_new' and kind = 'anc_visit' and generated_by = 'protocol') = 1
  and (select count(*) from public.investigations where pregnancy_id = :'p_new' and generated_by = 'protocol' and late) = 2
  and (select sensitive from public.investigations where id = '00000000-0000-4000-8009-0000001000a2'),
  'D006 the ANC visits and test windows are generated as registration used to (privacy flag from the catalogue)');
-- (no earlier than her assignment: greatest(assigned, 34+0 weeks), as for any re-dating)
select pg_temp.ok((select g.valid_from = greatest(least(a.from_at, now()), app.paeds_start(:'p_new')) and g.valid_from <= now() and app.paeds_start(:'p_new') < now()
                   from public.access_grants g join public.care_assignments a on a.id = g.assignment_id
                   where a.pregnancy_id = :'p_new' and a.specialty = 'paediatrics' and g.team_id is not null),
  'D007 the paediatric start moves to 34+0 weeks of the new EDD');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'record_dating' and entity_id = :'p_new'
                          and meta ->> 'method' = 'lmp' and (meta ->> 'tests')::int = 2),
  'D008 the first dating is audited as record_dating');
set local role authenticated;
select pg_temp.as_user(:'arjun');
select pg_temp.ok((select count(*) from public.pregnancies where id = :'p_new') = 1, 'D009 past 34 weeks, the paediatric team now sees her');
select pg_temp.as_user(:'priya');
select pg_temp.ok(public.redate_pregnancy(:'first'::jsonb) = :'first_out'::jsonb, 'D010 a replay returns the same response');
select pg_temp.as_user(:'new_u');
select pg_temp.ok((select c -> 'pregnancy' ->> 'edd' = (current_date + 30)::text from public.family_context() c)
  and (select jsonb_array_length(s -> 'visits') = 1 from public.family_schedule() s),
  'D011 the family now sees the due date and the planned visit');

-- ════════════════════════════════════════════════════════════════════════════════
-- Second dating: a re-dating (visits re-planned, no new test windows)
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
select (select version from public.pregnancies where id = :'p_new') as pv2 \gset
call pg_temp.fails(pg_temp.call('redate_pregnancy', jsonb_set(jsonb_set(:'first'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.key(5))),
    '{dating}', jsonb_build_object('method', 'clinician', 'edd', current_date + 37))),
  'D012 test windows are planned at the first dating only', '%first dating only%', 'PT422');
select public.redate_pregnancy(jsonb_build_object('idempotency_key', pg_temp.key(6), 'pregnancy_id', :'p_new', 'version', :pv2,
  'dating', jsonb_build_object('method', 'scan', 'scan_on', current_date - 3, 'ga_at_scan_days', 240, 'edd', current_date - 3 + 40),
  'cancel_task_ids', jsonb_build_array('00000000-0000-4000-800b-0000001000a1'),
  'new_tasks', jsonb_build_array(jsonb_build_object('kind', 'anc_visit', 'title', 'ANC visit · 36 weeks',
     'due_from', current_date + 8, 'due_by', current_date + 10))))::text as second_out \gset
reset role;
select pg_temp.ok(not (:'second_out'::jsonb ->> 'first_dating')::boolean and (:'second_out'::jsonb ->> 'cancelled')::int = 1
  and (select edd = current_date + 37 from public.pregnancies where id = :'p_new')
  and (select count(*) from public.pregnancy_datings where pregnancy_id = :'p_new') = 2
  and (select count(*) from public.investigations where pregnancy_id = :'p_new') = 2,
  'D013 a second dating re-dates: one current dating, visits re-planned, the test windows kept');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'redate_pregnancy' and entity_id = :'p_new'),
  'D014 …audited as redate_pregnancy');

-- The register import still dates at registration (dating given → behaves as before).
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.register_pregnancy(jsonb_build_object(
  'idempotency_key', pg_temp.key(7), 'source', 'import',
  'mother', jsonb_build_object('name', 'Import Row', 'age', 27, 'phone', '919000000311', 'lang', 'en'),
  'pregnancy', jsonb_build_object('id', '00000000-0000-4000-8004-0000001000b1', 'gravida', 1, 'para', 0, 'living', 0, 'abortions', 0),
  'dating', jsonb_build_object('method', 'lmp', 'lmp', current_date - 84, 'edd', current_date + 196),
  'team_id', :'t_unit_a', 'ga_days', 84));
reset role;
select pg_temp.ok((select edd = current_date + 196 from public.pregnancies where id = '00000000-0000-4000-8004-0000001000b1')
  and (select ga_days = 84 from public.encounters where pregnancy_id = '00000000-0000-4000-8004-0000001000b1' and kind = 'registration'),
  'D015 a dating given at registration (register import) works as before');

-- ════════════════════════════════════════════════════════════════════════════════
-- update_mother with the new fields
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'priya');
select (select version from public.mothers where id = :'m_new') as mv \gset
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(10), 'mother_id', :'m_lakshmi', 'husband_name', 'Ravi K')),
  'M001 a husband''s name for a woman not recorded as married is refused', '%only when her marital status is married%', 'PT422');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(11), 'mother_id', :'m_new', 'aadhaar_last4', '12345')),
  'M002 Aadhaar: the last 4 digits only, here too', '%only the last 4 digits%', 'PT422');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(12), 'mother_id', :'m_new', 'email', 'no-at-sign')),
  'M003 the email shape, here too', '%email address%', 'PT422');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(13), 'mother_id', :'m_new', 'husband_phone', '919000000301')),
  'M004 the husband''s mobile is not hers (checked against her record)', '%must differ from her mobile%', 'PT422');
-- Married on record: the husband's mobile alone can be corrected.
select public.update_mother(jsonb_build_object('idempotency_key', pg_temp.key(14), 'mother_id', :'m_new', 'version', :mv,
  'husband_phone', '919000000304', 'email', 'shilpa@example.org', 'address_line', '#9 Temple Road', 'aadhaar_last4', '8765'));
reset role;
select pg_temp.ok((select m.husband_phone = '919000000304' and m.email = 'shilpa@example.org' and m.address_line = '#9 Temple Road'
    and m.aadhaar_last4 = '8765' and m.husband_name = 'Raghu R' from public.mothers m where m.id = :'m_new'),
  'M005 the new fields are corrected; the others keep their value');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'update' and entity_type = 'mothers' and entity_id = :'m_new'
    and meta -> 'email' = '{"changed": true}'::jsonb and meta -> 'aadhaar_last4' = '{"changed": true}'::jsonb
    and meta -> 'husband_phone' = '{"changed": true}'::jsonb and meta -> 'address_line' = '{"changed": true}'::jsonb)
  and exists (select 1 from public.audit_log where action = 'update_mother' and entity_id = :'m_new' and meta -> 'fields' ? 'aadhaar_last4'
              and meta::text not like '%8765%' and meta::text not like '%example.org%'),
  'M006 personal fields are audited as changed, by name, never by value');
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.update_mother(jsonb_build_object('idempotency_key', pg_temp.key(15), 'mother_id', :'m_new', 'marital_status', 'widowed'));
reset role;
select pg_temp.ok((select m.marital_status = 'widowed' and m.husband_name is null and m.husband_phone is null from public.mothers m where m.id = :'m_new'),
  'M007 leaving "married" clears the husband''s details');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.call('update_mother', jsonb_build_object('idempotency_key', pg_temp.key(16), 'mother_id', :'m_new', 'husband_name', 'Raghu R')),
  'M008 …and they cannot come back while she is not married', '%only when her marital status is married%', 'PT422');
select public.update_mother(jsonb_build_object('idempotency_key', pg_temp.key(17), 'mother_id', :'m_lakshmi',
  'marital_status', 'married', 'husband_name', 'Ravi K', 'dob', '2002-05-01'));
reset role;
select pg_temp.ok((select m.marital_status = 'married' and m.husband_name = 'Ravi K' and m.dob = '2002-05-01' from public.mothers m where m.id = :'m_lakshmi'),
  'M009 status and husband together in one correction; a date of birth added');
set local role authenticated;
select pg_temp.as_user(:'priya');
select pg_temp.ok((select (f ->> 'marital_status') = 'married' and f ? 'address_line' and f::text not like '%91900000%'
                     and not f ? 'email' and not f ? 'aadhaar_last4' and not f ? 'husband_phone'
                   from public.find_mother('{"phone": "919000000003"}') f),
  'M011 find_mother prefills marital status and address, never phones, email or Aadhaar digits');
reset role;

-- Erasure clears the new personal fields too.
insert into public.erasure_requests (id, mother_id, received_via) values ('00000000-0000-4000-800f-0000001000a1', :'m_new', 'hospital');
select app.erase_mother_personal_data('00000000-0000-4000-800f-0000001000a1', :'s_priya');
select pg_temp.ok((select m.email is null and m.address_line is null and m.aadhaar_last4 is null and m.husband_phone is null and m.erased_at is not null
                   from public.mothers m where m.id = :'m_new'), 'M012 DPDP erasure clears email, address, Aadhaar digits and the husband''s mobile');

select format('  100_register_v2: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
