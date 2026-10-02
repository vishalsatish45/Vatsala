-- Family "Ask" quota (family_ai_quota) and the project-wide AI budget it shares with the Care Team's ai_quota.
-- Called as real users, the way the family-ask Edge Function calls it. Rolled back; synthetic data only.
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

\set ask 'select public.family_ai_quota(''{"fn":"family-ask"}''::jsonb)'

set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Who may ask
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
call pg_temp.fails(:'ask', 'K001 a clinician is not a family user', 'Ask is for mothers%', 'PT403');
select pg_temp.as_user(:'kiran');
call pg_temp.fails(:'ask', 'K002 a specialist is not a family user', 'Ask is for mothers%', 'PT403');
select pg_temp.as_user(:'meena_u');
call pg_temp.fails(:'ask', 'K003 a mother who has not accepted the notice is refused like every family read', 'Not found', 'PT404');

select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails('select public.family_ai_quota(''{"fn":"family-ask","question":"x"}''::jsonb)',
  'K004 unknown fields are refused (the question is never sent to the database)', '%unexpected field(s)%', 'PT422');
call pg_temp.fails('select public.family_ai_quota(''{"fn":"ai-brief"}''::jsonb)', 'K005 only family-ask is counted here', '%fn must be family-ask%', 'PT422');
select pg_temp.ok((public.family_ai_quota(jsonb_build_object('fn', 'family-ask')) ->> 'left_today')::int = 14, 'K006 the mother may ask; the call is counted');
select pg_temp.ok((public.family_ai_quota() ->> 'ok')::boolean, 'K007 fn is optional');

select pg_temp.as_user(:'ravi');
call pg_temp.fails(:'ask', 'K008 a caregiver who has not accepted the notice is refused', 'Not found', 'PT404');
select public.record_consent(jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_lakshmi', 'notice_version', 'v1', 'lang', 'kn',
  'purposes', '["app"]'::jsonb, 'decision', 'accepted'));
select pg_temp.ok((public.family_ai_quota('{}'::jsonb) ->> 'ok')::boolean, 'K009 a caregiver (with consent and her sharing consent) may ask');

call pg_temp.fails('select count(*) from app.family_ai_calls', 'K010 the call log is not readable by app users', '%permission denied%', '42501');
call pg_temp.fails(format('insert into app.family_ai_calls (user_id) values (%L)', :'ravi'), 'K011 nobody writes the call log directly', '%permission denied%', '42501');
reset role;
select pg_temp.ok((select count(*) = 2 from app.family_ai_calls where user_id = :'lakshmi_u')
  and (select count(*) = 1 from app.family_ai_calls where user_id = :'ravi'), 'K012 each allowed call is counted per user');
select pg_temp.ok((select array_agg(column_name::text order by column_name::text) from information_schema.columns
                   where table_schema = 'app' and table_name = 'family_ai_calls') = '{at,id,user_id}',
  'K013 only who and when are stored — never the question or the answer');
select pg_temp.ok(not has_table_privilege('anon', 'app.family_ai_calls', 'select')
  and not has_table_privilege('authenticated', 'app.family_ai_calls', 'select'), 'K014 no API role has any privilege on the call log');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Per-user caps
-- ════════════════════════════════════════════════════════════════════════════════
savepoint s_10m;
select pg_temp.as_user(:'lakshmi_u');
select public.family_ai_quota('{}'::jsonb) from generate_series(1, 3);
call pg_temp.fails(:'ask', 'K015 the 6th question in 10 minutes is refused', '%just now%', 'PT429');
reset role;
select pg_temp.ok((select count(*) = 5 from app.family_ai_calls where user_id = :'lakshmi_u'), 'K016 a refused call is not counted');
set local role authenticated;
select pg_temp.as_user(:'ravi');
select pg_temp.ok((public.family_ai_quota('{}'::jsonb) ->> 'ok')::boolean, 'K017 caps are per user: her caregiver may still ask');
rollback to savepoint s_10m;

savepoint s_day;
reset role;
insert into app.family_ai_calls (user_id, at) select :'lakshmi_u', now() - interval '3 hours' from generate_series(1, 13);
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(:'ask', 'K018 the 16th question in a day is refused', '%today%', 'PT429');
reset role;
delete from app.family_ai_calls where user_id = :'lakshmi_u' and at < now() - interval '2 hours';
insert into app.family_ai_calls (user_id, at) select :'lakshmi_u', now() - interval '25 hours' from generate_series(1, 20);
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok((public.family_ai_quota('{}'::jsonb) ->> 'ok')::boolean, 'K019 yesterday''s questions do not count today');
rollback to savepoint s_day;

-- ════════════════════════════════════════════════════════════════════════════════
-- One project-wide budget for Care Team drafts and family questions
-- ════════════════════════════════════════════════════════════════════════════════
savepoint s_minute_staff;
reset role;
-- 3 family questions already this minute (Lakshmi 2, Ravi 1) + 5 Care Team drafts = 8
insert into app.ai_calls (staff_id, fn) select :'s_arjun', 'ai-brief' from generate_series(1, 5);
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(:'ask', 'K020 Care Team drafts use up the project''s per-minute budget for families too', '%busy%', 'PT429');
rollback to savepoint s_minute_staff;

savepoint s_minute_family;
reset role;
insert into app.family_ai_calls (user_id) select :'meena_u' from generate_series(1, 5);
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.ai_quota(%L::jsonb)', jsonb_build_object('fn', 'ai-brief', 'pregnancy_id', :'p_lakshmi')),
  'K021 family questions use up the project''s per-minute budget for the Care Team too', '%busy%', 'PT429');
rollback to savepoint s_minute_family;

savepoint s_project_day;
reset role;
insert into app.family_ai_calls (user_id, at) select :'meena_u', now() - interval '5 hours' from generate_series(1, 100);
insert into app.ai_calls (staff_id, fn, at) select :'s_arjun', 'ai-brief', now() - interval '5 hours' from generate_series(1, 47);
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(:'ask', 'K022 the 150-a-day project cap counts both kinds of call (family side)', '%busy%', 'PT429');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.ai_quota(%L::jsonb)', jsonb_build_object('fn', 'ai-brief', 'pregnancy_id', :'p_lakshmi')),
  'K023 the 150-a-day project cap counts both kinds of call (Care Team side)', '%busy%', 'PT429');
rollback to savepoint s_project_day;

select pg_temp.as_user(:'priya');
select pg_temp.ok((public.ai_quota(jsonb_build_object('fn', 'ai-brief', 'pregnancy_id', :'p_lakshmi')) ->> 'ok')::boolean,
  'K024 under the caps the Care Team quota still works');

-- ════════════════════════════════════════════════════════════════════════════════
-- Removal is immediate
-- ════════════════════════════════════════════════════════════════════════════════
reset role;
update public.caregivers set revoked_at = now() where mother_id = :'m_lakshmi' and user_id = :'ravi';
set local role authenticated;
select pg_temp.as_user(:'ravi');
call pg_temp.fails(:'ask', 'K025 a removed caregiver can no longer ask', 'Ask is for mothers%', 'PT403');
reset role;

select format('  099_family_ask: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
