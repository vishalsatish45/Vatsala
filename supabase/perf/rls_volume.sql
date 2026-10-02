-- Volume + RLS performance probe. Run: .\scripts\laptop-db.ps1 perf
-- Loads a busy district hospital's year (5,000 pregnancies across 10 obstetric units, ~50k tasks, ~25k encounters,
-- ~150k observations, ~70k test orders), then times the app's hot queries AS A SIGNED-IN DOCTOR — a superuser
-- skips RLS and would make everything look fast. Everything is rolled back. Synthetic data only.
begin;

\set h1 '00000000-0000-4000-8000-000000000001'
\set s_priya '00000000-0000-4000-8002-000000000001'
\set priya '00000000-0000-4000-9000-000000000001'

insert into auth.users (id, phone) values (:'priya', '919000000001');

insert into public.teams (id, hospital_id, name, kind, specialty, parent_team_id)
select ('00000000-0000-4000-80f0-' || lpad(i::text, 12, '0'))::uuid, :'h1', 'Perf Unit ' || i, 'unit', 'obstetrics',
       '00000000-0000-4000-8001-000000000001'
from generate_series(1, 9) i;

create temp table unit_of (i int primary key, team uuid);
insert into unit_of
select i, case when i % 10 = 0 then '00000000-0000-4000-8001-0000000000a1'::uuid
               else ('00000000-0000-4000-80f0-' || lpad((i % 10)::text, 12, '0'))::uuid end
from generate_series(1, 5000) i;

\echo '  loading 5,000 mothers and pregnancies …'
insert into public.mothers (id, phone, name, age_at_registration)
select ('00000000-0000-4000-80f1-' || lpad(i::text, 12, '0'))::uuid, '917' || lpad(i::text, 9, '0'), 'Perf Mother ' || i, 18 + i % 20
from generate_series(1, 5000) i;

insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions)
select ('00000000-0000-4000-80f2-' || lpad(i::text, 12, '0'))::uuid, 'MCH-2025-' || lpad(i::text, 6, '0'),
       ('00000000-0000-4000-80f1-' || lpad(i::text, 12, '0'))::uuid, :'h1',
       now() - make_interval(days => 30 + i % 200), current_date + (i % 250), 2, 1, 1, 0
from generate_series(1, 5000) i;

insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, edd, decided_by, decided_at)
select g.id, g.mother_id, 'lmp', g.edd - 280, g.edd, :'s_priya', g.registered_on
from public.pregnancies g where g.mch_id like 'MCH-2025-%';

insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, from_at)
select ('00000000-0000-4000-80f1-' || lpad(u.i::text, 12, '0'))::uuid, ('00000000-0000-4000-80f2-' || lpad(u.i::text, 12, '0'))::uuid,
       'obstetrics', u.team, now() - interval '30 days'
from unit_of u;

\echo '  loading ~50k tasks, ~25k encounters, ~150k observations, ~70k test orders …'
insert into public.tasks (mother_id, pregnancy_id, kind, title, due_from, due_by, generated_by, completed_at)
select ('00000000-0000-4000-80f1-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-80f2-' || lpad(i::text, 12, '0'))::uuid,
       'anc_visit', 'ANC visit', current_date + (k * 14 - 72), current_date + (k * 14 - 70), 'protocol',
       case when k <= 4 then now() + make_interval(days => k * 14 - 70) end
from generate_series(1, 5000) i, generate_series(1, 10) k;

insert into public.encounters (id, mother_id, pregnancy_id, kind, at, by_staff)
select ('00000000-0000-4000-80f3-' || lpad((i * 10 + k)::text, 12, '0'))::uuid,
       ('00000000-0000-4000-80f1-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-80f2-' || lpad(i::text, 12, '0'))::uuid,
       'anc', now() - make_interval(days => k * 20), :'s_priya'
from generate_series(1, 5000) i, generate_series(1, 5) k;

insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, value_text, at, by_staff)
select e.id, e.mother_id, e.pregnancy_id, c.code, c.num, c.txt, e.at, e.by_staff
from public.encounters e
cross join (values ('weight', 60.0, null), ('bp_sys', 118, null), ('bp_dia', 76, null), ('fhr', 140, null),
                   ('fundal_height', 28, null), ('urine_albumin', null, 'Nil')) as c(code, num, txt)
where e.mother_id::text like '00000000-0000-4000-80f1-%';

insert into public.investigations (mother_id, pregnancy_id, code, label, due_from, due_by)
select ('00000000-0000-4000-80f1-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-80f2-' || lpad(i::text, 12, '0'))::uuid,
       c.code, c.label, current_date - 30, current_date + 30
from generate_series(1, 5000) i cross join public.investigation_catalogue c where c.applies_to = 'mother';

analyze;

\echo ''
\echo '  Row counts:'
select (select count(*) from public.mothers) mothers, (select count(*) from public.tasks) tasks,
       (select count(*) from public.encounters) encounters, (select count(*) from public.observations) observations,
       (select count(*) from public.investigations) investigations, (select count(*) from public.audit_log) audit_rows;

-- Everything below runs as Dr. Priya (OB Unit A ≈ 500 of the 5,000 pregnancies), exactly as the API would.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'priya')::text, true) \g

\echo ''
\echo '  Q1 my patients (list):'
explain (analyze, costs off, timing on, summary on) select id, name from public.mothers;

\echo ''
\echo '  Q2 worklist: my open visits due within 7 days:'
explain (analyze, costs off, timing on, summary on)
select id, pregnancy_id, title, due_by from public.tasks
where completed_at is null and cancelled_at is null and due_by < current_date + 7;

\echo ''
\echo '  Q3 patient view: one pregnancy''s observations (must use observations_pregnancy):'
explain (analyze, costs off, timing on, summary on)
select code, value_num, value_text, at from public.observations
where pregnancy_id = '00000000-0000-4000-80f2-000000000010' order by at desc;

\echo ''
\echo '  Q4 patient view: one pregnancy''s open tasks and tests:'
explain (analyze, costs off, timing on, summary on)
select id, title, due_by from public.tasks
where pregnancy_id = '00000000-0000-4000-80f2-000000000010' and completed_at is null and cancelled_at is null;
explain (analyze, costs off, timing on, summary on)
select id, code, status, due_by from public.investigations where pregnancy_id = '00000000-0000-4000-80f2-000000000010';

\echo ''
\echo '  Q5 another unit''s pregnancy (must return 0 rows, quickly):'
explain (analyze, costs off, timing on, summary on)
select code, value_num from public.observations where pregnancy_id = '00000000-0000-4000-80f2-000000000011';

reset role;
rollback;
