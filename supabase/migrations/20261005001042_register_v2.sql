-- Registration v2 (replaces register_pregnancy from 20261005000980).
--
--   * No dating at registration: `dating` is optional. Without it the pregnancy is undated (edd null), and no ANC
--     visit or test window may be planned (20261005001041); the doctor records the dating later (redate_pregnancy).
--     With it (register import, older clients) everything behaves as before.
--   * The mother's new details (20261005001040): email, marital status, husband's mobile, house / street, Aadhaar
--     last 4 digits.
--   * History: weight (kg) at registration, saved like height as an observation of the registration encounter, within
--     the possible-entry bounds of observation_codes.
--
-- Values are checked only for being possible to store; nothing here grades or interprets a clinical value.

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
  v_dated boolean;
  v_edd date;
  bad text;
  oc public.observation_codes;
  norm constant text := '\s+';
  yr text;
  v_mch text;
  v_mrn text;
  result jsonb;
begin
  perform app.only_keys(p, array['idempotency_key','mother','pregnancy','dating','history','team_id','intensity','tags',
                                 'tag_note','investigations','tasks','ga_days','source']);
  pm := app.only_keys(coalesce(p -> 'mother', '{}'), array['id','name','dob','dob_estimated','age','phone','alt_phone','email',
          'marital_status','husband_name','husband_phone','address_line','village','district','state','pincode','rch_id',
          'aadhaar_last4','abha_number','abha_address','lang','emergency_contact'], 'mother');
  pg := app.only_keys(coalesce(p -> 'pregnancy', '{}'), array['id','registered_on','gravida','para','living','abortions','fetuses'], 'pregnancy');
  pd := app.only_keys(coalesce(p -> 'dating', '{}'), array['method','lmp','lmp_certain','scan_on','ga_at_scan_days','edd','note'], 'dating');
  ph := app.only_keys(coalesce(p -> 'history', '{}'), array['conditions','allergies','medicines','blood_group','height_cm','weight_kg','previous'], 'history');
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

  -- Dating is optional (recorded later by the doctor); when given, the same checks as every dating.
  v_dated := jsonb_typeof(p -> 'dating') = 'object' and pd <> '{}'::jsonb;
  if v_dated then
    v_edd := app.check_dating(pd);
  end if;
  v_ga := app.int_field(p, 'ga_days', 0, 320, 'Gestational age at registration (days)');
  if v_ga is not null and not v_dated then
    raise exception 'A gestational age needs a dating' using errcode = 'PT422';
  end if;

  if ph ? 'height_cm' and jsonb_typeof(ph -> 'height_cm') <> 'null'
     and (jsonb_typeof(ph -> 'height_cm') <> 'number' or (ph ->> 'height_cm')::numeric not between 100 and 220) then
    raise exception 'Height must be 100–220 cm' using errcode = 'PT422';
  end if;
  -- Weight: the possible-entry bounds of the 'weight' observation code (a typing guard, never a clinical threshold).
  select * into oc from public.observation_codes where code = 'weight';
  if ph ? 'weight_kg' and jsonb_typeof(ph -> 'weight_kg') <> 'null'
     and (jsonb_typeof(ph -> 'weight_kg') <> 'number' or (ph ->> 'weight_kg')::numeric not between oc.min_possible and oc.max_possible) then
    raise exception 'Weight must be %–% kg', oc.min_possible, oc.max_possible using errcode = 'PT422';
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

  -- ── Who is she? One phone = one mother (the rules of 20261005000980, unchanged) ──
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
      insert into public.mothers (id, phone, alt_phone, name, email, marital_status, husband_name, husband_phone, dob, dob_estimated,
                                  age_at_registration, lang, address_line, village, district, state, pincode, aadhaar_last4,
                                  emergency_contact, created_by)
      values (coalesce((pm ->> 'id')::uuid, gen_random_uuid()), pm ->> 'phone', nullif(trim(pm ->> 'alt_phone'), ''), trim(pm ->> 'name'),
              nullif(trim(pm ->> 'email'), ''), nullif(pm ->> 'marital_status', ''), nullif(trim(pm ->> 'husband_name'), ''),
              nullif(trim(pm ->> 'husband_phone'), ''), nullif(pm ->> 'dob', '')::date, coalesce((pm ->> 'dob_estimated')::boolean, false),
              (pm ->> 'age')::int, coalesce(pm ->> 'lang', 'en'), nullif(trim(pm ->> 'address_line'), ''), nullif(trim(pm ->> 'village'), ''),
              nullif(trim(pm ->> 'district'), ''), nullif(trim(pm ->> 'state'), ''), nullif(trim(pm ->> 'pincode'), ''),
              nullif(trim(pm ->> 'aadhaar_last4'), ''), nullif(pm -> 'emergency_contact', 'null'::jsonb), s.id)
      returning * into m;
      perform app.add_mother_identifiers(m.id, pm, s.id);
    end if;
  end if;
  v_mother := m.id;

  yr := to_char(app.local_date(s.hospital_id, v_at), 'YYYY');
  v_mch := 'MCH-' || yr || '-' || lpad(app.next_number(s.hospital_id, 'mch', yr)::text, 6, '0');
  begin
    -- edd stays null until a dating is inserted below (its trigger sets it); undated, it stays null.
    insert into public.pregnancies (id, mch_id, mother_id, hospital_id, registered_on, edd, gravida, para, living, abortions,
                                    fetuses, intensity, intensity_set_by, intensity_set_at, source, created_by)
    values ((pg ->> 'id')::uuid, v_mch, v_mother, s.hospital_id, v_at, v_edd, v_g, v_p, v_l, v_a, v_fetuses,
            coalesce(p ->> 'intensity', 'routine'), s.id, v_at, coalesce(p ->> 'source', 'clinician'), s.id)
    returning * into g;
  exception when unique_violation then
    raise exception 'This mother already has an active pregnancy' using errcode = 'PT409';
  end;

  if v_dated then
    insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, lmp_certain, scan_on, ga_at_scan_days, edd,
                                          note, decided_by, decided_at)
    values (g.id, v_mother, coalesce(pd ->> 'method', 'lmp'), (pd ->> 'lmp')::date, (pd ->> 'lmp_certain')::boolean,
            (pd ->> 'scan_on')::date, app.int_field(pd, 'ga_at_scan_days', 28, 300, 'Gestational age at the scan (days)'), v_edd,
            nullif(trim(pd ->> 'note'), ''), s.id, v_at);
  end if;

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

  -- The registration encounter carries documented measurements (height, weight, blood group).
  insert into public.encounters (mother_id, pregnancy_id, kind, at, by_staff, ga_days, source)
  values (v_mother, g.id, 'registration', v_at, s.id, v_ga, coalesce(p ->> 'source', 'clinician'))
  returning * into e;
  insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, value_text, at, by_staff)
  select e.id, v_mother, g.id, x.code, x.num, x.txt, v_at, s.id
  from (values ('blood_group', null::numeric, nullif(trim(ph ->> 'blood_group'), '')),
               ('height', (ph ->> 'height_cm')::numeric, null),
               ('weight', (ph ->> 'weight_kg')::numeric, null)) x(code, num, txt)
  where x.num is not null or x.txt is not null;

  insert into public.tags (mother_id, pregnancy_id, code, note, set_by, set_at)
  select v_mother, g.id, c, nullif(trim(p ->> 'tag_note'), ''), s.id, v_at
  from unnest(coalesce(app.text_array(p -> 'tags', 'tags'), '{}')) c;

  -- Plans (refused for an undated pregnancy, 20261005001041).
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
                          jsonb_build_object('mch_id', v_mch, 'source', coalesce(p ->> 'source', 'clinician'), 'dated', v_dated));
  result := jsonb_build_object('mother_id', v_mother, 'pregnancy_id', g.id, 'mch_id', v_mch, 'mrn', v_mrn);
  return app.idem_finish(p, result);
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
