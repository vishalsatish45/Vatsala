-- Scenario suite: 150+ numbered scenarios across the whole schema — valid flows that must work, invalid ones
-- that must be refused with the right reason, commit-time invariants, access edge cases, and structural checks
-- over the catalogue. Everything is rolled back. Synthetic data only.
begin;

create temp table t_count (n int not null);
insert into t_count values (0);
grant all on t_count to authenticated;

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  update t_count set n = n + 1;
  if not coalesce(cond, false) then raise exception 'FAIL: %', what; end if;
end $$;

-- Must succeed.
create procedure pg_temp.works(stmt text, what text) language plpgsql as $$
begin
  update t_count set n = n + 1;
  begin
    execute stmt;
  exception when others then
    raise exception 'FAIL: % (refused: %)', what, sqlerrm;
  end;
end $$;

-- Must be refused immediately, with a message matching msg_like.
create procedure pg_temp.fails(stmt text, what text, msg_like text default '%') language plpgsql as $$
begin
  update t_count set n = n + 1;
  begin
    execute stmt;
  exception when others then
    if sqlerrm not like msg_like then raise exception 'FAIL: % (wrong error: %)', what, sqlerrm; end if;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', what;
end $$;

-- Must be refused at COMMIT (deferred invariants): run, then force the deferred checks now.
create procedure pg_temp.fails_at_commit(stmt text, what text, msg_like text default '%') language plpgsql as $$
begin
  update t_count set n = n + 1;
  begin
    execute stmt;
    set constraints all immediate;
  exception when others then
    set constraints all deferred;
    if sqlerrm not like msg_like then raise exception 'FAIL: % (wrong error: %)', what, sqlerrm; end if;
    return;
  end;
  set constraints all deferred;
  raise exception 'FAIL: % (accepted at commit)', what;
end $$;

-- Must pass the deferred checks.
create procedure pg_temp.commit_ok(what text) language plpgsql as $$
begin
  update t_count set n = n + 1;
  begin
    set constraints all immediate;
  exception when others then
    raise exception 'FAIL: % (commit check: %)', what, sqlerrm;
  end;
  set constraints all deferred;
end $$;

\ir _fixtures.psql

-- ── Extra cast for the scenarios ────────────────────────────────────────────────
--   Rekha: an earlier pregnancy that ended in miscarriage + a current one (same mother, two pregnancies).
create temp table ids (k text primary key, v uuid not null);
insert into ids values
  ('h1', :'h1'), ('h2', :'h2'),
  ('t_obs', :'t_obs'), ('t_paeds', :'t_paeds'), ('t_cardio', :'t_cardio'),
  ('t_unit_a', :'t_unit_a'), ('t_unit_b', :'t_unit_b'), ('t_paeds_unit', :'t_paeds_unit'),
  ('s_priya', :'s_priya'), ('s_arjun', :'s_arjun'), ('s_kiran', :'s_kiran'), ('s_neha', :'s_neha'), ('s_meera', :'s_meera'),
  ('m_lakshmi', :'m_lakshmi'), ('p_lakshmi', :'p_lakshmi'), ('m_sunita', :'m_sunita'), ('p_sunita', :'p_sunita'),
  ('m_meena', :'m_meena'), ('p_meena', :'p_meena'), ('b_meena', :'b_meena'), ('m_kavya', :'m_kavya'), ('p_kavya', :'p_kavya'),
  ('m_asha', :'m_asha'), ('p_asha', :'p_asha'), ('m_meera', :'m_meera'),
  ('d_meena', '00000000-0000-4000-800d-000000000001'),
  ('m_rekha', '00000000-0000-4000-8003-0000000000a1'),
  ('p_rekha_old', '00000000-0000-4000-8004-0000000000a1'), ('p_rekha', '00000000-0000-4000-8004-0000000000a2'),
  ('e_lak', '00000000-0000-4000-8005-0000000000a1'), ('e_rekha_old', '00000000-0000-4000-8005-0000000000a2'),
  ('e_rekha', '00000000-0000-4000-8005-0000000000a3'), ('e_baby', '00000000-0000-4000-8005-0000000000a4'),
  ('o_lak_w', '00000000-0000-4000-8006-0000000000a1'), ('o_lak_bp', '00000000-0000-4000-8006-0000000000a2'),
  ('o_rekha_old_w', '00000000-0000-4000-8006-0000000000a3'), ('o_lak_eie', '00000000-0000-4000-8006-0000000000a4'),
  ('i_lak_hb', '00000000-0000-4000-8008-0000000000a1'), ('i_lak_hiv', '00000000-0000-4000-8008-0000000000a2'),
  ('i_rekha_old_dating', '00000000-0000-4000-8008-0000000000a3'), ('i_lak_tsh', '00000000-0000-4000-8008-0000000000a4'),
  ('r_lak_hb', '00000000-0000-4000-8009-0000000000a1'), ('r_lak_tsh', '00000000-0000-4000-8009-0000000000a2'),
  ('ref_rekha', '00000000-0000-4000-800e-0000000000a1'),
  ('rx_ifa', '00000000-0000-4000-8010-0000000000a1'), ('rx_stmt', '00000000-0000-4000-8010-0000000000a2'),
  ('rx_stopped', '00000000-0000-4000-8010-0000000000a3'),
  ('doc_rekha_old', '00000000-0000-4000-8011-0000000000a1'),
  ('t_lak_anc', '00000000-0000-4000-800b-0000000000a1'),
  ('dis_meena_baby', '00000000-0000-4000-8012-0000000000a1'), ('dis_meena', '00000000-0000-4000-8012-0000000000a2');
grant select on ids to authenticated;
create function pg_temp.id(k text) returns uuid language sql stable as $$ select v from ids where ids.k = $1 $$;

insert into public.mothers (id, phone, name, age_at_registration) values (pg_temp.id('m_rekha'), '919000000014', 'Rekha D', 28);
insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions,
                                status, end_reason, ended_on) values
  (pg_temp.id('p_rekha_old'), 'MCH-2025-000107', pg_temp.id('m_rekha'), :'h1', now() - interval '400 days', current_date - 200,
   1, 0, 0, 1, 'closed', 'miscarriage', current_date - 330);
insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions) values
  (pg_temp.id('p_rekha'), 'MCH-2026-000108', pg_temp.id('m_rekha'), :'h1', now() - interval '8 weeks', current_date + 160, 2, 0, 0, 1);
insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, edd, decided_by, decided_at)
select g.id, g.mother_id, 'lmp', g.edd - 280, g.edd, :'s_priya', g.registered_on
from public.pregnancies g where g.mother_id = pg_temp.id('m_rekha');
insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at) values
  (pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), 'obstetrics', :'t_unit_a', :'s_priya', now() - interval '8 weeks');

insert into public.encounters (id, mother_id, pregnancy_id, baby_id, kind, at, by_staff) values
  (pg_temp.id('e_lak'), :'m_lakshmi', :'p_lakshmi', null, 'anc', now() - interval '7 days', :'s_priya'),
  (pg_temp.id('e_rekha_old'), pg_temp.id('m_rekha'), pg_temp.id('p_rekha_old'), null, 'anc', now() - interval '360 days', :'s_priya'),
  (pg_temp.id('e_rekha'), pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), null, 'anc', now() - interval '1 day', :'s_priya'),
  (pg_temp.id('e_baby'), :'m_meena', null, :'b_meena', 'newborn', now() - interval '1 day', :'s_arjun');
insert into public.observations (id, encounter_id, mother_id, pregnancy_id, code, value_num, at, by_staff) values
  (pg_temp.id('o_lak_w'), pg_temp.id('e_lak'), :'m_lakshmi', :'p_lakshmi', 'weight', 61.4, now() - interval '7 days', :'s_priya'),
  (pg_temp.id('o_lak_bp'), pg_temp.id('e_lak'), :'m_lakshmi', :'p_lakshmi', 'bp_sys', 118, now() - interval '7 days', :'s_priya'),
  (pg_temp.id('o_rekha_old_w'), pg_temp.id('e_rekha_old'), pg_temp.id('m_rekha'), pg_temp.id('p_rekha_old'), 'weight', 55, now() - interval '360 days', :'s_priya');
insert into public.observations (id, encounter_id, mother_id, pregnancy_id, code, value_num, at, by_staff, status, eie_reason, eie_by, eie_at) values
  (pg_temp.id('o_lak_eie'), pg_temp.id('e_lak'), :'m_lakshmi', :'p_lakshmi', 'pulse', 80, now() - interval '7 days', :'s_priya',
   'entered_in_error', 'Wrong patient', :'s_priya', now());

insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by, status, ordered_at, ordered_by) values
  (pg_temp.id('i_lak_hb'),  :'m_lakshmi', :'p_lakshmi', 'hb3', 'Repeat Hb (3rd trimester)', current_date - 7, current_date + 21, 'ordered', now(), :'s_priya'),
  (pg_temp.id('i_lak_hiv'), :'m_lakshmi', :'p_lakshmi', 'hiv', 'HIV', current_date - 120, current_date - 90, 'ordered', now(), :'s_priya'),
  (pg_temp.id('i_lak_tsh'), :'m_lakshmi', :'p_lakshmi', 'tsh', 'TSH', current_date - 120, current_date - 90, 'ordered', now(), :'s_priya'),
  (pg_temp.id('i_rekha_old_dating'), pg_temp.id('m_rekha'), pg_temp.id('p_rekha_old'), 'dating', 'Dating scan', current_date - 390, current_date - 360, 'due', null, null);
insert into public.investigation_results (id, investigation_id, mother_id, value_num, unit, reported_at, entered_by) values
  (pg_temp.id('r_lak_tsh'), pg_temp.id('i_lak_tsh'), :'m_lakshmi', 2.1, 'm[IU]/L', now() - interval '95 days', :'s_priya');

insert into public.referrals (id, mother_id, pregnancy_id, to_team_id, urgency, reason, question, created_by, created_at) values
  (pg_temp.id('ref_rekha'), pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), :'t_cardio', 'routine', 'Documented murmur', 'Review?', :'s_priya', now());
insert into public.referral_events (referral_id, mother_id, status, at, by_staff) values
  (pg_temp.id('ref_rekha'), pg_temp.id('m_rekha'), 'requested', now(), :'s_priya');

insert into public.medications (id, mother_id, pregnancy_id, kind, name, dose, slots, prescribed_by, status, stopped_reason) values
  (pg_temp.id('rx_ifa'),     :'m_lakshmi', :'p_lakshmi', 'prescription', 'IFA', '1 tablet', '{afternoon}', :'s_priya', 'active', null),
  (pg_temp.id('rx_stmt'),    :'m_lakshmi', :'p_lakshmi', 'statement',    'Thyroxine', '50 mcg', '{}', null, 'active', null),
  (pg_temp.id('rx_stopped'), :'m_lakshmi', :'p_lakshmi', 'prescription', 'Calcium', '1 tablet', '{morning,night}', :'s_priya', 'stopped', 'Course completed early');

insert into public.documents (id, mother_id, pregnancy_id, kind, captured_by, captured_at) values
  (pg_temp.id('doc_rekha_old'), pg_temp.id('m_rekha'), pg_temp.id('p_rekha_old'), 'anc_card', :'s_priya', now());

insert into public.tags (mother_id, pregnancy_id, code, set_by, set_at) values (:'m_lakshmi', :'p_lakshmi', 'prev_cs', :'s_priya', now());

insert into public.tasks (id, mother_id, pregnancy_id, kind, title, due_from, due_by, generated_by) values
  (pg_temp.id('t_lak_anc'), :'m_lakshmi', :'p_lakshmi', 'anc_visit', 'ANC visit · 35 weeks', current_date + 12, current_date + 14, 'protocol');

insert into public.discharges (id, mother_id, baby_id, started_at) values
  (pg_temp.id('dis_meena_baby'), :'m_meena', :'b_meena', now());
insert into public.discharges (id, mother_id, pregnancy_id, started_at) values
  (pg_temp.id('dis_meena'), :'m_meena', :'p_meena', now());

call pg_temp.commit_ok('S000 the shared cast satisfies every commit-time invariant');

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. People and identity
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$insert into public.mothers (phone, name, age_at_registration) values ('9000000099', 'X', 25)$$,
  'S001 a phone without the 91 country code is refused', '%check constraint%');
call pg_temp.fails($$insert into public.mothers (phone, name, age_at_registration) values ('915000000000', 'X', 25)$$,
  'S002 an Indian mobile starts with 6–9', '%check constraint%');
call pg_temp.fails($$insert into public.mothers (phone, alt_phone, name, age_at_registration) values ('919000000099', '919000000099', 'X', 25)$$,
  'S003 the alternate phone differs from the phone', '%check constraint%');
call pg_temp.fails($$insert into public.mothers (phone, name, age_at_registration, emergency_contact) values ('919000000099', 'X', 25, '{"name":"Y"}')$$,
  'S004 an emergency contact needs a phone', '%check constraint%');
call pg_temp.fails($$insert into public.mothers (phone, name, age_at_registration, card_fields) values ('919000000099', 'X', 25, '{name,hiv}')$$,
  'S005 the emergency card offers only the allowed fields', '%check constraint%');
call pg_temp.fails($$insert into public.mothers (phone, name, age_at_registration, lang) values ('919000000099', 'X', 25, 'ta')$$,
  'S006 unsupported language refused', '%check constraint%');
call pg_temp.fails($$insert into public.mothers (phone, name, age_at_registration, pincode) values ('919000000099', 'X', 25, '012345')$$,
  'S007 a PIN code cannot start with 0', '%check constraint%');
call pg_temp.fails($$insert into public.mothers (phone, name, age_at_registration) values ('919000000099', 'X', 9)$$,
  'S008 impossible age refused', '%check constraint%');
call pg_temp.works($$insert into public.caregivers (mother_id, phone, name, relation) values (pg_temp.id('m_asha'), '919000000004', 'Ravi K', 'brother')$$,
  'S009 one person can be caregiver for two mothers');
select pg_temp.ok((select user_id from public.caregivers where mother_id = pg_temp.id('m_asha') and phone = '919000000004')
  = '00000000-0000-4000-9000-000000000004', 'S010 a caregiver row links to the existing account at once');
call pg_temp.fails($$insert into public.caregivers (mother_id, phone, name, relation) values (pg_temp.id('m_lakshmi'), '919000000004', 'Ravi', 'husband')$$,
  'S011 the same caregiver is active only once per mother', '%caregivers_active%');
update public.caregivers set revoked_at = now() where mother_id = :'m_lakshmi' and phone = '919000000004';
call pg_temp.works($$insert into public.caregivers (mother_id, phone, name, relation) values (pg_temp.id('m_lakshmi'), '919000000004', 'Ravi K', 'husband')$$,
  'S012 a removed caregiver can be added again (history kept)');
call pg_temp.fails($$update public.caregivers set phone = '919000000088' where mother_id = pg_temp.id('m_lakshmi') and revoked_at is not null$$,
  'S013 a caregiver row cannot be re-pointed to another phone', '%cannot be changed%');
call pg_temp.fails($$insert into public.consents (user_id, mother_id, notice_version, lang, purposes, decision)
  values ('00000000-0000-4000-9000-000000000003', pg_temp.id('m_lakshmi'), 'v1', 'kn', '{app,marketing}', 'accepted')$$,
  'S014 consent only for the listed purposes', '%check constraint%');
call pg_temp.fails($$insert into public.consents (user_id, mother_id, notice_version, lang, purposes, decision, withdrawn_at)
  values ('00000000-0000-4000-9000-000000000003', pg_temp.id('m_lakshmi'), 'v1', 'kn', '{app}', 'declined', now())$$,
  'S015 a declined consent cannot be "withdrawn"', '%check constraint%');
call pg_temp.fails($$insert into public.consents (mother_id, notice_version, lang, purposes, decision)
  values (pg_temp.id('m_rekha'), 'v1', 'kn', '{app}', 'accepted')$$,
  'S016 verbal consent names the clinician who recorded it', '%check constraint%');
call pg_temp.fails($$update public.consents set purposes = '{app,reminders_whatsapp}' where mother_id = pg_temp.id('m_lakshmi')$$,
  'S017 a given consent cannot be edited (new consent instead)', '%cannot be changed%');
call pg_temp.works($$update public.consents set withdrawn_at = now(), withdrawn_reason = 'No longer wants the app' where mother_id = pg_temp.id('m_lakshmi')$$,
  'S018 a consent can be withdrawn');
call pg_temp.fails($$insert into public.staff (hospital_id, phone, name, role) values (pg_temp.id('h1'), '919000000001', 'Dup', 'obstetrician')$$,
  'S019 a staff phone is unique (phone or, once linked, account key)', '%unique constraint "staff_%');
call pg_temp.fails($$update public.mothers set created_at = created_at - interval '1 day' where id = pg_temp.id('m_rekha')$$,
  'S020 a mother''s creation record cannot be rewritten', '%cannot be changed%');
call pg_temp.works($$update public.mothers set name = 'Rekha Devi' where id = pg_temp.id('m_rekha')$$,
  'S021 a misspelt name can be corrected (and the change is audited)');
select pg_temp.ok(exists (select 1 from public.audit_log where entity_type = 'mothers' and entity_id = pg_temp.id('m_rekha')::text
  and meta -> 'name' = '{"changed": true}') and not exists (select 1 from public.audit_log where meta::text like '%Rekha D%'),
  'S022 the audit records that the name changed — never the old or new name (DPDP: no personal values in the log)');

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. Pregnancy and dating
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$insert into public.pregnancies (mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions)
  values ('MCH-26-1', pg_temp.id('m_sunita'), pg_temp.id('h1'), now(), current_date, 1, 0, 0, 0)$$,
  'S023 malformed MCH id refused', '%check constraint%');
call pg_temp.fails($$insert into public.pregnancies (mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions)
  values ('MCH-2026-000900', pg_temp.id('m_sunita'), pg_temp.id('h1'), now(), current_date, 0, 0, 0, 0)$$,
  'S024 gravida is at least 1', '%check constraint%');
call pg_temp.fails($$update public.pregnancies set end_reason = 'miscarriage', ended_on = current_date where id = pg_temp.id('p_sunita')$$,
  'S025 an active pregnancy has no end reason', '%check constraint%');
call pg_temp.fails($$update public.pregnancies set mch_id = 'MCH-2026-000999' where id = pg_temp.id('p_lakshmi')$$,
  'S026 an MCH id is never edited', '%cannot be changed%');
call pg_temp.fails($$update public.pregnancies set mother_id = pg_temp.id('m_sunita') where id = pg_temp.id('p_lakshmi')$$,
  'S027 a pregnancy cannot move to another mother', '%cannot be changed%');
call pg_temp.fails($$update public.pregnancies set hospital_id = pg_temp.id('h2') where id = pg_temp.id('p_lakshmi')$$,
  'S028 a pregnancy cannot move to another hospital (end it as transferred and register anew)', '%cannot be changed%');
call pg_temp.fails($$insert into public.pregnancy_datings (pregnancy_id, mother_id, method, edd, decided_by, decided_at)
  values (pg_temp.id('p_lakshmi'), pg_temp.id('m_lakshmi'), 'lmp', current_date + 40, pg_temp.id('s_priya'), now())$$,
  'S029 LMP dating needs the LMP', '%check constraint%');
call pg_temp.fails($$insert into public.pregnancy_datings (pregnancy_id, mother_id, method, scan_on, edd, decided_by, decided_at)
  values (pg_temp.id('p_lakshmi'), pg_temp.id('m_lakshmi'), 'scan', current_date - 100, current_date + 40, pg_temp.id('s_priya'), now())$$,
  'S030 scan dating needs the GA at scan', '%check constraint%');
call pg_temp.works($$insert into public.pregnancy_datings (pregnancy_id, mother_id, method, edd, decided_by, decided_at, is_current)
  values (pg_temp.id('p_lakshmi'), pg_temp.id('m_lakshmi'), 'clinician', current_date + 30, pg_temp.id('s_priya'), now(), false)$$,
  'S031 a non-current dating can be recorded');
select pg_temp.ok((select edd from public.pregnancies where id = pg_temp.id('p_lakshmi')) = current_date + 49,
  'S032 a non-current dating does not change the EDD');
call pg_temp.fails_at_commit($$update public.pregnancies set edd = edd + 1 where id = pg_temp.id('p_lakshmi')$$,
  'S033 editing the EDD directly (bypassing re-dating) is refused at commit', '%current dating matching its EDD%');
call pg_temp.fails_at_commit($$insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions)
  values ('00000000-0000-4000-8004-0000000000f1', 'MCH-2026-000901', pg_temp.id('m_sunita'), pg_temp.id('h1'), now(), current_date + 100, 1, 0, 0, 0)$$,
  'S034 a pregnancy cannot be saved without a dating', '%%');
savepoint s1;
update public.pregnancies set status = 'closed', end_reason = 'miscarriage', ended_on = current_date where id = :'p_sunita';
call pg_temp.fails_at_commit($$
  insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions)
  values ('00000000-0000-4000-8004-0000000000f2', 'MCH-2026-000902', pg_temp.id('m_sunita'), pg_temp.id('h1'), now(), current_date + 200, 2, 0, 0, 1);
$$, 'S035 (setup) a new pregnancy after a miscarriage still needs dating and a team', '%current dating%');
rollback to savepoint s1;
set constraints all deferred;  -- ROLLBACK TO restores the mode of the first SET CONSTRAINTS inside the savepoint (Postgres quirk)
savepoint s2;
update public.pregnancies set status = 'closed', end_reason = 'miscarriage', ended_on = current_date where id = :'p_sunita';
insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions)
  values ('00000000-0000-4000-8004-0000000000f2', 'MCH-2026-000902', :'m_sunita', :'h1', now(), current_date + 200, 2, 0, 0, 1);
insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, edd, decided_by, decided_at)
  values ('00000000-0000-4000-8004-0000000000f2', :'m_sunita', 'lmp', current_date - 80, current_date + 200, :'s_neha', now());
call pg_temp.fails_at_commit($$select 1$$, 'S036 an active pregnancy without an obstetric team is refused at commit', '%no obstetric team%');
insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at)
  values (:'m_sunita', '00000000-0000-4000-8004-0000000000f2', 'obstetrics', :'t_unit_b', :'s_neha', now());
call pg_temp.commit_ok('S037 a new pregnancy after a miscarriage, with dating and team, is valid');
rollback to savepoint s2;
set constraints all deferred;  -- ROLLBACK TO restores the mode of the first SET CONSTRAINTS inside the savepoint (Postgres quirk)
call pg_temp.fails_at_commit($$update public.care_assignments set to_at = now()
  where pregnancy_id = pg_temp.id('p_lakshmi') and specialty = 'obstetrics' and to_at is null$$,
  'S038 ending the obstetric team without a successor is refused at commit', '%no obstetric team%');
savepoint s3;
update public.care_assignments set to_at = now() where pregnancy_id = :'p_lakshmi' and specialty = 'obstetrics' and to_at is null;
insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at, reason)
  values (:'m_lakshmi', :'p_lakshmi', 'obstetrics', :'t_unit_b', :'s_neha', now(), 'Moved closer to Unit B clinic');
call pg_temp.commit_ok('S039 reassignment = end the old row + start a new one, history kept');
select pg_temp.ok((select count(*) from public.care_assignments where pregnancy_id = pg_temp.id('p_lakshmi') and specialty = 'obstetrics') = 2,
  'S040 both assignments remain on record');
rollback to savepoint s3;
set constraints all deferred;  -- ROLLBACK TO restores the mode of the first SET CONSTRAINTS inside the savepoint (Postgres quirk)
call pg_temp.fails($$insert into public.pregnancy_datings (pregnancy_id, mother_id, method, scan_on, ga_at_scan_days, investigation_id, edd, decided_by, decided_at)
  values (pg_temp.id('p_rekha'), pg_temp.id('m_rekha'), 'scan', current_date - 10, 60, pg_temp.id('i_rekha_old_dating'), current_date + 150, pg_temp.id('s_priya'), now())$$,
  'S041 a dating cannot cite the scan of the mother''s previous pregnancy', '%same pregnancy or baby%');

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. Teams, memberships, assignments, overrides
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$insert into public.teams (hospital_id, name, kind, specialty, parent_team_id)
  values (pg_temp.id('h1'), 'Sub-unit', 'unit', 'obstetrics', pg_temp.id('t_unit_a'))$$,
  'S042 a unit cannot sit under another unit', '%department of the same specialty%');
call pg_temp.fails($$insert into public.teams (hospital_id, name, kind, specialty, parent_team_id)
  values (pg_temp.id('h1'), 'OB Unit X', 'unit', 'obstetrics', pg_temp.id('t_paeds'))$$,
  'S043 an obstetric unit cannot sit under Paediatrics', '%department of the same specialty%');
call pg_temp.fails($$insert into public.teams (hospital_id, name, kind, specialty, parent_team_id)
  values (pg_temp.id('h1'), 'Dept X', 'department', 'obstetrics', pg_temp.id('t_obs'))$$,
  'S044 a department has no parent', '%check constraint%');
call pg_temp.fails($$insert into public.team_members (team_id, staff_id) values (pg_temp.id('t_paeds_unit'), pg_temp.id('s_priya'))$$,
  'S045 an obstetrician cannot join the paediatric unit', '%cannot join%');
call pg_temp.fails($$insert into public.team_members (team_id, staff_id) values (pg_temp.id('t_unit_a'), pg_temp.id('s_kiran'))$$,
  'S046 a cardiologist cannot join an obstetric unit', '%cannot join%');
call pg_temp.works($$
  insert into public.staff (id, hospital_id, phone, name, role) values ('00000000-0000-4000-8002-0000000000f1', pg_temp.id('h1'), '919000000020', 'Nurse Asha', 'nurse');
  insert into public.team_members (team_id, staff_id) values (pg_temp.id('t_paeds_unit'), '00000000-0000-4000-8002-0000000000f1');
$$, 'S047 a nurse may join any unit');
call pg_temp.fails($$insert into public.team_members (team_id, staff_id) values (pg_temp.id('t_unit_a'), pg_temp.id('s_priya'))$$,
  'S048 a clinician is a current member of a team once', '%team_members_current%');
call pg_temp.fails($$update public.team_members set team_id = pg_temp.id('t_unit_b') where staff_id = pg_temp.id('s_priya') and team_id = pg_temp.id('t_unit_a')$$,
  'S049 a membership cannot be moved to another team (end it, start another)', '%cannot be changed%');
call pg_temp.fails($$
  insert into public.teams (id, hospital_id, name, kind, specialty, parent_team_id, active)
    values ('00000000-0000-4000-8001-0000000000c1', pg_temp.id('h1'), 'OB Unit C (closed)', 'unit', 'obstetrics', pg_temp.id('t_obs'), false);
  insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, from_at)
    values (pg_temp.id('m_asha'), pg_temp.id('p_asha'), 'paediatrics', pg_temp.id('t_paeds_unit'), now());
$$, 'S050 (one current paediatric assignment per pregnancy)', '%care_assignments_current%');
call pg_temp.fails($$
  insert into public.teams (id, hospital_id, name, kind, specialty, parent_team_id, active)
    values ('00000000-0000-4000-8001-0000000000c2', pg_temp.id('h1'), 'OB Unit D (closed)', 'unit', 'obstetrics', pg_temp.id('t_obs'), false);
  update public.care_assignments set to_at = now() where pregnancy_id = pg_temp.id('p_meera') and specialty = 'obstetrics';
  insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, from_at)
    values (pg_temp.id('m_meera'), pg_temp.id('p_meera'), 'obstetrics', '00000000-0000-4000-8001-0000000000c2', now());
$$, 'S051 a patient cannot be assigned to an inactive team', '%inactive%');
call pg_temp.fails($$
  update public.care_assignments set to_at = now() where pregnancy_id = pg_temp.id('p_meera') and specialty = 'obstetrics';
  insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at)
    values (pg_temp.id('m_meera'), pg_temp.id('p_meera'), 'obstetrics', pg_temp.id('t_unit_a'), pg_temp.id('s_arjun'), now());
$$, 'S052 a paediatrician cannot be the primary obstetrician', '%active obstetric clinician%');
call pg_temp.fails($$
  update public.staff set active = false where id = pg_temp.id('s_neha');
  update public.care_assignments set to_at = now() where pregnancy_id = pg_temp.id('p_meera') and specialty = 'obstetrics';
  insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at)
    values (pg_temp.id('m_meera'), pg_temp.id('p_meera'), 'obstetrics', pg_temp.id('t_unit_a'), pg_temp.id('s_neha'), now());
$$, 'S053 a deactivated clinician cannot become primary', '%active obstetric clinician%');
call pg_temp.fails($$insert into public.care_assignments (mother_id, baby_id, specialty, team_id, from_at)
  values (pg_temp.id('m_meena'), pg_temp.id('b_meena'), 'obstetrics', pg_temp.id('t_unit_a'), now())$$,
  'S054 a baby is assigned to a paediatric team only', '%check constraint%');
call pg_temp.fails($$update public.teams set specialty = 'paediatrics' where id = pg_temp.id('t_unit_a')$$,
  'S055 a team cannot change specialty', '%cannot be changed%');
call pg_temp.fails($$insert into public.access_overrides (staff_id, mother_id, reason, expires_at)
  values (pg_temp.id('s_priya'), pg_temp.id('m_asha'), 'Emergency', now() + interval '25 hours')$$,
  'S056 an override lasts at most 24 hours', '%check constraint%');
call pg_temp.fails($$insert into public.access_overrides (staff_id, mother_id, reason, expires_at)
  values (pg_temp.id('s_priya'), pg_temp.id('m_asha'), 'ok', now() + interval '1 hour')$$,
  'S057 an override needs a real reason', '%check constraint%');
call pg_temp.fails($$insert into public.access_overrides (staff_id, mother_id, reason, expires_at)
  values (pg_temp.id('s_kiran'), pg_temp.id('m_asha'), 'Want to look', now() + interval '1 hour')$$,
  'S058 a specialist cannot use the emergency override', '%only an active obstetrician or paediatrician%');
savepoint s4;
insert into public.mothers (id, phone, name, age_at_registration) values ('00000000-0000-4000-8003-0000000000f9', '919000000030', 'Elsewhere', 30);
insert into public.pregnancies (mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions)
  values ('MCH-2026-000950', '00000000-0000-4000-8003-0000000000f9', :'h2', now(), current_date + 100, 1, 0, 0, 0);
call pg_temp.fails($$insert into public.access_overrides (staff_id, mother_id, reason, expires_at)
  values (pg_temp.id('s_priya'), '00000000-0000-4000-8003-0000000000f9', 'Emergency', now() + interval '1 hour')$$,
  'S059 an override cannot reach a patient of another hospital', '%patients of your hospital%');
rollback to savepoint s4;
set constraints all deferred;  -- ROLLBACK TO restores the mode of the first SET CONSTRAINTS inside the savepoint (Postgres quirk)
call pg_temp.fails($$update public.access_overrides set expires_at = expires_at + interval '1 day'$$,
  'S060 an override cannot be extended (grant a new one)', '%cannot be changed%');
call pg_temp.works($$update public.access_overrides set ended_at = now() where staff_id = pg_temp.id('s_priya')$$,
  'S061 an override can be ended early');

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. Encounters and observations
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$insert into public.encounters (mother_id, pregnancy_id, baby_id, kind, at, by_staff)
  values (pg_temp.id('m_meena'), pg_temp.id('p_meena'), pg_temp.id('b_meena'), 'postnatal', now(), pg_temp.id('s_priya'))$$,
  'S062 an encounter has one subject (a joint visit is two encounters)', '%check constraint%');
call pg_temp.fails($$insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff)
  values (pg_temp.id('m_meena'), pg_temp.id('p_meena'), 'newborn', now(), pg_temp.id('s_arjun'))$$,
  'S063 a newborn encounter is for a baby', '%check constraint%');
call pg_temp.fails($$insert into public.encounters (mother_id, baby_id, kind, at, by_staff)
  values (pg_temp.id('m_meena'), pg_temp.id('b_meena'), 'anc', now(), pg_temp.id('s_priya'))$$,
  'S064 an ANC encounter is for a pregnancy', '%check constraint%');
call pg_temp.works($$insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff)
  values (pg_temp.id('m_meena'), pg_temp.id('p_meena'), 'postnatal', now(), pg_temp.id('s_priya'))$$,
  'S065 a postnatal encounter for a delivered mother');
call pg_temp.fails($$insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff, completeness)
  values (pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'anc', now(), pg_temp.id('s_priya'), 1.2)$$,
  'S066 completeness is a fraction', '%check constraint%');
call pg_temp.fails($$insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff, ga_days)
  values (pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'anc', now(), pg_temp.id('s_priya'), -3)$$,
  'S067 GA cannot be negative', '%check constraint%');
call pg_temp.fails($$insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, at, by_staff)
  values (pg_temp.id('e_rekha_old'), pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), 'weight', 60, now(), pg_temp.id('s_priya'))$$,
  'S068 an observation cannot attach to the encounter of the mother''s other pregnancy', '%must match its encounter%');
create function pg_temp.w(v numeric) returns text language sql as $$
  select format($f$insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, at, by_staff)
    values (pg_temp.id('e_lak'), pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'weight', %s, now(), pg_temp.id('s_priya'))$f$, v)
$$;
call pg_temp.works(pg_temp.w(20), 'S069 weight at the lower bound (20 kg) is accepted');
call pg_temp.fails(pg_temp.w(19.9), 'S070 weight just below the bound is refused', '%not a possible entry%');
call pg_temp.works(pg_temp.w(250), 'S071 weight at the upper bound (250 kg) is accepted');
call pg_temp.fails(pg_temp.w(250.1), 'S072 weight just above the bound is refused', '%not a possible entry%');
call pg_temp.fails($$insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_text, at, by_staff)
  values (pg_temp.id('e_lak'), pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'urine_albumin', 'nil', now(), pg_temp.id('s_priya'))$$,
  'S073 coded values are exact (not case-folded)', '%must be one of%');
call pg_temp.works($$insert into public.observations (encounter_id, mother_id, baby_id, code, value_num, at, by_staff)
  values (pg_temp.id('e_baby'), pg_temp.id('m_meena'), pg_temp.id('b_meena'), 'nb_weight', 2850, now(), pg_temp.id('s_arjun'))$$,
  'S074 a newborn weight in grams on a newborn encounter');
call pg_temp.fails($$insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, at, by_staff, status, supersedes)
  values (pg_temp.id('e_lak'), pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'weight', 61.9, now(), pg_temp.id('s_priya'), 'amended', pg_temp.id('o_lak_bp'))$$,
  'S075 a correction is for the same measurement', '%same measurement of the same patient%');
call pg_temp.fails($$insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, at, by_staff, status, supersedes)
  values (pg_temp.id('e_rekha'), pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), 'weight', 56, now(), pg_temp.id('s_priya'), 'amended', pg_temp.id('o_rekha_old_w'))$$,
  'S076 a correction cannot reach into the mother''s previous pregnancy', '%same measurement of the same patient%');
call pg_temp.fails($$insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, at, by_staff, status, supersedes)
  values (pg_temp.id('e_lak'), pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'pulse', 82, now(), pg_temp.id('s_priya'), 'amended', pg_temp.id('o_lak_eie'))$$,
  'S077 an entry marked in error is not "corrected" (record a new one)', '%cannot be corrected%');
call pg_temp.works($$insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, at, by_staff, status, supersedes)
  values (pg_temp.id('e_lak'), pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'weight', 61.9, now(), pg_temp.id('s_priya'), 'amended', pg_temp.id('o_lak_w'))$$,
  'S078 a valid correction supersedes the earlier value');
call pg_temp.fails($$insert into public.encounter_checklist (encounter_id, mother_id, component, state)
  values (pg_temp.id('e_lak'), pg_temp.id('m_lakshmi'), 'presentation', 'na')$$,
  'S079 "not applicable" also needs a reason', '%check constraint%');
call pg_temp.works($$insert into public.encounter_checklist (encounter_id, mother_id, component, state, reason)
  values (pg_temp.id('e_lak'), pg_temp.id('m_lakshmi'), 'urine_albumin', 'not_done', 'Kit unavailable')$$,
  'S080 a skipped component with its reason');
call pg_temp.fails($$update public.encounter_checklist set state = 'done' where encounter_id = pg_temp.id('e_lak')$$,
  'S081 a checklist entry is part of the record', '%cannot be changed%');
call pg_temp.fails($$update public.encounters set kind = 'postnatal' where id = pg_temp.id('e_lak')$$,
  'S082 an encounter cannot change kind', '%cannot be changed%');
call pg_temp.fails($$insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff, source, document_id)
  values (pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), 'anc', now(), pg_temp.id('s_priya'), 'capture', pg_temp.id('doc_rekha_old'))$$,
  'S083 a transcribed visit cannot cite the paper card of another pregnancy', '%same pregnancy or baby%');

-- ════════════════════════════════════════════════════════════════════════════════
-- 5. Investigations and results
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$update public.investigations set status = 'resulted' where id = pg_temp.id('i_lak_hiv')$$,
  'S084 a test without a result cannot be marked resulted', '%without a result%');
call pg_temp.works($$
  insert into public.investigation_results (id, investigation_id, mother_id, value_num, unit, reported_at, entered_by)
    values (pg_temp.id('r_lak_hb'), pg_temp.id('i_lak_hb'), pg_temp.id('m_lakshmi'), 11.2, 'g/dL', now(), pg_temp.id('s_priya'));
  update public.investigations set status = 'resulted' where id = pg_temp.id('i_lak_hb');
$$, 'S085 result entered, test resulted');
call pg_temp.fails($$update public.investigations set status = 'reviewed', reviewed_by = pg_temp.id('s_priya'), reviewed_at = now()
  where id = pg_temp.id('i_lak_hb')$$, 'S086 a review records the follow-up chosen', '%check constraint%');
call pg_temp.works($$update public.investigations set status = 'reviewed', reviewed_by = pg_temp.id('s_priya'), reviewed_at = now(),
  follow_up = 'discuss_next_visit' where id = pg_temp.id('i_lak_hb')$$, 'S087 a review with its follow-up');
call pg_temp.fails($$
  update public.investigations set status = 'not_done', not_done_reason = 'Patient declined' where id = pg_temp.id('i_lak_hiv');
  insert into public.investigation_results (investigation_id, mother_id, value_text, reported_at, entered_by)
    values (pg_temp.id('i_lak_hiv'), pg_temp.id('m_lakshmi'), 'Non-reactive', now(), pg_temp.id('s_priya'));
$$, 'S088 a test marked not done cannot take a result', '%cannot take a result%');
call pg_temp.fails($$insert into public.investigation_results (investigation_id, mother_id, value_num, reported_at, entered_by, status)
  values (pg_temp.id('i_lak_hb'), pg_temp.id('m_lakshmi'), 11.0, now(), pg_temp.id('s_priya'), 'corrected')$$,
  'S089 a "corrected" result names what it corrects', '%check constraint%');
call pg_temp.fails($$insert into public.investigation_results (investigation_id, mother_id, value_num, reported_at, entered_by, status, supersedes)
  values (pg_temp.id('i_lak_hb'), pg_temp.id('m_lakshmi'), 11.0, now(), pg_temp.id('s_priya'), 'corrected', pg_temp.id('r_lak_tsh'))$$,
  'S090 a correction cannot point at another test''s result', '%same test%');
call pg_temp.works($$insert into public.investigation_results (investigation_id, mother_id, value_num, unit, reported_at, entered_by, status, supersedes)
  values (pg_temp.id('i_lak_hb'), pg_temp.id('m_lakshmi'), 11.0, 'g/dL', now(), pg_temp.id('s_priya'), 'corrected', pg_temp.id('r_lak_hb'))$$,
  'S091 a valid corrected result');
call pg_temp.fails($$insert into public.investigation_results (investigation_id, mother_id, reported_at, entered_by)
  values (pg_temp.id('i_lak_hb'), pg_temp.id('m_lakshmi'), now(), pg_temp.id('s_priya'))$$,
  'S092 a result has a value', '%check constraint%');
call pg_temp.fails($$insert into public.investigations (mother_id, pregnancy_id, code, label, due_from, due_by)
  values (pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'hb2', 'Repeat Hb', current_date, current_date - 1)$$,
  'S093 a test window ends after it starts', '%check constraint%');
call pg_temp.fails($$update public.investigations set code = 'hb2' where id = pg_temp.id('i_lak_hb')$$,
  'S094 a test order cannot be turned into another test', '%cannot be changed%');
call pg_temp.works($$
  update public.investigations set status = 'resulted' where id = pg_temp.id('i_lak_tsh');
  update public.investigation_results set status = 'entered_in_error', eie_reason = 'Wrong sample', eie_by = pg_temp.id('s_priya'), eie_at = now()
    where investigation_id = pg_temp.id('i_lak_tsh');
$$, 'S095 the only result of a resulted test is withdrawn');
select pg_temp.ok((select status from public.investigations where id = pg_temp.id('i_lak_tsh')) = 'ordered',
  'S096 withdrawing the only result sends the test back to "ordered" automatically');
call pg_temp.works($$insert into public.investigations (mother_id, baby_id, code, label, due_from, due_by)
  values (pg_temp.id('m_meena'), pg_temp.id('b_meena'), 'nb_bilirubin', 'Bilirubin', current_date, current_date + 2)$$,
  'S097 a newborn test on a baby');
select pg_temp.ok(not (select sensitive from public.investigations where baby_id = pg_temp.id('b_meena') and code = 'nb_bilirubin'),
  'S098 newborn bilirubin is not a sensitive test');

-- ════════════════════════════════════════════════════════════════════════════════
-- 6. Referrals
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$insert into public.referrals (mother_id, pregnancy_id, to_team_id, from_encounter_id, urgency, reason, question, created_by, created_at)
  values (pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), pg_temp.id('t_cardio'), pg_temp.id('e_rekha_old'), 'routine', 'r', 'q', pg_temp.id('s_priya'), now())$$,
  'S099 a referral cannot cite a visit from the mother''s previous pregnancy', '%same pregnancy or baby%');
call pg_temp.fails($$update public.referrals set status = 'scheduled' where id = pg_temp.id('ref_rekha')$$,
  'S100 scheduling needs a time', '%check constraint%');
call pg_temp.fails($$update public.referrals set status = 'recommendations' where id = pg_temp.id('ref_rekha')$$,
  'S101 "recommendations" needs the recommendations', '%check constraint%');
call pg_temp.fails($$update public.referrals set status = 'closed' where id = pg_temp.id('ref_rekha')$$,
  'S102 a closed referral records when it ended', '%check constraint%');
call pg_temp.fails_at_commit($$update public.referrals set status = 'accepted' where id = pg_temp.id('ref_rekha')$$,
  'S103 a status change without its event is refused at commit', '%latest event%');
call pg_temp.works($$
  update public.referrals set status = 'accepted' where id = pg_temp.id('ref_rekha');
  insert into public.referral_events (referral_id, mother_id, status, at, by_staff)
    values (pg_temp.id('ref_rekha'), pg_temp.id('m_rekha'), 'accepted', now() + interval '1 second', pg_temp.id('s_kiran'));
$$, 'S104 status and event together');
call pg_temp.commit_ok('S105 …pass the commit check');
call pg_temp.fails($$update public.referrals set to_team_id = pg_temp.id('t_paeds') where id = pg_temp.id('ref_rekha')$$,
  'S106 a referral cannot be redirected to another department', '%cannot be changed%');
call pg_temp.fails($$insert into public.referral_events (referral_id, mother_id, status, at, by_staff)
  values (pg_temp.id('ref_rekha'), pg_temp.id('m_rekha'), 'lost', now(), pg_temp.id('s_kiran'))$$,
  'S107 unknown referral event status', '%check constraint%');
call pg_temp.fails($$insert into public.tasks (mother_id, pregnancy_id, kind, title, due_by, appointment_at, referral_id, generated_by)
  values (pg_temp.id('m_rekha'), pg_temp.id('p_rekha_old'), 'referral_appt', 'Cardiology appointment', current_date + 3, now() + interval '3 days', pg_temp.id('ref_rekha'), 'clinician')$$,
  'S108 a referral appointment belongs to the referral''s pregnancy', '%same pregnancy or baby%');

-- ════════════════════════════════════════════════════════════════════════════════
-- 7. Tasks and contacts
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$insert into public.tasks (mother_id, pregnancy_id, kind, title, due_by, generated_by)
  values (pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'template', 'BP check', current_date + 3, 'template')$$,
  'S109 a template follow-up names its template', '%check constraint%');
call pg_temp.fails($$insert into public.tasks (mother_id, pregnancy_id, kind, title, template_key, due_by, generated_by)
  values (pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'anc_visit', 'ANC', 'tpl_bp', current_date + 3, 'protocol')$$,
  'S110 only template tasks carry a template key', '%check constraint%');
call pg_temp.fails($$insert into public.tasks (mother_id, pregnancy_id, kind, title, due_by, referral_id, generated_by)
  values (pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), 'referral_appt', 'Cardiology appointment', current_date + 3, pg_temp.id('ref_rekha'), 'clinician')$$,
  'S111 a referral appointment has a booked time', '%check constraint%');
call pg_temp.fails($$update public.tasks set completed_at = now(), cancelled_at = now(), override_reason = 'x' where id = pg_temp.id('t_lak_anc')$$,
  'S112 a task is either completed or cancelled, not both', '%check constraint%');
call pg_temp.fails($$update public.tasks set completed_at = now(), completed_by_encounter_id = pg_temp.id('e_rekha') where id = pg_temp.id('t_lak_anc')$$,
  'S113 a task cannot be closed by another patient''s visit', '%does not match%');
call pg_temp.fails($$update public.tasks set pregnancy_id = pg_temp.id('p_rekha') where id = pg_temp.id('t_lak_anc')$$,
  'S114 a task cannot move to another pregnancy', '%cannot be changed%');
call pg_temp.fails($$insert into public.tasks (mother_id, pregnancy_id, kind, title, due_from, due_by, generated_by)
  values (pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'anc_visit', 'ANC', current_date + 5, current_date + 3, 'protocol')$$,
  'S115 a due window ends after it starts', '%check constraint%');
call pg_temp.works($$update public.tasks set completed_at = now(), completed_by_encounter_id = pg_temp.id('e_lak') where id = pg_temp.id('t_lak_anc')$$,
  'S116 a visit closes its task and the task links that visit');
call pg_temp.fails($$insert into public.task_contacts (task_id, mother_id, at, outcome, successful, by_staff)
  values (pg_temp.id('t_lak_anc'), pg_temp.id('m_lakshmi'), now(), 'Will come', true, pg_temp.id('s_priya'))$$,
  'S117 contact outcomes are codes, not labels', '%unknown contact_outcome%');
call pg_temp.works($$insert into public.task_contacts (task_id, mother_id, at, outcome, successful, by_staff)
  values (pg_temp.id('t_lak_anc'), pg_temp.id('m_lakshmi'), now(), 'unreachable', false, pg_temp.id('s_priya'))$$,
  'S118 a call attempt with a coded outcome');
call pg_temp.fails($$update public.task_contacts set successful = true$$, 'S119 a call attempt is part of the record', '%cannot be changed%');
select pg_temp.ok((select data_type from information_schema.columns where table_name = 'tasks' and column_name = 'due_by') = 'date'
  and (select data_type from information_schema.columns where table_name = 'investigations' and column_name = 'due_by') = 'date',
  'S120 due dates are calendar dates (no UTC-midnight off-by-one in IST)');

-- ════════════════════════════════════════════════════════════════════════════════
-- 8. Delivery, babies, immunizations
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$insert into public.deliveries (pregnancy_id, mother_id, at, mode, recorded_by)
  values (pg_temp.id('p_meena'), pg_temp.id('m_meena'), now(), 'vaginal', pg_temp.id('s_priya'))$$,
  'S121 one delivery per pregnancy', '%deliveries_pregnancy_id_key%');
call pg_temp.fails($$insert into public.babies (child_id, mother_id, pregnancy_id, delivery_id, birth_order, dob, sex, outcome)
  values ('MCH-2026-000103-B3', pg_temp.id('m_meena'), pg_temp.id('p_meena'), pg_temp.id('d_meena'), 2, now(), 'M', 'live')$$,
  'S122 a child id is the MCH id + birth order', '%child id must be%');
call pg_temp.fails($$insert into public.babies (child_id, mother_id, pregnancy_id, delivery_id, birth_order, dob, sex, outcome)
  values ('MCH-2026-000103-B1', pg_temp.id('m_meena'), pg_temp.id('p_meena'), pg_temp.id('d_meena'), 1, now(), 'M', 'live')$$,
  'S123 birth order is unique within a delivery', '%unique constraint%');
call pg_temp.fails($$insert into public.babies (child_id, mother_id, pregnancy_id, delivery_id, birth_order, dob, sex, outcome, stillbirth_type)
  values ('MCH-2026-000103-B2', pg_temp.id('m_meena'), pg_temp.id('p_meena'), pg_temp.id('d_meena'), 2, now(), 'M', 'live', 'fresh')$$,
  'S124 a liveborn baby has no stillbirth type', '%check constraint%');
call pg_temp.fails($$insert into public.babies (child_id, mother_id, pregnancy_id, delivery_id, birth_order, dob, sex, outcome, deceased_at)
  values ('MCH-2026-000103-B2', pg_temp.id('m_meena'), pg_temp.id('p_meena'), pg_temp.id('d_meena'), 2, now(), 'M', 'stillbirth', now())$$,
  'S125 a stillbirth is an outcome, not a later death', '%check constraint%');
call pg_temp.fails_at_commit($$insert into public.babies (child_id, mother_id, pregnancy_id, delivery_id, birth_order, dob, sex, outcome)
  values ('MCH-2026-000103-B2', pg_temp.id('m_meena'), pg_temp.id('p_meena'), pg_temp.id('d_meena'), 2, now(), 'M', 'live')$$,
  'S126 a second baby on a singleton delivery is refused at commit', '%plurality%');
call pg_temp.fails($$update public.babies set birth_weight_g = 3100 where id = pg_temp.id('b_meena')$$,
  'S127 a birth weight is part of the birth record', '%cannot be changed%');
call pg_temp.works($$update public.babies set name = 'Anu' where id = pg_temp.id('b_meena')$$, 'S128 a baby''s name can be added later');
call pg_temp.fails_at_commit($$update public.pregnancies set status = 'delivered', end_reason = 'delivered', ended_on = current_date where id = pg_temp.id('p_rekha')$$,
  'S129 "delivered" without a delivery record is refused at commit', '%delivery record must go together%');
savepoint s5;
update public.pregnancies set status = 'delivered', end_reason = 'delivered', ended_on = current_date where id = pg_temp.id('p_rekha');
insert into public.deliveries (id, pregnancy_id, mother_id, at, mode, plurality, recorded_by, complications)
  values ('00000000-0000-4000-800d-0000000000a1', pg_temp.id('p_rekha'), pg_temp.id('m_rekha'), now(), 'lscs_emergency', 2, :'s_priya', '{pph}');
insert into public.babies (child_id, mother_id, pregnancy_id, delivery_id, birth_order, dob, sex, outcome)
  values ('MCH-2026-000108-B1', pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), '00000000-0000-4000-800d-0000000000a1', 1, now(), 'F', 'live');
call pg_temp.fails_at_commit($$select 1$$, 'S130 twins with only one baby recorded are refused at commit', '%records 1 babies but plurality 2%');
insert into public.babies (child_id, mother_id, pregnancy_id, delivery_id, birth_order, dob, sex, outcome, stillbirth_type)
  values ('MCH-2026-000108-B2', pg_temp.id('m_rekha'), pg_temp.id('p_rekha'), '00000000-0000-4000-800d-0000000000a1', 2, now(), 'M', 'stillbirth', 'fresh');
call pg_temp.commit_ok('S131 twin delivery (one liveborn, one stillborn) with status, delivery and both babies is valid');
rollback to savepoint s5;
set constraints all deferred;  -- ROLLBACK TO restores the mode of the first SET CONSTRAINTS inside the savepoint (Postgres quirk)
call pg_temp.fails($$insert into public.deliveries (pregnancy_id, mother_id, at, mode, recorded_by, complications)
  values (pg_temp.id('p_rekha'), pg_temp.id('m_rekha'), now(), 'vaginal', pg_temp.id('s_priya'), '{PPH}')$$,
  'S132 delivery complications are codes', '%unknown delivery_complication%');
call pg_temp.fails($$
  insert into public.admissions (id, pregnancy_id, mother_id, ip_no, admitted_at, admitted_by, discharged_at, discharged_by)
    values ('00000000-0000-4000-8013-0000000000a1', pg_temp.id('p_rekha_old'), pg_temp.id('m_rekha'), 'IP-2025-000009', now() - interval '340 days', pg_temp.id('s_priya'), now() - interval '339 days', pg_temp.id('s_priya'));
  insert into public.deliveries (pregnancy_id, mother_id, admission_id, at, mode, recorded_by)
    values (pg_temp.id('p_rekha'), pg_temp.id('m_rekha'), '00000000-0000-4000-8013-0000000000a1', now(), 'vaginal', pg_temp.id('s_priya'));
$$, 'S133 a delivery cannot link the admission of the mother''s previous pregnancy', '%same pregnancy or baby%');
call pg_temp.works($$insert into public.immunizations (mother_id, pregnancy_id, code, due_on) values (pg_temp.id('m_lakshmi'), pg_temp.id('p_lakshmi'), 'td1', current_date)$$,
  'S134 Td is scheduled on the pregnancy');
call pg_temp.works($$insert into public.immunizations (mother_id, baby_id, code, due_on) values (pg_temp.id('m_meena'), pg_temp.id('b_meena'), 'bcg', current_date - 2)$$,
  'S135 BCG is scheduled on the baby');
call pg_temp.fails($$insert into public.immunizations (mother_id, baby_id, code, due_on) values (pg_temp.id('m_meena'), pg_temp.id('b_meena'), 'bcg', current_date)$$,
  'S136 one live row per dose', '%immunizations_dose%');
call pg_temp.works($$
  update public.immunizations set status = 'entered_in_error', eie_reason = 'Duplicate import', eie_by = pg_temp.id('s_arjun'), eie_at = now()
    where baby_id = pg_temp.id('b_meena') and code = 'bcg';
  insert into public.immunizations (mother_id, baby_id, code, due_on) values (pg_temp.id('m_meena'), pg_temp.id('b_meena'), 'bcg', current_date - 2);
$$, 'S137 after marking a dose in error it can be recorded again');
call pg_temp.fails($$update public.immunizations set status = 'given', given_on = current_date, primary_source = true,
  given_in_encounter_id = pg_temp.id('e_lak') where baby_id = pg_temp.id('b_meena') and code = 'bcg' and status = 'due'$$,
  'S138 a baby''s dose cannot cite a visit from another patient', '%does not match%');
call pg_temp.works($$update public.immunizations set status = 'given', given_on = current_date, primary_source = true, batch = 'B123',
  site = 'Left upper arm', route = 'ID', given_by = pg_temp.id('s_arjun'), given_in_encounter_id = pg_temp.id('e_baby')
  where baby_id = pg_temp.id('b_meena') and code = 'bcg' and status = 'due'$$, 'S139 a dose given at the newborn visit');
call pg_temp.fails($$update public.immunizations set code = 'opv0' where baby_id = pg_temp.id('b_meena') and code = 'bcg' and status = 'given'$$,
  'S140 a dose cannot be turned into another vaccine', '%cannot be changed%');
call pg_temp.fails($$insert into public.immunizations (mother_id, baby_id, code, due_on, status, given_on, primary_source, expiry_on)
  values (pg_temp.id('m_meena'), pg_temp.id('b_meena'), 'opv0', current_date, 'given', current_date, true, current_date - 1)$$,
  'S141 an expired batch cannot be recorded as given', '%check constraint%');

-- ════════════════════════════════════════════════════════════════════════════════
-- 9. Admission and discharge
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$insert into public.admissions (pregnancy_id, mother_id, ip_no, admitted_at, admitted_by)
  values (pg_temp.id('p_kavya'), pg_temp.id('m_kavya'), 'IP-2026-000002', now(), pg_temp.id('s_neha'))$$,
  'S142 one open admission per pregnancy', '%admissions_open%');
call pg_temp.fails($$update public.admissions set discharged_at = admitted_at - interval '1 hour', discharged_by = pg_temp.id('s_neha')
  where mother_id = pg_temp.id('m_kavya')$$, 'S143 discharge cannot precede admission', '%check constraint%');
call pg_temp.fails($$update public.admissions set ip_no = 'IP-2026-000099' where mother_id = pg_temp.id('m_kavya')$$,
  'S144 an IP number is never edited', '%cannot be changed%');
call pg_temp.fails($$insert into public.discharges (mother_id, baby_id, admission_id, started_at)
  values (pg_temp.id('m_kavya'), pg_temp.id('b_meena'), (select id from public.admissions where mother_id = pg_temp.id('m_kavya')), now())$$,
  'S145 a baby''s discharge does not close the mother''s admission', '%%');
call pg_temp.fails($$insert into public.discharge_items (discharge_id, mother_id, key) values (pg_temp.id('dis_meena_baby'), pg_temp.id('m_meena'), 'fp')$$,
  'S146 a mother''s checklist item does not belong on the baby''s discharge', '%does not apply to this patient%');
call pg_temp.fails($$insert into public.discharge_items (discharge_id, mother_id, key) values (pg_temp.id('dis_meena_baby'), pg_temp.id('m_meena'), 'hugs')$$,
  'S147 unknown checklist items are refused', '%unknown discharge_item%');
call pg_temp.fails($$update public.discharges set completed_at = now(), completed_by = pg_temp.id('s_arjun') where id = pg_temp.id('dis_meena_baby')$$,
  'S148 a discharge cannot complete without its checklist', '%needs its checklist%');
insert into public.discharge_items (discharge_id, mother_id, key)
select pg_temp.id('dis_meena_baby'), :'m_meena', code from public.pick_lists where list = 'discharge_item' and grp = 'baby';
call pg_temp.fails($$update public.discharges set completed_at = now(), completed_by = pg_temp.id('s_arjun') where id = pg_temp.id('dis_meena_baby')$$,
  'S149 a discharge cannot complete with open items', '%every discharge item%');
call pg_temp.fails($$update public.discharge_items set state = 'deferred' where discharge_id = pg_temp.id('dis_meena_baby') and key = 'birth_doses'$$,
  'S150 a deferred item needs a reason', '%check constraint%');
call pg_temp.works($$
  update public.discharge_items set state = 'done', updated_by = pg_temp.id('s_arjun'), updated_at = now() where discharge_id = pg_temp.id('dis_meena_baby') and key <> 'jaundice';
  update public.discharge_items set state = 'na', reason = 'Not clinically assessed today', updated_by = pg_temp.id('s_arjun'), updated_at = now()
    where discharge_id = pg_temp.id('dis_meena_baby') and key = 'jaundice';
  update public.discharges set completed_at = now(), completed_by = pg_temp.id('s_arjun') where id = pg_temp.id('dis_meena_baby');
$$, 'S151 a discharge completes once every item is resolved');
call pg_temp.fails($$update public.discharge_items set state = 'done', reason = null where discharge_id = pg_temp.id('dis_meena_baby') and key = 'jaundice'$$,
  'S152 a completed discharge''s checklist is frozen', '%discharge is complete%');
call pg_temp.fails($$update public.discharges set completed_at = null, completed_by = null where id = pg_temp.id('dis_meena_baby')$$,
  'S153 a completed discharge cannot be reopened', '%cannot be reopened%');

-- ════════════════════════════════════════════════════════════════════════════════
-- 10. Family inputs and medicines
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$insert into public.callbacks (mother_id, requested_by_label, channel, signs, at)
  values (pg_temp.id('m_lakshmi'), 'mother', 'app', '{Bleeding}', now())$$,
  'S154 warning signs are stored as codes, not labels', '%unknown warning_sign%');
call pg_temp.works($$insert into public.callbacks (id, mother_id, requested_by_label, channel, signs, at)
  values ('00000000-0000-4000-800f-0000000000a1', pg_temp.id('m_lakshmi'), 'mother', 'app', '{bleeding,movements}', now())$$,
  'S155 a call-back with two ticked signs');
call pg_temp.fails($$update public.callbacks set closed_at = now() where id = '00000000-0000-4000-800f-0000000000a1'$$,
  'S156 closing a call-back records the outcome and who closed it', '%check constraint%');
call pg_temp.fails($$update public.callbacks set closed_at = now(), outcome = 'sorted', closed_by = pg_temp.id('s_priya') where id = '00000000-0000-4000-800f-0000000000a1'$$,
  'S157 call-back outcomes are codes', '%unknown callback_outcome%');
call pg_temp.fails($$update public.callbacks set signs = '{bleeding}' where id = '00000000-0000-4000-800f-0000000000a1'$$,
  'S158 what the family reported cannot be edited afterwards', '%cannot be changed%');
call pg_temp.works($$update public.callbacks set closed_at = now(), outcome = 'advised_to_come', closed_by = pg_temp.id('s_priya') where id = '00000000-0000-4000-800f-0000000000a1'$$,
  'S159 a call-back closed with a coded outcome');
call pg_temp.fails($$insert into public.self_logs (mother_id, baby_id, kind, value, at, by_label) values (pg_temp.id('m_lakshmi'), pg_temp.id('b_meena'), 'feeding', 'Fed well', now(), 'mother')$$,
  'S160 a mother cannot log for another mother''s baby', '%does not match%');
call pg_temp.fails($$insert into public.med_doses (medication_id, mother_id, date, slot, status, at) values (pg_temp.id('rx_stmt'), pg_temp.id('m_lakshmi'), current_date, 'morning', 'taken', now())$$,
  'S161 doses are not logged against a documented (unprescribed) medicine', '%active prescription%');
call pg_temp.fails($$insert into public.med_doses (medication_id, mother_id, date, slot, status, at) values (pg_temp.id('rx_stopped'), pg_temp.id('m_lakshmi'), current_date, 'morning', 'taken', now())$$,
  'S162 doses are not logged against a stopped prescription', '%active prescription%');
call pg_temp.works($$insert into public.med_doses (medication_id, mother_id, date, slot, status, at) values (pg_temp.id('rx_ifa'), pg_temp.id('m_lakshmi'), current_date, 'afternoon', 'taken', now())$$,
  'S163 a dose of an active prescription');
call pg_temp.fails($$insert into public.med_doses (medication_id, mother_id, date, slot, status, at) values (pg_temp.id('rx_ifa'), pg_temp.id('m_lakshmi'), current_date, 'afternoon', 'skipped', now())$$,
  'S164 one entry per medicine, day and slot', '%unique constraint%');
call pg_temp.fails($$update public.medications set status = 'stopped' where id = pg_temp.id('rx_ifa')$$,
  'S165 stopping a prescription needs a reason', '%check constraint%');
call pg_temp.fails($$update public.medications set dose = '2 tablets' where id = pg_temp.id('rx_ifa')$$,
  'S166 a prescription''s dose is not edited (stop it and prescribe again)', '%cannot be changed%');

-- ════════════════════════════════════════════════════════════════════════════════
-- 11. Audit and idempotency
-- ════════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', json_build_object('sub', :'priya')::text, true);
insert into public.care_notes (mother_id, pregnancy_id, author, body, kind, at) values (:'m_lakshmi', :'p_lakshmi', :'s_priya', 'Plan discussed.', 'note', now());
select pg_temp.ok((select actor = :'priya' and role = 'obstetrician' from public.audit_log where entity_type = 'care_notes' order by id desc limit 1),
  'S167 the audit row names the signed-in clinician and her role');
call pg_temp.works($$select app.idem_begin('rpc_a', '{"idempotency_key":"00000000-0000-4000-a000-0000000000a1","x":1}')$$, 'S168 first use of a key');
call pg_temp.fails($$select app.idem_begin('rpc_a', '{"idempotency_key":"00000000-0000-4000-a000-0000000000a1","x":1}')$$,
  'S169 a duplicate while the first call is still running is refused', '%still being processed%');
call pg_temp.fails($$select app.idem_begin('rpc_b', '{"idempotency_key":"00000000-0000-4000-a000-0000000000a1","x":1}')$$,
  'S170 a key cannot be reused for another action', '%different data%');
select set_config('request.jwt.claims', json_build_object('sub', :'neha')::text, true);
select pg_temp.ok(app.idem_begin('rpc_a', '{"idempotency_key":"00000000-0000-4000-a000-0000000000a1","x":1}') is null,
  'S171 keys are per user: the same key from another user is a new request');
select set_config('request.jwt.claims', '', true);
call pg_temp.works($$delete from public.notifications where kind = 'visit_reminder'$$, 'S172 old notifications can be purged');
call pg_temp.works($$
  update public.tags set removed_at = now(), removed_by = pg_temp.id('s_priya'), removed_reason = 'Documented in error at registration'
  where pregnancy_id = pg_temp.id('p_lakshmi') and code = 'prev_cs';
$$, 'S173 a tag removed with a reason');
select pg_temp.ok((select meta -> 'removed_reason' ->> 'to' from public.audit_log where entity_type = 'tags' and action = 'update' order by id desc limit 1)
  = 'Documented in error at registration', 'S174 the removal reason is in the audit trail');
call pg_temp.fails($$update public.tags set code = 'gdm' where pregnancy_id = pg_temp.id('p_lakshmi')$$,
  'S175 a tag cannot be relabelled (remove it and add another)', '%cannot be changed%');

-- ════════════════════════════════════════════════════════════════════════════════
-- 12. Access edge cases
-- ════════════════════════════════════════════════════════════════════════════════
insert into public.pregnancy_datings (pregnancy_id, mother_id, method, scan_on, ga_at_scan_days, edd, decided_by, decided_at)
  values (:'p_lakshmi', :'m_lakshmi', 'scan', current_date - 30, 208, current_date + 42, :'s_priya', now());
insert into public.notifications (user_id, kind) values (:'priya', 'digest'), (:'lakshmi_u', 'visit_reminder');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'arjun')::text, true);
select pg_temp.ok((select count(*) from public.pregnancies where id = pg_temp.id('p_lakshmi')) = 1,
  'S176 re-dated to 34 weeks, Lakshmi becomes visible to the paediatric team');
select set_config('request.jwt.claims', json_build_object('sub', :'kiran')::text, true);
select pg_temp.ok((select count(*) from public.investigations where id = pg_temp.id('i_lak_hiv')) = 0,
  'S177 a specialist with a referral does not see the mother''s sensitive tests');
select set_config('request.jwt.claims', json_build_object('sub', :'lakshmi_u')::text, true);
select pg_temp.ok((select count(*) from public.notifications) = 1, 'S178 each person reads only their own notifications');
select set_config('request.jwt.claims', json_build_object('sub', :'neha')::text, true);
select pg_temp.ok((select count(*) from public.audit_log where mother_id = pg_temp.id('m_lakshmi')) = 0,
  'S179 a clinician cannot read the audit trail of patients she cannot see');
call pg_temp.fails($$select count(*) from public.idempotency_keys$$, 'S180 the idempotency ledger is closed to the API', '%permission denied%');
call pg_temp.fails($$select count(*) from public.id_counters$$, 'S181 the number counters are closed to the API', '%permission denied%');
call pg_temp.fails($$select app.next_number(pg_temp.id('h1'), 'mch', '2026')$$, 'S182 server numbering cannot be called from the API', '%permission denied%');
call pg_temp.fails($$select app.idem_finish('{"idempotency_key":"00000000-0000-4000-a000-0000000000a1"}', '{}')$$,
  'S183 idempotency helpers cannot be called from the API', '%permission denied%');
select set_config('request.jwt.claims', json_build_object('sub', :'priya')::text, true);
select pg_temp.ok((select count(*) from public.access_overrides) >= 1, 'S184 a clinician sees her own overrides (access history)');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════
-- 14. Scoped visibility, shared results, access grants, DPDP erasure
-- ════════════════════════════════════════════════════════════════════════════════
select set_config('request.jwt.claims', '', true);  -- set-up rows are written by the system, not by a clinician
insert into public.allergies (mother_id, substance, recorded_by) values (:'m_lakshmi', 'Penicillin', :'s_priya');
insert into public.self_logs (mother_id, kind, value, at, by_label) values (:'m_lakshmi', 'bp', '120/80', now(), 'mother');
insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by) values
  ('00000000-0000-4000-8008-0000000000b1', :'m_kavya', :'p_kavya', 'hiv', 'HIV', current_date - 100, current_date - 70),
  ('00000000-0000-4000-8008-0000000000b2', :'m_meena', :'p_meena', 'hbsag', 'HBsAg', current_date - 200, current_date - 170);

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'kiran')::text, true);
select pg_temp.ok((select count(*) from public.pregnancies where id = pg_temp.id('p_lakshmi')) = 1,
  'S201 a specialist sees the referred pregnancy');
select pg_temp.ok((select count(*) from public.investigations where id = pg_temp.id('i_lak_hb')) = 1,
  'S202 …and its non-sensitive tests');
select pg_temp.ok((select count(*) from public.allergies where mother_id = pg_temp.id('m_lakshmi')) = 1,
  'S203 …and the mother''s documented allergies, for context');
select pg_temp.ok((select count(*) from public.callbacks where mother_id = pg_temp.id('m_lakshmi'))
                + (select count(*) from public.self_logs where mother_id = pg_temp.id('m_lakshmi'))
                + (select count(*) from public.caregivers where mother_id = pg_temp.id('m_lakshmi')) = 0,
  'S204 …but not her call-backs, home readings or caregivers');
select pg_temp.ok((select count(*) from public.audit_log where mother_id = pg_temp.id('m_lakshmi')) = 0,
  'S205 …nor her audit trail');
select pg_temp.ok((select count(*) from public.encounters where mother_id = pg_temp.id('m_rekha')) = 1,
  'S206 a specialist sees only the referred pregnancy''s visits, not the mother''s previous pregnancy');
reset role;
insert into public.referral_shared_results (referral_id, investigation_id, mother_id, shared_by)
  values ('00000000-0000-4000-800e-000000000001', pg_temp.id('i_lak_hiv'), :'m_lakshmi', :'s_priya');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'kiran')::text, true);
select pg_temp.ok((select count(*) from public.investigations where id = pg_temp.id('i_lak_hiv')) = 1,
  'S207 a sensitive result shared by the referrer becomes visible to the department');
select pg_temp.ok((select count(*) from public.investigations where id = pg_temp.id('i_lak_tsh')) = 1
  and (select count(*) from public.investigations where sensitive) = 1, 'S208 …only that one sensitive result');

select set_config('request.jwt.claims', json_build_object('sub', :'arjun')::text, true);
select pg_temp.ok((select count(*) from public.investigations where id = '00000000-0000-4000-8008-0000000000b2') = 1,
  'S209 the paediatrician sees the birth pregnancy''s serology (HBsAg) for newborn care');
select pg_temp.ok((select count(*) from public.audit_log where mother_id = pg_temp.id('m_asha')) = 0,
  'S210 the paediatric team does not read the mother''s audit trail');
select pg_temp.ok((select count(*) from public.self_logs where mother_id = pg_temp.id('m_meena')) >= 0
  and (select count(*) from public.caregivers where mother_id = pg_temp.id('m_meena')) >= 0
  and (select count(*) from public.mothers where id = pg_temp.id('m_meena')) = 1, 'S211 the treating paediatric team has care-level access');

select set_config('request.jwt.claims', json_build_object('sub', :'priya')::text, true);
select pg_temp.ok((select count(*) from public.investigations where id = '00000000-0000-4000-8008-0000000000b1') = 1,
  'S212 in the labour room an obstetrician sees the admitted mother''s HIV status');
select pg_temp.ok((select count(*) from public.audit_log where mother_id = pg_temp.id('m_kavya')) = 0,
  'S213 …but labour-room access is to the pregnancy, not the whole record');
select set_config('request.jwt.claims', json_build_object('sub', :'neha')::text, true);
select pg_temp.ok((select count(*) from public.audit_log where mother_id = pg_temp.id('m_kavya')) > 0,
  'S214 the obstetric team holds the whole record, including the audit trail');
reset role;

-- Grant maintenance (the triggers are the only writer)
select pg_temp.ok((select count(*) from public.access_grants g join public.care_assignments a on a.id = g.assignment_id
  where a.pregnancy_id = pg_temp.id('p_lakshmi') and a.specialty = 'obstetrics') = 2,
  'S215 an obstetric assignment grants its team and its primary clinician');
create temp table grant_count as select count(*) n from public.access_grants;
update public.team_members set to_at = now() where staff_id = :'s_neha' and team_id = :'t_unit_b';
select pg_temp.ok((select count(*) from public.access_grants) = (select n from grant_count),
  'S216 leaving a team rewrites no grants (they belong to the team)');
update public.team_members set to_at = null where staff_id = :'s_neha' and team_id = :'t_unit_b';
select pg_temp.ok((select g.valid_from from public.access_grants g join public.care_assignments a on a.id = g.assignment_id
  where a.pregnancy_id = pg_temp.id('p_lakshmi') and a.specialty = 'paediatrics' and g.team_id is not null)
  = app.paeds_start(pg_temp.id('p_lakshmi')), 'S217 the paediatric grant starts at local midnight of 34+0 weeks (after re-dating)');
update public.admissions set discharged_at = now(), discharged_by = :'s_neha' where mother_id = :'m_kavya';
select pg_temp.ok((select valid_until from public.access_grants where source = 'labour_room' and mother_id = pg_temp.id('m_kavya')) is not null,
  'S218 discharge closes the labour-room grant');
select pg_temp.ok((select g.valid_until = r.ended_at + interval '30 days' from public.access_grants g join public.referrals r on r.id = g.referral_id
  where r.id = '00000000-0000-4000-800e-000000000003'), 'S219 a closed referral keeps department access for 30 days');
select pg_temp.ok((select bool_and(g.valid_until = b.dob + interval '25 months') from public.access_grants g
  join public.care_assignments a on a.id = g.assignment_id join public.babies b on b.id = a.baby_id
  where a.baby_id = pg_temp.id('b_meena')), 'S220 a baby''s paediatric grants end with the 0–24-month schedule');
savepoint s6;
update public.pregnancies set status = 'closed', end_reason = 'miscarriage', ended_on = current_date where id = :'p_sunita';
select pg_temp.ok(not exists (select 1 from public.care_assignments where pregnancy_id = pg_temp.id('p_sunita') and to_at is null),
  'S221 closing a pregnancy ends its care assignments (bounded working set)');
select pg_temp.ok((select bool_and(valid_until is not null) from public.access_grants g join public.care_assignments a on a.id = g.assignment_id
  where a.pregnancy_id = pg_temp.id('p_sunita')), 'S222 …and closes their grants');
rollback to savepoint s6;
set constraints all deferred;
select pg_temp.ok(not exists (select 1 from public.audit_log where entity_type = 'access_grants'),
  'S223 derived grants are not audited (their sources are)');

-- DPDP erasure
savepoint s7;
insert into public.notifications (user_id, kind) values (:'lakshmi_u', 'visit_reminder');
insert into public.erasure_requests (id, mother_id, received_via) values ('00000000-0000-4000-8014-0000000000a1', :'m_lakshmi', 'app');
select app.erase_mother_personal_data('00000000-0000-4000-8014-0000000000a1', :'s_priya');
select pg_temp.ok((select name like 'Erased %' and phone is null and alt_phone is null and user_id is null and dob is null
  and emergency_contact is null and erased_at is not null from public.mothers where id = pg_temp.id('m_lakshmi')),
  'S224 erasure removes the mother''s personal and contact data and unlinks her login');
select pg_temp.ok(not exists (select 1 from public.consents where mother_id = pg_temp.id('m_lakshmi') and withdrawn_at is null)
  and not exists (select 1 from public.caregivers where mother_id = pg_temp.id('m_lakshmi') and (revoked_at is null or phone is not null))
  and not exists (select 1 from public.notifications where user_id = :'lakshmi_u'),
  'S225 …withdraws consent, revokes and erases caregivers, clears notifications');
select pg_temp.ok((select count(*) from public.pregnancies where mother_id = pg_temp.id('m_lakshmi')) = 1
  and (select count(*) from public.encounters where mother_id = pg_temp.id('m_lakshmi')) > 0,
  'S226 the clinical record is retained (legal retention)');
select pg_temp.ok(not exists (select 1 from public.audit_log where meta::text like '%919000000003%' or meta::text like '%Lakshmi%'
  or meta::text like '%919000000004%' or meta::text like '%Ravi%'),
  'S227 the audit log holds none of her or her caregiver''s personal values (nothing to rewrite)');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'erasure' and mother_id = pg_temp.id('m_lakshmi')),
  'S228 the erasure itself is audited');
call pg_temp.fails($$update public.mothers set name = 'Lakshmi K' where id = pg_temp.id('m_lakshmi')$$,
  'S229 an erased record stays erased', '%erased record cannot be changed%');
call pg_temp.fails($$select app.erase_mother_personal_data('00000000-0000-4000-8014-0000000000a1', pg_temp.id('s_priya'))$$,
  'S230 an erasure request runs once', '%is not open%');
call pg_temp.works($$insert into public.mothers (phone, name, age_at_registration) values ('919000000003', 'New owner of the number', 30)$$,
  'S231 the released phone number can belong to someone else');
rollback to savepoint s7;
set constraints all deferred;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'priya')::text, true);
call pg_temp.fails($$select app.erase_mother_personal_data('00000000-0000-4000-8014-0000000000a1', pg_temp.id('s_priya'))$$,
  'S232 erasure cannot be run from the app', '%permission denied%');
reset role;

-- ════════════════════════════════════════════════════════════════════════════════
-- 13. Structural checks over the catalogue (design smells)
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.ok(not exists (select 1 from pg_tables t where t.schemaname = 'public'
  and not exists (select 1 from pg_constraint c where c.conrelid = ('public.' || t.tablename)::regclass and c.contype = 'p')),
  'S185 every table has a primary key');
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and data_type = 'timestamp without time zone'),
  'S186 no timestamp without time zone anywhere');
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','app') and p.prosecdef and not exists (
    select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  'S187 every security-definer function pins its search_path');
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','app') and (has_function_privilege('anon', p.oid, 'execute'))),
  'S188 no function is callable by anonymous users');
create temp view missing_idx as
  select c.table_name, c.column_name from information_schema.columns c
  join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
  where c.table_schema = 'public'
    and c.column_name in ('mother_id','pregnancy_id','baby_id','encounter_id','investigation_id','referral_id','task_id',
                          'medication_id','discharge_id','delivery_id','team_id','staff_id','user_id')
    and not exists (
      select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
      where i.indrelid = ('public.' || c.table_name)::regclass and a.attname = c.column_name);
select pg_temp.ok(not exists (select 1 from missing_idx),
  'S189 every reference column used for lookups leads an index: ' || coalesce((select string_agg(table_name || '.' || column_name, ', ') from missing_idx), ''));
select pg_temp.ok(not exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public' and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%length(TRIM%'
    and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey) and not a.attnotnull)),
  'S190 no NULL-unsafe "length(trim(x)) > 0" reason checks on nullable columns');
select pg_temp.ok(not exists (select 1 from information_schema.columns c join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
  where c.table_schema = 'public' and c.column_name = 'status' and not exists (
    select 1 from pg_constraint k where k.conrelid = ('public.' || c.table_name)::regclass and k.contype = 'c'
      and pg_get_constraintdef(k.oid) like '%status%')),
  'S191 every status column is constrained to known values');
select pg_temp.ok(not exists (select 1 from information_schema.columns c join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
  where c.table_schema = 'public' and c.column_name = 'version'
    and not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || c.table_name)::regclass and g.tgname = c.table_name || '_version')),
  'S192 every versioned table bumps its version on update');
select pg_temp.ok(not exists (select 1 from pg_tables t where t.schemaname = 'public'
  and t.tablename not in ('audit_log','notifications','push_tokens','idempotency_keys','id_counters','access_grants')
  and not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.tablename)::regclass and g.tgname = t.tablename || '_audit')),
  'S193 every business table is audited');
select pg_temp.ok(not exists (select 1 from information_schema.columns c join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
  where c.table_schema = 'public' and c.column_name = 'mother_id' and c.table_name <> 'audit_log'
    and not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || c.table_name)::regclass and g.tgname = c.table_name || '_mother_consistency')),
  'S194 every patient table enforces mother consistency');
select pg_temp.ok(not exists (select 1 from pg_tables t where t.schemaname = 'public'
  and t.tablename not in ('id_counters','idempotency_keys')
  and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename)),
  'S195 every API-readable table has a read policy');
select pg_temp.ok((select count(*) from pg_trigger where tgconstraint <> 0 and tgdeferrable and tginitdeferred) >= 7,
  'S196 the commit-time invariants are installed as deferred constraint triggers');
select pg_temp.ok(not exists (select 1 from pg_constraint c join pg_class r on r.oid = c.conrelid join pg_namespace n on n.oid = r.relnamespace
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
  where n.nspname = 'public' and c.contype = 'f' and a.attname like '%_id' and a.attname <> 'id'
    and (select count(*) from pg_constraint c2 where c2.conrelid = c.conrelid and c2.contype = 'f' and c2.conkey = c.conkey) > 1),
  'S197 no column has two competing foreign keys');
select pg_temp.ok(not exists (
  select 1 from information_schema.columns c join pg_tables t on t.schemaname = 'public' and t.tablename = c.table_name
  where c.table_schema = 'public' and c.column_name in ('ref_id','subject_id','entity_ref')),
  'S198 no polymorphic reference columns (except audit_log.entity_id by design)');
select pg_temp.ok((select count(*) from public.pick_lists where label ->> 'en' is null) = 0, 'S199 every pick-list code has an English label');
select pg_temp.ok(not exists (select 1 from public.observation_codes where value_type = 'numeric' and (min_possible is null or max_possible is null)),
  'S200 every numeric measurement has impossible-value bounds');

select format('  020_scenarios: all %s scenarios passed', n) from t_count \gset
\echo :format
rollback;
