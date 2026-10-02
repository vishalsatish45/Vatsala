-- Integrity guarantees that hold whoever writes (RPC, Edge Function with service_role, SQL console).
--   1. facts are immutable and never deleted; errors are marked entered_in_error with who/when/why
--   2. every row belongs to the same mother as every record it references
--   3. teams, assignments and referrals never cross hospitals
--   4. pick-list codes are validated against pick_lists
--   5. observations match their code (type, UCUM unit, impossible-value bounds, allowed coded values)
--   6. the family-privacy flag on a test comes from the catalogue
--   7. re-dating keeps exactly one current dating and syncs pregnancies.edd (its only writer)
--   8. optimistic concurrency: `version` increments on every update of a mutable row
--   9. audit: inserts record the id, updates the changed columns; audit_log is append-only
--  10. accounts link to pre-provisioned rows by phone (no self sign-up)
--  11. request helpers: payload allowlists, idempotency ledger, server-assigned numbers
--  12. API privileges: anon nothing; authenticated SELECT (RLS decides rows) + allowlisted functions
-- The only bypass of 1 is demo reset, and only when app_settings.demo_mode is true.

-- ── Shared helpers ──────────────────────────────────────────────────────────────

create function app.demo_reset_active() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.demo_reset', true), '') = 'on'
$$;

-- security definer: reads staff to label audit rows; the caller cannot influence the result.
create function app.actor_role(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when p_user is null then 'system'
    else coalesce((select s.role from public.staff s where s.user_id = p_user), 'family')
  end
$$;

-- ── 1. Facts are immutable; nothing clinical is deleted ─────────────────────────

-- TG_ARGV lists the only columns that may change. A row in entered_in_error stays there.
create function app.guard_fact_update() returns trigger
language plpgsql set search_path = '' as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  k text;
begin
  if app.demo_reset_active() then return new; end if;
  -- a row already marked entered in error is final: its reason, author and time can never be rewritten
  if o ->> 'status' = 'entered_in_error' and o is distinct from n then
    raise exception '% entered in error is final', tg_table_name;
  end if;
  for k in select jsonb_object_keys(n) loop
    -- TG_ARGV is NULL when no column may change; NULL would make this test silently pass
    if not (k = any(coalesce(tg_argv, '{}'::text[]))) and (o -> k) is distinct from (n -> k) then
      raise exception '%.% is part of the record and cannot be changed; mark the entry as entered in error and record a correction',
        tg_table_name, k;
    end if;
  end loop;
  if n ? 'status' then
    if o ->> 'status' = 'entered_in_error' and n ->> 'status' <> 'entered_in_error' then
      raise exception '% entered in error cannot be reinstated', tg_table_name;
    end if;
    if n ->> 'status' = 'entered_in_error' and o ->> 'status' <> 'entered_in_error'
       and coalesce(trim(n ->> 'eie_reason'), '') = '' then
      raise exception 'marking % as entered in error needs a reason', tg_table_name;
    end if;
  end if;
  return new;
end $$;

create function app.forbid_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if app.demo_reset_active() then return old; end if;
  raise exception '% rows are never deleted', tg_table_name;
end $$;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('previous_pregnancies',  array['status','eie_reason','eie_by','eie_at']),
    ('documented_conditions', array['status','clinical_status','eie_reason','eie_by','eie_at']),
    ('allergies',             array['status','eie_reason','eie_by','eie_at']),
    ('encounters',            array['status','eie_reason','eie_by','eie_at']),
    ('encounter_checklist',   array[]::text[]),
    ('observations',          array['status','eie_reason','eie_by','eie_at']),
    ('investigation_results', array['status','eie_reason','eie_by','eie_at']),
    ('care_notes',            array['status','eie_reason','eie_by','eie_at']),
    ('self_logs',             array['status','eie_reason','eie_at']),
    ('referral_events',       array[]::text[]),
    ('task_contacts',         array[]::text[]),
    ('pregnancy_datings',     array['is_current']),
    ('deliveries',            array[]::text[]),
    ('consents',              array['withdrawn_at','withdrawn_reason']),
    ('patient_identifiers',   array[]::text[]),
    ('access_overrides',      array['ended_at']),
    ('care_assignments',      array['to_at']),
    ('team_members',          array['to_at']),
    ('access_grants',         array['valid_from','valid_until']),
    ('referral_shared_results', array[]::text[]),
    ('erasure_requests',      array['status','completed_at','completed_by','note'])
  ) as t(tbl, allowed)
  loop
    execute format(
      'create trigger %I before update on public.%I for each row execute function app.guard_fact_update(%s)',
      r.tbl || '_immutable', r.tbl,
      coalesce((select string_agg(quote_literal(c), ', ') from unnest(r.allowed) c), ''));
  end loop;
end $$;

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
           and tablename not in ('notifications','push_tokens','idempotency_keys','audit_log') loop
    execute format('create trigger %I before delete on public.%I for each row execute function app.forbid_delete()',
                   t || '_no_delete', t);
  end loop;
end $$;

-- ── 2. Every row belongs to the same mother as everything it references ─────────

-- security definer: must read parent rows regardless of the caller's visibility to compare mother_ids.
create function app.enforce_mother_id() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
  r record;
  parent_mother uuid;
begin
  for r in select * from (values
    ('pregnancy_id','pregnancies'), ('baby_id','babies'), ('delivery_id','deliveries'),
    ('admission_id','admissions'), ('encounter_id','encounters'), ('investigation_id','investigations'),
    ('referral_id','referrals'), ('task_id','tasks'), ('medication_id','medications'),
    ('discharge_id','discharges'), ('document_id','documents'), ('documented_in','pregnancies'),
    ('from_encounter_id','encounters'), ('completed_by_encounter_id','encounters'),
    ('given_in_encounter_id','encounters')
  ) as k(col, parent)
  loop
    continue when not (n ? r.col) or n ->> r.col is null;
    execute format('select mother_id from public.%I where id = $1', r.parent)
      into parent_mother using (n ->> r.col)::uuid;
    if parent_mother is distinct from (n ->> 'mother_id')::uuid then
      raise exception '%.mother_id does not match the mother of its % (%)', tg_table_name, r.col, n ->> r.col
        using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end $$;

do $$
declare
  t text;
begin
  for t in select c.table_name from information_schema.columns c
           join pg_tables p on p.schemaname = 'public' and p.tablename = c.table_name
           where c.table_schema = 'public' and c.column_name = 'mother_id' and c.table_name <> 'audit_log' loop
    execute format('create trigger %I before insert or update on public.%I for each row execute function app.enforce_mother_id()',
                   t || '_mother_consistency', t);
  end loop;
end $$;

-- ── 3. Nothing crosses hospitals ────────────────────────────────────────────────

-- security definer: compares hospitals of rows the caller may not be able to see.
create function app.enforce_same_hospital() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb;
  subject_hospital uuid;
  team_hospital uuid;
begin
  if tg_table_name = 'team_members' then
    if (select hospital_id from public.teams where id = new.team_id)
       is distinct from (select hospital_id from public.staff where id = new.staff_id) then
      raise exception 'staff and team belong to different hospitals' using errcode = 'foreign_key_violation';
    end if;
    return new;
  end if;
  if tg_table_name = 'teams' then
    if new.parent_team_id is not null and (select hospital_id from public.teams where id = new.parent_team_id)
       is distinct from new.hospital_id then
      raise exception 'a unit and its department belong to different hospitals' using errcode = 'foreign_key_violation';
    end if;
    return new;
  end if;
  -- care_assignments and referrals: the team (and primary staff) must be in the pregnancy's hospital.
  -- Fields are read through jsonb because the two tables name the team column differently.
  n := to_jsonb(new);
  subject_hospital := coalesce(
    (select g.hospital_id from public.pregnancies g where g.id = (n ->> 'pregnancy_id')::uuid),
    (select g.hospital_id from public.babies b join public.pregnancies g on g.id = b.pregnancy_id
      where b.id = (n ->> 'baby_id')::uuid));
  team_hospital := (select hospital_id from public.teams
                    where id = coalesce(n ->> 'to_team_id', n ->> 'team_id')::uuid);
  if team_hospital is distinct from subject_hospital then
    raise exception 'the team belongs to a different hospital than the patient' using errcode = 'foreign_key_violation';
  end if;
  if n ->> 'primary_staff_id' is not null
     and (select hospital_id from public.staff where id = (n ->> 'primary_staff_id')::uuid) is distinct from subject_hospital then
    raise exception 'the primary clinician belongs to a different hospital' using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

create trigger team_members_same_hospital before insert or update on public.team_members
  for each row execute function app.enforce_same_hospital();
create trigger teams_same_hospital before insert or update on public.teams
  for each row execute function app.enforce_same_hospital();
create trigger care_assignments_same_hospital before insert or update on public.care_assignments
  for each row execute function app.enforce_same_hospital();
create trigger referrals_same_hospital before insert or update of to_team_id on public.referrals
  for each row execute function app.enforce_same_hospital();

-- A referral goes to a department; an assignment goes to a team of the matching specialty.
create function app.check_team_kind() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
begin
  if tg_table_name = 'referrals' then
    select * into t from public.teams where id = new.to_team_id;
    if t.kind <> 'department' then
      raise exception 'referrals go to a department' using errcode = 'check_violation';
    end if;
  else
    select * into t from public.teams where id = new.team_id;
    if t.specialty <> new.specialty then
      raise exception 'a % assignment needs a % team', new.specialty, new.specialty using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create trigger referrals_team_kind before insert or update of to_team_id on public.referrals
  for each row execute function app.check_team_kind();
create trigger care_assignments_team_kind before insert or update of team_id on public.care_assignments
  for each row execute function app.check_team_kind();

-- ── 4. Pick-list codes are real codes ───────────────────────────────────────────

-- TG_ARGV: pairs of (column, list). Accepts a text or text[] column; new values must be active codes.
create function app.check_codes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  i int := 0;
  col text;
  lst text;
  bad text;
begin
  while i < tg_nargs loop
    col := tg_argv[i];
    lst := tg_argv[i + 1];
    i := i + 2;
    continue when n -> col is null or jsonb_typeof(n -> col) = 'null' or (o -> col) is not distinct from (n -> col);
    select string_agg(v, ', ') into bad
    from (select jsonb_array_elements_text(n -> col) as v where jsonb_typeof(n -> col) = 'array'
          union all
          select n ->> col where jsonb_typeof(n -> col) = 'string') x
    where not exists (select 1 from public.pick_lists p where p.list = lst and p.code = x.v and p.active);
    if bad is not null then
      raise exception 'unknown % code(s): %', lst, bad using errcode = 'check_violation';
    end if;
  end loop;
  return new;
end $$;

create trigger callbacks_codes before insert or update on public.callbacks
  for each row execute function app.check_codes('signs', 'warning_sign', 'outcome', 'callback_outcome');
create trigger encounters_codes before insert on public.encounters
  for each row execute function app.check_codes('complaints', 'complaint', 'counselling', 'counselling_topic');
create trigger encounter_checklist_codes before insert on public.encounter_checklist
  for each row execute function app.check_codes('component', 'anc_component');
create trigger deliveries_codes before insert on public.deliveries
  for each row execute function app.check_codes('complications', 'delivery_complication', 'medicines', 'labour_medicine');
create trigger task_contacts_codes before insert on public.task_contacts
  for each row execute function app.check_codes('outcome', 'contact_outcome');
create trigger discharge_items_codes before insert on public.discharge_items
  for each row execute function app.check_codes('key', 'discharge_item');

-- ── 5. Observations match their code ────────────────────────────────────────────
-- Data-quality validation only: the bounds reject impossible entries and never classify a value.

create function app.validate_observation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.observation_codes;
  e public.encounters;
begin
  select * into c from public.observation_codes where code = new.code;
  select * into e from public.encounters where id = new.encounter_id;
  if new.pregnancy_id is distinct from e.pregnancy_id or new.baby_id is distinct from e.baby_id then
    raise exception 'observation subject must match its encounter' using errcode = 'check_violation';
  end if;
  if (c.applies_to = 'baby') <> (new.baby_id is not null) then
    raise exception '% is recorded for the %', c.label, c.applies_to using errcode = 'check_violation';
  end if;
  if c.value_type = 'numeric' then
    if new.value_num is null then
      raise exception '% needs a number', c.label using errcode = 'check_violation';
    end if;
    new.unit := coalesce(new.unit, c.unit);
    if new.unit <> c.unit then
      raise exception '% is recorded in %, not %', c.label, c.unit, new.unit using errcode = 'check_violation';
    end if;
    if new.value_num < c.min_possible or new.value_num > c.max_possible then
      raise exception '% of % % is not a possible entry; please re-check', c.label, new.value_num, c.unit
        using errcode = 'check_violation';
    end if;
  elsif c.value_type = 'coded' then
    if new.value_text is null or not (new.value_text = any(c.allowed_values)) then
      raise exception '% must be one of %', c.label, array_to_string(c.allowed_values, ', ')
        using errcode = 'check_violation';
    end if;
  elsif new.value_text is null then
    raise exception '% needs text', c.label using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger observations_validate before insert on public.observations
  for each row execute function app.validate_observation();

-- ── 6. Test privacy and subject come from the catalogue ─────────────────────────

create function app.investigation_from_catalogue() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  c public.investigation_catalogue;
begin
  select * into c from public.investigation_catalogue where code = new.code;
  new.sensitive := coalesce(c.sensitive, true);
  if (c.applies_to = 'baby') <> (new.baby_id is not null) then
    raise exception '% is a % test', c.label, c.applies_to using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger investigations_catalogue before insert or update of code, sensitive, baby_id on public.investigations
  for each row execute function app.investigation_from_catalogue();

-- Vaccine subject must match the catalogue (Td for a pregnancy, UIP for a baby).
create function app.immunization_subject() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select applies_to from public.vaccine_catalogue where code = new.code) <> (case when new.baby_id is null then 'mother' else 'baby' end) then
    raise exception 'vaccine % does not apply to this subject', new.code using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger immunizations_subject before insert or update of code, baby_id, pregnancy_id on public.immunizations
  for each row execute function app.immunization_subject();

-- A tag must match its catalogue subject (pregnancy tag vs newborn tag).
create function app.tag_subject() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select applies_to from public.tag_catalogue where code = new.code) <> (case when new.baby_id is null then 'pregnancy' else 'baby' end) then
    raise exception 'tag % does not apply to this subject', new.code using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger tags_subject before insert on public.tags
  for each row execute function app.tag_subject();

-- ── 7. One current dating per pregnancy; pregnancies.edd follows it ────────────

create function app.apply_dating() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_current then
    update public.pregnancy_datings set is_current = false
      where pregnancy_id = new.pregnancy_id and is_current and id <> new.id;
    update public.pregnancies set edd = new.edd where id = new.pregnancy_id and edd is distinct from new.edd;
  end if;
  return new;
end $$;

create trigger pregnancy_datings_apply before insert on public.pregnancy_datings
  for each row execute function app.apply_dating();

-- ── 8. Optimistic concurrency ───────────────────────────────────────────────────

create function app.bump_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.version := old.version + 1;
  return new;
end $$;

do $$
declare
  t text;
begin
  for t in select c.table_name from information_schema.columns c
           join pg_tables p on p.schemaname = 'public' and p.tablename = c.table_name
           where c.table_schema = 'public' and c.column_name = 'version' loop
    execute format('create trigger %I before update on public.%I for each row execute function app.bump_version()',
                   t || '_version', t);
  end loop;
end $$;

-- ── 9. Audit ────────────────────────────────────────────────────────────────────
-- Inserts record only who created which row (the row itself is immutable and already stored — no second
-- copy of health data); updates record the changed columns.
-- Personal data (DPDP) is never copied into the audit log: for the columns below an update records only that
-- the column changed. Erasing a person therefore never requires rewriting the append-only log.

create table app.pii_columns (
  table_name text not null,
  column_name text not null,
  primary key (table_name, column_name)
);
insert into app.pii_columns values
  ('mothers','name'), ('mothers','phone'), ('mothers','alt_phone'), ('mothers','husband_name'), ('mothers','dob'),
  ('mothers','village'), ('mothers','pincode'), ('mothers','emergency_contact'), ('mothers','user_id'),
  ('caregivers','name'), ('caregivers','phone'), ('caregivers','relation'), ('caregivers','user_id'),
  ('staff','name'), ('staff','phone'), ('staff','user_id'),
  ('babies','name'),
  ('documents','fields'), ('documents','storage_path'),
  ('callbacks','voice_path');

-- security definer: writes audit_log, which no API role may write.
create function app.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb;
  diff jsonb := '{}';
  k text;
  who uuid := auth.uid();
  pii text[];
begin
  if tg_op = 'UPDATE' then
    o := to_jsonb(old);
    pii := array(select c.column_name from app.pii_columns c where c.table_name = tg_table_name);
    for k in select jsonb_object_keys(n) loop
      if (o -> k) is distinct from (n -> k) and k <> 'version' then
        diff := diff || jsonb_build_object(k, case when k = any(pii) then jsonb_build_object('changed', true)
                                                    else jsonb_build_object('from', o -> k, 'to', n -> k) end);
      end if;
    end loop;
    if diff = '{}' then return null; end if;
  end if;
  insert into public.audit_log (actor, role, action, entity_type, entity_id, mother_id, meta)
  values (who, app.actor_role(who), lower(tg_op), tg_table_name,
          coalesce(n ->> 'id', n ->> 'encounter_id', n ->> 'discharge_id'),
          case when tg_table_name = 'mothers' then (n ->> 'id')::uuid else (n ->> 'mother_id')::uuid end,
          diff);
  return null;
end $$;

do $$
declare
  t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
           and tablename not in ('audit_log','notifications','push_tokens','idempotency_keys','id_counters','access_grants') loop
    execute format('create trigger %I after insert or update on public.%I for each row execute function app.audit_row()',
                   t || '_audit', t);
  end loop;
end $$;

create function app.audit_log_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_update_delete before update or delete on public.audit_log
  for each row execute function app.audit_log_append_only();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app.audit_log_append_only();

-- ── 10. Accounts link to pre-provisioned rows by phone ──────────────────────────

-- security definer: runs inside Supabase Auth's insert into auth.users.
create function app.link_user_by_phone() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(new.phone, '') = '' then return new; end if;
  update public.staff set user_id = new.id where phone = new.phone and user_id is null;
  update public.mothers set user_id = new.id where phone = new.phone and user_id is null;
  update public.caregivers set user_id = new.id where phone = new.phone and user_id is null and revoked_at is null;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.link_user_by_phone();

-- A row created after the person already has an account links at once.
create function app.link_row_to_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null then
    new.user_id := (select u.id from auth.users u where u.phone = new.phone);
  end if;
  return new;
end $$;

create trigger staff_link_user before insert on public.staff
  for each row execute function app.link_row_to_user();
create trigger mothers_link_user before insert on public.mothers
  for each row execute function app.link_row_to_user();
create trigger caregivers_link_user before insert on public.caregivers
  for each row execute function app.link_row_to_user();

-- ── 11. Request helpers used by every RPC ───────────────────────────────────────

-- Payload allowlist (mass-assignment guard): unknown keys are rejected, never ignored.
create function app.only_keys(p jsonb, allowed text[], what text default 'request') returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  extra text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    raise exception '% must be an object', what using errcode = 'PT422';
  end if;
  select string_agg(k, ', ') into extra from jsonb_object_keys(p) k where not (k = any(allowed));
  if extra is not null then
    raise exception 'unexpected field(s) in %: %', what, extra using errcode = 'PT422';
  end if;
  return p;
end $$;

-- Idempotency: call at the start of a mutating RPC. Returns the stored response for a replay (the RPC
-- returns it unchanged), null for a first call. Same key + different payload → PT409.
-- security definer: idempotency_keys is not writable by API roles.
create function app.idem_begin(p_rpc text, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  k uuid := (p ->> 'idempotency_key')::uuid;
  h text := md5((p - 'idempotency_key')::text);
  row public.idempotency_keys;
begin
  if k is null then
    raise exception 'idempotency_key is required' using errcode = 'PT422';
  end if;
  insert into public.idempotency_keys (actor, key, rpc, request_hash)
  values (coalesce(who, '00000000-0000-0000-0000-000000000000'), k, p_rpc, h)
  on conflict (actor, key) do nothing;
  if found then return null; end if;
  select * into row from public.idempotency_keys
    where actor = coalesce(who, '00000000-0000-0000-0000-000000000000') and key = k;
  if row.rpc <> p_rpc or row.request_hash <> h then
    raise exception 'This request id was already used for different data' using errcode = 'PT409';
  end if;
  if row.response is null then
    raise exception 'This request is still being processed' using errcode = 'PT409';
  end if;
  return row.response;
end $$;

create function app.idem_finish(p jsonb, p_response jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update public.idempotency_keys set response = p_response
    where actor = coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000')
      and key = (p ->> 'idempotency_key')::uuid;
  return p_response;
end $$;

-- Server-assigned numbers; the counter row lock serialises concurrent requests.
create function app.next_number(p_hospital uuid, p_kind text, p_period text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  insert into public.id_counters (hospital_id, kind, period, value) values (p_hospital, p_kind, p_period, 1)
  on conflict (hospital_id, kind, period) do update set value = public.id_counters.value + 1
  returning value into n;
  return n;
end $$;

-- ── 12. Row-level security on; API privileges locked down ───────────────────────
-- Supabase grants ALL on public tables and EXECUTE on public functions to anon/authenticated by default;
-- we narrow both. Only functions listed in app.api_functions are callable by signed-in users (RPCs and the
-- helpers RLS policies call). apply_api_grants() is re-run at the end of every later migration.

create table app.api_functions (
  schema_name text not null check (schema_name in ('public','app')),
  function_name text not null,
  primary key (schema_name, function_name)
);

create function app.apply_api_grants() returns void
language plpgsql set search_path = '' as $$
declare
  t text;
  f record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    -- server-internal tables stay closed to API roles entirely
    if t not in ('id_counters','idempotency_keys') then
      execute format('grant select on public.%I to authenticated', t);
    end if;
  end loop;
  revoke all on all sequences in schema public from anon, authenticated;
  revoke execute on all functions in schema public from public, anon, authenticated;
  revoke execute on all functions in schema app from public, anon, authenticated;
  grant usage on schema app to authenticated;
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           join app.api_functions a on a.schema_name = n.nspname and a.function_name = p.proname loop
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;

alter default privileges in schema app revoke execute on functions from public;

do $$ begin perform app.apply_api_grants(); end $$;

-- ── Realtime: staff screens refresh on these; families refresh on their own notifications ──

alter publication supabase_realtime add table
  public.callbacks, public.tasks, public.referrals, public.referral_events, public.investigations,
  public.investigation_results, public.encounters, public.self_logs, public.notifications, public.babies,
  public.immunizations, public.discharges, public.pregnancies, public.tags, public.admissions,
  public.care_assignments;
