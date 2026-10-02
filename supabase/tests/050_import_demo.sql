-- Register import, demo reset and TRUNCATE protection. Rolled back; synthetic data only.
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

\ir _fixtures.psql

-- ════════════════════════════════════════════════════════════════════════════════
-- TRUNCATE protection
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$truncate public.tasks cascade$$, 'D001 clinical tables cannot be truncated (TRUNCATE skips row triggers)', '%cannot be truncated%');
call pg_temp.fails($$truncate public.audit_log$$, 'D002 the audit log cannot be truncated', '%append-only%');

-- ════════════════════════════════════════════════════════════════════════════════
-- Demo reset
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails($$select public.reset_demo('{"confirm":"RESET DEMO DATA"}')$$, 'D003 a family user cannot reset the demo', '%Care Team%', 'PT403');
select pg_temp.as_user(:'priya');
call pg_temp.fails($$select public.reset_demo('{"confirm":"yes"}')$$, 'D004 the reset needs the confirmation phrase', '%confirmation phrase%', 'PT422');
reset role;
update public.app_settings set value = 'false' where key = 'demo_mode';
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails($$select public.reset_demo('{"confirm":"RESET DEMO DATA"}')$$, 'D005 outside demo mode the reset is disabled', '%disabled%', 'PT403');
reset role;
update public.app_settings set value = 'true' where key = 'demo_mode';
set local role authenticated;
select pg_temp.as_user(:'priya');
select pg_temp.ok((public.reset_demo('{"confirm":"RESET DEMO DATA"}') ->> 'mothers')::int = 6, 'D006 the demo cast is loaded');
select pg_temp.ok((public.reset_demo('{"confirm":"RESET DEMO DATA"}') ->> 'mothers')::int = 6, 'D007 resetting twice gives the same cast');
reset role;
set constraints all immediate;
select pg_temp.ok(true, 'D008 the demo cast satisfies every commit-time invariant');
set constraints all deferred;
select pg_temp.ok((select user_id from public.mothers where phone = '919000000003') = :'lakshmi_u'
  and (select user_id from public.caregivers where phone = '919000000004') = :'ravi',
  'D009 demo accounts link to their existing sign-ins');
select pg_temp.ok((select min(mch_id) from public.pregnancies) like 'MCH-%-000001', 'D010 MCH numbering restarts for the demo');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'demo_reset'), 'D011 the reset is audited');

set local role authenticated;
select pg_temp.as_user(:'priya');
select pg_temp.ok((select count(*) from public.mothers) = 6, 'D012 Dr. Priya (Unit A) sees all six demo mothers');
select pg_temp.ok(exists (select 1 from public.tasks k where k.kind = 'anc_visit' and k.completed_at is null and k.cancelled_at is null
  and k.due_by < current_date), 'D013 the worklist has a missed visit (Sunita)');
select pg_temp.ok(exists (select 1 from public.investigations where status = 'resulted'), 'D014 …a result awaiting review (Lakshmi''s OGTT)');
select pg_temp.ok(exists (select 1 from public.callbacks where closed_at is null), 'D015 …an open call-back');
select pg_temp.ok(exists (select 1 from public.admissions where discharged_at is null), 'D016 …a mother in the labour room (Kavya)');
select pg_temp.ok(exists (select 1 from public.discharges where completed_at is null), 'D017 …a discharge checklist to complete (Meena''s baby)');
select pg_temp.as_user(:'arjun');
select pg_temp.ok((select string_agg(name, ', ' order by name) from public.mothers) = 'Asha P, Kavya N, Meena T',
  'D018 Dr. Arjun sees the 36-week mother, the labour room and the newborn''s mother');
select pg_temp.as_user(:'kiran');
select pg_temp.ok((select count(*) from public.mothers) = 1 and (select count(*) from public.investigations where sensitive) = 0,
  'D019 Dr. Kiran sees only the referred mother, without her sensitive tests');
select pg_temp.as_user(:'meera');
select pg_temp.ok(not exists (select 1 from public.mothers where name = 'Meera S'), 'D020 Dr. Meera never sees her own record');

select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails($$select public.family_context()$$, 'D021 after a reset the mother consents again in the app', 'Not found', 'PT404');
select public.record_consent(jsonb_build_object('idempotency_key', gen_random_uuid(), 'notice_version', 'v1', 'lang', 'kn',
  'purposes', '["app","reminders_app","caregiver_sharing"]'::jsonb, 'decision', 'accepted'));
select pg_temp.ok(jsonb_array_length(public.family_schedule() -> 'visits') >= 1, 'D022 Lakshmi''s app shows her next visit');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(public.family_tests()) t where t ->> 'label' = 'OGTT 75 g'
  and t ->> 'status' = 'done' and t -> 'result' = 'null'::jsonb), 'D023 her OGTT shows done, no value until reviewed');
select pg_temp.as_user(:'meena_u');
select public.record_consent(jsonb_build_object('idempotency_key', gen_random_uuid(), 'notice_version', 'v1', 'lang', 'kn',
  'purposes', '["app"]'::jsonb, 'decision', 'accepted'));
select pg_temp.ok(jsonb_array_length(public.family_context() -> 'babies') = 1
  and (select count(*) from jsonb_array_elements(public.family_schedule() -> 'vaccines') v where v ->> 'status' = 'given' and v ->> 'baby_id' is not null) = 3,
  'D024 Meena''s app shows her baby with the three birth doses given');

-- ════════════════════════════════════════════════════════════════════════════════
-- Register import
-- ════════════════════════════════════════════════════════════════════════════════
create function pg_temp.row(phone text, name text, preg uuid) returns jsonb language sql as $$
  select jsonb_build_object(
    'mother', jsonb_build_object('phone', phone, 'name', name, 'age', 26, 'lang', 'kn'),
    'pregnancy', jsonb_build_object('id', preg, 'gravida', 1, 'para', 0, 'living', 0, 'abortions', 0),
    'dating', jsonb_build_object('method', 'lmp', 'lmp', current_date - 100, 'edd', current_date + 180),
    'team_id', '00000000-0000-4000-8001-0000000000a1',
    'tasks', jsonb_build_array(jsonb_build_object('kind', 'anc_visit', 'title', 'ANC visit · 18 weeks',
                                                  'due_from', current_date + 24, 'due_by', current_date + 26)))
$$;
select jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-0000000000a5', 'file_name', 'anc_register_sept.xlsx',
  'rows', jsonb_build_array(pg_temp.row('919000000080', 'Imported One', '00000000-0000-4000-8004-0000000000a5'),
                            pg_temp.row('919000000003', 'Not Lakshmi', '00000000-0000-4000-8004-0000000000a6'),
                            pg_temp.row('919000000081', 'Imported Two', '00000000-0000-4000-8004-0000000000a7')))::text as imp \gset
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.confirm_import(%L::jsonb)', :'imp'), 'D025 only obstetricians import the ANC register', '%role%', 'PT403');
select pg_temp.as_user(:'priya');
select public.confirm_import(:'imp'::jsonb)::text as imp_out \gset
select pg_temp.ok(jsonb_array_length(:'imp_out'::jsonb -> 'created') = 2 and jsonb_array_length(:'imp_out'::jsonb -> 'rejected') = 1
  and (:'imp_out'::jsonb -> 'rejected' -> 0 ->> 'row')::int = 2
  and (:'imp_out'::jsonb -> 'rejected' -> 0 ->> 'reason') like '%belongs to another patient%',
  'D026 good rows are imported; a bad row is reported with its reason, not fatal');
select pg_temp.ok(public.confirm_import(:'imp'::jsonb) = :'imp_out'::jsonb, 'D027 re-sending the same import changes nothing');
reset role;
select pg_temp.ok((select count(*) from public.pregnancies where source = 'import') = 2, 'D028 imported pregnancies are marked as imported');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'import' and meta ->> 'file_name' = 'anc_register_sept.xlsx'
  and (meta ->> 'created')::int = 2 and (meta ->> 'rejected')::int = 1), 'D029 the import is audited with its totals');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails($$select public.confirm_import('{"idempotency_key":"00000000-0000-4000-a000-0000000000a6","file_name":"x.csv","rows":[]}')$$,
  'D030 an empty import is refused', '%Nothing to import%', 'PT422');
select format('select public.confirm_import(%L::jsonb)', jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-0000000000a7',
  'file_name', 'huge.csv', 'rows', (select jsonb_agg(pg_temp.row('9190000' || lpad(g::text, 5, '0'), 'R' || g, gen_random_uuid()))
  from generate_series(1, 501) g))) as huge \gset
call pg_temp.fails(:'huge', 'D031 imports are bounded (500 rows per call)', '%at most 500%', 'PT422');
reset role;

select format('  050_import_demo: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
