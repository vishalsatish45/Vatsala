-- Schema guarantees (core + integrity migrations). Runs in a transaction that is rolled back, so the seed
-- is untouched. Any failed check raises 'FAIL: …' and stops the run (psql ON_ERROR_STOP).
begin;

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAIL: %', what; end if;
end $$;

-- The statement must fail, with an error message matching msg_like.
create procedure pg_temp.fails(stmt text, what text, msg_like text default '%') language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm not like msg_like then raise exception 'FAIL: % (wrong error: %)', what, sqlerrm; end if;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', what;
end $$;

\set h1  '00000000-0000-4000-8000-000000000001'
\set h2  '00000000-0000-4000-8000-000000000002'
\set ob  '00000000-0000-4000-8002-000000000001'
\set ma  '00000000-0000-4000-8003-000000000001'
\set mb  '00000000-0000-4000-8003-000000000002'
\set pa  '00000000-0000-4000-8004-000000000001'
\set pb  '00000000-0000-4000-8004-000000000002'
\set ea  '00000000-0000-4000-8005-000000000001'

-- ── API surface ─────────────────────────────────────────────────────────────────
select pg_temp.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'every public table has RLS enabled');
select pg_temp.ok(not exists (
  select 1 from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'),
  'anon has no privileges on public tables');
select pg_temp.ok(not exists (
  select 1 from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public' and privilege_type <> 'SELECT'),
  'authenticated can only SELECT (writes go through RPCs)');
select pg_temp.ok(not exists (
  select 1 from information_schema.role_table_grants
  where grantee = 'authenticated' and table_schema = 'public' and table_name in ('id_counters','idempotency_keys')),
  'server-internal tables are closed to API roles');
select pg_temp.ok(not has_function_privilege('authenticated', 'app.next_number(uuid,text,text)', 'execute'),
  'internal helpers are not callable from the API');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-9000-000000000001","role":"authenticated"}';
select pg_temp.ok((select count(*) from public.staff) = 0, 'a signed-in user with no linked record sees nothing');
select pg_temp.ok(auth.uid() = '00000000-0000-4000-9000-000000000001', 'auth.uid() reads the JWT sub');
call pg_temp.fails($$insert into public.app_settings values ('x', '1')$$, 'authenticated cannot insert directly', '%permission denied%');
reset role;

-- ── Identity linking; one phone per mother ──────────────────────────────────────
insert into auth.users (id, phone) values ('00000000-0000-4000-9000-000000000001', '919000000001');
select pg_temp.ok((select user_id from public.staff where phone = '919000000001') = '00000000-0000-4000-9000-000000000001',
  'staff row linked on first login');

insert into auth.users (id, phone) values ('00000000-0000-4000-9000-000000000003', '919000000003');
insert into public.mothers (id, phone, name, age_at_registration) values
  (:'ma', '919000000003', 'Test Mother A', 24),
  (:'mb', '919000000006', 'Test Mother B', 29);
select pg_temp.ok((select user_id from public.mothers where id = :'ma') = '00000000-0000-4000-9000-000000000003',
  'mother row linked to an existing account on insert');
-- Rejected by the phone (or, once linked, the account) uniqueness; register_pregnancy pre-checks with a plain message.
call pg_temp.fails($$insert into public.mothers (phone, name, age_at_registration) values ('919000000003', 'Someone else', 30)$$,
  'one phone belongs to one mother', '%duplicate key value violates unique constraint "mothers_%');
call pg_temp.fails($$insert into public.mothers (phone, name, age_at_registration) values ('919000000006', 'Someone else', 30)$$,
  'one phone belongs to one mother (no account yet)', '%mothers_phone_key%');
call pg_temp.fails($$insert into public.mothers (phone, name) values ('919000000009', 'No age')$$,
  'a mother needs a DOB or an age', '%check constraint%');

-- ── Pregnancy ───────────────────────────────────────────────────────────────────
insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions) values
  (:'pa', 'MCH-2026-000001', :'ma', :'h1', now(), current_date + 120, 2, 1, 1, 0),
  (:'pb', 'MCH-2026-000002', :'mb', :'h1', now(), current_date + 60, 1, 0, 0, 0);
call pg_temp.fails(format($$insert into public.pregnancies (mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions)
  values ('MCH-2026-000003', %L, %L, now(), current_date + 90, 2, 1, 1, 0)$$, :'ma', :'h1'),
  'only one active pregnancy per mother', '%one_open_pregnancy%');
call pg_temp.fails(format($$insert into public.pregnancies (mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions)
  values ('MCH-2026-000004', %L, %L, now(), current_date, 1, 1, 0, 1)$$, :'mb', :'h1'),
  'para + abortions cannot exceed gravida', '%check constraint%');
call pg_temp.fails(format($$update public.pregnancies set status = 'delivered' where id = %L$$, :'pb'),
  'delivered needs an end reason and date', '%check constraint%');

-- Dating: one current row; pregnancies.edd follows it.
insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, lmp_certain, edd, decided_by, decided_at) values
  (:'pa', :'ma', 'lmp', current_date - 160, true, current_date + 120, :'ob', now());
insert into public.pregnancy_datings (pregnancy_id, mother_id, method, scan_on, ga_at_scan_days, edd, decided_by, decided_at) values
  (:'pa', :'ma', 'scan', current_date - 100, 70, current_date + 110, :'ob', now());
select pg_temp.ok((select count(*) from public.pregnancy_datings where pregnancy_id = :'pa' and is_current) = 1,
  'exactly one current dating');
select pg_temp.ok((select edd from public.pregnancies where id = :'pa') = current_date + 110,
  'pregnancies.edd follows the current dating');
call pg_temp.fails($$update public.pregnancy_datings set edd = current_date where method = 'lmp'$$,
  'a dating is part of the record', '%cannot be changed%');

-- ── Nothing crosses mothers or hospitals ────────────────────────────────────────
call pg_temp.fails(format($$insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff)
  values (%L, %L, 'anc', now(), %L)$$, :'mb', :'pa', :'ob'),
  'an encounter cannot pair one mother with another mother''s pregnancy', '%does not match%');
insert into public.hospitals (id, name, code) values (:'h2', 'Other Hospital', 'OTH');
insert into public.teams (id, hospital_id, name, kind, specialty) values
  ('00000000-0000-4000-8001-0000000000f1', :'h2', 'Other OB', 'unit', 'obstetrics');
call pg_temp.fails(format($$insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, from_at)
  values (%L, %L, 'obstetrics', '00000000-0000-4000-8001-0000000000f1', now())$$, :'ma', :'pa'),
  'a patient cannot be assigned to another hospital''s team', '%different hospital%');
call pg_temp.fails(format($$insert into public.team_members (team_id, staff_id) values ('00000000-0000-4000-8001-0000000000f1', %L)$$, :'ob'),
  'staff cannot join another hospital''s team', '%different hospitals%');
call pg_temp.fails(format($$insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, from_at)
  values (%L, %L, 'obstetrics', '00000000-0000-4000-8001-0000000000a2', now())$$, :'ma', :'pa'),
  'an obstetric assignment needs an obstetric team', '%needs a obstetrics team%');
call pg_temp.fails(format($$insert into public.referrals (mother_id, pregnancy_id, to_team_id, urgency, reason, question, created_by, created_at)
  values (%L, %L, '00000000-0000-4000-8001-0000000000a1', 'routine', 'r', 'q', %L, now())$$, :'ma', :'pa', :'ob'),
  'referrals go to a department, not a unit', '%go to a department%');
insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at) values
  (:'ma', :'pa', 'obstetrics', '00000000-0000-4000-8001-0000000000a1', :'ob', now());
call pg_temp.fails(format($$insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, from_at)
  values (%L, %L, 'obstetrics', '00000000-0000-4000-8001-0000000000a1', now())$$, :'ma', :'pa'),
  'one current assignment per subject and specialty', '%care_assignments_current%');
call pg_temp.fails(format($$update public.care_assignments set primary_staff_id = null where pregnancy_id = %L$$, :'pa'),
  'reassignment ends the row and starts a new one (no in-place edits)', '%cannot be changed%');

-- ── Encounters & observations ───────────────────────────────────────────────────
insert into public.encounters (id, mother_id, pregnancy_id, kind, at, by_staff, ga_days, complaints, counselling) values
  (:'ea', :'ma', :'pa', 'anc', now(), :'ob', 175, '{headache}', '{nutrition}');
call pg_temp.fails(format($$insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff, complaints)
  values (%L, %L, 'anc', now(), %L, '{Headache}')$$, :'ma', :'pa', :'ob'),
  'complaints are codes, not labels', '%unknown complaint code%');
call pg_temp.fails(format($$insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff, source)
  values (%L, %L, 'anc', now(), %L, 'capture')$$, :'ma', :'pa', :'ob'),
  'a captured encounter links its paper document', '%check constraint%');

insert into public.observations (id, encounter_id, mother_id, pregnancy_id, code, value_num, at, by_staff) values
  ('00000000-0000-4000-8006-000000000001', :'ea', :'ma', :'pa', 'weight', 61.4, now(), :'ob');
select pg_temp.ok((select unit from public.observations where id = '00000000-0000-4000-8006-000000000001') = 'kg',
  'the unit is filled from the code');

create function pg_temp.obs(code text, num numeric, txt text, unit text default null) returns text language sql as $$
  select format($f$insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, value_text, unit, at, by_staff)
    values ('00000000-0000-4000-8005-000000000001', '00000000-0000-4000-8003-000000000001', '00000000-0000-4000-8004-000000000001',
            %L, %L, %L, %L, now(), '00000000-0000-4000-8002-000000000001')$f$, code, num, txt, unit)
$$;
call pg_temp.fails(pg_temp.obs('bp_sys', 900, null), 'impossible BP is rejected', '%not a possible entry%');
call pg_temp.fails(pg_temp.obs('weight', 61, null, 'lb'), 'wrong unit is rejected', '%recorded in kg%');
call pg_temp.fails(pg_temp.obs('urine_albumin', null, 'Positive'), 'unknown coded value is rejected', '%must be one of%');
call pg_temp.fails(pg_temp.obs('nb_weight', 3000, null), 'a baby code on a mother encounter is rejected', '%recorded for the baby%');
call pg_temp.fails(pg_temp.obs('weight', null, 'sixty'), 'a numeric code needs a number', '%needs a number%');

-- Facts: never edited, never deleted; entered-in-error needs a reason and is final.
call pg_temp.fails($$update public.observations set value_num = 62 where id = '00000000-0000-4000-8006-000000000001'$$,
  'an observation value cannot be edited', '%cannot be changed%');
call pg_temp.fails($$update public.observations set status = 'entered_in_error' where id = '00000000-0000-4000-8006-000000000001'$$,
  'entered in error needs a reason', '%needs a reason%');
update public.observations set status = 'entered_in_error', eie_reason = 'Wrong patient', eie_by = :'ob', eie_at = now()
  where id = '00000000-0000-4000-8006-000000000001';
call pg_temp.fails($$update public.observations set status = 'final' where id = '00000000-0000-4000-8006-000000000001'$$,
  'entered in error cannot be reinstated', '%cannot be reinstated%');
call pg_temp.fails($$delete from public.observations$$, 'clinical rows are never deleted', '%never deleted%');
call pg_temp.fails($$delete from public.mothers$$, 'mothers are never deleted', '%never deleted%');
call pg_temp.fails(format($$insert into public.encounter_checklist (encounter_id, mother_id, component, state)
  values (%L, %L, 'urine_albumin', 'not_done')$$, :'ea', :'ma'),
  'a skipped checklist item needs a reason (NULL is not a reason)', '%check constraint%');
call pg_temp.fails(format($$insert into public.encounter_checklist (encounter_id, mother_id, component, state)
  values (%L, %L, 'made_up', 'done')$$, :'ea', :'ma'),
  'checklist components are known codes', '%unknown anc_component code%');

-- ── Investigations ──────────────────────────────────────────────────────────────
insert into public.investigations (id, mother_id, pregnancy_id, code, label, sensitive, due_from, due_by) values
  ('00000000-0000-4000-8008-000000000001', :'ma', :'pa', 'hiv', 'HIV', false, now(), now() + interval '14 days'),
  ('00000000-0000-4000-8008-000000000002', :'ma', :'pa', 'hb1', 'Haemoglobin (Hb)', true, now(), now() + interval '14 days');
select pg_temp.ok((select sensitive from public.investigations where id = '00000000-0000-4000-8008-000000000001'),
  'HIV is sensitive even when the client says otherwise');
select pg_temp.ok(not (select sensitive from public.investigations where id = '00000000-0000-4000-8008-000000000002'),
  'Hb is not sensitive');
call pg_temp.fails(format($$insert into public.investigations (mother_id, pregnancy_id, code, label, due_from, due_by)
  values (%L, %L, 'nb_bilirubin', 'Bilirubin', now(), now())$$, :'ma', :'pa'),
  'a newborn test cannot be ordered on a pregnancy', '%baby test%');
call pg_temp.fails($$update public.investigations set status = 'not_done' where id = '00000000-0000-4000-8008-000000000002'$$,
  'not done needs a reason', '%check constraint%');
call pg_temp.fails(format($$update public.investigations set status = 'reviewed', reviewed_by = %L
  where id = '00000000-0000-4000-8008-000000000002'$$, :'ob'), 'a test without a result cannot be reviewed', '%without a result%');

-- ── Tags, tasks, immunizations ──────────────────────────────────────────────────
insert into public.tags (id, mother_id, pregnancy_id, code, set_by, set_at) values
  ('00000000-0000-4000-800a-000000000001', :'ma', :'pa', 'prev_cs', :'ob', now());
call pg_temp.fails(format($$update public.tags set removed_at = now(), removed_by = %L
  where id = '00000000-0000-4000-800a-000000000001'$$, :'ob'), 'removing a tag needs a reason', '%check constraint%');
call pg_temp.fails(format($$insert into public.tags (mother_id, pregnancy_id, code, set_by, set_at)
  values (%L, %L, 'lbw', %L, now())$$, :'ma', :'pa', :'ob'), 'a newborn tag cannot go on a pregnancy', '%does not apply%');

insert into public.tasks (id, mother_id, pregnancy_id, kind, title, due_by, generated_by) values
  ('00000000-0000-4000-800b-000000000001', :'ma', :'pa', 'anc_visit', 'ANC visit · 26 weeks', now() + interval '7 days', 'protocol');
call pg_temp.fails(format($$insert into public.tasks (mother_id, pregnancy_id, kind, title, due_by, generated_by)
  values (%L, %L, 'referral_appt', 'Cardiology appointment', now(), 'clinician')$$, :'ma', :'pa'),
  'a referral appointment must link its referral', '%check constraint%');
call pg_temp.fails($$update public.tasks set cancelled_at = now() where id = '00000000-0000-4000-800b-000000000001'$$,
  'cancelling a task needs a reason', '%check constraint%');
update public.tasks set due_by = now() + interval '9 days', override_reason = 'Patient request'
  where id = '00000000-0000-4000-800b-000000000001';
select pg_temp.ok((select version from public.tasks where id = '00000000-0000-4000-800b-000000000001') = 2,
  'version increments on update');

call pg_temp.fails(format($$insert into public.immunizations (mother_id, pregnancy_id, code, due_on, status, given_on)
  values (%L, %L, 'td1', current_date, 'given', current_date)$$, :'ma', :'pa'),
  'a given dose records whether it was given here or reported', '%check constraint%');
call pg_temp.fails(format($$insert into public.immunizations (mother_id, pregnancy_id, code, due_on)
  values (%L, %L, 'bcg', current_date)$$, :'ma', :'pa'),
  'a baby vaccine cannot be scheduled on a pregnancy', '%does not apply%');

-- ── Request helpers ─────────────────────────────────────────────────────────────
select pg_temp.ok(app.only_keys('{"a":1}', array['a','b']) = '{"a":1}', 'allowlisted payload passes');
call pg_temp.fails($$select app.only_keys('{"a":1,"role":"admin"}', array['a'])$$, 'unknown payload keys are rejected', '%unexpected field(s)%role%');
select pg_temp.ok(app.next_number(:'h1', 'mch', '2026') = 1 and app.next_number(:'h1', 'mch', '2026') = 2
  and app.next_number(:'h1', 'mch', '2027') = 1, 'numbers are sequential per hospital, kind and year');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-9000-000000000001"}', true);
select pg_temp.ok(app.idem_begin('demo_rpc', '{"idempotency_key":"00000000-0000-4000-a000-000000000001","x":1}') is null,
  'first call with a key proceeds');
select app.idem_finish('{"idempotency_key":"00000000-0000-4000-a000-000000000001"}', '{"done":true}');
select pg_temp.ok(app.idem_begin('demo_rpc', '{"idempotency_key":"00000000-0000-4000-a000-000000000001","x":1}') = '{"done":true}',
  'a replay returns the stored response');
call pg_temp.fails($$select app.idem_begin('demo_rpc', '{"idempotency_key":"00000000-0000-4000-a000-000000000001","x":2}')$$,
  'the same key with different data is rejected', '%already used for different data%');
call pg_temp.fails($$select app.idem_begin('demo_rpc', '{"x":2}')$$, 'a mutating call needs a key', '%idempotency_key is required%');

-- ── Audit ───────────────────────────────────────────────────────────────────────
select pg_temp.ok(exists (select 1 from public.audit_log where entity_type = 'encounters' and action = 'insert'
  and entity_id = :'ea' and mother_id = :'ma' and meta = '{}'), 'inserts are audited by id, without a copy of the data');
select pg_temp.ok((select meta ? 'due_by' and meta ? 'override_reason' and not meta ? 'title' and not meta ? 'version'
  from public.audit_log where entity_type = 'tasks' and action = 'update' order by id desc limit 1),
  'updates audit only the changed columns');
select pg_temp.ok(not exists (select 1 from public.audit_log where entity_type in ('id_counters','idempotency_keys')),
  'internal counters are not audited');
call pg_temp.fails($$update public.audit_log set action = 'changed'$$, 'audit_log cannot be updated', '%append-only%');
call pg_temp.fails($$delete from public.audit_log$$, 'audit_log cannot be deleted', '%append-only%');

\echo '  000_core: all checks passed'
rollback;
