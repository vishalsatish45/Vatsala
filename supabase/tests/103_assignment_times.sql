-- Care assignments never start in the future (20261005001055): a registration dated "today" between 00:00 and
-- 05:30 IST used to start them at 05:30 IST, and closing that pregnancy then broke "to_at >= from_at".
-- Rolled back; synthetic data only.
begin;

create temp table t_count (n int not null);
insert into t_count values (0);

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  update t_count set n = n + 1;
  if not coalesce(cond, false) then raise exception 'FAIL: %', what; end if;
end $$;

\ir _fixtures.psql

-- Hand Lakshmi's obstetric care to a new assignment whose start was given hours ahead (as a date-only
-- registration after midnight IST would produce).
select team_id as ob_team from public.care_assignments
  where pregnancy_id = :'p_lakshmi' and specialty = 'obstetrics' and to_at is null limit 1 \gset
update public.care_assignments set to_at = now() where pregnancy_id = :'p_lakshmi' and specialty = 'obstetrics' and to_at is null;
insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at, assigned_by, reason)
  select g.mother_id, g.id, 'obstetrics', :'ob_team', :'s_priya', now() + interval '6 hours', :'s_priya', 'Test: future start'
  from public.pregnancies g where g.id = :'p_lakshmi';

select pg_temp.ok((select from_at <= now() from public.care_assignments
                   where pregnancy_id = :'p_lakshmi' and specialty = 'obstetrics' and to_at is null),
  'T001 an assignment given a future start begins now');

-- Closing the pregnancy ends every open assignment without breaking "to_at >= from_at".
update public.pregnancies set status = 'closed', end_reason = 'transferred_out', ended_on = current_date where id = :'p_lakshmi';
select pg_temp.ok((select bool_and(to_at is not null and to_at >= from_at) from public.care_assignments where pregnancy_id = :'p_lakshmi'),
  'T002 closing ends every assignment at or after its start');

select format('  103_assignment_times: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
