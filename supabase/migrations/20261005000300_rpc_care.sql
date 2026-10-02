-- Care Team RPCs. Every write in the app goes through one of these.
--
-- Each mutating RPC, in order:
--   1. app.only_keys            payload allowlist (nested objects and arrays too) — unknown keys are refused
--   2. app.idem_begin           idempotency: a replay returns the stored response; key reuse with other data → 409
--   3. role + object access     the caller's role, and visibility of every id in the payload (404 when not visible,
--                               so ids can't be probed)
--   4. version check            stale writes are refused (409)
--   5. writes                   set-based; the integrity triggers re-validate everything
--   6. app.audit_event          semantic event (row changes are audited by trigger)
--   7. app.idem_finish          stores and returns the response
-- Errors use PostgREST SQLSTATEs → HTTP: PT403 role · PT404 not visible · PT409 conflict / stale / done · PT422 input.
--
-- Plans (ANC visits, test windows) arrive planned by shared/domain on the device and are plausibility-checked
-- here; vaccine schedules are generated here from vaccine_catalogue.

-- ════════════════════════════════════════════════════════════════════════════════
-- Helpers
-- ════════════════════════════════════════════════════════════════════════════════

create function app.is_demo() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.value = 'true'::jsonb from public.app_settings s where s.key = 'demo_mode'), false)
$$;

-- Time of a workflow action: the server clock, or the device clock in demo mode (time travel, D8).
create function app.event_time(p_at text) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when p_at is not null and app.is_demo() then p_at::timestamptz else now() end
$$;

-- When something clinically happened: may be in the past (back-entry from paper), never in the future
-- outside demo mode.
create function app.effective_time(p_at text) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  t timestamptz := coalesce(p_at::timestamptz, now());
begin
  if t > now() + interval '10 minutes' and not app.is_demo() then
    raise exception 'A record cannot be dated in the future' using errcode = 'PT422';
  end if;
  return t;
end $$;

-- Every element of a jsonb array must be an object with only allowlisted keys.
create function app.only_keys_each(p jsonb, allowed text[], what text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  e jsonb;
begin
  if p is null or jsonb_typeof(p) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(p) <> 'array' then
    raise exception '% must be a list', what using errcode = 'PT422';
  end if;
  for e in select value from jsonb_array_elements(p) loop
    perform app.only_keys(e, allowed, what);
  end loop;
  return p;
end $$;

-- A list of text. Absent / null → null; anything else that is not a list of strings is refused, so a wrongly typed
-- field can never be silently read as "empty" (found by tests/030_rpc_care.sql R037).
create function app.text_array(j jsonb, what text default 'list') returns text[]
language plpgsql immutable set search_path = '' as $$
begin
  if j is null or jsonb_typeof(j) = 'null' then return null; end if;
  if jsonb_typeof(j) <> 'array' or exists (select 1 from jsonb_array_elements(j) e where jsonb_typeof(e) <> 'string') then
    raise exception '% must be a list of text values', what using errcode = 'PT422';
  end if;
  return array(select jsonb_array_elements_text(j));
end $$;

create function app.require_staff(p_roles text[] default null) returns public.staff
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.staff;
begin
  select * into s from public.staff where user_id = (select auth.uid()) and active;
  if s.id is null then
    raise exception 'This action is for the Care Team' using errcode = 'PT403';
  end if;
  if p_roles is not null and not (s.role = any(p_roles)) then
    raise exception 'Your role (%) cannot do this', s.role using errcode = 'PT403';
  end if;
  return s;
end $$;

create function app.require_reason(p_reason text, p_what text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if nullif(trim(p_reason), '') is null then
    raise exception '% needs a reason', p_what using errcode = 'PT422';
  end if;
  return trim(p_reason);
end $$;

create function app.check_version(p_current int, p jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if p ? 'version' and (p ->> 'version')::int <> p_current then
    raise exception 'Someone else updated this a moment ago. Refresh and try again.' using errcode = 'PT409';
  end if;
end $$;

create function app.not_visible() returns void
language plpgsql set search_path = '' as $$
begin
  raise exception 'Not found' using errcode = 'PT404';
end $$;

-- Visibility for writes — the same rules as the read policies.
create function app.can_see_subject(p_pregnancy uuid, p_baby uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select g.mother_id from public.pregnancies g where g.id = p_pregnancy),
    (select b.mother_id from public.babies b where b.id = p_baby)) in (select app.full_mother_ids())
    or coalesce(p_pregnancy, p_baby) in (select app.subject_ids())
$$;

create function app.can_see_investigation(i public.investigations) returns boolean
language sql stable security definer set search_path = '' as $$
  select i.mother_id in (select app.full_mother_ids())
      or (coalesce(i.pregnancy_id, i.baby_id) in (select app.subject_ids())
          and (not i.sensitive
               or coalesce(i.pregnancy_id, i.baby_id) in (select app.sensitive_subject_ids())
               or i.id in (select app.shared_investigation_ids())))
$$;

-- The clinician who may write this subject's record: obstetricians for a pregnancy, paediatricians for a baby,
-- and only when the subject is visible to them.
create function app.require_writer(p_pregnancy uuid, p_baby uuid) returns public.staff
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.staff;
begin
  if (p_pregnancy is null) = (p_baby is null) then
    raise exception 'Give either pregnancy_id or baby_id' using errcode = 'PT422';
  end if;
  s := app.require_staff(case when p_baby is null then array['obstetrician'] else array['paediatrician'] end);
  if not app.can_see_subject(p_pregnancy, p_baby) then perform app.not_visible(); end if;
  return s;
end $$;

-- Treating care (not referral specialists): call-backs, contacts, task overrides.
create function app.require_care(p_mother uuid) returns public.staff
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.staff := app.require_staff();
begin
  if p_mother is null or not (p_mother in (select app.care_mother_ids())) then perform app.not_visible(); end if;
  return s;
end $$;

create function app.audit_event(p_action text, p_entity_type text, p_entity_id text, p_mother uuid, p_meta jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor, actor_label, role, action, entity_type, entity_id, mother_id, meta)
  values ((select auth.uid()), (select s.name from public.staff s where s.user_id = (select auth.uid())),
          app.actor_role((select auth.uid())), p_action, p_entity_type, p_entity_id, p_mother, coalesce(p_meta, '{}'))
$$;

create function app.local_date(p_hospital uuid, p_at timestamptz) returns date
language sql stable security definer set search_path = '' as $$
  select (p_at at time zone h.timezone)::date from public.hospitals h where h.id = p_hospital
$$;

-- ── Plausibility of plans made on the device (D4) ──────────────────────────────
-- Not clinical judgement: only that a plan can exist (inside the pregnancy, ordered, one visit per day).

create function app.check_planned_tasks(g public.pregnancies, p_tasks jsonb, p_kinds text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  bad text;
begin
  if jsonb_array_length(p_tasks) > 30 then
    raise exception 'Too many planned visits in one request' using errcode = 'PT422';
  end if;
  select string_agg(coalesce(x.title, '?'), ', ') into bad
  from jsonb_to_recordset(p_tasks) as x(kind text, title text, due_from date, due_by date)
  where not (x.kind = any(p_kinds))
     or x.due_by is null or nullif(trim(x.title), '') is null
     or (x.due_from is not null and (x.due_from > x.due_by or x.due_by - x.due_from > 21))
     or x.due_by < app.local_date(g.hospital_id, g.registered_on) - 1
     or (x.kind = 'anc_visit' and x.due_by > g.edd + 14);
  if bad is not null then
    raise exception 'These planned visits are not possible for this pregnancy: %', bad using errcode = 'PT422';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_tasks) as x(kind text, due_by date) group by x.kind, x.due_by having count(*) > 1)
     or exists (select 1 from jsonb_to_recordset(p_tasks) as x(kind text, due_by date)
                join public.tasks k on k.pregnancy_id = g.id and k.kind = x.kind and k.due_by = x.due_by
                                   and k.completed_at is null and k.cancelled_at is null) then
    raise exception 'Two visits of the same kind are planned on one day' using errcode = 'PT422';
  end if;
end $$;

create function app.check_planned_tests(g public.pregnancies, p_tests jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  bad text;
begin
  select string_agg(coalesce(x.code, '?'), ', ') into bad
  from jsonb_to_recordset(p_tests) as x(code text, due_from date, due_by date)
  left join public.investigation_catalogue c on c.code = x.code and c.active and c.applies_to = 'mother'
  where c.code is null or x.due_from is null or x.due_by is null or x.due_from > x.due_by
     or x.due_by > g.edd + 14 or x.due_from < g.edd - 300;
  if bad is not null then
    raise exception 'These planned tests are not possible for this pregnancy: %', bad using errcode = 'PT422';
  end if;
end $$;

create function app.add_tasks(g public.pregnancies, p_tasks jsonb, p_kinds text[], p_generated_by text) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform app.check_planned_tasks(g, p_tasks, p_kinds);
  insert into public.tasks (id, mother_id, pregnancy_id, kind, title, due_from, due_by, appointment_at, place, generated_by)
  select coalesce(x.id, gen_random_uuid()), g.mother_id, g.id, x.kind, trim(x.title), x.due_from, x.due_by,
         x.appointment_at, nullif(trim(x.place), ''), p_generated_by
  from jsonb_to_recordset(p_tasks) as x(id uuid, kind text, title text, due_from date, due_by date,
                                        appointment_at timestamptz, place text);
  get diagnostics n = row_count;
  return n;
end $$;

-- Cancels exactly the open tasks named; if any changed meanwhile, the whole call is refused.
create function app.cancel_tasks(p_pregnancy uuid, p_ids jsonb, p_kind text, p_reason text, p_at timestamptz) returns int
language plpgsql security definer set search_path = '' as $$
declare
  ids uuid[] := array(select x::uuid from jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) x);
  n int;
begin
  if cardinality(ids) = 0 then return 0; end if;
  update public.tasks set cancelled_at = p_at, override_reason = p_reason
    where id = any(ids) and pregnancy_id = p_pregnancy and kind = p_kind and completed_at is null and cancelled_at is null;
  get diagnostics n = row_count;
  if n <> cardinality(ids) then
    raise exception 'Some planned visits changed meanwhile. Refresh and try again.' using errcode = 'PT409';
  end if;
  return n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Identity
-- ════════════════════════════════════════════════════════════════════════════════

-- Everything the app needs to choose a face. Never returns phone numbers or other people's data.
create function public.whoami() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'staff', (select jsonb_build_object('id', s.id, 'name', s.name, 'role', s.role, 'hospital_id', s.hospital_id,
                                        'hospital', h.name,
                                        'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
                                                    'kind', t.kind, 'specialty', t.specialty))
                                                  from public.team_members tm join public.teams t on t.id = tm.team_id
                                                  where tm.staff_id = s.id and tm.to_at is null), '[]'::jsonb))
              from public.staff s join public.hospitals h on h.id = s.hospital_id
              where s.user_id = (select auth.uid()) and s.active),
    'mother', (select jsonb_build_object('mother_id', m.id, 'name', m.name, 'lang', m.lang,
                 'consented', exists (select 1 from public.consents k where k.mother_id = m.id and k.user_id = m.user_id
                                      and k.decision = 'accepted' and k.withdrawn_at is null))
               from public.mothers m where m.user_id = (select auth.uid())),
    'caregiving', coalesce((select jsonb_agg(jsonb_build_object(
                  'caregiver_id', c.id, 'mother_id', m.id, 'mother_name', m.name, 'relation', c.relation,
                  'scopes', jsonb_build_object('schedule', c.scope_schedule, 'baby', c.scope_baby,
                                               'logs', c.scope_logs, 'tests', c.scope_tests),
                  'consented', exists (select 1 from public.consents k where k.mother_id = m.id and k.user_id = c.user_id
                                       and k.decision = 'accepted' and k.withdrawn_at is null)))
                from public.caregivers c join public.mothers m on m.id = c.mother_id
                where c.user_id = (select auth.uid()) and c.revoked_at is null and m.erased_at is null), '[]'::jsonb))
$$;

-- Supabase Auth "before user created" hook: no self sign-up — only numbers the hospital provisioned.
create function app.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  ph text := regexp_replace(coalesce(event -> 'user' ->> 'phone', ''), '[^0-9]', '', 'g');
begin
  if ph <> '' and (exists (select 1 from public.staff s where s.phone = ph and s.active)
                or exists (select 1 from public.mothers m where m.phone = ph)
                or exists (select 1 from public.caregivers c where c.phone = ph and c.revoked_at is null)) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'message', 'This number isn''t registered. Please ask your hospital.', 'http_code', 403));
end $$;

grant usage on schema app to supabase_auth_admin;
grant execute on function app.hook_before_user_created(jsonb) to supabase_auth_admin;

-- Opening a record is audited (PRD F-12, F-60); repeats within 10 minutes collapse into one entry.
create function public.log_access(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.staff;
  v_preg uuid;
  v_baby uuid;
  m uuid;
begin
  perform app.only_keys(p, array['pregnancy_id','baby_id']);
  s := app.require_staff();
  v_preg := (p ->> 'pregnancy_id')::uuid;
  v_baby := (p ->> 'baby_id')::uuid;
  if (v_preg is null) = (v_baby is null) or not app.can_see_subject(v_preg, v_baby) then perform app.not_visible(); end if;
  m := coalesce((select mother_id from public.pregnancies where id = v_preg), (select mother_id from public.babies where id = v_baby));
  if not exists (select 1 from public.audit_log a where a.action = 'view_record' and a.actor = (select auth.uid())
                 and a.entity_id = coalesce(v_preg, v_baby)::text and a.at > now() - interval '10 minutes') then
    perform app.audit_event('view_record', case when v_preg is null then 'babies' else 'pregnancies' end,
                            coalesce(v_preg, v_baby)::text, m);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Registration
-- ════════════════════════════════════════════════════════════════════════════════

create function public.register_pregnancy(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  pm jsonb;
  pg jsonb;
  pd jsonb;
  ph jsonb;
  t public.teams;
  paeds uuid;
  v_mother uuid;
  m public.mothers;
  g public.pregnancies;
  e public.encounters;
  v_at timestamptz;
  yr text;
  v_mch text;
  v_mrn text;
  result jsonb;
begin
  perform app.only_keys(p, array['idempotency_key','mother','pregnancy','dating','history','team_id','intensity','tags',
                                 'tag_note','investigations','tasks','ga_days','source']);
  pm := app.only_keys(coalesce(p -> 'mother', '{}'), array['id','phone','alt_phone','name','husband_name','dob','dob_estimated',
          'age','lang','village','district','state','pincode','emergency_contact','rch_id','abha_number','abha_address'], 'mother');
  pg := app.only_keys(coalesce(p -> 'pregnancy', '{}'), array['id','registered_on','gravida','para','living','abortions','fetuses'], 'pregnancy');
  pd := app.only_keys(coalesce(p -> 'dating', '{}'), array['method','lmp','lmp_certain','scan_on','ga_at_scan_days','edd','note'], 'dating');
  ph := app.only_keys(coalesce(p -> 'history', '{}'), array['conditions','allergies','medicines','blood_group','height_cm','previous'], 'history');
  perform app.only_keys_each(p -> 'investigations', array['id','code','due_from','due_by','late'], 'investigations');
  perform app.only_keys_each(p -> 'tasks', array['id','kind','title','due_from','due_by','appointment_at','place'], 'tasks');
  perform app.only_keys_each(ph -> 'previous', array['year','outcome','mode','gestation_weeks','complications','note'], 'previous pregnancies');

  prior := app.idem_begin('register_pregnancy', p);
  if prior is not null then return prior; end if;

  s := app.require_staff(array['obstetrician']);
  if pg ->> 'id' is null then
    raise exception 'pregnancy.id is required' using errcode = 'PT422';
  end if;
  select * into t from public.teams where id = (p ->> 'team_id')::uuid;
  if t.id is null or t.hospital_id <> s.hospital_id or t.kind <> 'unit' or t.specialty <> 'obstetrics' or not t.active then
    raise exception 'Choose an obstetric unit of this hospital' using errcode = 'PT422';
  end if;
  -- the paediatric team that will take over at 34 weeks: the hospital's default, or its only paediatric unit
  paeds := coalesce((select (h.settings ->> 'default_paediatric_team_id')::uuid from public.hospitals h where h.id = s.hospital_id),
                    (select x.id from public.teams x where x.hospital_id = s.hospital_id and x.kind = 'unit'
                       and x.specialty = 'paediatrics' and x.active
                       and (select count(*) from public.teams y where y.hospital_id = s.hospital_id and y.kind = 'unit'
                              and y.specialty = 'paediatrics' and y.active) = 1));
  if paeds is null then
    raise exception 'This hospital has no default paediatric team' using errcode = 'PT422';
  end if;
  v_at := app.effective_time(pg ->> 'registered_on');

  -- One phone = one mother: the same person starts a new pregnancy; anyone else is refused.
  select * into m from public.mothers where phone = pm ->> 'phone';
  if m.id is not null and lower(trim(m.name)) <> lower(trim(pm ->> 'name')) then
    raise exception 'This phone number already belongs to another patient. Use a different number.' using errcode = 'PT409';
  end if;
  if m.id is null then
    insert into public.mothers (id, phone, alt_phone, name, husband_name, dob, dob_estimated, age_at_registration, lang,
                                village, district, state, pincode, emergency_contact, created_by)
    values (coalesce((pm ->> 'id')::uuid, gen_random_uuid()), pm ->> 'phone', pm ->> 'alt_phone', trim(pm ->> 'name'),
            pm ->> 'husband_name', (pm ->> 'dob')::date, coalesce((pm ->> 'dob_estimated')::boolean, false), (pm ->> 'age')::int,
            coalesce(pm ->> 'lang', 'en'), pm ->> 'village', pm ->> 'district', pm ->> 'state', pm ->> 'pincode',
            pm -> 'emergency_contact', s.id)
    returning * into m;
  end if;
  v_mother := m.id;

  yr := to_char(app.local_date(s.hospital_id, v_at), 'YYYY');
  v_mch := 'MCH-' || yr || '-' || lpad(app.next_number(s.hospital_id, 'mch', yr)::text, 6, '0');
  begin
    insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions,
                                    fetuses, intensity, intensity_set_by, intensity_set_at, source, created_by)
    values ((pg ->> 'id')::uuid, v_mch, v_mother, s.hospital_id, v_at, (pd ->> 'edd')::date, (pg ->> 'gravida')::int,
            (pg ->> 'para')::int, (pg ->> 'living')::int, (pg ->> 'abortions')::int, (pg ->> 'fetuses')::int,
            coalesce(p ->> 'intensity', 'routine'), s.id, v_at, coalesce(p ->> 'source', 'clinician'), s.id)
    returning * into g;
  exception when unique_violation then
    raise exception 'This mother already has an active pregnancy' using errcode = 'PT409';
  end;

  insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, lmp_certain, scan_on, ga_at_scan_days, edd,
                                        note, decided_by, decided_at)
  values (g.id, v_mother, coalesce(pd ->> 'method', 'lmp'), (pd ->> 'lmp')::date, (pd ->> 'lmp_certain')::boolean,
          (pd ->> 'scan_on')::date, (pd ->> 'ga_at_scan_days')::int, (pd ->> 'edd')::date, pd ->> 'note', s.id, v_at);

  insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at, assigned_by, reason)
  values (v_mother, g.id, 'obstetrics', t.id, s.id, v_at, s.id, 'Registration'),
         (v_mother, g.id, 'paediatrics', paeds, null, v_at, s.id, 'Registration (from 34 weeks)');

  -- Identifiers: MRN once per hospital; national ids as documented.
  if not exists (select 1 from public.patient_identifiers i where i.mother_id = v_mother and i.system = 'mrn'
                 and i.hospital_id = s.hospital_id and i.baby_id is null) then
    v_mrn := (select h.code from public.hospitals h where h.id = s.hospital_id) || '-'
             || lpad(app.next_number(s.hospital_id, 'mrn', 'all')::text, 6, '0');
    insert into public.patient_identifiers (mother_id, system, value, hospital_id, assigned_by)
    values (v_mother, 'mrn', v_mrn, s.hospital_id, s.id);
  else
    v_mrn := (select i.value from public.patient_identifiers i where i.mother_id = v_mother and i.system = 'mrn'
              and i.hospital_id = s.hospital_id and i.baby_id is null);
  end if;
  begin
    insert into public.patient_identifiers (mother_id, system, value, assigned_by)
    select v_mother, x.system, trim(x.value), s.id
    from (values ('rch', pm ->> 'rch_id'), ('abha_number', pm ->> 'abha_number'), ('abha_address', pm ->> 'abha_address')) x(system, value)
    where nullif(trim(x.value), '') is not null
      and not exists (select 1 from public.patient_identifiers i where i.mother_id = v_mother and i.system = x.system
                      and i.value = trim(x.value));
  exception when unique_violation then
    raise exception 'This RCH / ABHA id already belongs to another patient' using errcode = 'PT409';
  end;

  -- Documented history, as recorded.
  insert into public.previous_pregnancies (mother_id, documented_in, year, outcome, mode, gestation_weeks, complications, note, recorded_by)
  select v_mother, g.id, x.year, x.outcome, x.mode, x.gestation_weeks, coalesce(x.complications, '{}'), x.note, s.id
  from jsonb_to_recordset(coalesce(ph -> 'previous', '[]'::jsonb))
       as x(year int, outcome text, mode text, gestation_weeks int, complications text[], note text);
  insert into public.documented_conditions (mother_id, pregnancy_id, label, recorded_by)
  select v_mother, g.id, trim(c), s.id from unnest(coalesce(app.text_array(ph -> 'conditions', 'conditions'), '{}')) c
  where nullif(trim(c), '') is not null
    and not exists (select 1 from public.documented_conditions d where d.mother_id = v_mother and lower(d.label) = lower(trim(c))
                    and d.status = 'final' and d.clinical_status = 'active');
  insert into public.allergies (mother_id, substance, recorded_by)
  select v_mother, trim(a), s.id from unnest(coalesce(app.text_array(ph -> 'allergies', 'allergies'), '{}')) a
  where nullif(trim(a), '') is not null
    and not exists (select 1 from public.allergies x where x.mother_id = v_mother and lower(x.substance) = lower(trim(a)) and x.status = 'final');
  insert into public.medications (mother_id, pregnancy_id, kind, name)
  select v_mother, g.id, 'statement', trim(d) from unnest(coalesce(app.text_array(ph -> 'medicines', 'medicines'), '{}')) d
  where nullif(trim(d), '') is not null;

  -- The registration encounter carries documented measurements.
  insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff, ga_days, source)
  values (v_mother, g.id, 'registration', v_at, s.id, (p ->> 'ga_days')::int, coalesce(p ->> 'source', 'clinician'))
  returning * into e;
  insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, value_text, at, by_staff)
  select e.id, v_mother, g.id, x.code, x.num, x.txt, v_at, s.id
  from (values ('blood_group', null::numeric, nullif(trim(ph ->> 'blood_group'), '')),
               ('height', (ph ->> 'height_cm')::numeric, null)) x(code, num, txt)
  where x.num is not null or x.txt is not null;

  insert into public.tags (mother_id, pregnancy_id, code, note, set_by, set_at)
  select v_mother, g.id, c, nullif(trim(p ->> 'tag_note'), ''), s.id, v_at
  from unnest(coalesce(app.text_array(p -> 'tags', 'tags'), '{}')) c;

  perform app.check_planned_tests(g, coalesce(p -> 'investigations', '[]'::jsonb));
  insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by, late, generated_by)
  select coalesce(x.id, gen_random_uuid()), v_mother, g.id, x.code, c.label, x.due_from, x.due_by, coalesce(x.late, false), 'protocol'
  from jsonb_to_recordset(coalesce(p -> 'investigations', '[]'::jsonb)) as x(id uuid, code text, due_from date, due_by date, late boolean)
  join public.investigation_catalogue c on c.code = x.code;

  perform app.add_tasks(g, coalesce(p -> 'tasks', '[]'::jsonb), array['anc_visit'], 'protocol');

  -- Maternal Td: the first dose is due now; the second is scheduled when the first is given (vaccine schedule is
  -- generated on the server from vaccine_catalogue).
  insert into public.immunizations (mother_id, pregnancy_id, code, due_on)
  values (v_mother, g.id, 'td1', app.local_date(s.hospital_id, v_at));

  perform app.audit_event('register_pregnancy', 'pregnancies', g.id::text, v_mother,
                          jsonb_build_object('mch_id', v_mch, 'source', coalesce(p ->> 'source', 'clinician')));
  result := jsonb_build_object('mother_id', v_mother, 'pregnancy_id', g.id, 'mch_id', v_mch, 'mrn', v_mrn);
  return app.idem_finish(p, result);
end $$;

create function public.redate_pregnancy(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  g public.pregnancies;
  pd jsonb;
  v_at timestamptz;
  cancelled int;
  created int;
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','version','dating','cancel_task_ids','new_tasks','at']);
  pd := app.only_keys(coalesce(p -> 'dating', '{}'), array['method','lmp','lmp_certain','scan_on','ga_at_scan_days','investigation_id','edd','note'], 'dating');
  perform app.only_keys_each(p -> 'new_tasks', array['id','kind','title','due_from','due_by','appointment_at','place'], 'new_tasks');
  prior := app.idem_begin('redate_pregnancy', p);
  if prior is not null then return prior; end if;

  s := app.require_writer((p ->> 'pregnancy_id')::uuid, null);
  select * into g from public.pregnancies where id = (p ->> 'pregnancy_id')::uuid for update;
  perform app.check_version(g.version, p);
  if g.status <> 'active' then
    raise exception 'Only an ongoing pregnancy can be re-dated' using errcode = 'PT409';
  end if;
  v_at := app.event_time(p ->> 'at');
  insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, lmp_certain, scan_on, ga_at_scan_days,
                                        investigation_id, edd, note, decided_by, decided_at)
  values (g.id, g.mother_id, pd ->> 'method', (pd ->> 'lmp')::date, (pd ->> 'lmp_certain')::boolean, (pd ->> 'scan_on')::date,
          (pd ->> 'ga_at_scan_days')::int, (pd ->> 'investigation_id')::uuid, (pd ->> 'edd')::date, pd ->> 'note', s.id, v_at);
  select * into g from public.pregnancies where id = g.id;
  cancelled := app.cancel_tasks(g.id, p -> 'cancel_task_ids', 'anc_visit', 'Re-planned after re-dating', v_at);
  created := app.add_tasks(g, coalesce(p -> 'new_tasks', '[]'::jsonb), array['anc_visit'], 'protocol');
  perform app.audit_event('redate_pregnancy', 'pregnancies', g.id::text, g.mother_id,
                          jsonb_build_object('edd', pd ->> 'edd', 'method', pd ->> 'method'));
  return app.idem_finish(p, jsonb_build_object('edd', g.edd, 'version', g.version, 'cancelled', cancelled, 'created', created));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- ANC visit
-- ════════════════════════════════════════════════════════════════════════════════

create function public.record_visit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  g public.pregnancies;
  e public.encounters;
  closed int := 0;
  cancelled int;
  created int;
begin
  perform app.only_keys(p, array['idempotency_key','encounter_id','pregnancy_id','at','ga_days','observations','checklist',
                                 'complaints','complaints_note','counselling','note','completeness','close_task_id',
                                 'cancel_task_ids','new_tasks']);
  perform app.only_keys_each(p -> 'observations', array['code','value_num','value_text','unit'], 'observations');
  perform app.only_keys_each(p -> 'checklist', array['component','state','reason'], 'checklist');
  perform app.only_keys_each(p -> 'new_tasks', array['id','kind','title','due_from','due_by','appointment_at','place'], 'new_tasks');
  prior := app.idem_begin('record_visit', p);
  if prior is not null then return prior; end if;

  s := app.require_writer((p ->> 'pregnancy_id')::uuid, null);
  select * into g from public.pregnancies where id = (p ->> 'pregnancy_id')::uuid;
  if g.status <> 'active' then
    raise exception 'ANC visits are recorded for an ongoing pregnancy' using errcode = 'PT409';
  end if;

  insert into public.encounters (id, mother_id, pregnancy_id, kind, at, by_staff, ga_days, complaints, complaints_note,
                                 counselling, note, completeness)
  values (coalesce((p ->> 'encounter_id')::uuid, gen_random_uuid()), g.mother_id, g.id, 'anc', app.effective_time(p ->> 'at'),
          s.id, (p ->> 'ga_days')::int, coalesce(app.text_array(p -> 'complaints', 'complaints'), '{}'), nullif(trim(p ->> 'complaints_note'), ''),
          coalesce(app.text_array(p -> 'counselling', 'counselling'), '{}'), nullif(trim(p ->> 'note'), ''), (p ->> 'completeness')::numeric)
  returning * into e;

  insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, value_text, unit, at, by_staff)
  select e.id, e.mother_id, e.pregnancy_id, x.code, x.value_num, nullif(trim(x.value_text), ''), x.unit, e.at, s.id
  from jsonb_to_recordset(coalesce(p -> 'observations', '[]'::jsonb)) as x(code text, value_num numeric, value_text text, unit text);

  insert into public.encounter_checklist (encounter_id, mother_id, component, state, reason)
  select e.id, e.mother_id, x.component, x.state, nullif(trim(x.reason), '')
  from jsonb_to_recordset(coalesce(p -> 'checklist', '[]'::jsonb)) as x(component text, state text, reason text);

  if p ->> 'close_task_id' is not null then
    update public.tasks set completed_at = e.at, completed_by_encounter_id = e.id
      where id = (p ->> 'close_task_id')::uuid and pregnancy_id = g.id and kind = 'anc_visit'
        and completed_at is null and cancelled_at is null;
    get diagnostics closed = row_count;
    if closed = 0 then
      raise exception 'That visit is no longer open. Refresh and try again.' using errcode = 'PT409';
    end if;
  end if;
  cancelled := app.cancel_tasks(g.id, p -> 'cancel_task_ids', 'anc_visit', 'Re-planned after visit', app.event_time(p ->> 'at'));
  created := app.add_tasks(g, coalesce(p -> 'new_tasks', '[]'::jsonb), array['anc_visit'], 'protocol');

  return app.idem_finish(p, jsonb_build_object('encounter_id', e.id, 'closed_task_id', p ->> 'close_task_id',
                                               'cancelled', cancelled, 'created', created));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Tags, intensity, care team, emergency override
-- ════════════════════════════════════════════════════════════════════════════════

create function public.set_tags(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  m uuid;
  codes text[];
  t timestamptz;
  removed text[];
  added text[];
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','baby_id','codes','note','removal_reason','at']);
  prior := app.idem_begin('set_tags', p);
  if prior is not null then return prior; end if;

  s := app.require_writer(v_preg, v_baby);
  m := coalesce((select mother_id from public.pregnancies where id = v_preg), (select mother_id from public.babies where id = v_baby));
  codes := coalesce(app.text_array(p -> 'codes', 'codes'), '{}');
  t := app.event_time(p ->> 'at');
  select coalesce(array_agg(code), '{}') into removed from public.tags
    where (pregnancy_id = v_preg or baby_id = v_baby) and removed_at is null and not (code = any(codes));
  if cardinality(removed) > 0 then
    update public.tags set removed_at = t, removed_by = s.id, removed_reason = app.require_reason(p ->> 'removal_reason', 'Removing a tag')
      where (pregnancy_id = v_preg or baby_id = v_baby) and removed_at is null and code = any(removed);
  end if;
  select coalesce(array_agg(x), '{}') into added from unnest(codes) x
    where not exists (select 1 from public.tags g where (g.pregnancy_id = v_preg or g.baby_id = v_baby)
                        and g.removed_at is null and g.code = x);
  insert into public.tags (mother_id, pregnancy_id, baby_id, code, note, set_by, set_at)
  select m, v_preg, v_baby, c, nullif(trim(p ->> 'note'), ''), s.id, t from unnest(added) c;
  return app.idem_finish(p, jsonb_build_object('added', to_jsonb(added), 'removed', to_jsonb(removed)));
end $$;

-- Intensity is the clinician's choice (never the system's); for a pregnancy it re-plans future ANC visits.
create function public.set_intensity(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  t timestamptz;
  g public.pregnancies;
  b public.babies;
  before text;
  cancelled int := 0;
  created int := 0;
  m uuid;
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','baby_id','version','intensity','note','cancel_task_ids','new_tasks','at']);
  perform app.only_keys_each(p -> 'new_tasks', array['id','kind','title','due_from','due_by','appointment_at','place'], 'new_tasks');
  prior := app.idem_begin('set_intensity', p);
  if prior is not null then return prior; end if;

  s := app.require_writer(v_preg, v_baby);
  t := app.event_time(p ->> 'at');
  if v_preg is not null then
    select * into g from public.pregnancies where id = v_preg for update;
    perform app.check_version(g.version, p);
    before := g.intensity;
    m := g.mother_id;
    update public.pregnancies set intensity = p ->> 'intensity', intensity_set_by = s.id, intensity_set_at = t where id = g.id;
    select * into g from public.pregnancies where id = v_preg;
    cancelled := app.cancel_tasks(g.id, p -> 'cancel_task_ids', 'anc_visit', 'Re-planned: follow-up intensity changed', t);
    created := app.add_tasks(g, coalesce(p -> 'new_tasks', '[]'::jsonb), array['anc_visit'], 'protocol');
  else
    select * into b from public.babies where id = v_baby for update;
    perform app.check_version(b.version, p);
    before := b.intensity;
    m := b.mother_id;
    update public.babies set intensity = p ->> 'intensity' where id = b.id;
  end if;
  perform app.audit_event('set_intensity', case when v_preg is null then 'babies' else 'pregnancies' end,
                          coalesce(v_preg, v_baby)::text, m,
                          jsonb_build_object('from', before, 'to', p ->> 'intensity', 'note', p ->> 'note'));
  return app.idem_finish(p, jsonb_build_object('intensity', p ->> 'intensity', 'cancelled', cancelled, 'created', created));
end $$;

-- Reassign the primary clinician and/or team (any clinician currently on the subject's team, with a reason).
create function public.assign_care(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  cur public.care_assignments;
  reason text;
  t timestamptz;
  new_id uuid;
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','baby_id','specialty','team_id','primary_staff_id','reason','at']);
  prior := app.idem_begin('assign_care', p);
  if prior is not null then return prior; end if;

  s := app.require_staff(array['obstetrician','paediatrician']);
  if app.role_specialty(s.role) <> p ->> 'specialty' then
    raise exception 'A % cannot change the % team', s.role, p ->> 'specialty' using errcode = 'PT403';
  end if;
  select * into cur from public.care_assignments
    where (pregnancy_id = v_preg or baby_id = v_baby) and specialty = p ->> 'specialty' and to_at is null for update;
  if cur.id is null or not app.can_see_subject(v_preg, v_baby) then perform app.not_visible(); end if;
  if not (cur.primary_staff_id = s.id
          or exists (select 1 from public.team_members tm where tm.team_id = cur.team_id and tm.staff_id = s.id and tm.to_at is null)) then
    raise exception 'Only the patient''s current team can reassign her' using errcode = 'PT403';
  end if;
  reason := app.require_reason(p ->> 'reason', 'Reassigning a patient');
  t := app.event_time(p ->> 'at');
  update public.care_assignments set to_at = t where id = cur.id;
  insert into public.care_assignments (mother_id, pregnancy_id, baby_id, specialty, team_id, primary_staff_id, from_at, assigned_by, reason)
  values (cur.mother_id, cur.pregnancy_id, cur.baby_id, cur.specialty, coalesce((p ->> 'team_id')::uuid, cur.team_id),
          (p ->> 'primary_staff_id')::uuid, t, s.id, reason)
  returning id into new_id;
  perform app.audit_event('reassign', 'care_assignments', new_id::text, cur.mother_id, jsonb_build_object('reason', reason));
  return app.idem_finish(p, jsonb_build_object('assignment_id', new_id));
end $$;

-- Emergency override ("break the glass"): 24 hours, a reason, audited.
create function public.grant_override(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  o public.access_overrides;
begin
  perform app.only_keys(p, array['idempotency_key','mother_id','reason']);
  prior := app.idem_begin('grant_override', p);
  if prior is not null then return prior; end if;

  s := app.require_staff(array['obstetrician','paediatrician']);
  if not exists (select 1 from public.pregnancies g where g.mother_id = (p ->> 'mother_id')::uuid and g.hospital_id = s.hospital_id)
     or exists (select 1 from public.mothers m where m.id = (p ->> 'mother_id')::uuid and m.user_id = (select auth.uid())) then
    perform app.not_visible();
  end if;
  insert into public.access_overrides (staff_id, mother_id, reason, expires_at)
  values (s.id, (p ->> 'mother_id')::uuid, app.require_reason(p ->> 'reason', 'An emergency override'), now() + interval '24 hours')
  returning * into o;
  perform app.audit_event('override_granted', 'access_overrides', o.id::text, o.mother_id, jsonb_build_object('reason', o.reason));
  return app.idem_finish(p, jsonb_build_object('override_id', o.id, 'expires_at', o.expires_at));
end $$;

create function public.end_override(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  n int;
begin
  perform app.only_keys(p, array['idempotency_key','override_id']);
  prior := app.idem_begin('end_override', p);
  if prior is not null then return prior; end if;
  s := app.require_staff();
  update public.access_overrides set ended_at = now()
    where id = (p ->> 'override_id')::uuid and staff_id = s.id and ended_at is null and expires_at > now();
  get diagnostics n = row_count;
  if n = 0 then perform app.not_visible(); end if;
  return app.idem_finish(p, jsonb_build_object('ended', true));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Investigations
-- ════════════════════════════════════════════════════════════════════════════════

-- Lifecycle: due → ordered → collected → resulted → reviewed; not_done / not_applicable with a reason.
-- "resulted" is reached only through record_result.
create function public.update_investigation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  i public.investigations;
  t timestamptz;
  act text := p ->> 'action';
begin
  perform app.only_keys(p, array['idempotency_key','id','version','action','reason','follow_up','at']);
  prior := app.idem_begin('update_investigation', p);
  if prior is not null then return prior; end if;

  select * into i from public.investigations where id = (p ->> 'id')::uuid for update;
  if i.id is null or not app.can_see_investigation(i) then perform app.not_visible(); end if;
  s := app.require_writer(i.pregnancy_id, i.baby_id);
  perform app.check_version(i.version, p);
  t := app.event_time(p ->> 'at');
  if act = 'order' and i.status = 'due' then
    update public.investigations set status = 'ordered', ordered_at = t, ordered_by = s.id where id = i.id;
  elsif act = 'collect' and i.status in ('due','ordered') then
    update public.investigations set status = 'collected', collected_at = t where id = i.id;
  elsif act in ('not_done','not_applicable') and i.status in ('due','ordered','collected') then
    update public.investigations set status = act, not_done_reason = app.require_reason(p ->> 'reason', 'Not done') where id = i.id;
  elsif act = 'review' and i.status = 'resulted' then
    if coalesce(p ->> 'follow_up', '') not in ('none','repeat','refer','discuss_next_visit') then
      raise exception 'Choose a follow-up: none, repeat, refer or discuss at next visit' using errcode = 'PT422';
    end if;
    update public.investigations set status = 'reviewed', reviewed_at = t, reviewed_by = s.id, follow_up = p ->> 'follow_up' where id = i.id;
  elsif act in ('order','collect','not_done','not_applicable','review') then
    raise exception 'This test is % and cannot be marked %', i.status, act using errcode = 'PT409';
  else
    raise exception 'Unknown action %', act using errcode = 'PT422';
  end if;
  select * into i from public.investigations where id = i.id;
  return app.idem_finish(p, jsonb_build_object('id', i.id, 'status', i.status, 'version', i.version));
end $$;

-- A new result (or a correction) always needs a fresh clinician review.
create function public.record_result(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  i public.investigations;
  r public.investigation_results;
begin
  perform app.only_keys(p, array['idempotency_key','id','investigation_id','version','value_num','value_text','unit',
                                 'lab_flag','reported_at','note','source','document_id','supersedes']);
  prior := app.idem_begin('record_result', p);
  if prior is not null then return prior; end if;

  select * into i from public.investigations where id = (p ->> 'investigation_id')::uuid for update;
  if i.id is null or not app.can_see_investigation(i) then perform app.not_visible(); end if;
  s := app.require_writer(i.pregnancy_id, i.baby_id);
  perform app.check_version(i.version, p);
  insert into public.investigation_results (id, investigation_id, mother_id, value_num, value_text, unit, lab_flag, reported_at,
                                            entered_by, source, document_id, note, status, supersedes)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), i.id, i.mother_id, (p ->> 'value_num')::numeric,
          nullif(trim(p ->> 'value_text'), ''), p ->> 'unit', nullif(trim(p ->> 'lab_flag'), ''),
          app.effective_time(p ->> 'reported_at'), s.id, coalesce(p ->> 'source', 'manual'), (p ->> 'document_id')::uuid,
          nullif(trim(p ->> 'note'), ''), case when p ? 'supersedes' then 'corrected' else 'final' end, (p ->> 'supersedes')::uuid)
  returning * into r;
  update public.investigations set status = 'resulted', reviewed_at = null, reviewed_by = null, follow_up = null where id = i.id;
  return app.idem_finish(p, jsonb_build_object('result_id', r.id, 'status', r.status));
end $$;

-- Share one result (possibly sensitive) with a referral's department. Only a clinician who can see that
-- result and who may write the referred subject can share it.
create function public.share_result(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  i public.investigations;
  r public.referrals;
begin
  perform app.only_keys(p, array['idempotency_key','referral_id','investigation_id']);
  prior := app.idem_begin('share_result', p);
  if prior is not null then return prior; end if;
  select * into r from public.referrals where id = (p ->> 'referral_id')::uuid;
  select * into i from public.investigations where id = (p ->> 'investigation_id')::uuid;
  if r.id is null or i.id is null or not app.can_see_investigation(i) or i.mother_id <> r.mother_id then
    perform app.not_visible();
  end if;
  s := app.require_writer(r.pregnancy_id, r.baby_id);
  insert into public.referral_shared_results (referral_id, investigation_id, mother_id, shared_by)
  values (r.id, i.id, r.mother_id, s.id) on conflict do nothing;
  perform app.audit_event('result_shared', 'referrals', r.id::text, r.mother_id, jsonb_build_object('investigation_id', i.id));
  return app.idem_finish(p, jsonb_build_object('shared', true));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Referrals
-- ════════════════════════════════════════════════════════════════════════════════

create function public.create_referral(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  m uuid;
  t timestamptz;
  r public.referrals;
begin
  perform app.only_keys(p, array['idempotency_key','id','pregnancy_id','baby_id','to_team_id','from_encounter_id','urgency',
                                 'reason','question','at']);
  prior := app.idem_begin('create_referral', p);
  if prior is not null then return prior; end if;

  s := app.require_writer(v_preg, v_baby);
  m := coalesce((select mother_id from public.pregnancies where id = v_preg), (select mother_id from public.babies where id = v_baby));
  if not exists (select 1 from public.teams x where x.id = (p ->> 'to_team_id')::uuid and x.hospital_id = s.hospital_id
                 and x.kind = 'department' and x.active) then
    raise exception 'Choose a department of this hospital' using errcode = 'PT422';
  end if;
  t := app.event_time(p ->> 'at');
  insert into public.referrals (id, mother_id, pregnancy_id, baby_id, to_team_id, from_encounter_id, urgency, reason, question,
                                created_by, created_at)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), m, v_preg, v_baby, (p ->> 'to_team_id')::uuid,
          (p ->> 'from_encounter_id')::uuid, p ->> 'urgency', trim(p ->> 'reason'), trim(p ->> 'question'), s.id, t)
  returning * into r;
  insert into public.referral_events (referral_id, mother_id, status, at, by_staff) values (r.id, m, 'requested', t, s.id);
  return app.idem_finish(p, jsonb_build_object('referral_id', r.id, 'version', r.version));
end $$;

-- The receiving department accepts/declines, schedules, sees and answers; the referring team closes or cancels.
create function public.advance_referral(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  r public.referrals;
  t timestamptz;
  dest text := p ->> 'to';
  receiving boolean;
  referring boolean;
  dept text;
  hosp uuid;
begin
  perform app.only_keys(p, array['idempotency_key','id','version','to','scheduled_at','place','recommendations','note',
                                 'appointment_task_id','at']);
  prior := app.idem_begin('advance_referral', p);
  if prior is not null then return prior; end if;

  s := app.require_staff();
  select * into r from public.referrals where id = (p ->> 'id')::uuid for update;
  if r.id is null or not app.can_see_subject(r.pregnancy_id, r.baby_id) then perform app.not_visible(); end if;
  perform app.check_version(r.version, p);
  receiving := exists (select 1 from public.team_members tm where tm.team_id = r.to_team_id and tm.staff_id = s.id and tm.to_at is null);
  referring := s.role = case when r.baby_id is null then 'obstetrician' else 'paediatrician' end
               and coalesce(r.pregnancy_id, r.baby_id) is not null
               and (r.mother_id in (select app.full_mother_ids()) or coalesce(r.pregnancy_id, r.baby_id) in (
                      select coalesce(g.pregnancy_id, g.baby_id) from app.my_grants() g where g.source <> 'referral'));

  if not ((r.status = 'requested' and dest in ('accepted','declined') and receiving)
       or (r.status in ('accepted','scheduled') and dest = 'scheduled' and receiving)
       or (r.status = 'scheduled' and dest = 'seen' and receiving)
       or (r.status = 'seen' and dest = 'recommendations' and receiving)
       or (r.status = 'recommendations' and dest = 'closed' and referring)
       or (r.status in ('requested','accepted','scheduled') and dest = 'cancelled' and referring)) then
    if dest in ('requested','accepted','declined','scheduled','seen','recommendations','closed','cancelled') then
      raise exception 'A % referral cannot be moved to % by %', r.status, dest,
        case when receiving then 'the receiving department' when referring then 'the referring team' else 'you' end
        using errcode = 'PT409';
    end if;
    raise exception 'Unknown referral status %', dest using errcode = 'PT422';
  end if;
  if dest = 'scheduled' and p ->> 'scheduled_at' is null then
    raise exception 'Scheduling needs a date and time' using errcode = 'PT422';
  end if;
  if dest = 'recommendations' and nullif(trim(p ->> 'recommendations'), '') is null then
    raise exception 'Write the recommendations' using errcode = 'PT422';
  end if;
  if dest in ('declined','cancelled') then perform app.require_reason(p ->> 'note', initcap(dest)); end if;

  t := app.event_time(p ->> 'at');
  update public.referrals set status = dest,
         scheduled_at = coalesce((p ->> 'scheduled_at')::timestamptz, scheduled_at),
         place = coalesce(nullif(trim(p ->> 'place'), ''), place),
         recommendations = coalesce(nullif(trim(p ->> 'recommendations'), ''), recommendations),
         ended_at = case when dest in ('closed','declined','cancelled') then t end
    where id = r.id;
  -- strictly after the previous event, so "latest event" is unambiguous
  insert into public.referral_events (referral_id, mother_id, status, at, by_staff, note)
  values (r.id, r.mother_id, dest,
          greatest(t, (select max(e.at) + interval '1 millisecond' from public.referral_events e where e.referral_id = r.id)),
          s.id, nullif(trim(p ->> 'note'), ''));

  -- The appointment is a task the family sees; it follows the referral.
  if dest in ('scheduled','declined','cancelled') then
    update public.tasks set cancelled_at = t,
           override_reason = case dest when 'scheduled' then 'Appointment rescheduled' else 'Referral ' || dest end
      where referral_id = r.id and completed_at is null and cancelled_at is null;
  end if;
  if dest = 'scheduled' then
    select x.name, x.hospital_id into dept, hosp from public.teams x where x.id = r.to_team_id;
    insert into public.tasks (id, mother_id, pregnancy_id, baby_id, kind, title, referral_id, place, due_from, due_by,
                              appointment_at, generated_by)
    values (coalesce((p ->> 'appointment_task_id')::uuid, gen_random_uuid()), r.mother_id, r.pregnancy_id, r.baby_id,
            'referral_appt', dept || ' appointment', r.id, nullif(trim(p ->> 'place'), ''),
            app.local_date(hosp, (p ->> 'scheduled_at')::timestamptz), app.local_date(hosp, (p ->> 'scheduled_at')::timestamptz),
            (p ->> 'scheduled_at')::timestamptz, 'clinician');
  end if;
  if dest = 'seen' then
    update public.tasks set completed_at = t where referral_id = r.id and completed_at is null and cancelled_at is null;
  end if;
  select * into r from public.referrals where id = r.id;
  return app.idem_finish(p, jsonb_build_object('id', r.id, 'status', r.status, 'version', r.version));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Call-backs, contacts, task overrides
-- ════════════════════════════════════════════════════════════════════════════════

create function public.close_callback(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  c public.callbacks;
begin
  perform app.only_keys(p, array['idempotency_key','id','version','outcome','note','at']);
  prior := app.idem_begin('close_callback', p);
  if prior is not null then return prior; end if;
  select * into c from public.callbacks where id = (p ->> 'id')::uuid for update;
  s := app.require_care(c.mother_id);
  perform app.check_version(c.version, p);
  if c.closed_at is not null then
    raise exception 'This call-back was already closed' using errcode = 'PT409';
  end if;
  update public.callbacks set closed_at = app.event_time(p ->> 'at'), outcome = p ->> 'outcome',
         outcome_note = nullif(trim(p ->> 'note'), ''), closed_by = s.id
    where id = c.id;
  return app.idem_finish(p, jsonb_build_object('id', c.id, 'outcome', p ->> 'outcome'));
end $$;

-- Three unsuccessful attempts since the last successful one mark the task lost to follow-up (PRD F-23).
create function public.log_contact(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  k public.tasks;
  t timestamptz;
  failures int;
begin
  perform app.only_keys(p, array['idempotency_key','id','task_id','channel','outcome','successful','note','at']);
  prior := app.idem_begin('log_contact', p);
  if prior is not null then return prior; end if;
  select * into k from public.tasks where id = (p ->> 'task_id')::uuid for update;
  s := app.require_care(k.mother_id);
  if k.completed_at is not null or k.cancelled_at is not null then
    raise exception 'This visit is already closed' using errcode = 'PT409';
  end if;
  t := app.event_time(p ->> 'at');
  insert into public.task_contacts (id, task_id, mother_id, at, channel, outcome, successful, note, by_staff)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), k.id, k.mother_id, t, coalesce(p ->> 'channel', 'call'),
          p ->> 'outcome', coalesce((p ->> 'successful')::boolean, false), nullif(trim(p ->> 'note'), ''), s.id);
  select count(*) into failures from public.task_contacts c
    where c.task_id = k.id and not c.successful
      and c.at > coalesce((select max(x.at) from public.task_contacts x where x.task_id = k.id and x.successful), '-infinity');
  if failures >= 3 and k.lost_at is null then
    update public.tasks set lost_at = t where id = k.id;
  end if;
  return app.idem_finish(p, jsonb_build_object('failures', failures, 'lost', failures >= 3 or k.lost_at is not null));
end $$;

-- Human override of any generated visit, always with a reason (PRD F-22).
create function public.override_task(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  k public.tasks;
  t timestamptz;
  reason text;
  act text := p ->> 'action';
  hosp uuid;
begin
  perform app.only_keys(p, array['idempotency_key','id','version','action','due_by','due_from','assigned_staff_id','reason','at']);
  prior := app.idem_begin('override_task', p);
  if prior is not null then return prior; end if;
  select * into k from public.tasks where id = (p ->> 'id')::uuid for update;
  s := app.require_care(k.mother_id);
  perform app.check_version(k.version, p);
  reason := app.require_reason(p ->> 'reason', 'Changing a planned visit');
  if act <> 'reactivate' and (k.completed_at is not null or k.cancelled_at is not null) then
    raise exception 'This visit is already closed' using errcode = 'PT409';
  end if;
  t := app.event_time(p ->> 'at');
  if act = 'reschedule' then
    if p ->> 'due_by' is null then
      raise exception 'Choose the new date' using errcode = 'PT422';
    end if;
    select g.hospital_id into hosp from public.pregnancies g
      where g.id = coalesce(k.pregnancy_id, (select b.pregnancy_id from public.babies b where b.id = k.baby_id));
    if (p ->> 'due_by')::date < app.local_date(hosp, t) then
      raise exception 'A visit cannot be rescheduled into the past' using errcode = 'PT422';
    end if;
    update public.tasks set due_by = (p ->> 'due_by')::date,
           due_from = coalesce((p ->> 'due_from')::date, (p ->> 'due_by')::date - 2), lost_at = null, override_reason = reason
      where id = k.id;
  elsif act = 'cancel' then
    update public.tasks set cancelled_at = t, override_reason = reason where id = k.id;
  elsif act = 'reassign' then
    if not exists (select 1 from public.staff x where x.id = (p ->> 'assigned_staff_id')::uuid and x.active
                   and x.hospital_id = s.hospital_id) then
      raise exception 'Choose a Care Team member of this hospital' using errcode = 'PT422';
    end if;
    update public.tasks set assigned_staff_id = (p ->> 'assigned_staff_id')::uuid, override_reason = reason where id = k.id;
  elsif act = 'reactivate' then
    if k.lost_at is null then
      raise exception 'This visit is not marked lost to follow-up' using errcode = 'PT409';
    end if;
    update public.tasks set lost_at = null, override_reason = reason where id = k.id;
  else
    raise exception 'Unknown action %', act using errcode = 'PT422';
  end if;
  select * into k from public.tasks where id = k.id;
  return app.idem_finish(p, jsonb_build_object('id', k.id, 'version', k.version, 'due_by', k.due_by,
                                               'cancelled', k.cancelled_at is not null));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Notes and corrections
-- ════════════════════════════════════════════════════════════════════════════════

create function public.add_note(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  n public.care_notes;
begin
  perform app.only_keys(p, array['idempotency_key','id','pregnancy_id','baby_id','body','at']);
  prior := app.idem_begin('add_note', p);
  if prior is not null then return prior; end if;
  s := app.require_staff(array['obstetrician','paediatrician','specialist']);
  if (v_preg is null) = (v_baby is null) or not app.can_see_subject(v_preg, v_baby) then perform app.not_visible(); end if;
  insert into public.care_notes (id, mother_id, pregnancy_id, baby_id, author, body, kind, at)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()),
          coalesce((select mother_id from public.pregnancies where id = v_preg), (select mother_id from public.babies where id = v_baby)),
          v_preg, v_baby, s.id, trim(p ->> 'body'), 'note', app.event_time(p ->> 'at'))
  returning * into n;
  return app.idem_finish(p, jsonb_build_object('note_id', n.id));
end $$;

-- The only way to retract a recorded fact (FHIR entered-in-error). An encounter takes its observations with it;
-- withdrawing a test's last result sends the test back to waiting (trigger).
create function public.mark_entered_in_error(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  tbl text := case p ->> 'kind'
    when 'observation' then 'observations'        when 'encounter' then 'encounters'
    when 'investigation_result' then 'investigation_results'
    when 'care_note' then 'care_notes'            when 'self_log' then 'self_logs'
    when 'condition' then 'documented_conditions' when 'allergy' then 'allergies'
    when 'previous_pregnancy' then 'previous_pregnancies' end;
  v_id uuid := (p ->> 'id')::uuid;
  reason text;
  row_json jsonb;
  t timestamptz;
begin
  perform app.only_keys(p, array['idempotency_key','kind','id','reason','at']);
  prior := app.idem_begin('mark_entered_in_error', p);
  if prior is not null then return prior; end if;
  if tbl is null then
    raise exception 'Unknown record kind %', p ->> 'kind' using errcode = 'PT422';
  end if;
  execute format('select to_jsonb(x) from public.%I x where x.id = $1', tbl) into row_json using v_id;
  if row_json is null then perform app.not_visible(); end if;
  if row_json ->> 'status' = 'entered_in_error' then
    raise exception 'Already marked as entered in error' using errcode = 'PT409';
  end if;
  if tbl = 'investigation_results' then
    select to_jsonb(i) into row_json from public.investigations i where i.id = (row_json ->> 'investigation_id')::uuid;
  end if;
  -- the writer of that record's subject; mother-level history (conditions, allergies, past pregnancies) is the
  -- obstetric team's
  if row_json ? 'pregnancy_id' or row_json ? 'baby_id' then
    if row_json ->> 'pregnancy_id' is null and row_json ->> 'baby_id' is null then
      s := app.require_staff(array['obstetrician']);
      if not ((row_json ->> 'mother_id')::uuid in (select app.full_mother_ids())) then perform app.not_visible(); end if;
    else
      s := app.require_writer((row_json ->> 'pregnancy_id')::uuid, (row_json ->> 'baby_id')::uuid);
    end if;
  else
    s := app.require_staff(array['obstetrician']);
    if not ((row_json ->> 'mother_id')::uuid in (select app.full_mother_ids())) then perform app.not_visible(); end if;
  end if;
  reason := app.require_reason(p ->> 'reason', 'Marking an entry as entered in error');
  t := app.event_time(p ->> 'at');
  if tbl = 'self_logs' then
    update public.self_logs set status = 'entered_in_error', eie_reason = reason, eie_at = t where id = v_id;
  else
    execute format('update public.%I set status = ''entered_in_error'', eie_reason = $2, eie_by = $3, eie_at = $4 where id = $1', tbl)
      using v_id, reason, s.id, t;
  end if;
  if tbl = 'encounters' then
    update public.observations set status = 'entered_in_error', eie_reason = reason, eie_by = s.id, eie_at = t
      where encounter_id = v_id and status <> 'entered_in_error';
  end if;
  perform app.audit_event('entered_in_error', tbl, v_id::text, (row_json ->> 'mother_id')::uuid, jsonb_build_object('reason', reason));
  return app.idem_finish(p, jsonb_build_object('id', v_id, 'status', 'entered_in_error'));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════

insert into app.api_functions values
  ('public','whoami'), ('public','log_access'), ('public','register_pregnancy'), ('public','redate_pregnancy'),
  ('public','record_visit'), ('public','set_tags'), ('public','set_intensity'), ('public','assign_care'),
  ('public','grant_override'), ('public','end_override'), ('public','update_investigation'), ('public','record_result'),
  ('public','share_result'), ('public','create_referral'), ('public','advance_referral'), ('public','close_callback'),
  ('public','log_contact'), ('public','override_task'), ('public','add_note'), ('public','mark_entered_in_error');

do $$ begin perform app.apply_api_grants(); end $$;
