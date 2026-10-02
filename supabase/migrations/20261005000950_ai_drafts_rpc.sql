-- AI drafts (PRD F-27 consultation brief / handoff / discharge draft, F-31 paper capture).
-- The Edge Functions `ai-brief` and `capture-transcribe` call these RPCs with the
-- clinician's own JWT, so the same role and visibility checks apply as for any other write.
--
--   save_ai_draft(p)       stores a de-identified, cited draft as 'unverified'. Every cited row must exist and
--                          belong to the same mother. Nothing here enters the record.
--   verify_ai_draft(p)     the clinician verifies (→ one care_notes row, kind 'ai_verified', linked as note_id)
--                          or discards the draft. Only an unverified draft can change, once.
--   save_capture_draft(p)  stores a transcription draft on documents.fields (every field unconfirmed). The
--                          clinician later confirms field by field (confirm_capture / record_visit).
--
-- A draft is the caller's draft: engine 'claude' records how it was produced, and the audit log records who
-- asked for it. It becomes part of the record only through verify_ai_draft. Same contract as every RPC
-- (20261005000300_rpc_care.sql header): only_keys → idem_begin → role + object access → state check → writes →
-- audit_event → idem_finish. Errors: PT403 role · PT404 not visible · PT409 already done · PT422 input.

-- ════════════════════════════════════════════════════════════════════════════════
-- Helpers
-- ════════════════════════════════════════════════════════════════════════════════

-- A well-formed UUID (text), so a bad id is a PT422/PT404 rather than a cast error.
create function app.is_uuid(p text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false)
$$;

-- Citation kind → table (a hard-coded allowlist; used with format('%I')).
-- Must stay in step with SOURCE_PREFIX in supabase/functions/_shared/ai.ts.
create function app.ai_source_table(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'registration' then 'pregnancies'   when 'baby' then 'babies'           when 'delivery' then 'deliveries'
    when 'visit' then 'encounters'           when 'test' then 'investigations'   when 'referral' then 'referrals'
    when 'tag' then 'tags'                   when 'task' then 'tasks'            when 'callback' then 'callbacks'
    when 'selflog' then 'self_logs'          when 'note' then 'care_notes'       when 'medication' then 'medications'
    when 'vaccine' then 'immunizations'      when 'discharge' then 'discharges'
  end
$$;

-- ANC-card fields a transcription may fill. Must match CAPTURE_FIELDS in supabase/functions/_shared/ai.ts.
create function app.capture_field_labels() returns table (key text, label text, sort int)
language sql immutable set search_path = '' as $$
  values ('visit_date', 'Visit date', 1), ('weight', 'Weight', 2), ('bp', 'BP', 3), ('albumin', 'Urine albumin', 4),
         ('urine_sugar', 'Urine sugar', 5), ('hb', 'Hb', 6), ('fhr', 'FHR', 7), ('fundal_height', 'Fundal height', 8),
         ('next_visit', 'Next visit date', 9)
$$;

-- ════════════════════════════════════════════════════════════════════════════════
-- save_ai_draft
-- ════════════════════════════════════════════════════════════════════════════════

-- security definer: inserts into ai_drafts, which no API role may write; require_writer has checked the
-- caller's role and visibility of the subject first.
create function public.save_ai_draft(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid;
  v_baby uuid;
  v_mother uuid;
  v_content jsonb := p -> 'content';
  v_model text := nullif(trim(p ->> 'model'), '');
  e jsonb;
  k text;
  missing int;
  d public.ai_drafts;
begin
  perform app.only_keys(p, array['idempotency_key','id','pregnancy_id','baby_id','kind','content','model']);
  if (p ->> 'pregnancy_id' is not null and not app.is_uuid(p ->> 'pregnancy_id'))
     or (p ->> 'baby_id' is not null and not app.is_uuid(p ->> 'baby_id'))
     or (p ->> 'id' is not null and not app.is_uuid(p ->> 'id')) then
    raise exception 'ids must be UUIDs' using errcode = 'PT422';
  end if;
  v_preg := (p ->> 'pregnancy_id')::uuid;
  v_baby := (p ->> 'baby_id')::uuid;
  prior := app.idem_begin('save_ai_draft', p);
  if prior is not null then return prior; end if;
  s := app.require_writer(v_preg, v_baby);
  v_mother := coalesce((select g.mother_id from public.pregnancies g where g.id = v_preg),
                       (select b.mother_id from public.babies b where b.id = v_baby));

  if coalesce(p ->> 'kind', '') not in ('brief','handoff','discharge') then
    raise exception 'kind must be brief, handoff or discharge' using errcode = 'PT422';
  end if;
  if v_model is null or length(v_model) > 80 then
    raise exception 'model is required' using errcode = 'PT422';
  end if;
  if (case when jsonb_typeof(v_content) = 'array' then jsonb_array_length(v_content) not between 1 and 40 else true end) then
    raise exception 'A draft needs between 1 and 40 cited sentences' using errcode = 'PT422';
  end if;
  perform app.only_keys_each(v_content, array['text','sources'], 'sentence');
  for e in select value from jsonb_array_elements(v_content) loop
    if (case when jsonb_typeof(e -> 'text') = 'string' then length(trim(e ->> 'text')) not between 1 and 600 else true end)
       or (case when jsonb_typeof(e -> 'sources') = 'array' then jsonb_array_length(e -> 'sources') not between 1 and 20 else true end) then
      raise exception 'Every sentence needs text and at least one source' using errcode = 'PT422';
    end if;
    perform app.only_keys_each(e -> 'sources', array['kind','id'], 'source');
  end loop;
  if (select sum(length(x ->> 'text')) from jsonb_array_elements(v_content) x) > 7000 then
    raise exception 'The draft is too long' using errcode = 'PT422';
  end if;
  if exists (select 1 from jsonb_array_elements(v_content) x, jsonb_array_elements(x -> 'sources') src
             where app.ai_source_table(src ->> 'kind') is null or not app.is_uuid(src ->> 'id')) then
    raise exception 'A sentence cites an unknown kind of source or a malformed id' using errcode = 'PT422';
  end if;

  -- Every cited row exists and is part of this mother's record (one query per cited kind).
  for k in select distinct src ->> 'kind' from jsonb_array_elements(v_content) x, jsonb_array_elements(x -> 'sources') src loop
    execute format(
      'select count(*) from (select distinct (src ->> ''id'')::uuid as id
                               from jsonb_array_elements($1) x, jsonb_array_elements(x -> ''sources'') src
                              where src ->> ''kind'' = $2) c
        where not exists (select 1 from public.%I t where t.id = c.id and t.mother_id = $3)', app.ai_source_table(k))
      into missing using v_content, k, v_mother;
    if missing > 0 then
      raise exception 'A sentence cites a record that is not part of this patient''s record' using errcode = 'PT422';
    end if;
  end loop;

  insert into public.ai_drafts (id, mother_id, pregnancy_id, baby_id, kind, content, engine, model, generated_by)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), v_mother, v_preg, v_baby, p ->> 'kind',
          (select jsonb_agg(jsonb_build_object(
                    'text', trim(x.value ->> 'text'),
                    'sources', (select jsonb_agg(jsonb_build_object('kind', src.value ->> 'kind', 'id', (src.value ->> 'id')::uuid) order by src.ordinality)
                                  from jsonb_array_elements(x.value -> 'sources') with ordinality src(value, ordinality)))
                  order by x.ordinality)
             from jsonb_array_elements(v_content) with ordinality x(value, ordinality)),
          'claude', v_model, s.id)
  returning * into d;

  perform app.audit_event('ai_draft_generated', 'ai_drafts', d.id::text, v_mother,
                          jsonb_build_object('kind', d.kind, 'sentences', jsonb_array_length(d.content), 'model', d.model));
  return app.idem_finish(p, jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status, 'engine', d.engine,
                                               'model', d.model, 'generated_at', d.generated_at, 'content', d.content));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- verify_ai_draft
-- ════════════════════════════════════════════════════════════════════════════════

-- security definer: updates ai_drafts and inserts care_notes; require_writer checks role and visibility of the
-- draft's subject before anything is written.
create function public.verify_ai_draft(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  d public.ai_drafts;
  v_action text := p ->> 'action';
  v_exclude int[];
  v_body text;
  v_kept int;
  n public.care_notes;
begin
  perform app.only_keys(p, array['idempotency_key','id','action','exclude','note_id','at']);
  if not app.is_uuid(p ->> 'id') then perform app.not_visible(); end if;
  if p ->> 'note_id' is not null and not app.is_uuid(p ->> 'note_id') then
    raise exception 'note_id must be a UUID' using errcode = 'PT422';
  end if;
  prior := app.idem_begin('verify_ai_draft', p);
  if prior is not null then return prior; end if;
  select * into d from public.ai_drafts where id = (p ->> 'id')::uuid for update;
  if d.id is null then perform app.not_visible(); end if;
  s := app.require_writer(d.pregnancy_id, d.baby_id);
  if d.status <> 'unverified' then
    raise exception 'This draft was already %', d.status using errcode = 'PT409';
  end if;

  if v_action = 'discard' then
    if p ? 'exclude' or p ? 'note_id' then
      raise exception 'A discarded draft takes no edits' using errcode = 'PT422';
    end if;
    update public.ai_drafts set status = 'discarded' where id = d.id;
    perform app.audit_event('ai_draft_discarded', 'ai_drafts', d.id::text, d.mother_id, jsonb_build_object('kind', d.kind));
    return app.idem_finish(p, jsonb_build_object('id', d.id, 'status', 'discarded', 'note_id', null));
  elsif v_action is distinct from 'verify' then
    raise exception 'action must be verify or discard' using errcode = 'PT422';
  end if;

  -- Sentences the clinician left out (0-based positions in the draft).
  if p ? 'exclude' and jsonb_typeof(p -> 'exclude') <> 'null' then
    if jsonb_typeof(p -> 'exclude') <> 'array'
       or exists (select 1 from jsonb_array_elements(p -> 'exclude') x
                  where case when jsonb_typeof(x) = 'number'
                             then (x #>> '{}')::numeric not between 0 and jsonb_array_length(d.content) - 1
                                  or (x #>> '{}')::numeric <> trunc((x #>> '{}')::numeric)
                             else true end) then
      raise exception 'exclude must list sentence positions of this draft' using errcode = 'PT422';
    end if;
    v_exclude := array(select (x #>> '{}')::int from jsonb_array_elements(p -> 'exclude') x);
  end if;

  select count(*), string_agg(x.value ->> 'text', ' ' order by x.ordinality) into v_kept, v_body
    from jsonb_array_elements(d.content) with ordinality x(value, ordinality)
   where not ((x.ordinality - 1)::int = any(coalesce(v_exclude, '{}')));
  if v_kept = 0 then
    raise exception 'Keep at least one sentence, or discard the draft' using errcode = 'PT422';
  end if;
  v_body := case d.kind when 'brief' then 'Consultation brief' when 'handoff' then 'Handoff summary' else 'Discharge summary' end
            || ' (AI draft, verified): ' || v_body;

  insert into public.care_notes (id, mother_id, pregnancy_id, baby_id, author, body, kind, at)
  values (coalesce((p ->> 'note_id')::uuid, gen_random_uuid()), d.mother_id, d.pregnancy_id, d.baby_id, s.id, v_body,
          'ai_verified', app.event_time(p ->> 'at'))
  returning * into n;
  update public.ai_drafts set status = 'verified', verified_by = s.id, verified_at = now(), note_id = n.id where id = d.id;

  perform app.audit_event('ai_draft_verified', 'ai_drafts', d.id::text, d.mother_id,
                          jsonb_build_object('kind', d.kind, 'kept', v_kept, 'excluded', jsonb_array_length(d.content) - v_kept,
                                             'note_id', n.id));
  return app.idem_finish(p, jsonb_build_object('id', d.id, 'status', 'verified', 'note_id', n.id));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- save_capture_draft
-- ════════════════════════════════════════════════════════════════════════════════

-- security definer: updates documents, which no API role may write; require_writer checks role and visibility
-- of the document's subject first.
create function public.save_capture_draft(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  doc public.documents;
  v_fields jsonb := p -> 'fields';
  v_model text := nullif(trim(p ->> 'model'), '');
  v_out jsonb;
begin
  perform app.only_keys(p, array['idempotency_key','document_id','fields','model']);
  if not app.is_uuid(p ->> 'document_id') then perform app.not_visible(); end if;
  prior := app.idem_begin('save_capture_draft', p);
  if prior is not null then return prior; end if;
  select * into doc from public.documents where id = (p ->> 'document_id')::uuid for update;
  if doc.id is null then perform app.not_visible(); end if;
  s := app.require_writer(doc.pregnancy_id, doc.baby_id);
  if doc.confirmed_at is not null then
    raise exception 'This document was already confirmed' using errcode = 'PT409';
  end if;
  if v_model is null or length(v_model) > 80 then
    raise exception 'model is required' using errcode = 'PT422';
  end if;
  if (case when jsonb_typeof(v_fields) = 'array' then jsonb_array_length(v_fields) > 20 else true end) then
    raise exception 'fields must be a list' using errcode = 'PT422';
  end if;
  perform app.only_keys_each(v_fields, array['key','value','confidence'], 'field');
  if exists (select 1 from jsonb_array_elements(v_fields) f
             where not exists (select 1 from app.capture_field_labels() c where c.key = f ->> 'key')
                or case when jsonb_typeof(f -> 'value') = 'string' then length(trim(f ->> 'value')) not between 1 and 80 else true end
                or case when jsonb_typeof(f -> 'confidence') = 'number' then (f ->> 'confidence')::numeric not between 0 and 1 else true end) then
    raise exception 'Each field needs a known key, a value as written and a confidence between 0 and 1' using errcode = 'PT422';
  end if;
  if (select count(distinct f ->> 'key') from jsonb_array_elements(v_fields) f) <> jsonb_array_length(v_fields) then
    raise exception 'Each field may appear once' using errcode = 'PT422';
  end if;

  -- Every transcribed field starts unconfirmed; labels come from the server's list.
  select coalesce(jsonb_agg(jsonb_build_object('key', c.key, 'label', c.label, 'value', trim(f ->> 'value'),
                                               'confidence', (f ->> 'confidence')::numeric, 'confirmed', false) order by c.sort), '[]')
    into v_out
    from jsonb_array_elements(v_fields) f join app.capture_field_labels() c on c.key = f ->> 'key';
  update public.documents set fields = v_out where id = doc.id;

  perform app.audit_event('capture_transcribed', 'documents', doc.id::text, doc.mother_id,
                          jsonb_build_object('fields', jsonb_array_length(v_out), 'model', v_model));
  return app.idem_finish(p, jsonb_build_object('document_id', doc.id, 'fields', v_out));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════

insert into app.api_functions values
  ('public','save_ai_draft'), ('public','verify_ai_draft'), ('public','save_capture_draft');

do $$ begin perform app.apply_api_grants(); end $$;
