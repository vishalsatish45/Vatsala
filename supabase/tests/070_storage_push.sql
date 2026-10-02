-- Storage policies (voice notes, paper records), capture RPCs, emergency access by MCH id, scheduled jobs
-- (reminders, call-back escalation, staff digest). Uploads are simulated the way Supabase Storage does them: an
-- INSERT into storage.objects as the signed-in user, so the row-level policies decide. Called as real users.
-- Rolled back; synthetic data only.
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
-- An upload as Storage performs it.
create function pg_temp.upload(b text, n text) returns text language sql as $$
  select format('insert into storage.objects (bucket_id, name, owner) values (%L, %L, %L)', b, n, auth.uid())
$$;
create function pg_temp.sees(b text, n text) returns int language sql as $$
  select count(*)::int from storage.objects where bucket_id = b and name = n
$$;
grant execute on function pg_temp.upload(text, text), pg_temp.sees(text, text) to authenticated;

\ir _fixtures.psql
-- Ravi (Lakshmi's caregiver) has accepted the notice, without app reminders.
insert into public.consents (user_id, mother_id, notice_version, lang, purposes, decision) values
  (:'ravi', :'m_lakshmi', 'v1', 'kn', '{app}', 'accepted');
select id as cg_ravi from public.caregivers where mother_id = :'m_lakshmi' and user_id = :'ravi' \gset
select (now() at time zone 'Asia/Kolkata')::date + 1 as tomorrow \gset

set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Buckets
-- ════════════════════════════════════════════════════════════════════════════════
reset role;
select pg_temp.ok((select count(*) from storage.buckets where id in ('voice-notes','documents') and not public
                   and file_size_limit is not null and allowed_mime_types is not null) = 2,
  'S001 both buckets exist, private, with size and type pinned');
select pg_temp.ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                              and cmd in ('UPDATE','DELETE','ALL')),
  'S002 no UPDATE / DELETE policy: an uploaded file can never be replaced or removed by an app user');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Voice notes: the mother's own call-back
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'lakshmi_u');
select public.request_callback(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8070-0000000000c1',
  'signs', '["bleeding"]'::jsonb, 'voice_seconds', 20))::text as cb1 \gset
select substr(:'cb1'::jsonb ->> 'voice_path', length('voice-notes/') + 1) as v1 \gset
select pg_temp.ok(:'v1' = :'m_lakshmi' || '/00000000-0000-4000-8070-0000000000c1.m4a',
  'S003 the server chooses the path: voice-notes/<mother>/<call-back>.m4a');

select pg_temp.as_user(:'meena_u');
call pg_temp.fails(pg_temp.upload('voice-notes', :'v1'), 'S004 another family cannot upload to her call-back', '%row-level security%', '42501');
select pg_temp.as_user(:'ravi');
call pg_temp.fails(pg_temp.upload('voice-notes', :'v1'), 'S005 her caregiver cannot upload to a call-back he did not make', '%row-level security%', '42501');
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.upload('voice-notes', :'v1'), 'S006 staff cannot upload a family voice note', '%row-level security%', '42501');
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(pg_temp.upload('voice-notes', :'m_meena' || '/00000000-0000-4000-8070-0000000000c1.m4a'),
  'S007 not under another mother''s folder', '%row-level security%', '42501');
call pg_temp.fails(pg_temp.upload('voice-notes', :'m_lakshmi' || '/' || gen_random_uuid() || '.m4a'),
  'S008 not to a path no call-back named', '%row-level security%', '42501');
call pg_temp.fails(pg_temp.upload('documents', :'v1'), 'S009 not into another bucket', '%row-level security%', '42501');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 0, 'S010 nothing there before the upload');
select pg_temp.upload('voice-notes', :'v1') as up \gset
:up;
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 1, 'S011 the requester uploads to the path she was given, and can play it back');
call pg_temp.fails(pg_temp.upload('voice-notes', :'v1'), 'S012 only once: a second upload to the same path is refused', '%duplicate key%');
with u as (update storage.objects set name = name || '.x' where bucket_id = 'voice-notes' returning 1) select count(*) as n_upd from u \gset
with d as (delete from storage.objects where bucket_id = 'voice-notes' returning 1) select count(*) as n_del from d \gset
select pg_temp.ok(:n_upd = 0 and :n_del = 0, 'S013 she can neither rename nor delete it');

-- Who may listen
select pg_temp.as_user(:'priya');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 1, 'S014 her treating obstetrician can play it (signed URL)');
select pg_temp.as_user(:'neha');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 0, 'S015 an obstetrician of another unit (wrong mother) cannot');
select pg_temp.as_user(:'kiran');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 0, 'S016 a specialist with only a referral (no care access) cannot');
select pg_temp.as_user(:'arjun');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 0, 'S017 the paediatric team before 34 weeks cannot');
select pg_temp.as_user(:'other');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 0, 'S018 a doctor of another hospital cannot');
select pg_temp.as_user(:'meena_u');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 0, 'S019 another family cannot');
select pg_temp.as_user(:'ravi');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 0, 'S020 a caregiver cannot hear a note he did not record');

-- ════════════════════════════════════════════════════════════════════════════════
-- Voice notes: a caregiver's call-backs
-- ════════════════════════════════════════════════════════════════════════════════
select public.request_callback(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8070-0000000000c2',
  'mother_id', :'m_lakshmi', 'signs', '[]'::jsonb, 'voice_seconds', 12))::text as cb2 \gset
select substr(:'cb2'::jsonb ->> 'voice_path', length('voice-notes/') + 1) as v2 \gset
select public.request_callback(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8070-0000000000c3',
  'mother_id', :'m_lakshmi', 'signs', '[]'::jsonb, 'voice_seconds', 8))::text as cb3 \gset
select substr(:'cb3'::jsonb ->> 'voice_path', length('voice-notes/') + 1) as v3 \gset
select pg_temp.upload('voice-notes', :'v2') as up \gset
:up;
select pg_temp.ok(pg_temp.sees('voice-notes', :'v2') = 1, 'S021 a consented caregiver uploads his own call-back''s voice note and can play it');
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(pg_temp.upload('voice-notes', :'v3'), 'S022 the mother cannot upload into her caregiver''s call-back', '%row-level security%', '42501');

-- ════════════════════════════════════════════════════════════════════════════════
-- Scheduled jobs (called directly; pg_cron schedules them on Supabase only)
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
call pg_temp.fails('select app.job_reminders()', 'S023 jobs are not callable from the app', '%permission denied%', '42501');
call pg_temp.fails('select app.job_staff_digest()', 'S024 …none of them', '%permission denied%', '42501');
reset role;
delete from public.notifications;
insert into public.tasks (id, mother_id, pregnancy_id, baby_id, kind, title, due_from, due_by, generated_by) values
  ('00000000-0000-4000-8070-0000000000a1', :'m_lakshmi', :'p_lakshmi', null, 'anc_visit', 'ANC visit · tomorrow', :'tomorrow', (:'tomorrow'::date + 2), 'protocol'),
  ('00000000-0000-4000-8070-0000000000a2', :'m_lakshmi', :'p_lakshmi', null, 'anc_visit', 'ANC visit · later', (:'tomorrow'::date + 5), (:'tomorrow'::date + 7), 'protocol'),
  ('00000000-0000-4000-8070-0000000000a3', :'m_meena', null, :'b_meena', 'nb_visit', 'Newborn check · tomorrow', null, :'tomorrow', 'protocol');
insert into public.immunizations (mother_id, pregnancy_id, baby_id, code, due_on) values
  (:'m_lakshmi', :'p_lakshmi', null, 'td1', :'tomorrow'),
  (:'m_meena', null, :'b_meena', 'bcg', :'tomorrow');
select app.job_reminders(now()) as sent \gset
select pg_temp.ok(exists (select 1 from public.notifications where user_id = :'lakshmi_u' and kind = 'visit_reminder'
                          and target_type = 'task' and target_id = '00000000-0000-4000-8070-0000000000a1')
  and exists (select 1 from public.notifications where user_id = :'lakshmi_u' and kind = 'vaccine_reminder'
              and target_type = 'pregnancy' and target_id = :'p_lakshmi'),
  'S025 the consented mother is reminded of tomorrow''s visit and Td dose (task / pregnancy ids only)');
select pg_temp.ok(not exists (select 1 from public.notifications where target_id = '00000000-0000-4000-8070-0000000000a2'),
  'S026 a visit not due tomorrow is not reminded');
select pg_temp.ok(not exists (select 1 from public.notifications where user_id = :'ravi'),
  'S027 a caregiver who did not choose app reminders gets none');
select pg_temp.ok(not exists (select 1 from public.notifications where user_id = :'meena_u'),
  'S028 a mother without app consent gets no reminders (her baby''s visit and BCG)');
select pg_temp.ok(app.job_reminders(now()) = 0 and app.job_reminders(now() + interval '3 hours') = 0
  and (select count(*) from public.notifications where kind like '%reminder') = :sent,
  'S029 re-running the job the same day adds nothing');
update public.consents set withdrawn_at = now(), withdrawn_reason = 'Replaced' where user_id = :'ravi' and withdrawn_at is null;
insert into public.consents (user_id, mother_id, notice_version, lang, purposes, decision) values
  (:'ravi', :'m_lakshmi', 'v1', 'kn', '{app,reminders_app}', 'accepted');
select app.job_reminders(now()) as sent2 \gset
select pg_temp.ok(:sent2 = 2 and (select count(*) from public.notifications where user_id = :'ravi') = 2,
  'S030 a caregiver with app reminders and the Schedule scope is reminded too');
update public.caregivers set scope_schedule = false where id = :'cg_ravi';
delete from public.notifications where user_id = :'ravi';
select pg_temp.ok(app.job_reminders(now()) = 0, 'S031 …but not without the Schedule scope');
update public.caregivers set scope_schedule = true where id = :'cg_ravi';
select pg_temp.ok(not exists (select 1 from public.notifications where params <> '{}'), 'S032 reminders carry no names or clinical detail');

-- Call-back escalation
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.close_callback(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8070-0000000000c3', 'outcome', 'information_given'));
reset role;
select pg_temp.ok(app.job_callback_escalation(now()) = 0, 'S033 a call-back younger than 30 minutes is not escalated');
select pg_temp.ok(app.job_callback_escalation(now() + interval '31 minutes') = 2, 'S034 the two open call-backs are escalated after 30 minutes');
select pg_temp.ok(exists (select 1 from public.notifications where user_id = :'priya' and kind = 'callback_waiting'
                          and target_type = 'callback' and target_id = '00000000-0000-4000-8070-0000000000c1')
  and exists (select 1 from public.notifications where user_id = :'meera' and kind = 'callback_waiting'
              and target_id = '00000000-0000-4000-8070-0000000000c1'),
  'S035 the whole treating team (primary and unit members) hears again');
select pg_temp.ok(not exists (select 1 from public.notifications where kind = 'callback_waiting'
                              and target_id = '00000000-0000-4000-8070-0000000000c3')
  and not exists (select 1 from public.notifications where kind = 'callback_waiting' and user_id in (:'neha', :'kiran', :'lakshmi_u')),
  'S036 a closed call-back is not escalated; nobody outside the team is told');
select pg_temp.ok(app.job_callback_escalation(now() + interval '2 hours') = 0, 'S037 once per call-back');

-- Staff digest
select app.job_staff_digest(now()) as digests \gset
select pg_temp.ok(:digests >= 4
  and (select count(*) from public.notifications where kind = 'daily_digest' and user_id in (:'priya', :'neha', :'arjun', :'kiran')) = 4,
  'S038 one digest per clinician with patients in care (obstetric units, paediatrics, a department with an open referral)');
select pg_temp.ok(not exists (select 1 from public.notifications where kind = 'daily_digest' and user_id in (:'other', :'lakshmi_u')),
  'S039 no digest for a clinician without a workload or for a family');
select pg_temp.ok(app.job_staff_digest(now() + interval '1 minute') = 0, 'S040 once per day (re-run the same day)');
select pg_temp.ok(not exists (select 1 from public.notifications where params <> '{}'), 'S041 no notification carries content');

-- ════════════════════════════════════════════════════════════════════════════════
-- Voice notes after the caregiver is removed
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
select public.request_callback(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8070-0000000000c4',
  'signs', '[]'::jsonb, 'voice_seconds', 5))::text as cb4 \gset
select public.revoke_caregiver(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'cg_ravi'));
select pg_temp.as_user(:'ravi');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v2') = 0, 'S042 a removed caregiver can no longer hear his own voice note');
reset role;
select pg_temp.ok((select count(*) from storage.objects where name = :'v2') = 1, 'S043 …which stays with the hospital');
-- A call-back he made before removal, voice note not yet uploaded:
insert into public.callbacks (id, mother_id, requested_by, requested_by_label, channel, signs, voice_path, voice_seconds, at)
values ('00000000-0000-4000-8070-0000000000c5', :'m_lakshmi', :'ravi', 'caregiver: Ravi K (husband)', 'app', '{}',
        'voice-notes/' || :'m_lakshmi' || '/00000000-0000-4000-8070-0000000000c5.m4a', 5, now());
set local role authenticated;
select pg_temp.as_user(:'ravi');
call pg_temp.fails(pg_temp.upload('voice-notes', :'m_lakshmi' || '/00000000-0000-4000-8070-0000000000c5.m4a'),
  'S044 a removed caregiver cannot upload, even to his own call-back', '%row-level security%', '42501');
select pg_temp.as_user(:'priya');
select pg_temp.ok(pg_temp.sees('voice-notes', :'v2') = 1, 'S045 the treating team still hears it');

-- ════════════════════════════════════════════════════════════════════════════════
-- Paper records: create_document → upload → confirm_capture
-- ════════════════════════════════════════════════════════════════════════════════
select jsonb_build_object('idempotency_key', '00000000-0000-4000-a070-0000000000d1', 'id', '00000000-0000-4000-8070-0000000000d1',
  'pregnancy_id', :'p_lakshmi', 'kind', 'anc_card', 'mime', 'image/jpeg')::text as doc_req \gset
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.create_document(%L::jsonb)', :'doc_req'), 'S046 a family cannot open a capture', '%Care Team%', 'PT403');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.create_document(%L::jsonb)', :'doc_req'), 'S047 a paediatrician cannot capture a maternal record', '%role%', 'PT403');
select pg_temp.as_user(:'kiran');
call pg_temp.fails(format('select public.create_document(%L::jsonb)', :'doc_req'), 'S048 nor a specialist', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.create_document(%L::jsonb)', :'doc_req'), 'S049 another unit''s obstetrician: not found', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.create_document(%L::jsonb)', jsonb_set(:'doc_req'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k())) || '{"storage_path":"x"}'),
  'S050 the client cannot choose the path', '%unexpected field(s)%', 'PT422');
call pg_temp.fails(format('select public.create_document(%L::jsonb)', jsonb_set(jsonb_set(:'doc_req'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k())), '{mime}', '"text/html"')),
  'S051 only photos and PDFs', '%JPEG%', 'PT422');
select public.create_document(:'doc_req'::jsonb)::text as doc \gset
select pg_temp.ok(:'doc'::jsonb ->> 'storage_path' = 'documents/' || :'m_lakshmi' || '/00000000-0000-4000-8070-0000000000d1.jpg'
  and public.create_document(:'doc_req'::jsonb) = :'doc'::jsonb,
  'S052 the server chooses documents/<mother>/<document>.jpg; a retry returns the same answer');
select substr(:'doc'::jsonb ->> 'storage_path', length('documents/') + 1) as d1 \gset

select pg_temp.as_user(:'meera');
call pg_temp.fails(pg_temp.upload('documents', :'d1'), 'S053 a colleague who did not open the capture cannot upload', '%row-level security%', '42501');
select pg_temp.as_user(:'neha');
call pg_temp.fails(pg_temp.upload('documents', :'d1'), 'S054 nor another unit''s doctor', '%row-level security%', '42501');
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(pg_temp.upload('documents', :'d1'), 'S055 nor the family', '%row-level security%', '42501');
select pg_temp.as_user(:'priya');
call pg_temp.fails(pg_temp.upload('documents', replace(:'d1', '.jpg', '.png')), 'S056 only the exact server-chosen path', '%row-level security%', '42501');
select pg_temp.upload('documents', :'d1') as up \gset
:up;
call pg_temp.fails(pg_temp.upload('documents', :'d1'), 'S057 the photo is uploaded once', '%duplicate key%');
select pg_temp.ok(pg_temp.sees('documents', :'d1') = 1, 'S058 the capturing clinician sees the photo');
select pg_temp.as_user(:'meera');
select pg_temp.ok(pg_temp.sees('documents', :'d1') = 1, 'S059 her obstetric team sees it');
select pg_temp.as_user(:'kiran');
select pg_temp.ok(pg_temp.sees('documents', :'d1') = 1, 'S060 the department she is referred to sees it, like the document row');
select pg_temp.as_user(:'neha');
select pg_temp.ok(pg_temp.sees('documents', :'d1') = 0, 'S061 another unit does not');
select pg_temp.as_user(:'other');
select pg_temp.ok(pg_temp.sees('documents', :'d1') = 0, 'S062 another hospital does not');
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok(pg_temp.sees('documents', :'d1') = 0, 'S063 families never read stored documents');

-- A specialist whose referral window has closed
select pg_temp.as_user(:'neha');
select public.create_document(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8070-0000000000d2',
  'pregnancy_id', :'p_sunita', 'kind', 'lab_report', 'mime', 'application/pdf'))::text as doc2 \gset
select substr(:'doc2'::jsonb ->> 'storage_path', length('documents/') + 1) as d2 \gset
select pg_temp.upload('documents', :'d2') as up \gset
:up;
select pg_temp.as_user(:'kiran');
select pg_temp.ok(pg_temp.sees('documents', :'d2') = 0, 'S064 a specialist 40 days after the referral closed does not see it');
select pg_temp.as_user(:'priya');
select pg_temp.ok(pg_temp.sees('documents', :'d2') = 0, 'S065 an expired override gives nothing');

-- Confirm
select jsonb_build_object('idempotency_key', '00000000-0000-4000-a070-0000000000e1', 'document_id', '00000000-0000-4000-8070-0000000000d1',
  'encounter_id', '00000000-0000-4000-8070-0000000000e1',
  'fields', jsonb_build_array(
    jsonb_build_object('key', 'weight', 'label', 'Weight', 'value', '61 kg', 'confidence', 0.93, 'confirmed', true),
    jsonb_build_object('key', 'bp', 'label', 'BP', 'value', '128/82', 'confidence', 0.88, 'confirmed', true),
    jsonb_build_object('key', 'fhr', 'label', 'FHR', 'value', '144', 'confidence', 0.64, 'confirmed', false)),
  'observations', jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 61),
    jsonb_build_object('code', 'bp_sys', 'value_num', 128), jsonb_build_object('code', 'bp_dia', 'value_num', 82)),
  'checklist', jsonb_build_array(jsonb_build_object('component', 'weight', 'state', 'done'), jsonb_build_object('component', 'bp', 'state', 'done')))::text as conf \gset
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.confirm_capture(%L::jsonb)', :'conf'), 'S066 another unit cannot confirm her record', 'Not found', 'PT404');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.confirm_capture(%L::jsonb)', jsonb_set(:'conf'::jsonb, '{document_id}', to_jsonb(gen_random_uuid()))),
  'S067 an unknown document is not found', 'Not found', 'PT404');
call pg_temp.fails(format('select public.confirm_capture(%L::jsonb)', jsonb_set(jsonb_set(:'conf'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k())),
  '{fields}', '[{"key":"bp","label":"BP","value":"128/82","confidence":0.9,"confirmed":false}]')),
  'S068 nothing unconfirmed enters the record', '%Confirm at least one%', 'PT422');
call pg_temp.fails(format('select public.confirm_capture(%L::jsonb)', jsonb_set(jsonb_set(:'conf'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k())),
  '{fields,0,confidence}', '"high"')), 'S069 fields are typed', '%confidence%', 'PT422');
call pg_temp.fails(format('select public.confirm_capture(%L::jsonb)', jsonb_set(jsonb_set(:'conf'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k())),
  '{fields,0,extra}', '"x"')), 'S070 unknown field keys are refused', '%unexpected field(s) in fields%', 'PT422');
select public.confirm_capture(:'conf'::jsonb)::text as conf_out \gset
select pg_temp.ok(public.confirm_capture(:'conf'::jsonb) = :'conf_out'::jsonb, 'S071 a retry confirms once');
call pg_temp.fails(format('select public.confirm_capture(%L::jsonb)', jsonb_set(:'conf'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k()))),
  'S072 a confirmed record is final', '%already confirmed%', 'PT409');
reset role;
select pg_temp.ok((select source = 'capture' and kind = 'anc' and document_id = '00000000-0000-4000-8070-0000000000d1' and by_staff = :'s_priya'
                   and ga_days is not null from public.encounters where id = '00000000-0000-4000-8070-0000000000e1')
  and (select count(*) from public.observations where encounter_id = '00000000-0000-4000-8070-0000000000e1') = 3
  and (select count(*) from public.encounter_checklist where encounter_id = '00000000-0000-4000-8070-0000000000e1') = 2,
  'S073 the confirmed fields become an ANC visit from the paper record, linked to its document');
select pg_temp.ok((select confirmed_by = :'s_priya' and confirmed_at is not null and jsonb_array_length(fields) = 3
                   from public.documents where id = '00000000-0000-4000-8070-0000000000d1'),
  'S074 the document keeps the checked transcription and who confirmed it');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'capture_confirmed' and entity_id = '00000000-0000-4000-8070-0000000000d1'),
  'S075 the confirmation is audited');

-- A baby's paper record (paediatrician)
set local role authenticated;
select pg_temp.as_user(:'arjun');
select public.create_document(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8070-0000000000d3',
  'baby_id', :'b_meena', 'kind', 'other', 'mime', 'image/png'))::text as doc3 \gset
call pg_temp.fails(format('select public.confirm_capture(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'document_id', '00000000-0000-4000-8070-0000000000d3', 'fields', '[{"key":"w","label":"Weight","value":"3000 g","confidence":0.9,"confirmed":true}]'::jsonb,
  'checklist', '[{"component":"weight","state":"done"}]'::jsonb)), 'S076 no ANC checklist on a baby', '%pregnancy%', 'PT422');
select public.confirm_capture(jsonb_build_object('idempotency_key', pg_temp.k(), 'document_id', '00000000-0000-4000-8070-0000000000d3',
  'encounter_id', '00000000-0000-4000-8070-0000000000e3',
  'fields', '[{"key":"w","label":"Weight","value":"3000 g","confidence":0.9,"confirmed":true}]'::jsonb,
  'observations', '[{"code":"nb_weight","value_num":3000}]'::jsonb));
reset role;
select pg_temp.ok((select kind = 'newborn' and baby_id = :'b_meena' and source = 'capture' from public.encounters where id = '00000000-0000-4000-8070-0000000000e3'),
  'S077 a baby''s paper record becomes a newborn check');
select pg_temp.ok(:'doc3'::jsonb ->> 'storage_path' like 'documents/' || :'m_meena' || '/%.png', 'S078 a baby''s document is filed under its mother');

-- ════════════════════════════════════════════════════════════════════════════════
-- Emergency access by MCH id
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'neha');
select pg_temp.ok((select count(*) from public.pregnancies where id = :'p_lakshmi') = 0, 'S079 before: another unit cannot see her');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'mother_id', :'m_lakshmi', 'mch_id', 'MCH-2026-000101', 'reason', 'Labour room')), 'S080 not both mother_id and mch_id', '%either%', 'PT422');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'reason', 'Labour room')),
  'S081 one of them is required', '%either%', 'PT422');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'mch_id', 'MCH-2026-999999', 'reason', 'Labour room')), 'S082 an unknown MCH id is not found', 'Not found', 'PT404');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'mch_id', 'MCH-2026-000101')), 'S083 a reason is required', '%needs a reason%', 'PT422');
select public.grant_override(jsonb_build_object('idempotency_key', '00000000-0000-4000-a070-0000000000f1',
  'mch_id', 'mch-2026-000101', 'reason', 'Labour room, no card'))::text as ovr \gset
select pg_temp.ok(:'ovr'::jsonb ->> 'mother_id' = :'m_lakshmi' and :'ovr'::jsonb ->> 'pregnancy_id' = :'p_lakshmi'
  and (:'ovr'::jsonb ->> 'override_id') is not null and (:'ovr'::jsonb ->> 'expires_at')::timestamptz > now() + interval '23 hours',
  'S084 by MCH id: returns override, expiry, mother and pregnancy');
select pg_temp.ok((select count(*) from public.pregnancies where id = :'p_lakshmi') = 1, 'S085 …and opens her record at once');
select pg_temp.ok(public.grant_override(jsonb_build_object('idempotency_key', '00000000-0000-4000-a070-0000000000f1',
  'mch_id', 'mch-2026-000101', 'reason', 'Labour room, no card')) = :'ovr'::jsonb, 'S086 a retry grants once');
select pg_temp.as_user(:'other');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'mch_id', 'MCH-2026-000101', 'reason', 'x')), 'S087 another hospital''s doctor: not found (same as unknown)', 'Not found', 'PT404');
select pg_temp.as_user(:'meera');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'mch_id', 'MCH-2026-000106', 'reason', 'x')), 'S088 never on her own record', 'Not found', 'PT404');
select pg_temp.as_user(:'kiran');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'mch_id', 'MCH-2026-000102', 'reason', 'x')), 'S089 a specialist cannot break the glass', '%role%', 'PT403');
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.grant_override(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'mch_id', 'MCH-2026-000102', 'reason', 'x')), 'S090 nor a family', '%Care Team%', 'PT403');
select pg_temp.as_user(:'arjun');
select public.grant_override(jsonb_build_object('idempotency_key', pg_temp.k(), 'mother_id', :'m_sunita', 'reason', 'Neonatal consult'))::text as ovr2 \gset
select pg_temp.ok(:'ovr2'::jsonb ->> 'pregnancy_id' = :'p_sunita' and :'ovr2'::jsonb ->> 'mother_id' = :'m_sunita',
  'S091 by mother_id still works and names her pregnancy at this hospital');

-- ════════════════════════════════════════════════════════════════════════════════
-- Push tokens
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails('select public.register_push_token(''{"token":"<script>","platform":"android"}'')', 'S095 only Expo push tokens are stored', '%Expo push token%', 'PT422');
call pg_temp.fails('select public.register_push_token(''{"token":"ExponentPushToken[demo-070]","platform":"web"}'')', 'S096 only phone platforms', '%platform%', 'PT422');
select public.register_push_token('{"token":"ExponentPushToken[demo-070]","platform":"android"}');
select pg_temp.as_user(:'meena_u');
select pg_temp.ok((public.unregister_push_token('{"token":"ExponentPushToken[demo-070]"}') ->> 'removed')::int = 0,
  'S097 nobody can remove another person''s token');
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok((select count(*) from public.push_tokens where token = 'ExponentPushToken[demo-070]') = 1
  and (public.unregister_push_token('{"token":"ExponentPushToken[demo-070]"}') ->> 'removed')::int = 1,
  'S098 sign-out removes her own token');
select pg_temp.ok((select count(*) from public.push_tokens where token = 'ExponentPushToken[demo-070]') = 0, 'S099 …and it is gone');

-- ════════════════════════════════════════════════════════════════════════════════
-- Withdrawn consent
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'lakshmi_u');
select public.withdraw_consent(jsonb_build_object('idempotency_key', pg_temp.k()));
select pg_temp.ok(pg_temp.sees('voice-notes', :'v1') = 0, 'S092 after withdrawing consent she can no longer play her voice note');
call pg_temp.fails(pg_temp.upload('voice-notes', substr(:'cb4'::jsonb ->> 'voice_path', length('voice-notes/') + 1)),
  'S093 …nor upload one', '%row-level security%', '42501');
reset role;
delete from public.notifications;
select pg_temp.ok(app.job_reminders(now()) = 0, 'S094 no reminders after consent is withdrawn and the caregiver is removed');

select format('  070_storage_push: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
