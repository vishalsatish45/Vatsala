-- Previous pregnancies: "Other" outcome (20261005001070). The table takes it, every function that validates a previous
-- pregnancy lists it, and an unknown outcome is still refused. Rolled back; synthetic data only.
begin;

create temp table t_count (n int not null);
insert into t_count values (0);

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  update t_count set n = n + 1;
  if not coalesce(cond, false) then raise exception 'FAIL: %', what; end if;
end $$;

\ir _fixtures.psql

insert into public.previous_pregnancies (mother_id, year, outcome, note, recorded_by)
values (:'m_lakshmi', 2022, 'other', 'Synthetic: as documented on the referral letter', :'s_priya');
select pg_temp.ok(exists (select 1 from public.previous_pregnancies where mother_id = :'m_lakshmi' and outcome = 'other'),
  'T001 the table takes an "other" outcome');

select pg_temp.ok(not exists (
    select 1 from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname in ('public','app') and position($l$'neonatal_death')$l$ in p.prosrc) > 0),
  'T002 no function still holds the old outcome list');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname in ('public','app') and p.proname in ('register_pregnancy','correct_fact')
      and position($l$'neonatal_death','other')$l$ in p.prosrc) > 0) = 2,
  'T003 registration and record correction both accept "other"');

do $$ begin
  insert into public.previous_pregnancies (mother_id, year, outcome, recorded_by)
  values ('00000000-0000-4000-8003-000000000001', 2021, 'unknown_outcome', '00000000-0000-4000-8002-000000000001');
  raise exception 'FAIL: T004 an unknown outcome was accepted';
exception when check_violation then null;
end $$;
update t_count set n = n + 1;

select format('  104_previous_outcome_other: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
