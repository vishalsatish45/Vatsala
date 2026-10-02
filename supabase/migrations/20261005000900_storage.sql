-- Storage: private buckets for family voice notes and photographed paper
-- records, row-level policies on storage.objects, and the two capture RPCs.
--
--   voice-notes/<mother_id>/<callback_id>.m4a   path chosen by request_callback (callbacks.voice_path)
--   documents/<mother_id>/<document_id>.<ext>   path chosen by create_document (documents.storage_path)
--
-- Object names inside a bucket omit the bucket: callbacks.voice_path = 'voice-notes/' || storage.objects.name.
-- Uploads: only the person the row was created for, only to that exact path, only once (unique bucket + name; no
-- UPDATE or DELETE policy, so an upload can never overwrite or remove a file). Reads: signed URLs only — the app
-- asks Storage for a short-lived URL, which Storage grants only when the SELECT policy below lets this user see
-- the object. Storage keys are never shown on screen.
--
-- Supabase owns the storage schema (the laptop shim recreates a minimal copy); this migration only adds rows to
-- storage.buckets and policies to storage.objects, so it runs unchanged on both.

-- ════════════════════════════════════════════════════════════════════════════════
-- Buckets (private; size and type pinned)
-- ════════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('voice-notes', 'voice-notes', false, 5242880, array['audio/mp4','audio/m4a','audio/x-m4a','audio/aac']),
  ('documents',   'documents',   false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;

-- ════════════════════════════════════════════════════════════════════════════════
-- Policy helpers
-- ════════════════════════════════════════════════════════════════════════════════

-- True when the caller may still act for this mother in the Family face (her own consented login, or an active,
-- consented caregiver with the mother's sharing consent) — app.family_actor's rules, as a yes/no.
-- security definer: reads mothers / caregivers / consents, which families cannot read.
create function app.family_can_act(p_mother uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.family_actor(p_mother);
  return true;
exception when others then
  return false;
end $$;

-- Upload a voice note: the requester of that call-back, while she may still act for the mother.
-- security definer: families cannot read callbacks; the check is on the caller's own request only.
create function app.can_upload_voice(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.callbacks c
                 where c.voice_path = 'voice-notes/' || p_name
                   and c.requested_by = (select auth.uid())
                   and app.family_can_act(c.mother_id))
$$;

-- Listen to a voice note: treating staff of that mother (not referral specialists — the same rule as reading
-- call-backs), or the requester herself while she may still act for the mother.
create function app.can_read_voice(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.callbacks c
                 where c.voice_path = 'voice-notes/' || p_name
                   and (c.mother_id in (select app.care_mother_ids())
                        or (c.requested_by = (select auth.uid()) and app.family_can_act(c.mother_id))))
$$;

-- Upload a paper-record photo: the clinician who created the document row, while she can still see its subject.
create function app.can_upload_document(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.documents d
                 where d.storage_path = 'documents/' || p_name
                   and d.captured_by = (select app.my_staff_id())
                   and app.can_see_subject(d.pregnancy_id, d.baby_id))
$$;

-- View a paper-record photo: whoever may read the document row (the documents read policy, 20261005000200).
create function app.can_read_document(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.documents d
                 where d.storage_path = 'documents/' || p_name
                   and (d.mother_id in (select app.full_mother_ids())
                        or coalesce(d.pregnancy_id, d.baby_id) in (select app.subject_ids())))
$$;

create index callbacks_voice_path on public.callbacks(voice_path) where voice_path is not null;
create index documents_storage_path on public.documents(storage_path) where storage_path is not null;

-- ════════════════════════════════════════════════════════════════════════════════
-- Policies on storage.objects (INSERT and SELECT only; no UPDATE / DELETE for API users)
-- ════════════════════════════════════════════════════════════════════════════════

create policy vatsala_voice_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'voice-notes' and app.can_upload_voice(name));
create policy vatsala_voice_read on storage.objects for select to authenticated
  using (bucket_id = 'voice-notes' and app.can_read_voice(name));
create policy vatsala_document_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and app.can_upload_document(name));
create policy vatsala_document_read on storage.objects for select to authenticated
  using (bucket_id = 'documents' and app.can_read_document(name));

-- ════════════════════════════════════════════════════════════════════════════════
-- Paper-record capture (PRD F-31): create_document → upload the photo → confirm_capture
-- ════════════════════════════════════════════════════════════════════════════════

-- Opens a capture: the server chooses the storage path from the mime type. Without a mime type (the demo's sample
-- card, no photo) the document has no file and no path.
create function public.create_document(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  v_id uuid := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  m uuid;
  ext text;
  path text;
begin
  perform app.only_keys(p, array['idempotency_key','id','pregnancy_id','baby_id','kind','mime']);
  prior := app.idem_begin('create_document', p);
  if prior is not null then return prior; end if;

  s := app.require_writer(v_preg, v_baby);
  m := coalesce((select mother_id from public.pregnancies where id = v_preg), (select mother_id from public.babies where id = v_baby));
  if p ->> 'mime' is not null then
    ext := case p ->> 'mime' when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp'
                             when 'application/pdf' then 'pdf' end;
    if ext is null then
      raise exception 'A paper record is a JPEG, PNG or WebP photo, or a PDF' using errcode = 'PT422';
    end if;
    path := 'documents/' || m || '/' || v_id || '.' || ext;
  end if;
  begin
    insert into public.documents (id, mother_id, pregnancy_id, baby_id, kind, storage_path, mime, captured_by, captured_at)
    values (v_id, m, v_preg, v_baby, coalesce(p ->> 'kind', 'anc_card'), path, p ->> 'mime', s.id, now());
  exception when unique_violation then
    raise exception 'This document already exists' using errcode = 'PT409';
  end;
  return app.idem_finish(p, jsonb_build_object('document_id', v_id, 'storage_path', path));
end $$;

-- Saves the clinician-checked transcription on the document and records ONLY the confirmed fields as an encounter
-- (source 'capture', linked to the document): an ANC visit for a pregnancy, a newborn check for a baby. The values
-- are stored as entered and never interpreted. A confirmed document is final (trigger documents_confirmed_final).
create function public.confirm_capture(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  d public.documents;
  g public.pregnancies;
  e public.encounters;
  t timestamptz;
  ga int;
  n_confirmed int;
  n_obs int;
begin
  perform app.only_keys(p, array['idempotency_key','document_id','encounter_id','at','fields','observations','checklist']);
  perform app.only_keys_each(p -> 'fields', array['key','label','value','confidence','confirmed'], 'fields');
  perform app.only_keys_each(p -> 'observations', array['code','value_num','value_text','unit'], 'observations');
  perform app.only_keys_each(p -> 'checklist', array['component','state','reason'], 'checklist');
  prior := app.idem_begin('confirm_capture', p);
  if prior is not null then return prior; end if;

  select * into d from public.documents where id = (p ->> 'document_id')::uuid for update;
  if d.id is null then perform app.not_visible(); end if;
  s := app.require_writer(d.pregnancy_id, d.baby_id);
  if d.confirmed_at is not null then
    raise exception 'This paper record was already confirmed' using errcode = 'PT409';
  end if;

  -- Every field is a {key, label, value, confidence 0–1, confirmed} with the right types.
  if jsonb_typeof(p -> 'fields') is distinct from 'array' or jsonb_array_length(p -> 'fields') = 0
     or jsonb_array_length(p -> 'fields') > 60
     or exists (select 1 from jsonb_array_elements(p -> 'fields') f
                where jsonb_typeof(f -> 'key') is distinct from 'string' or jsonb_typeof(f -> 'label') is distinct from 'string'
                   or jsonb_typeof(f -> 'value') is distinct from 'string' or jsonb_typeof(f -> 'confidence') is distinct from 'number'
                   or jsonb_typeof(f -> 'confirmed') is distinct from 'boolean'
                   or case when jsonb_typeof(f -> 'confidence') = 'number' then (f ->> 'confidence')::numeric not between 0 and 1 end
                   or length(f ->> 'value') > 500) then
    raise exception 'Each field needs a key, label, value, confidence (0–1) and confirmed flag' using errcode = 'PT422';
  end if;
  select count(*) into n_confirmed from jsonb_array_elements(p -> 'fields') f where (f ->> 'confirmed')::boolean;
  if n_confirmed = 0 then
    raise exception 'Confirm at least one field before saving' using errcode = 'PT422';
  end if;
  -- Nothing enters the record that the clinician did not confirm. The app maps each confirmed field to its coded
  -- observations (a BP field is two: systolic and diastolic) and checklist item; bounded here.
  select jsonb_array_length(coalesce(p -> 'observations', '[]'::jsonb)) into n_obs;
  if n_obs > 2 * n_confirmed or jsonb_array_length(coalesce(p -> 'checklist', '[]'::jsonb)) > n_confirmed then
    raise exception 'Only confirmed fields can be recorded' using errcode = 'PT422';
  end if;
  if d.baby_id is not null and jsonb_array_length(coalesce(p -> 'checklist', '[]'::jsonb)) > 0 then
    raise exception 'The ANC checklist is for a pregnancy' using errcode = 'PT422';
  end if;

  t := app.effective_time(p ->> 'at');
  update public.documents set fields = p -> 'fields', confirmed_by = s.id, confirmed_at = now() where id = d.id;

  if d.pregnancy_id is not null then
    select * into g from public.pregnancies where id = d.pregnancy_id;
    ga := app.local_date(g.hospital_id, t) - (g.edd - 280);
    if ga not between 0 and 320 then ga := null; end if;
  end if;
  begin
    insert into public.encounters (id, mother_id, pregnancy_id, baby_id, kind, at, by_staff, source, document_id, ga_days, note)
    values (coalesce((p ->> 'encounter_id')::uuid, gen_random_uuid()), d.mother_id, d.pregnancy_id, d.baby_id,
            case when d.baby_id is null then 'anc' else 'newborn' end, t, s.id, 'capture', d.id, ga,
            'Transcribed from a paper record; each field confirmed by the clinician')
    returning * into e;
  exception when unique_violation then
    raise exception 'This visit already exists' using errcode = 'PT409';
  end;

  insert into public.observations (encounter_id, mother_id, pregnancy_id, baby_id, code, value_num, value_text, unit, at, by_staff)
  select e.id, e.mother_id, e.pregnancy_id, e.baby_id, x.code, x.value_num, nullif(trim(x.value_text), ''), x.unit, e.at, s.id
  from jsonb_to_recordset(coalesce(p -> 'observations', '[]'::jsonb)) as x(code text, value_num numeric, value_text text, unit text);

  insert into public.encounter_checklist (encounter_id, mother_id, component, state, reason)
  select e.id, e.mother_id, x.component, x.state, nullif(trim(x.reason), '')
  from jsonb_to_recordset(coalesce(p -> 'checklist', '[]'::jsonb)) as x(component text, state text, reason text);

  perform app.audit_event('capture_confirmed', 'documents', d.id::text, d.mother_id,
                          jsonb_build_object('confirmed_fields', n_confirmed, 'encounter_id', e.id));
  return app.idem_finish(p, jsonb_build_object('document_id', d.id, 'encounter_id', e.id, 'confirmed_fields', n_confirmed));
end $$;

-- The four can_* helpers are called by the storage policies as the signed-in user, so they need EXECUTE
-- (the app schema is not exposed through the Data API). family_can_act is only called by them.
insert into app.api_functions values
  ('app','can_upload_voice'), ('app','can_read_voice'), ('app','can_upload_document'),
  ('app','can_read_document'), ('public','create_document'), ('public','confirm_capture');

do $$ begin perform app.apply_api_grants(); end $$;
