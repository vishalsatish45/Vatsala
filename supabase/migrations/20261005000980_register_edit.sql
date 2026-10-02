-- Registration, a mother's details and care-team assignment (registration audit, October 2026).
--
--   update_mother(p)        correct a mother's details (name, age / date of birth, address, phones, language,
--                           husband, emergency contact, RCH / ABHA ids). Versioned and audited; the treating
--                           obstetrician or her current obstetric team only. A corrected phone re-links her login.
--   find_mother(p)          the registration desk looks a returning mother up by phone (this hospital's patients only)
--                           to prefill the form; audited.
--   register_pregnancy(p)   replaced: every input bound is checked up front with a clear PT422 (the app's form mirrors
--                           the same bounds, src/features/care/forms.ts), and the returning-mother rule below.
--   assign_care(p)          replaced: the team must be a unit of this hospital for that specialty, and a named doctor
--                           must be a current member of it.
--
-- Values are checked only for being possible to store (whole numbers, ranges the tables allow); nothing here grades
-- or interprets a clinical value.

-- ════════════════════════════════════════════════════════════════════════════════
-- Input helpers
-- ════════════════════════════════════════════════════════════════════════════════

-- A whole number from lo to hi, or null when absent. "2.5", "two" or 61 are refused with a readable message.
create function app.int_field(p jsonb, k text, lo int, hi int, what text) returns int
language plpgsql immutable set search_path = '' as $$
begin
  if p -> k is null or jsonb_typeof(p -> k) = 'null' then return null; end if;
  if jsonb_typeof(p -> k) <> 'number' or (p ->> k) !~ '^-?[0-9]+$' or (p ->> k)::numeric not between lo and hi then
    raise exception '% must be a whole number from % to %', what, lo, hi using errcode = 'PT422';
  end if;
  return (p ->> k)::int;
end $$;

-- The mother's details as the RPCs accept them (only the keys present are checked; register_pregnancy also needs
-- name, phone and age or date of birth). Phones are stored as 91XXXXXXXXXX.
create function app.check_mother_fields(pm jsonb) returns void
language plpgsql stable set search_path = '' as $$
declare
  ec jsonb := pm -> 'emergency_contact';
  mobile constant text := '^91[6-9][0-9]{9}$';
begin
  if pm ? 'name' and (nullif(trim(pm ->> 'name'), '') is null or length(trim(pm ->> 'name')) > 120) then
    raise exception 'Enter her full name (up to 120 characters)' using errcode = 'PT422';
  end if;
  perform app.int_field(pm, 'age', 10, 60, 'Age');
  if pm ? 'phone' and coalesce(pm ->> 'phone', '') !~ mobile then
    raise exception 'Enter a 10-digit mobile number starting with 6, 7, 8 or 9' using errcode = 'PT422';
  end if;
  if nullif(pm ->> 'alt_phone', '') is not null then
    if pm ->> 'alt_phone' !~ mobile then
      raise exception 'The alternate number must be a 10-digit mobile number' using errcode = 'PT422';
    end if;
    if pm ->> 'alt_phone' = pm ->> 'phone' then
      raise exception 'The alternate number must differ from her mobile' using errcode = 'PT422';
    end if;
  end if;
  if pm ? 'lang' and coalesce(pm ->> 'lang', '') not in ('en','kn','hi') then
    raise exception 'Language must be English, Kannada or Hindi' using errcode = 'PT422';
  end if;
  if nullif(pm ->> 'pincode', '') is not null and pm ->> 'pincode' !~ '^[1-9][0-9]{5}$' then
    raise exception 'A PIN code has 6 digits and does not start with 0' using errcode = 'PT422';
  end if;
  if nullif(pm ->> 'dob', '') is not null and (pm ->> 'dob')::date > current_date then
    raise exception 'The date of birth cannot be in the future' using errcode = 'PT422';
  end if;
  if pm ? 'age' and pm ? 'dob' and jsonb_typeof(pm -> 'age') is distinct from 'number' and nullif(pm ->> 'dob', '') is null then
    raise exception 'Enter her age or her date of birth' using errcode = 'PT422';
  end if;
  if pm ? 'husband_name' and length(coalesce(pm ->> 'husband_name', '')) > 120 then
    raise exception 'Husband''s name: up to 120 characters' using errcode = 'PT422';
  end if;
  if ec is not null and jsonb_typeof(ec) <> 'null' then
    perform app.only_keys(ec, array['name','relation','phone'], 'emergency_contact');
    if coalesce(ec ->> 'phone', '') !~ mobile then
      raise exception 'The emergency contact needs a 10-digit mobile number' using errcode = 'PT422';
    end if;
  end if;
  if nullif(trim(pm ->> 'rch_id'), '') is not null and trim(pm ->> 'rch_id') !~ '^[0-9]{12}$' then
    raise exception 'An RCH id has 12 digits' using errcode = 'PT422';
  end if;
  if nullif(trim(pm ->> 'abha_number'), '') is not null and trim(pm ->> 'abha_number') !~ '^[0-9]{14}$' then
    raise exception 'An ABHA number has 14 digits' using errcode = 'PT422';
  end if;
  if nullif(trim(pm ->> 'abha_address'), '') is not null and trim(pm ->> 'abha_address') !~ '^[a-z0-9._]+@[a-z]+$' then
    raise exception 'An ABHA address looks like name@abdm' using errcode = 'PT422';
  end if;
end $$;

-- RCH / ABHA ids as documented: added when she has none of that kind; a different one already on record is refused
-- (one id per scheme), and an id that belongs to someone else is refused by the unique index.
create function app.add_mother_identifiers(p_mother uuid, pm jsonb, p_staff uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  clash text;
begin
  select string_agg(x.label, ', ') into clash
  from (values ('rch', pm ->> 'rch_id', 'RCH id'), ('abha_number', pm ->> 'abha_number', 'ABHA number'),
               ('abha_address', pm ->> 'abha_address', 'ABHA address')) x(system, value, label)
  where nullif(trim(x.value), '') is not null
    and exists (select 1 from public.patient_identifiers i where i.mother_id = p_mother and i.baby_id is null
                and i.system = x.system and i.value <> trim(x.value));
  if clash is not null then
    raise exception 'A different % is already recorded for her', clash using errcode = 'PT409';
  end if;
  begin
    insert into public.patient_identifiers (mother_id, system, value, assigned_by)
    select p_mother, x.system, trim(x.value), p_staff
    from (values ('rch', pm ->> 'rch_id'), ('abha_number', pm ->> 'abha_number'), ('abha_address', pm ->> 'abha_address')) x(system, value)
    where nullif(trim(x.value), '') is not null
      and not exists (select 1 from public.patient_identifiers i where i.mother_id = p_mother and i.system = x.system
                      and i.value = trim(x.value));
  exception when unique_violation then
    raise exception 'This RCH / ABHA id already belongs to another patient' using errcode = 'PT409';
  end;
end $$;

-- Writes the details present in pm (absent keys keep their value; an empty text clears an optional field).
-- security definer: called by update_mother / register_pregnancy after they checked role, access and input.
--
-- A changed phone moves her login with it (the same rule as app.link_user_by_phone / app.link_row_to_user in
-- 20261005000110_integrity.sql): the record links to the account already signed in with the new number, if any, or
-- to none until she first signs in with it (the auth trigger links it then). The old number's account loses access
-- at once, and the new one gives consent again on its first sign-in.
create function app.apply_mother_details(p_mother uuid, pm jsonb, p_staff uuid) returns public.mothers
language plpgsql security definer set search_path = '' as $$
declare
  m public.mothers;
  v_phone text;
  v_user uuid;
begin
  select * into m from public.mothers where id = p_mother for update;
  v_phone := case when pm ? 'phone' then pm ->> 'phone' else m.phone end;
  v_user := m.user_id;
  if v_phone is distinct from m.phone then
    if exists (select 1 from public.mothers x where x.phone = v_phone and x.id <> m.id) then
      raise exception 'This phone number already belongs to another patient. Use a different number.' using errcode = 'PT409';
    end if;
    v_user := (select u.id from auth.users u where u.phone = v_phone
               and not exists (select 1 from public.mothers x where x.user_id = u.id and x.id <> m.id));
  end if;
  update public.mothers set
    phone = v_phone,
    user_id = v_user,
    name = case when pm ? 'name' then trim(pm ->> 'name') else name end,
    age_at_registration = case when pm ? 'age' then app.int_field(pm, 'age', 10, 60, 'Age') else age_at_registration end,
    dob = case when pm ? 'dob' then nullif(pm ->> 'dob', '')::date else dob end,
    dob_estimated = case when pm ? 'dob_estimated' then coalesce((pm ->> 'dob_estimated')::boolean, false) else dob_estimated end,
    lang = case when pm ? 'lang' then pm ->> 'lang' else lang end,
    village = case when pm ? 'village' then nullif(trim(pm ->> 'village'), '') else village end,
    district = case when pm ? 'district' then nullif(trim(pm ->> 'district'), '') else district end,
    state = case when pm ? 'state' then nullif(trim(pm ->> 'state'), '') else state end,
    pincode = case when pm ? 'pincode' then nullif(trim(pm ->> 'pincode'), '') else pincode end,
    husband_name = case when pm ? 'husband_name' then nullif(trim(pm ->> 'husband_name'), '') else husband_name end,
    alt_phone = case when pm ? 'alt_phone' then nullif(trim(pm ->> 'alt_phone'), '') else alt_phone end,
    emergency_contact = case when pm ? 'emergency_contact' then nullif(pm -> 'emergency_contact', 'null'::jsonb)
                             else emergency_contact end
  where id = m.id
  returning * into m;
  perform app.add_mother_identifiers(m.id, pm, p_staff);
  return m;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Correct a mother's details
-- ════════════════════════════════════════════════════════════════════════════════

create function public.update_mother(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  before public.mothers;
  m public.mothers;
  pm jsonb := p - 'idempotency_key' - 'mother_id' - 'version';
begin
  perform app.only_keys(p, array['idempotency_key','mother_id','version','name','age','dob','dob_estimated','phone','alt_phone',
                                 'lang','husband_name','village','district','state','pincode','emergency_contact',
                                 'rch_id','abha_number','abha_address']);
  prior := app.idem_begin('update_mother', p);
  if prior is not null then return prior; end if;

  s := app.require_staff(array['obstetrician']);
  select * into before from public.mothers where id = (p ->> 'mother_id')::uuid for update;
  -- The treating obstetrician or a member of her current obstetric team (any of her pregnancies); anyone else is
  -- told "not found", so ids cannot be probed.
  if before.id is null or before.erased_at is not null or not exists (
       select 1 from public.care_assignments a
       where a.mother_id = before.id and a.specialty = 'obstetrics' and a.to_at is null
         and (a.primary_staff_id = s.id
              or exists (select 1 from public.team_members tm where tm.team_id = a.team_id and tm.staff_id = s.id and tm.to_at is null))) then
    perform app.not_visible();
  end if;
  perform app.check_version(before.version, p);
  if pm = '{}'::jsonb then
    raise exception 'Nothing to change' using errcode = 'PT422';
  end if;
  perform app.check_mother_fields(pm);
  m := app.apply_mother_details(before.id, pm, s.id);
  -- Field names only: the values are personal data (the row trigger marks them as changed).
  perform app.audit_event('update_mother', 'mothers', m.id::text, m.id,
    jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(pm) k),
                       'login_relinked', m.phone is distinct from before.phone));
  return app.idem_finish(p, jsonb_build_object('mother_id', m.id, 'version', m.version));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Returning mother: look up by phone
-- ════════════════════════════════════════════════════════════════════════════════

-- Read-only (no idempotency key). Only a mother with a pregnancy at the caller's hospital is returned; a number
-- unknown here — or known only at another hospital — returns null, so a phone number reveals nothing more.
create function public.find_mother(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.staff;
  m public.mothers;
begin
  perform app.only_keys(p, array['phone']);
  s := app.require_staff(array['obstetrician']);
  if coalesce(p ->> 'phone', '') !~ '^91[6-9][0-9]{9}$' then
    raise exception 'Enter a 10-digit mobile number' using errcode = 'PT422';
  end if;
  select * into m from public.mothers x
  where x.phone = p ->> 'phone' and x.user_id is distinct from (select auth.uid())
    and exists (select 1 from public.pregnancies g where g.mother_id = x.id and g.hospital_id = s.hospital_id);
  if m.id is null then return null; end if;
  perform app.audit_event('lookup_mother', 'mothers', m.id::text, m.id);
  return jsonb_build_object(
    'mother_id', m.id, 'version', m.version, 'name', m.name, 'age', m.age_at_registration, 'dob', m.dob,
    'dob_estimated', m.dob_estimated, 'lang', m.lang, 'village', m.village, 'district', m.district, 'state', m.state,
    'pincode', m.pincode, 'husband_name', m.husband_name,
    'active_pregnancy', exists (select 1 from public.pregnancies g where g.mother_id = m.id and g.status = 'active'),
    'pregnancies', (select count(*) from public.pregnancies g where g.mother_id = m.id));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Registration (replaces 20261005000300)
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function public.register_pregnancy(p jsonb) returns jsonb
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
  v_g int;
  v_p int;
  v_l int;
  v_a int;
  v_fetuses int;
  v_ga int;
  v_lmp date;
  v_scan date;
  v_scan_ga int;
  v_edd date;
  v_method text;
  bad text;
  norm constant text := '\s+';
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

  -- ── Input bounds (the registration form mirrors each one) ────────────────────
  if nullif(trim(pm ->> 'name'), '') is null or nullif(pm ->> 'phone', '') is null then
    raise exception 'Her name and mobile number are required' using errcode = 'PT422';
  end if;
  if jsonb_typeof(pm -> 'age') is distinct from 'number' and nullif(pm ->> 'dob', '') is null then
    raise exception 'Enter her age or her date of birth' using errcode = 'PT422';
  end if;
  perform app.check_mother_fields(pm);
  v_g := app.int_field(pg, 'gravida', 1, 20, 'Gravida');
  v_p := app.int_field(pg, 'para', 0, 20, 'Para');
  v_l := app.int_field(pg, 'living', 0, 20, 'Living children');
  v_a := app.int_field(pg, 'abortions', 0, 20, 'Abortions');
  v_fetuses := app.int_field(pg, 'fetuses', 1, 4, 'Number of fetuses');
  if v_g is null or v_p is null or v_l is null or v_a is null then
    raise exception 'Enter G, P, L and A' using errcode = 'PT422';
  end if;
  if v_p + v_a > v_g - 1 then
    raise exception 'P + A must be at most G − 1 for a current pregnancy' using errcode = 'PT422';
  end if;
  v_ga := app.int_field(p, 'ga_days', 0, 320, 'Gestational age at registration (days)');

  v_method := coalesce(pd ->> 'method', 'lmp');
  if v_method not in ('lmp','scan','clinician') then
    raise exception 'Dating method must be lmp, scan or clinician' using errcode = 'PT422';
  end if;
  v_edd := (pd ->> 'edd')::date;
  v_lmp := (pd ->> 'lmp')::date;
  v_scan := (pd ->> 'scan_on')::date;
  v_scan_ga := app.int_field(pd, 'ga_at_scan_days', 28, 300, 'Gestational age at the scan (days)');
  if v_edd is null then
    raise exception 'The EDD is required' using errcode = 'PT422';
  end if;
  -- (a day's grace for the phone's time zone; demo mode may travel in time)
  if not app.is_demo() and (v_lmp > current_date + 1 or v_scan > current_date + 1) then
    raise exception 'The LMP and the scan date cannot be in the future' using errcode = 'PT422';
  end if;
  -- Calendar arithmetic only (the definitions in src/data/payloads.ts eddFor): one source of truth for the EDD.
  if v_method = 'lmp' and (v_lmp is null or v_edd <> v_lmp + 280) then
    raise exception 'For LMP dating, the EDD is the LMP + 280 days' using errcode = 'PT422';
  end if;
  if v_method = 'scan' and (v_scan is null or v_scan_ga is null or v_edd <> v_scan + (280 - v_scan_ga)) then
    raise exception 'For scan dating, give the scan date and the gestational age at the scan' using errcode = 'PT422';
  end if;
  if length(coalesce(pd ->> 'note', '')) > 500 then
    raise exception 'Dating note: up to 500 characters' using errcode = 'PT422';
  end if;

  if ph ? 'height_cm' and jsonb_typeof(ph -> 'height_cm') <> 'null'
     and (jsonb_typeof(ph -> 'height_cm') <> 'number' or (ph ->> 'height_cm')::numeric not between 100 and 220) then
    raise exception 'Height must be 100–220 cm' using errcode = 'PT422';
  end if;
  if nullif(trim(ph ->> 'blood_group'), '') is not null
     and trim(ph ->> 'blood_group') not in ('A+','A-','B+','B-','AB+','AB-','O+','O-') then
    raise exception 'Blood group must be one of A+, A-, B+, B-, AB+, AB-, O+, O-' using errcode = 'PT422';
  end if;
  if jsonb_typeof(ph -> 'previous') = 'array' then
    if jsonb_array_length(ph -> 'previous') > 20 then
      raise exception 'At most 20 previous pregnancies' using errcode = 'PT422';
    end if;
    select string_agg(coalesce(x ->> 'year', '?'), ', ') into bad
    from jsonb_array_elements(ph -> 'previous') x
    where jsonb_typeof(x -> 'year') is distinct from 'number' or (x ->> 'year') !~ '^[0-9]{4}$'
       or (x ->> 'year')::int not between 1960 and extract(year from now())::int
       or coalesce(x ->> 'outcome', '') not in ('live_birth','stillbirth','miscarriage','induced_abortion','ectopic','molar','neonatal_death')
       or (nullif(x ->> 'mode', '') is not null and x ->> 'mode' not in ('vaginal','assisted','lscs'))
       or (jsonb_typeof(x -> 'gestation_weeks') = 'number'
           and ((x ->> 'gestation_weeks') !~ '^[0-9]+$' or (x ->> 'gestation_weeks')::int not between 4 and 45))
       or (x ? 'gestation_weeks' and jsonb_typeof(x -> 'gestation_weeks') not in ('number','null'));
    if bad is not null then
      raise exception 'Check these previous pregnancies (year 1960–this year, an outcome, gestation 4–45 weeks): %', bad
        using errcode = 'PT422';
    end if;
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

  -- ── Who is she? One phone = one mother ───────────────────────────────────────
  --  1. mother.id names an existing mother: the clinician looked her up (find_mother) and confirmed she is the same
  --     woman. Only a mother with a pregnancy at this hospital can be named (find_mother offers no one else); the
  --     details on the form correct hers, the phone included (a phone held by another mother is still refused).
  --  2. Otherwise, the phone already belongs to a mother: she is the same woman returning only when the name matches
  --     (ignoring case and spacing) AND she has a pregnancy at this hospital. Nobody confirmed her details, so they are
  --     kept as they are. (A register import relies on this.)
  --  3. Anyone else is refused with the one message, so a number reveals nothing about who holds it.
  -- Never: taking over a woman known only at another hospital (an obstetric team gets her whole record), or keeping a
  -- record on a name match alone.
  if pm ->> 'id' is not null then
    select * into m from public.mothers where id = (pm ->> 'id')::uuid;
  end if;
  if m.id is not null then
    if m.erased_at is not null
       or not exists (select 1 from public.pregnancies x where x.mother_id = m.id and x.hospital_id = s.hospital_id) then
      perform app.not_visible();
    end if;
    m := app.apply_mother_details(m.id, pm - 'id', s.id);
    perform app.audit_event('returning_mother_confirmed', 'mothers', m.id::text, m.id,
      jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(pm - 'id') k)));
  else
    select * into m from public.mothers where phone = pm ->> 'phone';
    if m.id is not null then
      if lower(regexp_replace(trim(m.name), norm, ' ', 'g')) <> lower(regexp_replace(trim(pm ->> 'name'), norm, ' ', 'g'))
         or not exists (select 1 from public.pregnancies x where x.mother_id = m.id and x.hospital_id = s.hospital_id) then
        raise exception 'This phone number already belongs to another patient. Use a different number.' using errcode = 'PT409';
      end if;
      perform app.add_mother_identifiers(m.id, pm, s.id);
    else
      insert into public.mothers (id, phone, alt_phone, name, husband_name, dob, dob_estimated, age_at_registration, lang,
                                  village, district, state, pincode, emergency_contact, created_by)
      values (coalesce((pm ->> 'id')::uuid, gen_random_uuid()), pm ->> 'phone', nullif(trim(pm ->> 'alt_phone'), ''), trim(pm ->> 'name'),
              nullif(trim(pm ->> 'husband_name'), ''), nullif(pm ->> 'dob', '')::date, coalesce((pm ->> 'dob_estimated')::boolean, false),
              (pm ->> 'age')::int, coalesce(pm ->> 'lang', 'en'), nullif(trim(pm ->> 'village'), ''), nullif(trim(pm ->> 'district'), ''),
              nullif(trim(pm ->> 'state'), ''), nullif(trim(pm ->> 'pincode'), ''), nullif(pm -> 'emergency_contact', 'null'::jsonb), s.id)
      returning * into m;
      perform app.add_mother_identifiers(m.id, pm, s.id);
    end if;
  end if;
  v_mother := m.id;

  yr := to_char(app.local_date(s.hospital_id, v_at), 'YYYY');
  v_mch := 'MCH-' || yr || '-' || lpad(app.next_number(s.hospital_id, 'mch', yr)::text, 6, '0');
  begin
    insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions,
                                    fetuses, intensity, intensity_set_by, intensity_set_at, source, created_by)
    values ((pg ->> 'id')::uuid, v_mch, v_mother, s.hospital_id, v_at, v_edd, v_g, v_p, v_l, v_a, v_fetuses,
            coalesce(p ->> 'intensity', 'routine'), s.id, v_at, coalesce(p ->> 'source', 'clinician'), s.id)
    returning * into g;
  exception when unique_violation then
    raise exception 'This mother already has an active pregnancy' using errcode = 'PT409';
  end;

  insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, lmp_certain, scan_on, ga_at_scan_days, edd,
                                        note, decided_by, decided_at)
  values (g.id, v_mother, v_method, v_lmp, (pd ->> 'lmp_certain')::boolean, v_scan, v_scan_ga, v_edd,
          nullif(trim(pd ->> 'note'), ''), s.id, v_at);

  insert into public.care_assignments (mother_id, pregnancy_id, specialty, team_id, primary_staff_id, from_at, assigned_by, reason)
  values (v_mother, g.id, 'obstetrics', t.id, s.id, v_at, s.id, 'Registration'),
         (v_mother, g.id, 'paediatrics', paeds, null, v_at, s.id, 'Registration (from 34 weeks)');

  -- MRN once per hospital (national ids were added above).
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

  -- Documented history, as recorded.
  insert into public.previous_pregnancies (mother_id, documented_in, year, outcome, mode, gestation_weeks, complications, note, recorded_by)
  select v_mother, g.id, x.year, x.outcome, nullif(x.mode, ''), x.gestation_weeks, coalesce(x.complications, '{}'),
         nullif(trim(x.note), ''), s.id
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
  values (v_mother, g.id, 'registration', v_at, s.id, v_ga, coalesce(p ->> 'source', 'clinician'))
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

  -- Maternal Td: the first dose is due now; the second is scheduled when the first is given.
  insert into public.immunizations (mother_id, pregnancy_id, code, due_on)
  values (v_mother, g.id, 'td1', app.local_date(s.hospital_id, v_at));

  perform app.audit_event('register_pregnancy', 'pregnancies', g.id::text, v_mother,
                          jsonb_build_object('mch_id', v_mch, 'source', coalesce(p ->> 'source', 'clinician')));
  result := jsonb_build_object('mother_id', v_mother, 'pregnancy_id', g.id, 'mch_id', v_mch, 'mrn', v_mrn);
  return app.idem_finish(p, result);
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Care team (replaces 20261005000300)
-- ════════════════════════════════════════════════════════════════════════════════

-- Reassign the team and/or the named doctor (any clinician currently on the subject's team of that specialty, with
-- a reason). The team must be an active unit of this hospital for that specialty; a named doctor must be an active
-- clinician of that specialty and a current member of the team. No named doctor = the team as a whole.
create or replace function public.assign_care(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  v_staff uuid := (p ->> 'primary_staff_id')::uuid;
  cur public.care_assignments;
  t public.teams;
  reason text;
  v_at timestamptz;
  new_id uuid;
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','baby_id','specialty','team_id','primary_staff_id','reason','at']);
  prior := app.idem_begin('assign_care', p);
  if prior is not null then return prior; end if;

  s := app.require_staff(array['obstetrician','paediatrician']);
  if app.role_specialty(s.role) <> p ->> 'specialty' then
    raise exception 'A % cannot change the % team', s.role, p ->> 'specialty' using errcode = 'PT403';
  end if;
  if (v_preg is null) = (v_baby is null) then
    raise exception 'Give either pregnancy_id or baby_id' using errcode = 'PT422';
  end if;
  select * into cur from public.care_assignments
    where (pregnancy_id = v_preg or baby_id = v_baby) and specialty = p ->> 'specialty' and to_at is null for update;
  if cur.id is null or not app.can_see_subject(v_preg, v_baby) then perform app.not_visible(); end if;
  if not (cur.primary_staff_id = s.id
          or exists (select 1 from public.team_members tm where tm.team_id = cur.team_id and tm.staff_id = s.id and tm.to_at is null)) then
    raise exception 'Only the patient''s current team can reassign her' using errcode = 'PT403';
  end if;
  reason := app.require_reason(p ->> 'reason', 'Reassigning a patient');

  select * into t from public.teams where id = coalesce((p ->> 'team_id')::uuid, cur.team_id);
  if t.id is null or t.hospital_id <> s.hospital_id or t.kind <> 'unit' or t.specialty <> cur.specialty or not t.active then
    raise exception 'Choose a % unit of this hospital', case cur.specialty when 'obstetrics' then 'an obstetric' else 'a paediatric' end
      using errcode = 'PT422';
  end if;
  if v_staff is not null and not exists (
       select 1 from public.staff x
       join public.team_members tm on tm.staff_id = x.id and tm.team_id = t.id and tm.to_at is null
       where x.id = v_staff and x.active and x.hospital_id = s.hospital_id and app.role_specialty(x.role) = cur.specialty) then
    raise exception 'Choose a doctor who is a current member of %', t.name using errcode = 'PT422';
  end if;
  if t.id = cur.team_id and v_staff is not distinct from cur.primary_staff_id then
    raise exception 'This is already the current team and doctor' using errcode = 'PT409';
  end if;

  v_at := greatest(app.event_time(p ->> 'at'), cur.from_at);
  update public.care_assignments set to_at = v_at where id = cur.id;
  insert into public.care_assignments (mother_id, pregnancy_id, baby_id, specialty, team_id, primary_staff_id, from_at, assigned_by, reason)
  values (cur.mother_id, cur.pregnancy_id, cur.baby_id, cur.specialty, t.id, v_staff, v_at, s.id, reason)
  returning id into new_id;
  perform app.audit_event('reassign', 'care_assignments', new_id::text, cur.mother_id,
                          jsonb_build_object('reason', reason, 'specialty', cur.specialty, 'team_id', t.id, 'primary_staff_id', v_staff));
  return app.idem_finish(p, jsonb_build_object('assignment_id', new_id, 'team_id', t.id, 'primary_staff_id', v_staff));
end $$;

insert into app.api_functions values ('public','update_mother'), ('public','find_mother');

do $$ begin perform app.apply_api_grants(); end $$;
