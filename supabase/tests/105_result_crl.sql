-- Scan results: the CRL (mm) as reported, its own column (20261005001080). record_result and correct_result take
-- crl_mm; an impossible value is refused by the table. Called as real users. Rolled back; synthetic data only.
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

\set inv '00000000-0000-4000-8008-0000000010f1'
\set res '00000000-0000-4000-8009-0000000010f1'
\set res2 '00000000-0000-4000-8009-0000000010f2'
insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by) values
  (:'inv', :'m_lakshmi', :'p_lakshmi', 'dating', 'Dating scan', current_date - 7, current_date + 21);

set local role authenticated;
select pg_temp.as_user(:'priya');
select public.record_result(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'res', 'investigation_id', :'inv',
  'value_text', 'Report documented', 'crl_mm', 45.5, 'note', 'Synthetic'));
reset role;
select pg_temp.ok((select crl_mm = 45.5 and note = 'Synthetic' from public.investigation_results where id = :'res'),
  'C001 record_result keeps the CRL in its own column, the note unchanged');

set local role authenticated;
select pg_temp.as_user(:'priya');
select public.correct_result(jsonb_build_object('idempotency_key', pg_temp.k(), 'result_id', :'res', 'id', :'res2',
  'value_text', 'Report documented', 'crl_mm', 46));
reset role;
select pg_temp.ok((select crl_mm = 46 from public.investigation_results where id = :'res2'),
  'C002 correct_result keeps the corrected CRL');

set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.record_result(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'investigation_id', :'inv', 'value_text', 'Report', 'crl_mm', 250)),
  'C003 a CRL over 200 mm is refused', '%', '23514');
reset role;

select format('  105_result_crl: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
