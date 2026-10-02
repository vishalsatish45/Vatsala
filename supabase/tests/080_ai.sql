-- AI drafts (save_ai_draft, verify_ai_draft) and paper-capture transcription drafts (save_capture_draft).
-- Called as real users, the way the ai-brief / capture-transcribe Edge Functions call them. Rolled back;
-- synthetic data only.
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

-- A draft payload with a fresh idempotency key and the given sentences.
create function pg_temp.draft(p_id text, p_subject text, p_subject_id text, p_content jsonb, p_kind text default 'brief') returns text
language sql volatile as $$
  select format('select public.save_ai_draft(%L::jsonb)', jsonb_build_object(
    'idempotency_key', gen_random_uuid(), 'id', p_id, p_subject, p_subject_id, 'kind', p_kind, 'model', 'claude-sonnet-5-5',
    'content', p_content))
$$;
create function pg_temp.sentence(p_text text, p_kind text, p_id text) returns jsonb language sql immutable as $$
  select jsonb_build_object('text', p_text, 'sources', jsonb_build_array(jsonb_build_object('kind', p_kind, 'id', p_id)))
$$;

\ir _fixtures.psql

\set ref_lakshmi '00000000-0000-4000-800e-000000000001'
\set ref_sunita  '00000000-0000-4000-800e-000000000002'
\set d1   '00000000-0000-4000-8020-000000000001'
\set d2   '00000000-0000-4000-8020-000000000002'
\set d3   '00000000-0000-4000-8020-000000000003'
\set doc1 '00000000-0000-4000-8021-000000000001'
\set doc2 '00000000-0000-4000-8021-000000000002'
select id as t_lakshmi from public.tasks where pregnancy_id = :'p_lakshmi' limit 1 \gset
select id as dlv_meena from public.deliveries where pregnancy_id = :'p_meena' \gset

insert into public.documents (id, mother_id, pregnancy_id, kind, storage_path, mime, captured_by, captured_at) values
  (:'doc1', :'m_lakshmi', :'p_lakshmi', 'anc_card', 'documents/' || :'m_lakshmi' || '/card-1.jpg', 'image/jpeg', :'s_priya', now());
insert into public.documents (id, mother_id, pregnancy_id, kind, storage_path, mime, fields, captured_by, captured_at, confirmed_by, confirmed_at) values
  (:'doc2', :'m_lakshmi', :'p_lakshmi', 'anc_card', 'documents/' || :'m_lakshmi' || '/card-2.jpg', 'image/jpeg', '[]', :'s_priya', now(), :'s_priya', now());

select jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000801', 'id', :'d1', 'pregnancy_id', :'p_lakshmi',
  'kind', 'brief', 'model', 'claude-sonnet-5-5',
  'content', jsonb_build_array(
    pg_temp.sentence('Pregnancy registered; EDD as documented.', 'registration', :'p_lakshmi'),
    pg_temp.sentence('Cardiology referral status requested.', 'referral', :'ref_lakshmi'),
    pg_temp.sentence('Next ANC visit is scheduled.', 'task', :'t_lakshmi')))::text as brief \gset

set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- save_ai_draft
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.save_ai_draft(%L::jsonb)', :'brief'), 'A001 a family member cannot make an AI draft', '%Care Team%', 'PT403');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.save_ai_draft(%L::jsonb)', :'brief'), 'A002 a paediatrician cannot draft a pregnancy brief', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.save_ai_draft(%L::jsonb)', :'brief'), 'A003 another unit''s obstetrician cannot see her', 'Not found', 'PT404');
select pg_temp.as_user(:'other');
call pg_temp.fails(format('select public.save_ai_draft(%L::jsonb)', :'brief'), 'A004 another hospital''s obstetrician cannot see her', 'Not found', 'PT404');

select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.save_ai_draft(%L::jsonb)', (:'brief'::jsonb || jsonb_build_object('idempotency_key', pg_temp.k(), 'engine', 'gpt'))),
  'A005 unknown fields are refused (the engine is set by the server)', '%unexpected field(s)%', 'PT422');
call pg_temp.fails(pg_temp.draft(null, 'pregnancy_id', :'p_lakshmi', jsonb_build_array(jsonb_build_object('text', 'She is doing well.', 'sources', '[]'::jsonb))),
  'A006 a sentence without a source is refused', '%at least one source%', 'PT422');
call pg_temp.fails(pg_temp.draft(null, 'pregnancy_id', :'p_lakshmi', jsonb_build_array(pg_temp.sentence('Lab entry.', 'lab', :'p_lakshmi'))),
  'A007 an unknown kind of source is refused', '%unknown kind of source%', 'PT422');
call pg_temp.fails(pg_temp.draft(null, 'pregnancy_id', :'p_lakshmi', jsonb_build_array(pg_temp.sentence('Referral seen.', 'referral', :'ref_sunita'))),
  'A008 a draft cannot cite another mother''s record', '%not part of this patient%', 'PT422');
call pg_temp.fails(pg_temp.draft(null, 'pregnancy_id', :'p_lakshmi', jsonb_build_array(pg_temp.sentence('Registered.', 'registration', :'p_lakshmi')), 'summary'),
  'A009 only brief, handoff and discharge drafts exist', '%kind must be%', 'PT422');
call pg_temp.fails(pg_temp.draft(null, 'pregnancy_id', :'p_lakshmi', jsonb_build_array(pg_temp.sentence('Registered.', 'registration', 'not-a-uuid'))),
  'A010 a source id must be a UUID', '%unknown kind of source%', 'PT422');
call pg_temp.fails(pg_temp.draft(null, 'pregnancy_id', :'p_lakshmi', '[]'::jsonb),
  'A011 an empty draft is refused', '%between 1 and 40%', 'PT422');

select public.save_ai_draft(:'brief'::jsonb)::text as saved \gset
select pg_temp.ok((:'saved'::jsonb ->> 'status') = 'unverified' and (:'saved'::jsonb ->> 'engine') = 'claude'
  and jsonb_array_length(:'saved'::jsonb -> 'content') = 3
  and (:'saved'::jsonb -> 'content' -> 1 -> 'sources' -> 0 ->> 'id') = :'ref_lakshmi', 'A012 the draft is saved unverified, with its citations');
select pg_temp.ok(public.save_ai_draft(:'brief'::jsonb) = :'saved'::jsonb, 'A013 a retry returns the same draft');
select public.save_ai_draft(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'kind', 'brief',
  'model', 'gemini-3.5-flash', 'content', jsonb_build_array(pg_temp.sentence('Registered.', 'registration', :'p_lakshmi'))))::text as gem \gset
select pg_temp.ok((:'gem'::jsonb ->> 'engine') = 'gemini' and (:'gem'::jsonb ->> 'model') = 'gemini-3.5-flash',
  'A013a a Gemini draft records engine gemini');
call pg_temp.fails(format('select public.save_ai_draft(%L::jsonb)', jsonb_set(:'brief'::jsonb, '{kind}', '"handoff"')),
  'A014 the same request id with other data is refused', '%already used%', 'PT409');
select pg_temp.ok((select generated_by = :'s_priya' and status = 'unverified' and mother_id = :'m_lakshmi' from public.ai_drafts where id = :'d1'),
  'A015 she can read her draft back; it records who asked for it');
call pg_temp.fails(format('insert into public.ai_drafts (mother_id, pregnancy_id, kind, content, engine, generated_by) values (%L, %L, ''brief'', ''[]'', ''claude'', %L)',
  :'m_lakshmi', :'p_lakshmi', :'s_priya'), 'A016 nobody writes ai_drafts directly', '%permission denied%', '42501');

select pg_temp.as_user(:'arjun');
select public.save_ai_draft(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d3', 'baby_id', :'b_meena', 'kind', 'handoff',
  'model', 'claude-sonnet-5-5', 'content', jsonb_build_array(
    pg_temp.sentence('Baby born, birth weight as documented.', 'baby', :'b_meena'),
    pg_temp.sentence('Delivery mode as documented.', 'delivery', :'dlv_meena'))));
select pg_temp.ok((select baby_id = :'b_meena' and pregnancy_id is null from public.ai_drafts where id = :'d3'),
  'A017 the paediatrician drafts a baby handoff that may cite the delivery');

-- ════════════════════════════════════════════════════════════════════════════════
-- verify_ai_draft
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
select public.save_ai_draft(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d2', 'pregnancy_id', :'p_lakshmi', 'kind', 'brief',
  'model', 'claude-sonnet-5-5', 'content', jsonb_build_array(pg_temp.sentence('Registered.', 'registration', :'p_lakshmi'))));

select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d1', 'action', 'verify')),
  'A018 a clinician who cannot see her cannot verify', 'Not found', 'PT404');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d1', 'action', 'verify')),
  'A019 a paediatrician cannot verify a pregnancy brief', '%role%', 'PT403');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', gen_random_uuid(), 'action', 'verify')),
  'A020 an unknown draft is not found', 'Not found', 'PT404');
call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d1', 'action', 'approve')),
  'A021 the action is verify or discard', '%verify or discard%', 'PT422');
call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d1', 'action', 'verify', 'exclude', '[5]'::jsonb)),
  'A022 exclusions are positions in this draft', '%sentence positions%', 'PT422');
call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d1', 'action', 'verify', 'exclude', '["0"]'::jsonb)),
  'A023 exclusions are numbers', '%sentence positions%', 'PT422');
call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d1', 'action', 'verify', 'exclude', '[0,1,2]'::jsonb)),
  'A024 a verified note keeps at least one sentence', '%Keep at least one%', 'PT422');

select public.verify_ai_draft(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000802', 'id', :'d1', 'action', 'verify',
  'exclude', '[1]'::jsonb))::text as verified \gset
select pg_temp.ok((:'verified'::jsonb ->> 'status') = 'verified' and (:'verified'::jsonb ->> 'note_id') is not null, 'A025 verifying returns the new note');
select pg_temp.ok((select n.kind = 'ai_verified' and n.author = :'s_priya' and n.pregnancy_id = :'p_lakshmi'
                     and n.body like 'Consultation brief (AI draft, verified): Pregnancy registered%Next ANC visit is scheduled.'
                     and n.body not like '%Cardiology%'
                   from public.care_notes n where n.id = (:'verified'::jsonb ->> 'note_id')::uuid),
  'A026 the note holds only the sentences she kept');
select pg_temp.ok((select status = 'verified' and verified_by = :'s_priya' and verified_at is not null
                     and note_id = (:'verified'::jsonb ->> 'note_id')::uuid from public.ai_drafts where id = :'d1'),
  'A027 the draft is linked to its note');
select pg_temp.ok(public.verify_ai_draft(jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000802', 'id', :'d1', 'action', 'verify',
  'exclude', '[1]'::jsonb)) = :'verified'::jsonb, 'A028 a retried tap verifies once');
call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d1', 'action', 'verify')),
  'A029 a draft is verified once', '%already verified%', 'PT409');

call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d2', 'action', 'discard', 'exclude', '[0]'::jsonb)),
  'A030 a discard takes no edits', '%no edits%', 'PT422');
select pg_temp.ok((public.verify_ai_draft(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d2', 'action', 'discard')) ->> 'status') = 'discarded',
  'A031 the clinician can discard a draft');
select pg_temp.ok((select status = 'discarded' and note_id is null from public.ai_drafts where id = :'d2')
  and (select count(*) from public.care_notes where pregnancy_id = :'p_lakshmi' and kind = 'ai_verified') = 1,
  'A032 a discarded draft adds nothing to the record');
call pg_temp.fails(format('select public.verify_ai_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'d2', 'action', 'verify')),
  'A033 a discarded draft cannot be verified later', '%already discarded%', 'PT409');
call pg_temp.fails(format('update public.ai_drafts set status = ''verified'' where id = %L', :'d2'),
  'A034 nobody updates ai_drafts directly', '%permission denied%', '42501');

reset role;
select pg_temp.ok((select count(*) from public.audit_log where entity_type = 'ai_drafts' and entity_id = :'d1'
                     and action in ('ai_draft_generated','ai_draft_verified')) = 2
  and exists (select 1 from public.audit_log where entity_id = :'d2' and action = 'ai_draft_discarded'),
  'A035 generating, verifying and discarding are audited');
select pg_temp.ok(not exists (select 1 from public.audit_log where entity_id in (:'d1', :'d2') and meta::text like '%Cardiology%'),
  'A036 the audit log holds no draft text');

-- ════════════════════════════════════════════════════════════════════════════════
-- save_capture_draft
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-000000000803', 'document_id', :'doc1', 'model', 'claude-sonnet-5-5',
  'fields', jsonb_build_array(
    jsonb_build_object('key', 'fhr', 'value', '144/min', 'confidence', 0.64),
    jsonb_build_object('key', 'bp', 'value', ' 128/82 ', 'confidence', 0.88),
    jsonb_build_object('key', 'albumin', 'value', 'Nil', 'confidence', 0.79)))::text as cap \gset

select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', :'cap'), 'C001 a family member cannot transcribe', '%Care Team%', 'PT403');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', :'cap'), 'C002 a paediatrician cannot transcribe an ANC card', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', :'cap'), 'C003 a clinician who cannot see her cannot transcribe', 'Not found', 'PT404');

select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'document_id', 'x', 'model', 'm', 'fields', '[]'::jsonb)),
  'C004 a malformed document id is not found', 'Not found', 'PT404');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'document_id', :'doc1', 'model', 'm',
  'fields', jsonb_build_array(jsonb_build_object('key', 'name', 'value', 'Lakshmi K', 'confidence', 0.9)))),
  'C005 only known ANC-card fields are kept', '%known key%', 'PT422');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'document_id', :'doc1', 'model', 'm',
  'fields', jsonb_build_array(jsonb_build_object('key', 'bp', 'value', '128/82', 'confidence', 1.5)))),
  'C006 confidence is between 0 and 1', '%known key%', 'PT422');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'document_id', :'doc1', 'model', 'm',
  'fields', jsonb_build_array(jsonb_build_object('key', 'bp', 'value', '128/82', 'confidence', '0.5')))),
  'C007 confidence is a number', '%known key%', 'PT422');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'document_id', :'doc1', 'model', 'm',
  'fields', jsonb_build_array(jsonb_build_object('key', 'bp', 'value', '128/82', 'confidence', 0.5), jsonb_build_object('key', 'bp', 'value', '130/80', 'confidence', 0.5)))),
  'C008 each field appears once', '%once%', 'PT422');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'document_id', :'doc1', 'model', 'm',
  'fields', jsonb_build_array(jsonb_build_object('key', 'bp', 'value', '128/82', 'confidence', 0.5, 'confirmed', true)))),
  'C009 the model cannot confirm a field', '%unexpected field(s) in field%', 'PT422');

select public.save_capture_draft(:'cap'::jsonb)::text as cap_out \gset
select pg_temp.ok((:'cap_out'::jsonb -> 'fields') = '[{"key": "bp", "label": "BP", "value": "128/82", "confidence": 0.88, "confirmed": false},
                                                      {"key": "albumin", "label": "Urine albumin", "value": "Nil", "confidence": 0.79, "confirmed": false},
                                                      {"key": "fhr", "label": "FHR", "value": "144/min", "confidence": 0.64, "confirmed": false}]'::jsonb,
  'C010 fields are labelled by the server, values kept as written, every one unconfirmed');
select pg_temp.ok((select fields = (:'cap_out'::jsonb -> 'fields') and confirmed_at is null from public.documents where id = :'doc1'),
  'C011 the draft is stored on the document');
select pg_temp.ok(public.save_capture_draft(:'cap'::jsonb) = :'cap_out'::jsonb, 'C012 a retry stores it once');
call pg_temp.fails(format('select public.save_capture_draft(%L::jsonb)', jsonb_set(:'cap'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k()))
  || jsonb_build_object('document_id', :'doc2')), 'C013 a confirmed document cannot be re-transcribed', '%already confirmed%', 'PT409');

reset role;
select pg_temp.ok(exists (select 1 from public.audit_log where entity_type = 'documents' and entity_id = :'doc1' and action = 'capture_transcribed'
                          and meta::text not like '%128/82%'),
  'C014 transcription is audited without the values');

-- ════════════════════════════════════════════════════════════════════════════════
-- ai_quota: checked before any model call (role, visibility, per-clinician and project caps)
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.ai_quota(%L::jsonb)', jsonb_build_object('fn', 'ai-brief', 'pregnancy_id', :'p_lakshmi')),
  'Q001 a family member gets no AI call', '%Care Team%', 'PT403');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.ai_quota(%L::jsonb)', jsonb_build_object('fn', 'ai-brief', 'pregnancy_id', :'p_lakshmi')),
  'Q002 the wrong role is refused before the model is asked', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.ai_quota(%L::jsonb)', jsonb_build_object('fn', 'ai-brief', 'pregnancy_id', :'p_lakshmi')),
  'Q003 a record she cannot see is refused before the model is asked', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.ai_quota(%L::jsonb)', jsonb_build_object('fn', 'chat', 'pregnancy_id', :'p_lakshmi')),
  'Q004 only the two AI functions are counted', '%fn must be%', 'PT422');
call pg_temp.fails(format('select public.ai_quota(%L::jsonb)', jsonb_build_object('fn', 'ai-brief', 'pregnancy_id', :'p_lakshmi', 'n', 1)),
  'Q005 unknown fields are refused', '%unexpected field(s)%', 'PT422');
select pg_temp.ok((public.ai_quota(jsonb_build_object('fn', 'ai-brief', 'pregnancy_id', :'p_lakshmi')) ->> 'left_this_hour')::int = 5,
  'Q006 the first call is allowed and counted');
select public.ai_quota(jsonb_build_object('fn', 'capture-transcribe', 'pregnancy_id', :'p_lakshmi')) from generate_series(1, 5);
call pg_temp.fails(format('select public.ai_quota(%L::jsonb)', jsonb_build_object('fn', 'ai-brief', 'pregnancy_id', :'p_lakshmi')),
  'Q007 the 7th call in an hour is refused', '%used your AI drafts%', 'PT429');
call pg_temp.fails('select count(*) from app.ai_calls', 'Q008 the call log is not readable by app users', '%permission denied%', '42501');
reset role;
select pg_temp.ok((select count(*) = 6 from app.ai_calls where staff_id = :'s_priya'), 'Q009 refused calls are not counted');
insert into app.ai_calls (staff_id, fn, at) select :'s_arjun', 'ai-brief', now() - interval '30 seconds' from generate_series(1, 2);
set local role authenticated;
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.ai_quota(%L::jsonb)', jsonb_build_object('fn', 'ai-brief', 'baby_id', :'b_meena')),
  'Q010 the project-wide per-minute cap applies to everyone', '%busy%', 'PT429');
reset role;

select format('  080_ai: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
