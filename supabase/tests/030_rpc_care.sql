-- Care Team RPCs, called exactly as the app will (role authenticated + JWT sub). Happy paths, every refusal path,
-- idempotency, allowlists, versions, object-level access. Rolled back; synthetic data only.
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

-- Sign in as someone (claims only; the role switch happens at top level).
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true)
$$;

\ir _fixtures.psql

create temp table ids (k text primary key, v uuid not null);
grant select on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$ select v from ids where ids.k = $1 $$;
insert into ids values ('p_lakshmi', :'p_lakshmi'), ('m_lakshmi', :'m_lakshmi'), ('p_meena', :'p_meena'),
  ('m_sunita', :'m_sunita'), ('p_sunita', :'p_sunita'), ('m_meera', :'m_meera'), ('t_unit_a', :'t_unit_a'),
  ('t_unit_b', :'t_unit_b'), ('t_cardio', :'t_cardio'), ('t_obs', :'t_obs'), ('s_neha', :'s_neha'), ('s_priya', :'s_priya');
insert into ids select 't_lak_anc', id from public.tasks where pregnancy_id = :'p_lakshmi' and kind = 'anc_visit';
insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by) values
  ('00000000-0000-4000-8008-0000000000c1', :'m_lakshmi', :'p_lakshmi', 'hb3', 'Repeat Hb (3rd trimester)', current_date - 7, current_date + 21),
  ('00000000-0000-4000-8008-0000000000c2', :'m_lakshmi', :'p_lakshmi', 'hiv', 'HIV', current_date - 120, current_date - 90);
insert into public.callbacks (id, mother_id, requested_by, requested_by_label, channel, signs, at) values
  ('00000000-0000-4000-800f-0000000000c1', :'m_lakshmi', :'lakshmi_u', 'mother', 'app', '{headache_vision}', now() - interval '1 hour');
insert into public.allergies (id, mother_id, substance, recorded_by) values
  ('00000000-0000-4000-8015-0000000000c1', :'m_lakshmi', 'Penicillin', :'s_priya');

-- A complete registration payload (new mother "Nisha", ~11 weeks).
select jsonb_build_object(
  'idempotency_key', '00000000-0000-4000-a000-000000000c01',
  'mother', jsonb_build_object('phone', '919000000050', 'name', 'Nisha B', 'age', 23, 'lang', 'kn', 'village', 'Demo Village',
                               'rch_id', '123456789012', 'emergency_contact', jsonb_build_object('name', 'Suresh', 'phone', '919000000051')),
  'pregnancy', jsonb_build_object('id', '00000000-0000-4000-8004-0000000000c1', 'gravida', 1, 'para', 0, 'living', 0, 'abortions', 0),
  'dating', jsonb_build_object('method', 'lmp', 'lmp', current_date - 80, 'lmp_certain', true, 'edd', current_date + 200),
  'history', jsonb_build_object('allergies', jsonb_build_array('Sulfa'), 'blood_group', 'O-', 'height_cm', 155,
                                'conditions', jsonb_build_array('Hypothyroidism on treatment'), 'medicines', jsonb_build_array('Thyroxine')),
  'team_id', :'t_unit_a', 'intensity', 'routine', 'tags', jsonb_build_array('rh_neg'), 'ga_days', 80,
  'investigations', jsonb_build_array(
     jsonb_build_object('code', 'hb1', 'due_from', current_date, 'due_by', current_date + 14),
     jsonb_build_object('code', 'hiv', 'due_from', current_date, 'due_by', current_date + 14)),
  'tasks', jsonb_build_array(
     jsonb_build_object('kind', 'anc_visit', 'title', 'ANC visit · 16 weeks', 'due_from', current_date + 33, 'due_by', current_date + 35),
     jsonb_build_object('kind', 'anc_visit', 'title', 'ANC visit · 20 weeks', 'due_from', current_date + 61, 'due_by', current_date + 63))
)::text as reg \gset

-- ════════════════════════════════════════════════════════════════════════════════
-- Identity
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'priya');
select pg_temp.ok((select (w -> 'staff' ->> 'role') = 'obstetrician' and (w -> 'staff' -> 'teams') @> '[{"name":"OB Unit A"}]'
  and w::text not like '%9190000%' from public.whoami() w), 'R001 whoami: role and teams, no phone numbers');
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok((select (w -> 'mother' ->> 'consented')::boolean and w -> 'staff' = 'null'::jsonb from public.whoami() w),
  'R002 whoami: a consented mother, not staff');
select pg_temp.as_user(:'ravi');
select pg_temp.ok((select jsonb_array_length(w -> 'caregiving') = 1 from public.whoami() w), 'R003 whoami: a caregiver''s mothers');
call pg_temp.fails($$select app.hook_before_user_created('{"user":{"phone":"919999999999"}}')$$,
  'R004a the sign-up hook is callable only by Supabase Auth, not by app users', '%permission denied%');
reset role;
select pg_temp.ok((select app.hook_before_user_created('{"user":{"phone":"919999999999"}}') ? 'error')
  and app.hook_before_user_created('{"user":{"phone":"+91 90000 00003"}}') = '{}',
  'R004 the sign-up hook refuses an unregistered number and accepts a provisioned one');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Registration
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', :'reg'), 'R005 a paediatrician cannot register a pregnancy', '%role%', 'PT403');
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', jsonb_set(:'reg'::jsonb, '{idempotency_key}', '"00000000-0000-4000-a000-000000000c99"')),
  'R006 a family user cannot call Care Team RPCs', '%Care Team%', 'PT403');
select pg_temp.as_user(:'priya');
select public.register_pregnancy(:'reg'::jsonb)::text as reg_out \gset
select pg_temp.ok((:'reg_out'::jsonb ->> 'mch_id') ~ '^MCH-[0-9]{4}-000001$' and (:'reg_out'::jsonb ->> 'mrn') = 'DDH-000001',
  'R007 registration returns the server-assigned MCH id and MRN');
select pg_temp.ok(public.register_pregnancy(:'reg'::jsonb) = :'reg_out'::jsonb, 'R008 a replay returns the same response');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', jsonb_set(:'reg'::jsonb, '{intensity}', '"close"')),
  'R009 the same request id with different data is refused', '%different data%', 'PT409');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', (:'reg'::jsonb) || '{"role":"admin"}'),
  'R010 an unknown field is refused, not ignored', '%unexpected field(s) in request: role%', 'PT422');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', jsonb_set(:'reg'::jsonb, '{mother,is_vip}', 'true')),
  'R011 an unknown nested field is refused', '%unexpected field(s) in mother%', 'PT422');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', (:'reg'::jsonb) - 'idempotency_key'),
  'R012 every write needs a request id', '%idempotency_key is required%', 'PT422');
select pg_temp.ok((select count(*) from public.pregnancies where id = '00000000-0000-4000-8004-0000000000c1') = 1,
  'R013 the registering obstetrician sees the new pregnancy');
reset role;
select pg_temp.ok((select count(*) from public.pregnancy_datings where pregnancy_id = '00000000-0000-4000-8004-0000000000c1' and is_current) = 1
  and (select count(*) from public.care_assignments where pregnancy_id = '00000000-0000-4000-8004-0000000000c1' and to_at is null) = 2
  and (select count(*) from public.immunizations where pregnancy_id = '00000000-0000-4000-8004-0000000000c1' and code = 'td1') = 1
  and (select count(*) from public.observations o join public.encounters e on e.id = o.encounter_id
       where e.pregnancy_id = '00000000-0000-4000-8004-0000000000c1' and e.kind = 'registration') = 2
  and (select count(*) from public.investigations where pregnancy_id = '00000000-0000-4000-8004-0000000000c1') = 2
  and (select count(*) from public.tasks where pregnancy_id = '00000000-0000-4000-8004-0000000000c1') = 2
  and (select count(*) from public.patient_identifiers i join public.pregnancies g on g.mother_id = i.mother_id
       where g.id = '00000000-0000-4000-8004-0000000000c1') = 2,
  'R014 one call wrote dating, both care teams, Td, registration measurements, tests, visits and identifiers');
select pg_temp.ok((select primary_staff_id from public.care_assignments where pregnancy_id = '00000000-0000-4000-8004-0000000000c1'
  and specialty = 'obstetrics') = :'s_priya', 'R015 the registering obstetrician is the primary clinician');
set local role authenticated;
select pg_temp.as_user(:'neha');
select pg_temp.ok((select count(*) from public.pregnancies where id = '00000000-0000-4000-8004-0000000000c1') = 0,
  'R016 another unit does not see the new registration');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)',
  jsonb_set(jsonb_set(jsonb_set(:'reg'::jsonb, '{idempotency_key}', '"00000000-0000-4000-a000-000000000c02"'),
            '{mother,name}', '"Someone Else"'), '{pregnancy,id}', '"00000000-0000-4000-8004-0000000000c2"')),
  'R017 a phone that belongs to another patient is refused', '%already belongs to another patient%', 'PT409');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)',
  jsonb_set(jsonb_set(jsonb_set(:'reg'::jsonb, '{idempotency_key}', '"00000000-0000-4000-a000-000000000c03"'),
            '{mother}', jsonb_build_object('phone', '919000000003', 'name', 'Lakshmi K', 'age', 24)), '{pregnancy,id}', '"00000000-0000-4000-8004-0000000000c3"')),
  'R018 a mother with an active pregnancy cannot start another', '%already has an active pregnancy%', 'PT409');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)',
  jsonb_set(jsonb_set(:'reg'::jsonb, '{idempotency_key}', '"00000000-0000-4000-a000-000000000c04"'), '{team_id}', to_jsonb(:'t_obs'::text))),
  'R019 patients are assigned to a unit, not a department', '%obstetric unit%', 'PT422');
select jsonb_set(jsonb_set(jsonb_set(:'reg'::jsonb, '{idempotency_key}', '"00000000-0000-4000-a000-000000000c05"'),
  '{mother}', jsonb_build_object('phone', '919000000060', 'name', 'Asha Two', 'age', 25)),
  '{pregnancy,id}', '"00000000-0000-4000-8004-0000000000c5"')::text as reg2 \gset
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', jsonb_set(:'reg2'::jsonb, '{tasks}',
  jsonb_build_array(jsonb_build_object('kind', 'anc_visit', 'title', 'Too late', 'due_by', current_date + 230)))),
  'R020 a planned visit after EDD + 2 weeks is refused', '%not possible for this pregnancy: Too late%', 'PT422');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', jsonb_set(:'reg2'::jsonb, '{tasks}',
  jsonb_build_array(jsonb_build_object('kind', 'anc_visit', 'title', 'A', 'due_by', current_date + 30),
                    jsonb_build_object('kind', 'anc_visit', 'title', 'B', 'due_by', current_date + 30)))),
  'R021 two visits on one day are refused', '%on one day%', 'PT422');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', jsonb_set(:'reg2'::jsonb, '{tasks}',
  jsonb_build_array(jsonb_build_object('kind', 'pn_visit', 'title', 'Postnatal', 'due_by', current_date + 30)))),
  'R022 registration plans ANC visits only', '%not possible%', 'PT422');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', jsonb_set(:'reg2'::jsonb, '{investigations}',
  jsonb_build_array(jsonb_build_object('code', 'nb_bilirubin', 'due_from', current_date, 'due_by', current_date + 3)))),
  'R023 a newborn test cannot be planned on a pregnancy', '%planned tests are not possible%', 'PT422');
call pg_temp.fails(format('select public.register_pregnancy(%L::jsonb)', jsonb_set(:'reg2'::jsonb, '{tags}', '["lbw"]')),
  'R024 a newborn tag cannot be set at registration', '%does not apply%');
select pg_temp.ok((select count(*) from public.pregnancies where id = '00000000-0000-4000-8004-0000000000c5') = 0,
  'R025 a refused registration leaves nothing behind');
reset role;
select pg_temp.ok(not exists (select 1 from public.mothers where phone = '919000000060'), 'R026 …not even the mother');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- ANC visit
-- ════════════════════════════════════════════════════════════════════════════════
select jsonb_build_object(
  'idempotency_key', '00000000-0000-4000-a000-000000000d01', 'encounter_id', '00000000-0000-4000-8005-0000000000d1',
  'pregnancy_id', :'p_lakshmi', 'ga_days', 231, 'complaints', '["headache"]'::jsonb, 'counselling', '["birth_preparedness"]'::jsonb,
  'observations', jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 62.1),
                                    jsonb_build_object('code', 'bp_sys', 'value_num', 126), jsonb_build_object('code', 'bp_dia', 'value_num', 82),
                                    jsonb_build_object('code', 'urine_albumin', 'value_text', 'Nil')),
  'checklist', jsonb_build_array(jsonb_build_object('component', 'bp', 'state', 'done'),
                                 jsonb_build_object('component', 'fhr', 'state', 'not_done', 'reason', 'Doppler unavailable')),
  'completeness', 0.8, 'close_task_id', pg_temp.id('t_lak_anc'),
  'new_tasks', jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-800b-0000000000d1', 'kind', 'anc_visit',
                                 'title', 'ANC visit · 35 weeks', 'due_from', current_date + 12, 'due_by', current_date + 14)))::text as visit \gset
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.record_visit(%L::jsonb)', :'visit'), 'R027 a paediatrician cannot record an ANC visit', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.record_visit(%L::jsonb)', :'visit'), 'R028 another unit''s obstetrician gets "not found"', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
select public.record_visit(:'visit'::jsonb)::text as visit_out \gset
select pg_temp.ok((:'visit_out'::jsonb ->> 'encounter_id') = '00000000-0000-4000-8005-0000000000d1'
  and (:'visit_out'::jsonb ->> 'created')::int = 1, 'R029 a visit is recorded and the next one planned');
select pg_temp.ok(public.record_visit(:'visit'::jsonb) = :'visit_out'::jsonb
  and (select count(*) from public.encounters where pregnancy_id = pg_temp.id('p_lakshmi') and kind = 'anc') = 1,
  'R030 an offline retry records the visit once');
select pg_temp.ok((select completed_by_encounter_id from public.tasks where id = pg_temp.id('t_lak_anc')) = '00000000-0000-4000-8005-0000000000d1',
  'R031 the visit closed its task and the task links the visit');
select pg_temp.ok((select count(*) from public.observations where encounter_id = '00000000-0000-4000-8005-0000000000d1') = 4
  and (select count(*) from public.encounter_checklist where encounter_id = '00000000-0000-4000-8005-0000000000d1') = 2,
  'R032 measurements and checklist written in one go');
create function pg_temp.visit_with(k text, changes jsonb) returns text language sql as $$
  select format('select public.record_visit(%L::jsonb)',
    (current_setting('t.visit')::jsonb || jsonb_build_object('idempotency_key', k, 'encounter_id', gen_random_uuid(),
     'close_task_id', null, 'new_tasks', '[]'::jsonb)) || changes)
$$;
select set_config('t.visit', :'visit', true);
call pg_temp.fails(pg_temp.visit_with('00000000-0000-4000-a000-000000000d02', jsonb_build_object('observations',
  jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 62), jsonb_build_object('code', 'bp_sys', 'value_num', 900)))),
  'R033 an impossible value refuses the whole visit', '%not a possible entry%');
select pg_temp.ok((select count(*) from public.encounters where pregnancy_id = pg_temp.id('p_lakshmi') and kind = 'anc') = 1,
  'R034 …and nothing of it is saved');
call pg_temp.fails(pg_temp.visit_with('00000000-0000-4000-a000-000000000d03', jsonb_build_object('checklist',
  jsonb_build_array(jsonb_build_object('component', 'fhr', 'state', 'not_done')))), 'R035 a skipped item needs a reason', '%check constraint%');
call pg_temp.fails(pg_temp.visit_with('00000000-0000-4000-a000-000000000d04', jsonb_build_object('close_task_id', pg_temp.id('t_lak_anc'))),
  'R036 a visit cannot close a visit already done', '%no longer open%', 'PT409');
call pg_temp.fails(pg_temp.visit_with('00000000-0000-4000-a000-000000000d05', jsonb_build_object('complaints', '["Headache"]'::jsonb)),
  'R037 complaints are codes, not labels', '%unknown complaint%');
call pg_temp.fails(pg_temp.visit_with('00000000-0000-4000-a000-000000000d09', jsonb_build_object('complaints', 'headache')),
  'R037a a wrongly typed list is refused, never read as empty', '%complaints must be a list%', 'PT422');
call pg_temp.fails(pg_temp.visit_with('00000000-0000-4000-a000-000000000d06', jsonb_build_object('observations',
  jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 62, 'flag', 'H')))), 'R038 unknown fields inside a list are refused',
  '%unexpected field(s) in observations: flag%', 'PT422');
call pg_temp.fails(pg_temp.visit_with('00000000-0000-4000-a000-000000000d07', jsonb_build_object('pregnancy_id', pg_temp.id('p_meena'))),
  'R039 no ANC visit on a delivered pregnancy', '%ongoing pregnancy%', 'PT409');
reset role;
update public.app_settings set value = 'false' where key = 'demo_mode';
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.visit_with('00000000-0000-4000-a000-000000000d08', jsonb_build_object('at', now() + interval '2 days')),
  'R040 outside demo mode a visit cannot be dated in the future', '%future%', 'PT422');
reset role;
update public.app_settings set value = 'true' where key = 'demo_mode';
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Tags, intensity, re-dating
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.set_intensity(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000e01',
  'pregnancy_id', :'p_lakshmi', 'version', 999, 'intensity', 'close')), 'R041 a stale version is refused', '%Someone else updated%', 'PT409');
select (select version from public.pregnancies where id = :'p_lakshmi') as pv \gset
select public.set_intensity(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000e02', 'pregnancy_id', :'p_lakshmi',
  'version', :pv, 'intensity', 'close', 'note', 'Documented hypertensive disorder',
  'cancel_task_ids', jsonb_build_array('00000000-0000-4000-800b-0000000000d1'),
  'new_tasks', jsonb_build_array(jsonb_build_object('kind', 'anc_visit', 'title', 'ANC visit · 34+3 weeks', 'due_from', current_date + 5, 'due_by', current_date + 7))));
select pg_temp.ok((select intensity from public.pregnancies where id = pg_temp.id('p_lakshmi')) = 'close'
  and (select cancelled_at is not null from public.tasks where id = '00000000-0000-4000-800b-0000000000d1'),
  'R042 intensity set by the clinician re-plans the next visits');
call pg_temp.fails(format('select public.set_intensity(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000e03',
  'pregnancy_id', :'p_lakshmi', 'intensity', 'routine', 'cancel_task_ids', jsonb_build_array('00000000-0000-4000-800b-0000000000d1'))),
  'R043 re-planning cannot cancel a visit that is no longer open', '%changed meanwhile%', 'PT409');
select public.set_tags(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000e04', 'pregnancy_id', :'p_lakshmi',
  'codes', '["hypertensive","prev_cs"]'::jsonb));
call pg_temp.fails(format('select public.set_tags(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000e05',
  'pregnancy_id', :'p_lakshmi', 'codes', '["hypertensive"]'::jsonb)), 'R044 removing a tag needs a reason', '%needs a reason%', 'PT422');
select pg_temp.ok((public.set_tags(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000e06', 'pregnancy_id', :'p_lakshmi',
  'codes', '["hypertensive"]'::jsonb, 'removal_reason', 'Entered by mistake')) -> 'removed') = '["prev_cs"]',
  'R045 a tag removed with a reason');
call pg_temp.fails(format('select public.set_tags(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000e07',
  'pregnancy_id', :'p_lakshmi', 'codes', '["hypertensive","lbw"]'::jsonb)), 'R046 a newborn tag cannot go on a pregnancy', '%does not apply%');
select (select version from public.pregnancies where id = :'p_lakshmi') as pv \gset
select public.redate_pregnancy(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000e08', 'pregnancy_id', :'p_lakshmi',
  'version', :pv, 'dating', jsonb_build_object('method', 'scan', 'scan_on', current_date - 60, 'ga_at_scan_days', 180, 'edd', current_date + 40)));
reset role;
select pg_temp.ok((select edd from public.pregnancies where id = :'p_lakshmi') = current_date + 40
  and (select g.valid_from from public.access_grants g join public.care_assignments a on a.id = g.assignment_id
       where a.pregnancy_id = :'p_lakshmi' and a.specialty = 'paediatrics' and g.team_id is not null) = app.paeds_start(:'p_lakshmi'),
  'R047 re-dating updates the EDD and moves the paediatric start');
set local role authenticated;
select pg_temp.as_user(:'arjun');
select pg_temp.ok((select count(*) from public.pregnancies where id = pg_temp.id('p_lakshmi')) = 1,
  'R048 now past 34 weeks, the paediatric team sees her');

-- ════════════════════════════════════════════════════════════════════════════════
-- Care team and emergency override
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.assign_care(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000f01',
  'pregnancy_id', :'p_lakshmi', 'specialty', 'obstetrics', 'team_id', :'t_unit_b', 'reason', 'x')),
  'R049 a paediatrician cannot change the obstetric team', '%cannot change%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.assign_care(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000f02',
  'pregnancy_id', :'p_lakshmi', 'specialty', 'obstetrics', 'team_id', :'t_unit_b', 'reason', 'Taking over')),
  'R050 a clinician outside the team cannot reassign', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.assign_care(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000f03',
  'pregnancy_id', :'p_lakshmi', 'specialty', 'obstetrics', 'team_id', :'t_unit_b')),
  'R051 reassignment needs a reason', '%needs a reason%', 'PT422');
savepoint s_reassign;
select public.assign_care(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000f04', 'pregnancy_id', :'p_lakshmi',
  'specialty', 'obstetrics', 'team_id', :'t_unit_b', 'primary_staff_id', :'s_neha', 'reason', 'Moved near Unit B clinic'));
select pg_temp.ok((select count(*) from public.pregnancies where id = pg_temp.id('p_lakshmi')) = 0,
  'R052 after handing over, the previous team no longer sees her');
select pg_temp.as_user(:'neha');
select pg_temp.ok((select count(*) from public.investigations where id = '00000000-0000-4000-8008-0000000000c2') = 1,
  'R053 …and the new team sees the whole record, sensitive tests included');
rollback to savepoint s_reassign;
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000f05',
  'mother_id', :'m_lakshmi')), 'R054 an override needs a reason', '%needs a reason%', 'PT422');
select public.grant_override(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000f06', 'mother_id', :'m_lakshmi',
  'reason', 'Emergency in OPD, primary unavailable'))::text as ovr \gset
select pg_temp.ok((select count(*) from public.investigations where id = '00000000-0000-4000-8008-0000000000c2') = 1,
  'R055 an emergency override opens the whole record immediately');
select public.end_override(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000f07', 'override_id', :'ovr'::jsonb ->> 'override_id'));
select pg_temp.ok((select count(*) from public.pregnancies where id = pg_temp.id('p_lakshmi')) = 0, 'R056 ending the override closes it again');
select pg_temp.as_user(:'kiran');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000f08',
  'mother_id', :'m_sunita', 'reason', 'Curious')), 'R057 a specialist cannot break the glass', '%role%', 'PT403');
select pg_temp.as_user(:'meera');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000f09',
  'mother_id', :'m_meera', 'reason', 'My own chart')), 'R058 nobody can break the glass on her own record', 'Not found', 'PT404');

-- ════════════════════════════════════════════════════════════════════════════════
-- Investigations
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
select public.update_investigation(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a01',
  'id', '00000000-0000-4000-8008-0000000000c1', 'action', 'order'));
call pg_temp.fails(format('select public.update_investigation(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a02',
  'id', '00000000-0000-4000-8008-0000000000c1', 'action', 'order')), 'R059 a test is ordered once', '%cannot be marked order%', 'PT409');
call pg_temp.fails(format('select public.update_investigation(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a03',
  'id', '00000000-0000-4000-8008-0000000000c1', 'action', 'review', 'follow_up', 'none')), 'R060 nothing to review before a result', '%cannot be marked review%', 'PT409');
select public.record_result(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a04', 'id', '00000000-0000-4000-8009-0000000000c1',
  'investigation_id', '00000000-0000-4000-8008-0000000000c1', 'value_num', 10.4, 'unit', 'g/dL'));
call pg_temp.fails(format('select public.update_investigation(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a05',
  'id', '00000000-0000-4000-8008-0000000000c1', 'action', 'review', 'follow_up', 'maybe')), 'R061 a review picks a listed follow-up', '%Choose a follow-up%', 'PT422');
select public.update_investigation(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a06',
  'id', '00000000-0000-4000-8008-0000000000c1', 'action', 'review', 'follow_up', 'discuss_next_visit'));
select public.record_result(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a07',
  'investigation_id', '00000000-0000-4000-8008-0000000000c1', 'value_num', 11.4, 'unit', 'g/dL', 'supersedes', '00000000-0000-4000-8009-0000000000c1'));
select pg_temp.ok((select status = 'resulted' and reviewed_by is null from public.investigations where id = '00000000-0000-4000-8008-0000000000c1'),
  'R062 a corrected result clears the review and asks for a new one');
call pg_temp.fails(format('select public.update_investigation(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a08',
  'id', '00000000-0000-4000-8008-0000000000c2', 'action', 'not_done')), 'R063 not done needs a reason', '%needs a reason%', 'PT422');
select pg_temp.as_user(:'kiran');
call pg_temp.fails(format('select public.update_investigation(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a09',
  'id', '00000000-0000-4000-8008-0000000000c2', 'action', 'order')), 'R064 a specialist cannot even find an unshared sensitive test', 'Not found', 'PT404');
call pg_temp.fails(format('select public.record_result(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000a10',
  'investigation_id', '00000000-0000-4000-8008-0000000000c1', 'value_num', 9)), 'R065 a specialist cannot enter maternal results', '%role%', 'PT403');

-- ════════════════════════════════════════════════════════════════════════════════
-- Referrals
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.create_referral(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b01',
  'pregnancy_id', :'p_lakshmi', 'to_team_id', :'t_unit_b', 'urgency', 'routine', 'reason', 'r', 'question', 'q')),
  'R066 a referral goes to a department', '%department%', 'PT422');
select public.create_referral(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b02', 'id', '00000000-0000-4000-800e-0000000000b1',
  'pregnancy_id', :'p_lakshmi', 'to_team_id', :'t_cardio', 'from_encounter_id', '00000000-0000-4000-8005-0000000000d1',
  'urgency', '24h', 'reason', 'Documented murmur', 'question', 'Fit for vaginal delivery?'));
call pg_temp.fails(format('select public.advance_referral(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b03',
  'id', '00000000-0000-4000-800e-0000000000b1', 'to', 'accepted')), 'R067 the referrer cannot accept her own referral', '%cannot be moved%', 'PT409');
select pg_temp.as_user(:'kiran');
select public.advance_referral(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b04', 'id', '00000000-0000-4000-800e-0000000000b1', 'to', 'accepted'));
call pg_temp.fails(format('select public.advance_referral(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b05',
  'id', '00000000-0000-4000-800e-0000000000b1', 'to', 'scheduled')), 'R068 scheduling needs a time', '%date and time%', 'PT422');
select public.advance_referral(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b06', 'id', '00000000-0000-4000-800e-0000000000b1',
  'to', 'scheduled', 'scheduled_at', (current_date + 3)::timestamp + interval '11 hours', 'place', 'Cardiology OPD, Block C'));
select pg_temp.ok((select kind = 'referral_appt' and appointment_at is not null and due_by = current_date + 3 and place = 'Cardiology OPD, Block C'
  from public.tasks where referral_id = '00000000-0000-4000-800e-0000000000b1' and cancelled_at is null),
  'R069 scheduling creates the appointment the family will see');
call pg_temp.fails(format('select public.advance_referral(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b07',
  'id', '00000000-0000-4000-800e-0000000000b1', 'to', 'seen', 'version', 1)), 'R070 a stale version is refused', '%Someone else updated%', 'PT409');
select public.advance_referral(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b08', 'id', '00000000-0000-4000-800e-0000000000b1', 'to', 'seen'));
select pg_temp.ok((select completed_at is not null from public.tasks where referral_id = '00000000-0000-4000-800e-0000000000b1' and cancelled_at is null),
  'R071 "seen" completes the appointment');
call pg_temp.fails(format('select public.advance_referral(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b09',
  'id', '00000000-0000-4000-800e-0000000000b1', 'to', 'recommendations')), 'R072 the answer needs the recommendations', '%recommendations%', 'PT422');
select public.advance_referral(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b10', 'id', '00000000-0000-4000-800e-0000000000b1',
  'to', 'recommendations', 'recommendations', 'Fit for vaginal delivery; review if symptomatic'));
call pg_temp.fails(format('select public.advance_referral(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b11',
  'id', '00000000-0000-4000-800e-0000000000b1', 'to', 'closed')), 'R073 the specialist cannot close the referral', '%cannot be moved%', 'PT409');
call pg_temp.fails(format('select public.share_result(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b12',
  'referral_id', '00000000-0000-4000-800e-0000000000b1', 'investigation_id', '00000000-0000-4000-8008-0000000000c1')),
  'R074 a specialist cannot share results', '%role%', 'PT403');
select pg_temp.ok((select count(*) from public.investigations where id = '00000000-0000-4000-8008-0000000000c2') = 0,
  'R075 the specialist does not see the HIV test');
select pg_temp.as_user(:'priya');
select public.share_result(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b13',
  'referral_id', '00000000-0000-4000-800e-0000000000b1', 'investigation_id', '00000000-0000-4000-8008-0000000000c2'));
select pg_temp.as_user(:'kiran');
select pg_temp.ok((select count(*) from public.investigations where id = '00000000-0000-4000-8008-0000000000c2') = 1,
  'R076 …until the referring obstetrician shares that result');
select pg_temp.ok((select count(*) from public.referral_events where referral_id = '00000000-0000-4000-800e-0000000000b1') = 5,
  'R077 every step is on the referral timeline');
select pg_temp.as_user(:'priya');
select public.advance_referral(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000b14', 'id', '00000000-0000-4000-800e-0000000000b1', 'to', 'closed'));
reset role;
select pg_temp.ok((select g.valid_until = r.ended_at + interval '30 days' from public.access_grants g join public.referrals r on r.id = g.referral_id
  where r.id = '00000000-0000-4000-800e-0000000000b1'), 'R078 the referrer closes it; the department keeps 30 days of access');
set constraints all immediate;
select pg_temp.ok(true, 'R079 every commit-time invariant still holds after the whole flow');
set constraints all deferred;
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Call-backs, contacts, task overrides
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'kiran');
call pg_temp.fails(format('select public.close_callback(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c11',
  'id', '00000000-0000-4000-800f-0000000000c1', 'outcome', 'information_given')), 'R080 call-backs are for the treating team, not specialists', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.close_callback(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c12',
  'id', '00000000-0000-4000-800f-0000000000c1', 'outcome', 'Advised to come in')), 'R081 outcomes are codes', '%unknown callback_outcome%');
select public.close_callback(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c13', 'id', '00000000-0000-4000-800f-0000000000c1',
  'outcome', 'advised_to_come', 'note', 'Asked to come in today'));
call pg_temp.fails(format('select public.close_callback(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c14',
  'id', '00000000-0000-4000-800f-0000000000c1', 'outcome', 'information_given')), 'R082 a call-back is closed once', '%already closed%', 'PT409');
reset role;
insert into public.tasks (id, mother_id, pregnancy_id, kind, title, due_from, due_by, generated_by)
values ('00000000-0000-4000-800b-0000000000c9', :'m_lakshmi', :'p_lakshmi', 'anc_visit', 'Missed ANC visit', current_date - 12, current_date - 10, 'protocol');
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.log_contact(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c15', 'task_id', '00000000-0000-4000-800b-0000000000c9', 'outcome', 'unreachable', 'successful', false));
select public.log_contact(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c16', 'task_id', '00000000-0000-4000-800b-0000000000c9', 'outcome', 'unreachable', 'successful', false));
select pg_temp.ok((public.log_contact(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c17', 'task_id', '00000000-0000-4000-800b-0000000000c9',
  'outcome', 'unreachable', 'successful', false)) ->> 'lost')::boolean, 'R083 three unsuccessful calls mark the visit lost to follow-up');
call pg_temp.fails(format('select public.override_task(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c18',
  'id', '00000000-0000-4000-800b-0000000000c9', 'action', 'reschedule', 'due_by', current_date + 3)), 'R084 rescheduling needs a reason', '%needs a reason%', 'PT422');
call pg_temp.fails(format('select public.override_task(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c19',
  'id', '00000000-0000-4000-800b-0000000000c9', 'action', 'reschedule', 'due_by', current_date - 3, 'reason', 'x')),
  'R085 a visit cannot be rescheduled into the past', '%into the past%', 'PT422');
select public.override_task(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c20', 'id', '00000000-0000-4000-800b-0000000000c9',
  'action', 'reschedule', 'due_by', current_date + 3, 'reason', 'Reached husband; she will come Monday'));
select pg_temp.ok((select due_by = current_date + 3 and lost_at is null from public.tasks where id = '00000000-0000-4000-800b-0000000000c9'),
  'R086 rescheduling re-engages a lost visit');
select public.override_task(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c21', 'id', '00000000-0000-4000-800b-0000000000c9',
  'action', 'cancel', 'reason', 'Delivered elsewhere (reported)'));
call pg_temp.fails(format('select public.override_task(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c22',
  'id', '00000000-0000-4000-800b-0000000000c9', 'action', 'reschedule', 'due_by', current_date + 5, 'reason', 'x')),
  'R087 a cancelled visit cannot be rescheduled', '%already closed%', 'PT409');

-- ════════════════════════════════════════════════════════════════════════════════
-- Notes, corrections, record-opening audit
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'kiran');
select public.add_note(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c31', 'pregnancy_id', :'p_lakshmi',
  'body', 'Seen in cardiology; see recommendations.'));
call pg_temp.fails(format('select public.add_note(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c32',
  'pregnancy_id', :'p_sunita', 'body', 'x')), 'R088 no notes on a patient you cannot see', 'Not found', 'PT404');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.mark_entered_in_error(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c33',
  'kind', 'allergy', 'id', '00000000-0000-4000-8015-0000000000c1', 'reason', 'Wrong')),
  'R089 the mother''s documented history is corrected by her obstetric team', '%role%', 'PT403');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.mark_entered_in_error(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c34',
  'kind', 'visit', 'id', '00000000-0000-4000-8005-0000000000d1', 'reason', 'x')), 'R090 unknown record kinds are refused', '%Unknown record kind%', 'PT422');
select public.mark_entered_in_error(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c35',
  'kind', 'encounter', 'id', '00000000-0000-4000-8005-0000000000d1', 'reason', 'Recorded against the wrong patient'));
select pg_temp.ok((select count(*) from public.observations where encounter_id = '00000000-0000-4000-8005-0000000000d1' and status <> 'entered_in_error') = 0,
  'R091 withdrawing a visit withdraws its measurements');
call pg_temp.fails(format('select public.mark_entered_in_error(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000c36',
  'kind', 'encounter', 'id', '00000000-0000-4000-8005-0000000000d1', 'reason', 'Again')), 'R092 a withdrawal happens once', '%Already marked%', 'PT409');
select public.log_access(jsonb_build_object('pregnancy_id', :'p_lakshmi'));
select public.log_access(jsonb_build_object('pregnancy_id', :'p_lakshmi'));
select pg_temp.ok((select count(*) from public.audit_log where action = 'view_record' and entity_id = pg_temp.id('p_lakshmi')::text) = 1,
  'R093 opening a record twice within 10 minutes is one audit entry');
call pg_temp.fails(format('select public.log_access(%L::jsonb)', jsonb_build_object('pregnancy_id', :'p_sunita')),
  'R094 opening a record you cannot see is "not found"', 'Not found', 'PT404');
select pg_temp.ok((select count(*) from public.audit_log where action in ('register_pregnancy','set_intensity','override_granted',
  'result_shared','entered_in_error','reassign')) >= 5, 'R095 semantic events are in the audit trail');
reset role;

select format('  030_rpc_care: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
