-- Family onboarding details before consent (family_onboarding_info) and the assigned doctor in family_context
-- (20261005001050). Called as real users. Rolled back; synthetic data only.
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

\ir _fixtures.psql

-- A registered mother with no pregnancy on record yet (null-safety: no hospital, no doctor, no MCH id, no EDD).
\set nopreg_u '00000000-0000-4000-9000-000000000088'
insert into auth.users (id, phone) values (:'nopreg_u', '919000000088');
insert into public.mothers (phone, name, age_at_registration, lang) values ('919000000088', 'Test Nopreg', 26, 'en');

\set ctx_ravi '{"mother_id":"00000000-0000-4000-8003-000000000001"}'
\set info_ravi 'select public.family_onboarding_info(''{"mother_id":"00000000-0000-4000-8003-000000000001"}''::jsonb)'

set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- The mother, before consent
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'meena_u');
call pg_temp.fails($$select public.family_context()$$, 'O001 (premise) without consent family_context sees nothing', 'Not found', 'PT404');
select public.family_onboarding_info()::text as info \gset
select pg_temp.ok((:'info'::jsonb ->> 'role') = 'mother' and (:'info'::jsonb -> 'mother' ->> 'name') = 'Meena T',
  'O002 before consent the mother gets her name for "Your details"');
select pg_temp.ok((:'info'::jsonb ->> 'phone') = '9000000006', 'O003 …her own number, in local format');
select pg_temp.ok((:'info'::jsonb ->> 'mch_id') = 'MCH-2026-000103' and (:'info'::jsonb ->> 'edd')::date = current_date - 2,
  'O004 …her MCH id and EDD');
select pg_temp.ok((:'info'::jsonb -> 'hospital' ->> 'name') = 'Demo District Hospital', 'O005 …and her hospital''s name');
select pg_temp.ok((:'info'::jsonb -> 'doctor') = 'null'::jsonb, 'O006 a team with no named doctor: doctor is null, not invented');
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(:'info'::jsonb) k) = '{doctor,edd,hospital,mch_id,mother,phone,role}'
  and (select array_agg(k order by k) from jsonb_object_keys(:'info'::jsonb -> 'mother') k) = '{name}'
  and (select array_agg(k order by k) from jsonb_object_keys(:'info'::jsonb -> 'hospital') k) = '{name}',
  'O007 exactly these fields: nothing clinical (no card, tests, readings, tags, babies, scopes)');
select pg_temp.ok(public.family_onboarding_info('{}'::jsonb) = :'info'::jsonb, 'O008 the payload is optional');
call pg_temp.fails($$select public.family_onboarding_info('{"tests":true}'::jsonb)$$, 'O009 unknown fields are refused', '%unexpected field(s)%', 'PT422');
call pg_temp.fails(format('select public.family_onboarding_info(%L::jsonb)', jsonb_build_object('mother_id', :'m_lakshmi')),
  'O010 a mother cannot read another mother''s details', 'Not found', 'PT404');

-- Lakshmi, consent withdrawn: still her onboarding details, now with her named doctor.
savepoint s_withdrawn;
select pg_temp.as_user(:'lakshmi_u');
select public.withdraw_consent(jsonb_build_object('idempotency_key', pg_temp.k(), 'reason', 'Not using the app'));
call pg_temp.fails($$select public.family_context()$$, 'O011 (premise) withdrawn consent closes family_context', 'Not found', 'PT404');
select public.family_onboarding_info()::text as info_l \gset
select pg_temp.ok((:'info_l'::jsonb ->> 'doctor') = 'Dr. Priya Rao' and (:'info_l'::jsonb ->> 'phone') = '9000000003'
  and (:'info_l'::jsonb ->> 'mch_id') = 'MCH-2026-000101', 'O012 onboarding shows her named doctor before (re-)consent');
select pg_temp.ok(:'info_l' not like '%919000000004%' and :'info_l' not like '%Ravi%', 'O013 her caregiver''s number and name are not in it');
rollback to savepoint s_withdrawn;

-- A mother with no pregnancy on record yet: every pregnancy field is simply null.
select pg_temp.as_user(:'nopreg_u');
select public.family_onboarding_info()::text as info_n \gset
select pg_temp.ok((:'info_n'::jsonb -> 'mother' ->> 'name') = 'Test Nopreg' and (:'info_n'::jsonb -> 'hospital') = 'null'::jsonb
  and (:'info_n'::jsonb -> 'doctor') = 'null'::jsonb and (:'info_n'::jsonb -> 'mch_id') = 'null'::jsonb and (:'info_n'::jsonb -> 'edd') = 'null'::jsonb,
  'O014 no pregnancy yet: hospital, doctor, MCH id and EDD are null (no error)');

-- ════════════════════════════════════════════════════════════════════════════════
-- A caregiver, before consent
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'ravi');
call pg_temp.fails(format('select public.family_context(%L::jsonb)', :'ctx_ravi'), 'O015 (premise) the caregiver has not consented', 'Not found', 'PT404');
select public.family_onboarding_info(:'ctx_ravi'::jsonb)::text as info_r \gset
select pg_temp.ok((:'info_r'::jsonb ->> 'role') = 'caregiver' and (:'info_r'::jsonb -> 'mother' ->> 'name') = 'Lakshmi K',
  'O016 before consent the caregiver sees whose helper he is');
select pg_temp.ok((:'info_r'::jsonb ->> 'phone') = '9000000004', 'O017 …his own number (local format), never hers');
select pg_temp.ok(:'info_r' not like '%9000000003%', 'O018 the mother''s number is not in it');
select pg_temp.ok((:'info_r'::jsonb -> 'mch_id') = 'null'::jsonb and (:'info_r'::jsonb -> 'edd') = 'null'::jsonb,
  'O019 her MCH id and EDD are the mother''s only');
select pg_temp.ok((:'info_r'::jsonb -> 'hospital' ->> 'name') = 'Demo District Hospital' and (:'info_r'::jsonb ->> 'doctor') = 'Dr. Priya Rao',
  'O020 the hospital and the doctor''s name are not sensitive: the caregiver sees them');
call pg_temp.fails($$select public.family_onboarding_info()$$, 'O021 a caregiver must name the mother', 'Not found', 'PT404');
call pg_temp.fails(format('select public.family_onboarding_info(%L::jsonb)', jsonb_build_object('mother_id', :'m_meena')),
  'O022 …and only a mother who added him', 'Not found', 'PT404');

-- ════════════════════════════════════════════════════════════════════════════════
-- Refused: staff and strangers
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
call pg_temp.fails($$select public.family_onboarding_info()$$, 'O023 her doctor is not a family user', 'Not found', 'PT404');
call pg_temp.fails(:'info_ravi', 'O024 staff cannot read it by naming the mother', 'Not found', 'PT404');
select pg_temp.as_user(:'kiran');
call pg_temp.fails(:'info_ravi', 'O025 a specialist cannot read it', 'Not found', 'PT404');
select pg_temp.as_user(:'other');
call pg_temp.fails(:'info_ravi', 'O026 a doctor of another hospital cannot read it', 'Not found', 'PT404');
select pg_temp.as_user('00000000-0000-4000-9000-0000000000ff');
call pg_temp.fails($$select public.family_onboarding_info()$$, 'O027 an unknown account gets nothing', 'Not found', 'PT404');
reset role;
select pg_temp.ok(not has_function_privilege('anon', 'public.family_onboarding_info(jsonb)', 'execute')
  and has_function_privilege('authenticated', 'public.family_onboarding_info(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'app.family_doctor_name(uuid)', 'execute'),
  'O028 signed-in users only; the doctor-name helper is not an API function');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- family_context: the assigned doctor
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok((public.family_context() -> 'pregnancy' ->> 'doctor') = 'Dr. Priya Rao', 'O029 Home shows her named doctor');
select pg_temp.as_user(:'ravi');
select public.record_consent(jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_lakshmi', 'notice_version', 'v1', 'lang', 'kn',
  'purposes', '["app"]'::jsonb, 'decision', 'accepted'));
select pg_temp.ok((public.family_context(:'ctx_ravi'::jsonb) -> 'pregnancy' ->> 'doctor') = 'Dr. Priya Rao', 'O030 …and so does her caregiver''s');
select pg_temp.as_user(:'meena_u');
select public.record_consent(jsonb_build_object('idempotency_key', pg_temp.k(), 'notice_version', 'v1', 'lang', 'kn',
  'purposes', '["app"]'::jsonb, 'decision', 'accepted'));
select pg_temp.ok((public.family_context() -> 'pregnancy') ? 'doctor' and (public.family_context() -> 'pregnancy' -> 'doctor') = 'null'::jsonb,
  'O031 no named doctor on the current assignment: doctor is null');

-- The doctor follows the CURRENT obstetric assignment.
savepoint s_reassign;
reset role;
update public.care_assignments set to_at = now() where pregnancy_id = :'p_lakshmi' and specialty = 'obstetrics' and to_at is null;
insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at, reason)
values (:'m_lakshmi', :'p_lakshmi', 'obstetrics', :'t_unit_a', :'s_meera', now(), 'Cover');
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok((public.family_context() -> 'pregnancy' ->> 'doctor') = 'Dr. Meera S', 'O032 after reassignment Home names the new doctor');
select pg_temp.ok((public.family_onboarding_info() ->> 'doctor') = 'Dr. Meera S', 'O033 …and so does onboarding');
reset role;
update public.care_assignments set to_at = now() where pregnancy_id = :'p_lakshmi' and specialty = 'obstetrics' and to_at is null;
insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at, reason)
values (:'m_lakshmi', :'p_lakshmi', 'obstetrics', :'t_unit_a', null, now(), 'Team only');
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok((public.family_context() -> 'pregnancy' -> 'doctor') = 'null'::jsonb, 'O034 assigned to a team only: no doctor named');
rollback to savepoint s_reassign;

-- ════════════════════════════════════════════════════════════════════════════════
-- Removal is immediate
-- ════════════════════════════════════════════════════════════════════════════════
reset role;
update public.caregivers set revoked_at = now() where mother_id = :'m_lakshmi' and user_id = :'ravi';
set local role authenticated;
select pg_temp.as_user(:'ravi');
call pg_temp.fails(:'info_ravi', 'O035 a removed caregiver gets nothing, not even the onboarding details', 'Not found', 'PT404');
reset role;

select format('  101_family_onboarding: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
