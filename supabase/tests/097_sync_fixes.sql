-- Server contracts the app's sync layer relies on (outbox / store fixes of 2 Oct): which RPCs take no idempotency key,
-- why a version is frozen per intent, which rows a correction also changes, the urine scale of a paper capture, and
-- doses the server never planned. No schema change: these pin the behaviour the client now matches.
-- Called as real users. Rolled back; synthetic data only.
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

\set inv '00000000-0000-4000-8008-0000000009f1'
\set res '00000000-0000-4000-8009-0000000009f1'
\set doc '00000000-0000-4000-8070-0000000009f1'
\set doc2 '00000000-0000-4000-8070-0000000009f2'
insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by) values
  (:'inv', :'m_lakshmi', :'p_lakshmi', 'hb3', 'Repeat Hb (3rd trimester)', current_date - 7, current_date + 21);

set local role authenticated;
select pg_temp.as_user(:'priya');

-- ════════════════════════════════════════════════════════════════════════════════
-- Idempotency keys and frozen versions (outbox.ts NO_KEY, version stamping)
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails($$select public.reset_demo('{"confirm":"RESET DEMO DATA","idempotency_key":"00000000-0000-4000-a097-000000000001"}')$$,
  'Y001 reset_demo takes no idempotency key: the outbox must not add one', '%unexpected field(s)%', 'PT422');

select public.update_investigation(jsonb_build_object('idempotency_key', '00000000-0000-4000-a097-000000000002', 'id', :'inv', 'action', 'order'))::text as ord \gset
select (:'ord'::jsonb ->> 'version')::int as v_ordered \gset
select jsonb_build_object('idempotency_key', '00000000-0000-4000-a097-000000000003', 'id', :'res', 'investigation_id', :'inv',
  'version', :v_ordered, 'value_num', 10.6, 'unit', 'g/dL')::text as rec \gset
select public.record_result(:'rec'::jsonb)::text as rec_answer \gset
select pg_temp.ok(public.record_result(:'rec'::jsonb) = :'rec_answer'::jsonb,
  'Y002 a retry with the very same payload (version included) replays the stored answer');
call pg_temp.fails(format('select public.record_result(%L::jsonb)', jsonb_set(:'rec'::jsonb, '{version}', to_jsonb(:v_ordered + 1))),
  'Y003 the same key with another version is refused: a retry must resend the version it was first sent with',
  '%already used for different data%', 'PT409');

-- ════════════════════════════════════════════════════════════════════════════════
-- A withdrawn result changes its test too (store.ts markEnteredInError → alsoInvalidate)
-- ════════════════════════════════════════════════════════════════════════════════
reset role;
select version as v_resulted from public.investigations where id = :'inv' \gset
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.mark_entered_in_error(jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'investigation_result', 'id', :'res',
  'reason', 'Recorded against the wrong patient'));
reset role;
select pg_temp.ok((select status = 'ordered' and version > :v_resulted from public.investigations where id = :'inv'),
  'Y004 withdrawing the only result sends the test back to waiting and bumps its version');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.record_result(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'investigation_id', :'inv',
  'version', :v_resulted, 'value_num', 10.9, 'unit', 'g/dL')),
  'Y005 so a new result checked against the version from before the withdrawal is refused', '%', 'PT409');
select public.record_result(jsonb_build_object('idempotency_key', pg_temp.k(), 'investigation_id', :'inv', 'value_num', 10.9, 'unit', 'g/dL'));
reset role;
select pg_temp.ok((select status = 'resulted' from public.investigations where id = :'inv'),
  'Y006 the app forgets the stale version and the new result is recorded');
set local role authenticated;
select pg_temp.as_user(:'priya');

-- ════════════════════════════════════════════════════════════════════════════════
-- Paper capture: every mapped field becomes a coded observation (store.ts captureVisit)
-- ════════════════════════════════════════════════════════════════════════════════
select public.create_document(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'doc', 'pregnancy_id', :'p_lakshmi', 'kind', 'anc_card', 'mime', 'image/jpeg'));
select public.create_document(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'doc2', 'pregnancy_id', :'p_lakshmi', 'kind', 'anc_card', 'mime', 'image/jpeg'));
call pg_temp.fails(format('select public.confirm_capture(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'document_id', :'doc2',
  'fields', jsonb_build_array(jsonb_build_object('key', 'albumin', 'label', 'Urine albumin', 'value', 'absent', 'confidence', 0.8, 'confirmed', true)),
  'observations', jsonb_build_array(jsonb_build_object('code', 'urine_albumin', 'value_text', 'absent')))),
  'Y007 urine albumin as free text refuses the whole capture: the app offers the scale as choices', '%must be one of%');
select public.confirm_capture(jsonb_build_object('idempotency_key', pg_temp.k(), 'document_id', :'doc',
  'fields', jsonb_build_array(
     jsonb_build_object('key', 'fundal_height', 'label', 'Fundal height', 'value', '28 cm', 'confidence', 0.9, 'confirmed', true),
     jsonb_build_object('key', 'urine_sugar', 'label', 'Urine sugar', 'value', 'Nil', 'confidence', 0.9, 'confirmed', true),
     jsonb_build_object('key', 'albumin', 'label', 'Urine albumin', 'value', 'Trace', 'confidence', 0.9, 'confirmed', true),
     jsonb_build_object('key', 'hb', 'label', 'Hb', 'value', '10.8', 'confidence', 0.9, 'confirmed', true)),
  'observations', jsonb_build_array(
     jsonb_build_object('code', 'fundal_height', 'value_num', 28),
     jsonb_build_object('code', 'urine_albumin', 'value_text', 'Trace'),
     jsonb_build_object('code', 'urine_sugar', 'value_text', 'Nil')),
  'checklist', jsonb_build_array(jsonb_build_object('component', 'urine_albumin', 'state', 'done'),
                                 jsonb_build_object('component', 'fundal_height', 'state', 'done'))))::text as cap \gset
reset role;
select pg_temp.ok((select count(*) = 3 and bool_and(code <> 'hb') from public.observations where encounter_id = (:'cap'::jsonb ->> 'encounter_id')::uuid)
  and (select fields @> '[{"key":"hb","value":"10.8"}]' from public.documents where id = :'doc'),
  'Y008 fundal height and urine sugar are recorded; Hb stays on the document only');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Doses the server never planned (store.ts isUnsavedDose)
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.record_vaccine(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', gen_random_uuid(),
  'action', 'given', 'given_on', current_date, 'primary_source', true)),
  'Y009 a dose planned only on the phone (its delivery not yet saved) cannot be recorded: the app waits for the reload', 'Not found', 'PT404');

-- Last: the reset replaces the whole cast.
set local client_min_messages = warning;
select pg_temp.as_user(:'priya');
select pg_temp.ok((public.reset_demo('{"confirm":"RESET DEMO DATA"}') ->> 'mothers')::int > 0, 'Y010 reset_demo with only its confirmation phrase works');
reset role;
set constraints all immediate;
select pg_temp.ok(true, 'Y011 every commit-time invariant holds');

select format('  097_sync_fixes: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
