-- Access rules: who sees which mothers, and that every patient table follows the mother.
-- Each block impersonates one person exactly as PostgREST would (role authenticated + JWT sub).
begin;

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FAIL: %', what; end if;
end $$;

-- Sorted names of the mothers the current user can see.
create function pg_temp.seen() returns text language sql as $$
  select coalesce(string_agg(name, ', ' order by name), '(none)') from public.mothers
$$;

create function pg_temp.expect(want text, who text) returns void language plpgsql as $$
declare
  got text := pg_temp.seen();
begin
  if got <> want then raise exception 'FAIL: % should see [%] but sees [%]', who, want, got; end if;
end $$;

\ir _fixtures.psql

-- ── Obstetricians: own unit's patients + the labour room; never their own record ─────
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'priya')::text, true);
select pg_temp.expect('Kavya N, Lakshmi K, Meena T, Meera S', 'Dr. Priya (Unit A + labour room)');
select pg_temp.ok((select count(*) from public.tasks where mother_id = :'m_sunita') = 0,
  'Priya cannot see tasks of Unit B''s patient (expired override)');
select pg_temp.ok((select count(*) from public.babies) = 1, 'Priya sees the baby of her unit''s mother');

select set_config('request.jwt.claims', json_build_object('sub', :'neha')::text, true);
select pg_temp.expect('Asha P, Kavya N, Sunita R', 'Dr. Neha (Unit B; Kavya is also in the labour room)');

select set_config('request.jwt.claims', json_build_object('sub', :'meera')::text, true);
select pg_temp.expect('Kavya N, Lakshmi K, Meena T', 'Dr. Meera (Unit A, but never her own record)');
select pg_temp.ok((select count(*) from public.pregnancies where mother_id = :'m_meera') = 0,
  'a clinician cannot open her own pregnancy in the Care Team face');

-- ── Paediatrician: from 34 weeks, admitted, delivered, and babies ────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'arjun')::text, true);
select pg_temp.expect('Asha P, Kavya N, Meena T', 'Dr. Arjun (Asha ≥34 wk, Kavya admitted, Meena''s baby)');
select pg_temp.ok((select count(*) from public.pregnancies where mother_id = :'m_lakshmi') = 0,
  'the paediatric team does not see Lakshmi at 33 weeks');

-- ── Specialist: referrals to the department, until 30 days after they end ──────
select set_config('request.jwt.claims', json_build_object('sub', :'kiran')::text, true);
select pg_temp.expect('Asha P, Lakshmi K', 'Dr. Kiran (open referral + one ended 10 days ago)');
select pg_temp.ok((select count(*) from public.referrals) = 2, 'Kiran sees only those two referrals');

-- ── Other hospital: nothing ─────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'other')::text, true);
select pg_temp.expect('(none)', 'a doctor of another hospital');
select pg_temp.ok((select count(*) from public.staff) = 1 and (select count(*) from public.teams) = 0,
  'another hospital sees only its own staff and teams');

-- ── Families read no clinical table directly ────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'lakshmi_u')::text, true);
select pg_temp.expect('(none)', 'Lakshmi (families use DTO functions, not tables)');
select pg_temp.ok((select count(*) from public.tasks) + (select count(*) from public.pregnancies)
                + (select count(*) from public.caregivers) + (select count(*) from public.staff) = 0,
  'a mother cannot read clinical or staff tables');
select pg_temp.ok((select count(*) from public.consents) = 1 and (select count(*) from public.notifications) = 1,
  'a mother reads her own consents and notifications');
select set_config('request.jwt.claims', json_build_object('sub', :'ravi')::text, true);
select pg_temp.ok((select count(*) from public.consents) + (select count(*) from public.notifications)
                + (select count(*) from public.mothers) = 0, 'a caregiver reads nothing directly');
reset role;

-- ── Access changes take effect immediately ──────────────────────────────────────
-- Emergency override: visible for its 24 hours.
insert into public.access_overrides (staff_id, mother_id, reason, expires_at)
  values (:'s_priya', :'m_sunita', 'Emergency in OPD', now() + interval '24 hours');
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'priya')::text, true);
select pg_temp.ok(pg_temp.seen() like '%Sunita R%', 'an active override opens the record');
reset role;

-- Leaving the team removes team-based access (Priya keeps Lakshmi and Meera as primary clinician).
update public.team_members set to_at = now() where staff_id = :'s_priya' and team_id = :'t_unit_a';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'priya')::text, true);
select pg_temp.expect('Kavya N, Lakshmi K, Meera S, Sunita R', 'Priya after leaving Unit A (primary, labour room, override)');
reset role;

-- Discharge from the labour room ends labour-room access.
update public.admissions set discharged_at = now(), discharged_by = :'s_neha' where mother_id = :'m_kavya';
-- Deactivated staff see nothing at all.
update public.staff set active = false where id = :'s_neha';
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'neha')::text, true);
select pg_temp.expect('(none)', 'a deactivated clinician');
select set_config('request.jwt.claims', json_build_object('sub', :'arjun')::text, true);
select pg_temp.expect('Asha P, Meena T', 'Arjun after Kavya''s discharge');
reset role;

-- Every table with patient data follows the mother: a sample across the schema for Dr. Other.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'other')::text, true);
select pg_temp.ok((select count(*) from public.tasks) + (select count(*) from public.babies)
                + (select count(*) from public.referrals) + (select count(*) from public.care_assignments)
                + (select count(*) from public.admissions) + (select count(*) from public.audit_log)
                + (select count(*) from public.access_overrides) = 0, 'no patient row leaks to another hospital');
reset role;

\echo '  010_access: all checks passed'
rollback;
