-- Core schema. Synthetic data only.
--
-- Clinical shapes follow FHIR R4 / ABDM (NRCeS) so records can be exported later:
--   Patient → mothers (a person, not tied to one hospital) / babies, + patient_identifiers (RCH, ABHA, MRN …)
--   EpisodeOfCare → pregnancies (+ pregnancy_datings, previous_pregnancies)
--   Encounter → encounters · Observation → observations (coded by observation_codes)
--   ServiceRequest + DiagnosticReport → investigations + investigation_results
--   Condition / AllergyIntolerance → documented_conditions / allergies
--   MedicationStatement + MedicationRequest → medications (+ med_doses)
--   Immunization → immunizations · Flag → tags · Task → tasks · Consent → consents · AuditEvent → audit_log
--   CareTeam → teams + team_members + care_assignments
--
-- Rules carried into the schema:
--  * Every reference is a real foreign key; a subject is pregnancy_id XOR baby_id, never a polymorphic id.
--  * Pick-list values are codes from pick_lists (validated by trigger), never labels.
--  * No clinical logic. min/max_possible on observation_codes reject impossible entries only; nothing here
--    colours, flags, ranks or labels a clinical value.
--  * Facts are never edited or deleted: entered_in_error (who, when, why) + a superseding row.
--  * Effective time (`at`) is separate from record time (`recorded_at`).
--  * Every patient row carries mother_id so access checks are one indexed comparison.
--  * Lookup indexes are on bare columns (index-usable under RLS); expression indexes only enforce uniqueness.
--  * Rows the app creates carry app-generated UUIDs; retries are deduplicated by idempotency_keys.
--  * Mutable workflow rows carry `version` for optimistic concurrency.

create schema if not exists app;                 -- private helpers; never in the API's exposed schemas
revoke all on schema app from public;

-- ════════════════════════════════════════════════════════════════════════════════
-- Organisation
-- ════════════════════════════════════════════════════════════════════════════════

create table public.hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique not null check (code ~ '^[A-Z0-9]{2,10}$'),
  hfr_id text unique,                            -- ABDM Health Facility Registry id
  phone_opd text,
  phone_labour text,
  address text,
  district text,
  state text,
  maps_url text,
  timezone text not null default 'Asia/Kolkata',
  settings jsonb not null default '{}',          -- per-hospital settings, e.g. {"quiet_hours":{"from":"21:00","to":"07:00"}}
  created_at timestamptz not null default now()
);

-- A department (Obstetrics, Cardiology …) receives referrals; a unit (OB Unit A …) owns patients.
create table public.teams (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id),
  name text not null,
  kind text not null check (kind in ('department','unit')),
  specialty text not null check (specialty in ('obstetrics','paediatrics','other')),
  parent_team_id uuid references public.teams(id),          -- a unit's department
  active boolean not null default true,
  unique (hospital_id, name),
  check (kind = 'unit' or parent_team_id is null)
);
create index teams_hospital on public.teams(hospital_id);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  hospital_id uuid not null references public.hospitals(id),
  user_id uuid unique references auth.users(id) on delete set null,      -- linked on first OTP login
  phone text unique not null check (phone ~ '^91[6-9][0-9]{9}$'),
  name text not null,
  role text not null check (role in ('obstetrician','paediatrician','specialist','nurse','coordinator','admin')),
  hpr_id text unique,                            -- ABDM Healthcare Professionals Registry id
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index staff_hospital on public.staff(hospital_id);

create table public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id),
  staff_id uuid not null references public.staff(id),
  from_at timestamptz not null default now(),
  to_at timestamptz,
  check (to_at is null or to_at >= from_at)
);
create unique index team_members_current on public.team_members(team_id, staff_id) where to_at is null;
create index team_members_staff on public.team_members(staff_id) where to_at is null;

-- ════════════════════════════════════════════════════════════════════════════════
-- Catalogues (hospital-configurable data, PRD §10)
-- ════════════════════════════════════════════════════════════════════════════════

-- Small code lists the app picks from: warning signs, complaints, counselling topics, outcomes, discharge items …
create table public.pick_lists (
  list text not null check (list ~ '^[a-z_]+$'),
  code text not null check (code ~ '^[a-z0-9_]+$'),
  label jsonb not null check (label ? 'en'),    -- {en, kn, hi}
  grp text,                                      -- optional grouping, e.g. warning-sign stage, discharge subject
  sort int not null default 0,
  active boolean not null default true,
  primary key (list, code)
);

-- Clinician-selected documentation labels (PRD §10.4). The system never assigns or suggests them.
create table public.tag_catalogue (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  label jsonb not null check (label ? 'en'),
  grp text not null check (grp in ('Obstetric','Medical','Social','Newborn')),
  applies_to text not null check (applies_to in ('pregnancy','baby')),
  template text,                                 -- follow-up template key in shared/domain TAG_TEMPLATES
  family_visible boolean not null default false,
  active boolean not null default true
);

-- What can be measured and how it is stored. Bounds reject impossible entries only (e.g. BP 900).
create table public.observation_codes (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  label text not null,
  applies_to text not null check (applies_to in ('mother','baby')),
  value_type text not null check (value_type in ('numeric','coded','text')),
  unit text,                                     -- UCUM, e.g. kg, mm[Hg], cm, /min, Cel, g
  min_possible numeric,
  max_possible numeric,
  allowed_values text[],                         -- for coded values, stored exactly as recorded
  loinc text,                                    -- mapping hint for ABDM/FHIR export; verify before use
  check ((value_type = 'numeric') = (unit is not null)),
  check ((value_type = 'coded') = (allowed_values is not null)),
  check (min_possible is null or max_possible is null or min_possible < max_possible)
);

create table public.investigation_catalogue (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  label text not null,
  applies_to text not null check (applies_to in ('mother','baby')),
  kind text not null check (kind in ('lab','scan')),
  result_type text not null check (result_type in ('numeric','coded','text')),
  default_unit text,
  sensitive boolean not null default false,      -- HIV, syphilis, HBsAg: never shown to families (PRD §15.4)
  loinc text,
  active boolean not null default true
);

-- Each code is one dose of one antigen series; schedules are generated on the server from this table.
create table public.vaccine_catalogue (
  code text primary key check (code ~ '^[a-z0-9_]+$'),
  label text not null,
  grp text not null,                             -- 'Birth', '6 weeks', … or 'Pregnancy' for Td
  applies_to text not null check (applies_to in ('mother','baby')),
  age_days int check (age_days >= 0),            -- baby schedule offset from date of birth (UIP)
  dose_number int not null check (dose_number >= 1),
  route text,
  active boolean not null default true,
  check ((applies_to = 'baby') = (age_days is not null))
);

create table public.app_settings (
  key text primary key,
  value jsonb not null
);

-- Server-assigned numbers (MCH-<yyyy>-<n>, MRN, IP-<yyyy>-<n>); the row lock serialises concurrent requests.
create table public.id_counters (
  hospital_id uuid not null references public.hospitals(id),
  kind text not null check (kind in ('mch','mrn','ip')),
  period text not null,                          -- '2026' for yearly series, 'all' for MRN
  value int not null default 0 check (value >= 0),
  primary key (hospital_id, kind, period)
);

-- ════════════════════════════════════════════════════════════════════════════════
-- People
-- ════════════════════════════════════════════════════════════════════════════════

-- A mother is a person: her pregnancies carry the hospital. One phone belongs to at most one mother.
-- After a DPDP erasure her contact data is removed (erased_at) while the clinical record is retained.
create table public.mothers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  phone text unique check (phone ~ '^91[6-9][0-9]{9}$'),
  alt_phone text check (alt_phone ~ '^91[6-9][0-9]{9}$'),
  name text not null check (length(name) between 1 and 120),
  husband_name text,                             -- RCH register field
  dob date,
  dob_estimated boolean not null default false,
  age_at_registration int check (age_at_registration between 10 and 60),
  lang text not null default 'en' check (lang in ('en','kn','hi')),
  village text,
  district text,
  state text,
  pincode text check (pincode ~ '^[1-9][0-9]{5}$'),
  emergency_contact jsonb check (emergency_contact is null or emergency_contact ? 'phone'),  -- {name, relation, phone}
  card_fields text[] not null default '{name,blood,weeks,allergies,hospital,emergency}'
    check (card_fields <@ '{name,age,blood,weeks,allergies,conditions,hospital,emergency}'),
  deceased_at timestamptz,                       -- suppresses every reminder; handled gently in the UI
  erased_at timestamptz,                         -- personal data erased on request (DPDP); see app.erase_mother_personal_data
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  version int not null default 1,
  check (dob is not null or age_at_registration is not null),
  check (alt_phone is null or alt_phone <> phone),
  check ((phone is null) = (erased_at is not null))
);

create table public.caregivers (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  user_id uuid references auth.users(id) on delete set null,  -- not unique: one person can help several mothers
  phone text check (phone ~ '^91[6-9][0-9]{9}$'),               -- null only once erased (revoked first)
  name text not null,
  relation text not null,
  scope_schedule boolean not null default true,
  scope_baby boolean not null default true,
  scope_logs boolean not null default false,
  scope_tests boolean not null default false,
  added_by uuid references auth.users(id),
  added_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  version int not null default 1,
  check (phone is not null or revoked_at is not null)
);
create unique index caregivers_active on public.caregivers(mother_id, phone) where revoked_at is null;
create index caregivers_user on public.caregivers(user_id) where revoked_at is null;
create index caregivers_mother on public.caregivers(mother_id);

-- DPDP Act 2023: purpose-specific, tied to the notice shown, withdrawable as easily as given.
-- Reminder channels are the accepted reminders_* purposes — there is no separate channel setting.
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),        -- null when a clinician records the mother's verbal consent
  mother_id uuid not null references public.mothers(id),
  notice_version text not null,
  lang text not null check (lang in ('en','kn','hi')),
  purposes text[] not null check (purposes <@ '{app,reminders_app,reminders_whatsapp,reminders_sms,caregiver_sharing}'),
  decision text not null check (decision in ('accepted','declined')),
  at timestamptz not null default now(),
  recorded_by uuid references public.staff(id),
  withdrawn_at timestamptz,
  withdrawn_reason text,
  check (decision = 'accepted' or withdrawn_at is null),
  check (user_id is not null or recorded_by is not null)
);
create index consents_mother on public.consents(mother_id) where withdrawn_at is null;
create index consents_user on public.consents(user_id) where withdrawn_at is null;

-- ════════════════════════════════════════════════════════════════════════════════
-- Pregnancy (episode of care)
-- ════════════════════════════════════════════════════════════════════════════════

create table public.pregnancies (
  id uuid primary key default gen_random_uuid(),
  mch_id text unique not null check (mch_id ~ '^MCH-[0-9]{4}-[0-9]{6}$'),
  mother_id uuid not null references public.mothers(id),
  hospital_id uuid not null references public.hospitals(id),
  registered_on timestamptz not null,
  edd date not null,                             -- current EDD; every (re)dating is kept in pregnancy_datings
  gravida int not null check (gravida between 1 and 20),
  para int not null check (para between 0 and 20),
  living int not null check (living between 0 and 20),
  abortions int not null check (abortions between 0 and 20),
  fetuses int check (fetuses between 1 and 4),
  -- 'Admitted' is not a status: it is an open row in admissions (one source of truth).
  status text not null default 'active' check (status in ('active','delivered','closed')),
  intensity text not null default 'routine' check (intensity in ('routine','enhanced','close')),  -- clinician-set only
  intensity_set_by uuid references public.staff(id),
  intensity_set_at timestamptz,
  ended_on date,
  end_reason text check (end_reason in
    ('delivered','miscarriage','induced_abortion','ectopic','molar','maternal_death','transferred_out','lost_to_follow_up','other')),
  source text not null default 'clinician' check (source in ('clinician','import')),
  created_by uuid references public.staff(id),
  created_at timestamptz not null default now(),
  version int not null default 1,
  check (para + abortions <= gravida),
  check ((status = 'active') = (end_reason is null)),
  check (status <> 'delivered' or end_reason = 'delivered'),
  check ((end_reason is null) = (ended_on is null))
);
create unique index one_open_pregnancy on public.pregnancies(mother_id) where status = 'active';
create index pregnancies_mother on public.pregnancies(mother_id);
create index pregnancies_hospital_active on public.pregnancies(hospital_id, edd) where status = 'active';

-- ════════════════════════════════════════════════════════════════════════════════
-- Admission & delivery & babies
-- ════════════════════════════════════════════════════════════════════════════════

create table public.admissions (
  id uuid primary key default gen_random_uuid(),
  pregnancy_id uuid not null references public.pregnancies(id),
  mother_id uuid not null references public.mothers(id),
  ip_no text not null,                           -- In-Patient number: issued per admission, server-assigned
  admitted_at timestamptz not null,
  reason text,
  admitted_by uuid not null references public.staff(id),
  discharged_at timestamptz,
  discharged_by uuid references public.staff(id),
  check ((discharged_at is null) = (discharged_by is null)),
  check (discharged_at is null or discharged_at >= admitted_at)
);
create unique index admissions_open on public.admissions(pregnancy_id) where discharged_at is null;
create index admissions_open_mother on public.admissions(mother_id) where discharged_at is null;
create index admissions_mother on public.admissions(mother_id);
create index admissions_pregnancy on public.admissions(pregnancy_id);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  pregnancy_id uuid unique not null references public.pregnancies(id),
  mother_id uuid not null references public.mothers(id),
  admission_id uuid references public.admissions(id),
  at timestamptz not null,
  place text not null default 'this_facility' check (place in ('this_facility','other_facility','home','in_transit')),
  labour_onset text check (labour_onset in ('spontaneous','induced','no_labour')),
  mode text not null check (mode in ('vaginal','assisted','lscs_elective','lscs_emergency')),
  indication text,                               -- as documented
  plurality int not null default 1 check (plurality between 1 and 4),
  blood_loss_ml int check (blood_loss_ml between 0 and 10000),
  perineum text,
  complications text[] not null default '{}',    -- codes: pick list 'delivery_complication'
  complications_note text,
  medicines text[] not null default '{}',        -- codes: pick list 'labour_medicine'
  medicines_note text,
  maternal_condition text,                       -- as documented
  attended_by text,
  recorded_by uuid not null references public.staff(id),
  recorded_at timestamptz not null default now()
);
create index deliveries_mother on public.deliveries(mother_id);

create table public.babies (
  id uuid primary key default gen_random_uuid(),
  child_id text unique not null check (child_id ~ '^MCH-[0-9]{4}-[0-9]{6}-B[1-4]$'),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid not null references public.pregnancies(id),
  delivery_id uuid not null references public.deliveries(id),
  birth_order int not null check (birth_order between 1 and 4),
  name text,                                     -- often given later; UI shows "Baby of <mother>"
  dob timestamptz not null,
  sex text not null check (sex in ('F','M','U')),           -- U: undetermined at birth
  -- Birth record (immutable). Later measurements are observations; growth views combine both.
  birth_weight_g int check (birth_weight_g between 200 and 7000),
  length_cm numeric(4,1) check (length_cm between 20 and 70),
  head_circ_cm numeric(4,1) check (head_circ_cm between 15 and 50),
  ga_at_birth_days int check (ga_at_birth_days between 140 and 320),
  apgar1 int check (apgar1 between 0 and 10),
  apgar5 int check (apgar5 between 0 and 10),
  outcome text not null check (outcome in ('live','stillbirth')),
  stillbirth_type text check (stillbirth_type in ('fresh','macerated')),
  resuscitation boolean,
  birth_defects text,                            -- as documented
  breastfed_within_1h boolean,
  vitamin_k boolean,
  intensity text not null default 'routine' check (intensity in ('routine','enhanced','close')),
  deceased_at timestamptz,                       -- suppresses baby reminders and cheerful content
  version int not null default 1,
  unique (delivery_id, birth_order),
  check (outcome = 'stillbirth' or stillbirth_type is null),
  check (outcome = 'live' or deceased_at is null)
);
create index babies_mother on public.babies(mother_id);
create index babies_pregnancy on public.babies(pregnancy_id);

-- National and hospital identifiers. The IP number lives on admissions, not here.
create table public.patient_identifiers (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  baby_id uuid references public.babies(id),     -- null → identifies the mother
  system text not null check (system in ('rch','abha_number','abha_address','mrn','birth_certificate')),
  value text not null,
  hospital_id uuid references public.hospitals(id),          -- required for hospital-scoped MRNs
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.staff(id),
  unique nulls not distinct (system, value, hospital_id),
  check ((system = 'mrn') = (hospital_id is not null)),
  check (system <> 'rch' or value ~ '^[0-9]{12}$'),
  check (system <> 'abha_number' or value ~ '^[0-9]{14}$'),
  check (system <> 'abha_address' or value ~ '^[a-z0-9._]+@[a-z]+$')
);
create unique index patient_identifiers_one_mrn on public.patient_identifiers(mother_id, hospital_id)
  where system = 'mrn' and baby_id is null;
create index patient_identifiers_mother on public.patient_identifiers(mother_id);
create index patient_identifiers_value on public.patient_identifiers(value);

-- ════════════════════════════════════════════════════════════════════════════════
-- Care teams & access
-- ════════════════════════════════════════════════════════════════════════════════

-- Who looks after this pregnancy / baby. One current assignment per subject and specialty.
-- A pregnancy has an obstetric assignment from registration and a paediatric one that becomes effective
-- from 34 weeks or on admission.
create table public.care_assignments (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  specialty text not null check (specialty in ('obstetrics','paediatrics')),
  team_id uuid not null references public.teams(id),
  primary_staff_id uuid references public.staff(id),
  from_at timestamptz not null,
  to_at timestamptz,
  assigned_by uuid references public.staff(id),  -- null when created by the system at delivery/registration
  reason text,
  check ((pregnancy_id is null) <> (baby_id is null)),
  check (baby_id is null or specialty = 'paediatrics'),
  check (to_at is null or to_at >= from_at)
);
create unique index care_assignments_current on public.care_assignments(coalesce(pregnancy_id, baby_id), specialty)
  where to_at is null;
create index care_assignments_primary on public.care_assignments(primary_staff_id) where to_at is null;
create index care_assignments_team on public.care_assignments(team_id) where to_at is null;
create index care_assignments_mother on public.care_assignments(mother_id);

-- Emergency override ("break the glass"): one clinician, one mother, a reason, 24 hours.
create table public.access_overrides (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id),
  mother_id uuid not null references public.mothers(id),
  reason text not null check (length(trim(reason)) between 3 and 500),
  granted_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz,                          -- ended early by the clinician
  check (expires_at > granted_at and expires_at <= granted_at + interval '24 hours')
);
create index access_overrides_staff on public.access_overrides(staff_id, expires_at);
create index access_overrides_mother on public.access_overrides(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Documented history (facts, correctable only by entered-in-error + new row)
-- ════════════════════════════════════════════════════════════════════════════════

create table public.previous_pregnancies (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  documented_in uuid references public.pregnancies(id),
  year int not null check (year between 1960 and 2100),
  outcome text not null check (outcome in
    ('live_birth','stillbirth','miscarriage','induced_abortion','ectopic','molar','neonatal_death')),
  mode text check (mode in ('vaginal','assisted','lscs')),
  gestation_weeks int check (gestation_weeks between 4 and 45),
  complications text[] not null default '{}',    -- as documented
  note text,
  recorded_by uuid not null references public.staff(id),
  recorded_at timestamptz not null default now(),
  status text not null default 'final' check (status in ('final','entered_in_error')),
  eie_reason text, eie_by uuid references public.staff(id), eie_at timestamptz
);
create index previous_pregnancies_mother on public.previous_pregnancies(mother_id);

create table public.documented_conditions (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),       -- set when specific to this pregnancy
  label text not null,                           -- as documented
  code text,                                     -- optional ICD-10 / SNOMED CT
  clinical_status text not null default 'active' check (clinical_status in ('active','resolved')),
  recorded_by uuid not null references public.staff(id),
  recorded_at timestamptz not null default now(),
  status text not null default 'final' check (status in ('final','entered_in_error')),
  eie_reason text, eie_by uuid references public.staff(id), eie_at timestamptz
);
create index documented_conditions_mother on public.documented_conditions(mother_id);

create table public.allergies (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  substance text not null,
  reaction text,                                 -- as documented
  recorded_by uuid not null references public.staff(id),
  recorded_at timestamptz not null default now(),
  status text not null default 'final' check (status in ('final','entered_in_error')),
  eie_reason text, eie_by uuid references public.staff(id), eie_at timestamptz
);
create index allergies_mother on public.allergies(mother_id);

-- Clinician-set documentation tags (FHIR Flag). Removal needs who and why.
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  code text not null references public.tag_catalogue(code),
  note text,
  set_by uuid not null references public.staff(id),
  set_at timestamptz not null,
  removed_by uuid references public.staff(id),
  removed_at timestamptz,
  removed_reason text,
  check ((pregnancy_id is null) <> (baby_id is null)),
  check (removed_at is null or (removed_by is not null and nullif(trim(removed_reason), '') is not null))
);
create unique index tags_active on public.tags(coalesce(pregnancy_id, baby_id), code) where removed_at is null;
create index tags_pregnancy on public.tags(pregnancy_id) where pregnancy_id is not null;
create index tags_baby on public.tags(baby_id) where baby_id is not null;
create index tags_mother on public.tags(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Documents (photos/PDFs of paper records; defined early because encounters and results link to them)
-- ════════════════════════════════════════════════════════════════════════════════

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  kind text not null check (kind in ('anc_card','lab_report','register_page','other')),
  storage_path text,                             -- server-chosen: documents/<mother_id>/<uuid>.<ext>
  mime text,
  fields jsonb,                                  -- transcription draft: [{key, label, value, confidence, confirmed}]
  captured_by uuid not null references public.staff(id),
  captured_at timestamptz not null,
  confirmed_by uuid references public.staff(id),
  confirmed_at timestamptz,
  check ((pregnancy_id is null) <> (baby_id is null)),
  check ((confirmed_at is null) = (confirmed_by is null))
);
create index documents_mother on public.documents(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Encounters & observations
-- ════════════════════════════════════════════════════════════════════════════════

create table public.encounters (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  kind text not null check (kind in ('registration','anc','postnatal','newborn','admission','labour','other')),
  at timestamptz not null,                       -- when it happened
  recorded_at timestamptz not null default now(),-- when it reached the server
  by_staff uuid not null references public.staff(id),
  source text not null default 'clinician' check (source in ('clinician','capture','import')),
  document_id uuid references public.documents(id),          -- paper record it was transcribed from
  ga_days int check (ga_days between 0 and 320), -- snapshot of GA at the encounter (antenatal kinds)
  complaints text[] not null default '{}',       -- codes: pick list 'complaint' (as reported)
  complaints_note text,
  counselling text[] not null default '{}',      -- codes: pick list 'counselling_topic'
  note text check (length(note) <= 4000),
  completeness numeric(4,3) check (completeness between 0 and 1),   -- recorded / expected (KPI only)
  status text not null default 'final' check (status in ('final','entered_in_error')),
  eie_reason text, eie_by uuid references public.staff(id), eie_at timestamptz,
  check (kind not in ('registration','anc','admission','labour') or pregnancy_id is not null),
  check (kind <> 'newborn' or baby_id is not null),
  check ((pregnancy_id is null) <> (baby_id is null)),       -- one subject; a joint visit is two encounters
  check ((source = 'capture') = (document_id is not null))
);
create index encounters_pregnancy on public.encounters(pregnancy_id, at) where pregnancy_id is not null;
create index encounters_baby on public.encounters(baby_id, at) where baby_id is not null;
create index encounters_mother on public.encounters(mother_id);

-- ANC completeness per encounter (PRD §10.2). Skipped components always carry a reason.
create table public.encounter_checklist (
  encounter_id uuid not null references public.encounters(id),
  mother_id uuid not null references public.mothers(id),
  component text not null,                       -- code: pick list 'anc_component'
  state text not null check (state in ('done','not_done','na')),
  reason text,
  primary key (encounter_id, component),
  check (state = 'done' or nullif(trim(reason), '') is not null)
);
create index encounter_checklist_mother on public.encounter_checklist(mother_id);

create table public.observations (
  id uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  code text not null references public.observation_codes(code),
  value_num numeric,
  value_text text check (length(value_text) <= 500),
  unit text,
  at timestamptz not null,
  by_staff uuid not null references public.staff(id),
  status text not null default 'final' check (status in ('final','amended','entered_in_error')),
  supersedes uuid references public.observations(id),
  eie_reason text, eie_by uuid references public.staff(id), eie_at timestamptz,
  check ((value_num is null) <> (value_text is null)),
  check ((pregnancy_id is null) <> (baby_id is null))
);
create index observations_pregnancy on public.observations(pregnancy_id, code, at) where pregnancy_id is not null;
create index observations_baby on public.observations(baby_id, code, at) where baby_id is not null;
create index observations_encounter on public.observations(encounter_id);
create index observations_mother on public.observations(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Investigations (order lifecycle) & results (versioned)
-- ════════════════════════════════════════════════════════════════════════════════

create table public.investigations (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  code text not null references public.investigation_catalogue(code),
  label text not null,                           -- as shown when ordered (catalogue labels may change)
  sensitive boolean not null default true,       -- always copied from the catalogue (trigger)
  due_from date not null,                       -- test windows are calendar days in the hospital's time zone
  due_by date not null,
  late boolean not null default false,           -- window had closed at registration: "due now", not a failure
  status text not null default 'due' check (status in
    ('due','ordered','collected','resulted','reviewed','not_done','not_applicable')),
  ordered_at timestamptz, ordered_by uuid references public.staff(id),
  collected_at timestamptz,
  reviewed_at timestamptz, reviewed_by uuid references public.staff(id),
  follow_up text check (follow_up in ('none','repeat','refer','discuss_next_visit')),
  not_done_reason text,
  generated_by text not null default 'protocol' check (generated_by in ('protocol','clinician','import')),
  version int not null default 1,
  check ((pregnancy_id is null) <> (baby_id is null)),
  check (due_by >= due_from),
  check (status not in ('not_done','not_applicable') or nullif(trim(not_done_reason), '') is not null),
  check (status <> 'reviewed' or (reviewed_by is not null and follow_up is not null))
);
create index investigations_pregnancy on public.investigations(pregnancy_id) where pregnancy_id is not null;
create index investigations_baby on public.investigations(baby_id) where baby_id is not null;
create index investigations_mother on public.investigations(mother_id);
create index investigations_awaiting_review on public.investigations(mother_id) where status = 'resulted';

create table public.investigation_results (
  id uuid primary key default gen_random_uuid(),
  investigation_id uuid not null references public.investigations(id),
  mother_id uuid not null references public.mothers(id),
  value_num numeric,
  value_text text check (length(value_text) <= 2000),
  unit text,
  lab_flag text,                                 -- transcribed exactly as printed by the lab; never computed
  reported_at timestamptz not null,
  entered_by uuid not null references public.staff(id),
  entered_at timestamptz not null default now(),
  source text not null default 'manual' check (source in ('manual','capture','import')),
  document_id uuid references public.documents(id),
  note text,
  status text not null default 'final' check (status in ('final','corrected','entered_in_error')),
  supersedes uuid references public.investigation_results(id),
  eie_reason text, eie_by uuid references public.staff(id), eie_at timestamptz,
  check (value_num is not null or value_text is not null),
  check ((status = 'corrected') = (supersedes is not null) or status = 'entered_in_error')
);
create index investigation_results_investigation on public.investigation_results(investigation_id);
create index investigation_results_mother on public.investigation_results(mother_id);

-- Dating history (LMP, scan, clinician). Exactly one current row; the clinician chooses — the system never picks.
create table public.pregnancy_datings (
  id uuid primary key default gen_random_uuid(),
  pregnancy_id uuid not null references public.pregnancies(id),
  mother_id uuid not null references public.mothers(id),
  method text not null check (method in ('lmp','scan','clinician')),
  lmp date,
  lmp_certain boolean,
  scan_on date,
  ga_at_scan_days int check (ga_at_scan_days between 28 and 300),
  investigation_id uuid references public.investigations(id),   -- the dating-scan order it came from, if any
  edd date not null,
  note text,
  decided_by uuid not null references public.staff(id),
  decided_at timestamptz not null,
  is_current boolean not null default true,
  check (method <> 'lmp' or lmp is not null),
  check (method <> 'scan' or (scan_on is not null and ga_at_scan_days is not null))
);
create unique index pregnancy_datings_current on public.pregnancy_datings(pregnancy_id) where is_current;
create index pregnancy_datings_pregnancy on public.pregnancy_datings(pregnancy_id);
create index pregnancy_datings_mother on public.pregnancy_datings(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Referrals
-- ════════════════════════════════════════════════════════════════════════════════

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  to_team_id uuid not null references public.teams(id),     -- a department
  from_encounter_id uuid references public.encounters(id),  -- the visit it was raised in, if any
  urgency text not null check (urgency in ('emergency','24h','routine')),   -- as chosen by the referrer
  reason text not null,
  question text not null,
  status text not null default 'requested' check (status in
    ('requested','accepted','scheduled','seen','recommendations','closed','declined','cancelled')),
  scheduled_at timestamptz,
  place text,
  recommendations text,
  ended_at timestamptz,                          -- when it was closed / declined / cancelled (access window starts)
  created_by uuid not null references public.staff(id),
  created_at timestamptz not null,
  version int not null default 1,
  check ((pregnancy_id is null) <> (baby_id is null)),
  check (status <> 'scheduled' or scheduled_at is not null),
  check (status <> 'recommendations' or recommendations is not null),
  check ((status in ('closed','declined','cancelled')) = (ended_at is not null))
);
create index referrals_mother on public.referrals(mother_id);
create index referrals_to_team on public.referrals(to_team_id, status);
create index referrals_pregnancy on public.referrals(pregnancy_id) where pregnancy_id is not null;

create table public.referral_events (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.referrals(id),
  mother_id uuid not null references public.mothers(id),
  status text not null check (status in
    ('requested','accepted','scheduled','seen','recommendations','closed','declined','cancelled')),
  at timestamptz not null,
  by_staff uuid not null references public.staff(id),
  note text
);
create index referral_events_referral on public.referral_events(referral_id, at);
create index referral_events_mother on public.referral_events(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Medicines
-- ════════════════════════════════════════════════════════════════════════════════

-- 'statement' = documented current medicine; 'prescription' = clinician-entered, drives reminders.
-- The app never suggests a medicine.
create table public.medications (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  kind text not null check (kind in ('statement','prescription')),
  name text not null,
  dose text,
  route text,
  slots text[] not null default '{}' check (slots <@ '{morning,afternoon,night}'),
  instructions text,
  start_on date,
  end_on date,
  prescribed_by uuid references public.staff(id),
  recorded_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active','stopped','completed','entered_in_error')),
  stopped_reason text,
  version int not null default 1,
  check ((pregnancy_id is null) <> (baby_id is null)),
  check (end_on is null or start_on is null or end_on >= start_on),
  check (kind = 'statement' or prescribed_by is not null),
  check (status not in ('stopped','entered_in_error') or nullif(trim(stopped_reason), '') is not null)
);
create index medications_mother on public.medications(mother_id);

create table public.med_doses (
  id uuid primary key default gen_random_uuid(),
  medication_id uuid not null references public.medications(id),
  mother_id uuid not null references public.mothers(id),
  date date not null,
  slot text not null check (slot in ('morning','afternoon','night')),
  status text not null check (status in ('taken','skipped')),
  at timestamptz not null,
  by_user uuid references auth.users(id),
  unique (medication_id, date, slot)
);
create index med_doses_mother on public.med_doses(mother_id, date);

-- ════════════════════════════════════════════════════════════════════════════════
-- Immunizations (maternal Td + baby UIP), ABDM Immunization profile fields
-- ════════════════════════════════════════════════════════════════════════════════

create table public.immunizations (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),       -- maternal doses (Td)
  baby_id uuid references public.babies(id),                 -- UIP doses
  code text not null references public.vaccine_catalogue(code),   -- one code = one dose of one series
  due_on date not null,
  status text not null default 'due' check (status in ('due','given','not_given','entered_in_error')),
  given_on date,
  given_in_encounter_id uuid references public.encounters(id),
  primary_source boolean,                        -- true: given here · false: reported from a card / elsewhere
  batch text,
  expiry_on date,
  manufacturer text,
  site text,
  route text,
  given_by uuid references public.staff(id),
  location text,
  not_given_reason text,
  eie_reason text, eie_by uuid references public.staff(id), eie_at timestamptz,
  version int not null default 1,
  check ((pregnancy_id is null) <> (baby_id is null)),
  check ((status = 'given') = (given_on is not null)),
  check (status <> 'given' or primary_source is not null),
  check (status <> 'not_given' or nullif(trim(not_given_reason), '') is not null),
  check (expiry_on is null or given_on is null or expiry_on >= given_on)
);
create unique index immunizations_dose on public.immunizations(coalesce(baby_id, pregnancy_id), code)
  where status <> 'entered_in_error';
create index immunizations_baby on public.immunizations(baby_id, due_on) where baby_id is not null;
create index immunizations_pregnancy on public.immunizations(pregnancy_id) where pregnancy_id is not null;
create index immunizations_mother on public.immunizations(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Tasks: visits and appointments the family must come to (worklist, reminders, missed visits, KPI).
-- Tests and vaccines are their own obligations (investigations, immunizations) — not duplicated here.
-- missed / overdue / due / upcoming are NOT stored: derived from dates + the subject's intensity grace.
-- ════════════════════════════════════════════════════════════════════════════════

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  kind text not null check (kind in ('anc_visit','pn_visit','nb_visit','referral_appt','template')),
  title text not null,
  template_key text,                             -- which follow-up template generated it, e.g. 'tpl_bp'
  referral_id uuid references public.referrals(id),         -- set exactly for referral appointments
  place text,
  due_from date,                                 -- the window is calendar days in the hospital's time zone
  due_by date not null,
  appointment_at timestamptz,                    -- a booked time, when there is one (always for referral appointments)
  generated_by text not null check (generated_by in ('protocol','template','clinician','import')),
  owner_role text check (owner_role in ('obstetrician','paediatrician','specialist','nurse','coordinator')),
  assigned_staff_id uuid references public.staff(id),
  completed_at timestamptz,
  completed_by_encounter_id uuid references public.encounters(id),
  cancelled_at timestamptz,
  override_reason text,                          -- staff-only text; never sent to families
  lost_at timestamptz,                           -- 3 unsuccessful contacts; reactivatable
  confirmed_at timestamptz,                      -- family confirmed (WhatsApp "1", stretch)
  created_at timestamptz not null default now(),
  version int not null default 1,
  check ((pregnancy_id is null) <> (baby_id is null)),
  check ((kind = 'referral_appt') = (referral_id is not null)),
  check ((kind = 'template') = (template_key is not null)),
  check (kind <> 'referral_appt' or appointment_at is not null),
  check (due_from is null or due_by >= due_from),
  check (cancelled_at is null or nullif(trim(override_reason), '') is not null),
  check (completed_at is null or cancelled_at is null)
);
create index tasks_open_pregnancy on public.tasks(pregnancy_id, due_by)
  where pregnancy_id is not null and completed_at is null and cancelled_at is null;
create index tasks_open_baby on public.tasks(baby_id, due_by)
  where baby_id is not null and completed_at is null and cancelled_at is null;
create index tasks_open_due on public.tasks(due_by) where completed_at is null and cancelled_at is null;
create index tasks_mother on public.tasks(mother_id);
create index tasks_referral on public.tasks(referral_id) where referral_id is not null;

create table public.task_contacts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id),
  mother_id uuid not null references public.mothers(id),
  at timestamptz not null,
  channel text not null default 'call' check (channel in ('call','whatsapp','sms','in_person')),
  outcome text not null,                         -- code: pick list 'contact_outcome'
  successful boolean not null,                   -- 3 unsuccessful in a row → lost to follow-up
  note text,
  by_staff uuid not null references public.staff(id)
);
create index task_contacts_task on public.task_contacts(task_id, at);
create index task_contacts_mother on public.task_contacts(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Family inputs
-- ════════════════════════════════════════════════════════════════════════════════

create table public.callbacks (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  requested_by uuid references auth.users(id),   -- null when it arrives by WhatsApp/SMS
  requested_by_label text not null,              -- 'mother' | 'caregiver: Ravi (husband)'
  channel text not null check (channel in ('app','whatsapp','sms')),
  signs text[] not null default '{}',            -- codes: pick list 'warning_sign', as ticked; never evaluated
  note text check (length(note) <= 2000),
  voice_path text,                               -- server-chosen: voice-notes/<mother_id>/<uuid>.m4a
  voice_seconds int check (voice_seconds between 1 and 300),
  at timestamptz not null,
  closed_at timestamptz,
  outcome text,                                  -- code: pick list 'callback_outcome'
  outcome_note text,
  closed_by uuid references public.staff(id),
  version int not null default 1,
  check ((closed_at is null) = (outcome is null)),
  check ((closed_at is null) = (closed_by is null)),
  check ((voice_path is null) = (voice_seconds is null))
);
create index callbacks_open on public.callbacks(at) where closed_at is null;
create index callbacks_mother on public.callbacks(mother_id);

-- Family-reported readings: stored as entered, shown as "home reading", never parsed or evaluated,
-- never overwriting clinical observations.
create table public.self_logs (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  baby_id uuid references public.babies(id),
  kind text not null check (kind in ('bp','weight','movements','contractions','feeding','bleeding','wound','note')),
  value text not null check (length(value) between 1 and 500),
  at timestamptz not null,
  by_user uuid references auth.users(id),
  by_label text not null,
  status text not null default 'final' check (status in ('final','entered_in_error')),
  eie_reason text, eie_at timestamptz
);
create index self_logs_mother on public.self_logs(mother_id, at);

-- ════════════════════════════════════════════════════════════════════════════════
-- Discharge
-- ════════════════════════════════════════════════════════════════════════════════

create table public.discharges (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  admission_id uuid references public.admissions(id),       -- the mother's admission it closes
  started_at timestamptz not null,
  completed_at timestamptz,
  completed_by uuid references public.staff(id),
  version int not null default 1,
  check ((pregnancy_id is null) <> (baby_id is null)),
  check (admission_id is null or pregnancy_id is not null),
  check ((completed_at is null) = (completed_by is null))
);
create unique index discharges_subject on public.discharges(coalesce(pregnancy_id, baby_id));
create index discharges_mother on public.discharges(mother_id);

-- Gating (PRD F-21): every item done, or N/A / deferred with a reason, before completion (checked in the RPC).
create table public.discharge_items (
  discharge_id uuid not null references public.discharges(id),
  mother_id uuid not null references public.mothers(id),
  key text not null,                             -- code: pick list 'discharge_item'
  state text check (state in ('done','na','deferred')),
  reason text,
  updated_by uuid references public.staff(id),
  updated_at timestamptz,
  primary key (discharge_id, key),
  check (state is null or state = 'done' or nullif(trim(reason), '') is not null)
);
create index discharge_items_mother on public.discharge_items(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Notes, AI drafts
-- ════════════════════════════════════════════════════════════════════════════════

create table public.care_notes (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  author uuid not null references public.staff(id),
  body text not null check (length(body) between 1 and 8000),
  kind text not null check (kind in ('note','ai_verified')),
  at timestamptz not null,
  status text not null default 'final' check (status in ('final','entered_in_error')),
  eie_reason text, eie_by uuid references public.staff(id), eie_at timestamptz,
  check ((pregnancy_id is null) <> (baby_id is null))
);
create index care_notes_pregnancy on public.care_notes(pregnancy_id, at) where pregnancy_id is not null;
create index care_notes_baby on public.care_notes(baby_id, at) where baby_id is not null;
create index care_notes_mother on public.care_notes(mother_id);

create table public.ai_drafts (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  kind text not null check (kind in ('brief','handoff','discharge')),   -- transcription lives on documents
  content jsonb not null,                        -- [{text, sources: [{kind, id}]}]; uncited sentences dropped
  engine text not null,
  model text,
  generated_by uuid not null references public.staff(id),
  generated_at timestamptz not null default now(),
  status text not null default 'unverified' check (status in ('unverified','verified','discarded')),
  verified_by uuid references public.staff(id),
  verified_at timestamptz,
  note_id uuid references public.care_notes(id),
  check ((pregnancy_id is null) <> (baby_id is null)),
  check (status <> 'verified' or (verified_by is not null and note_id is not null))
);
create index ai_drafts_mother on public.ai_drafts(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Platform: audit, notifications, push tokens, idempotency
-- ════════════════════════════════════════════════════════════════════════════════

-- Row changes (by trigger: inserts record the id, updates the changed columns) and semantic events
-- (by RPCs: view_record, override, reassign, entered_in_error …). Append-only for everyone.
create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                                    -- auth user; null for system jobs
  actor_label text,
  role text,
  action text not null,
  entity_type text not null,
  entity_id text,                                -- the one generic reference column, by design
  mother_id uuid,
  meta jsonb not null default '{}'
);
create index audit_log_mother on public.audit_log(mother_id, at);
create index audit_log_entity on public.audit_log(entity_type, entity_id);
create index audit_log_actor on public.audit_log(actor, at);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  kind text not null,
  params jsonb not null default '{}',            -- localised on device; push text never carries names or clinical detail
  target_type text check (target_type in ('pregnancy','baby','callback','referral','task','investigation')),
  target_id uuid,
  at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz,
  check ((target_type is null) = (target_id is null))
);
create index notifications_user on public.notifications(user_id, at desc);
create index notifications_unpushed on public.notifications(at) where pushed_at is null;

create table public.push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id),
  platform text not null check (platform in ('android','ios')),
  updated_at timestamptz not null default now()
);
create index push_tokens_user on public.push_tokens(user_id);

-- One row per user intent. A replay with the same key and payload returns the stored response;
-- the same key with a different payload is rejected. Purged after 30 days.
create table public.idempotency_keys (
  actor uuid not null,
  key uuid not null,
  rpc text not null,
  request_hash text not null,
  response jsonb,                                -- null while the first call is still in flight
  created_at timestamptz not null default now(),
  primary key (actor, key)
);
create index idempotency_keys_created on public.idempotency_keys(created_at);

-- ════════════════════════════════════════════════════════════════════════════════
-- Access grants: who may see which patient data, precomputed.
-- Derived data with a single writer: the triggers in 20261005000130_access_grants.sql, fired by assignments,
-- datings, admissions, referrals and overrides. RLS reads it with one indexed lookup per principal instead of
-- recomputing every rule on every query. Grants go to a team / the hospital's labour-room roles, not to each
-- member, so team membership changes rewrite nothing.
-- ════════════════════════════════════════════════════════════════════════════════

create table public.access_grants (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  pregnancy_id uuid references public.pregnancies(id),
  baby_id uuid references public.babies(id),
  scope text not null check (scope in ('mother','subject')),   -- whole maternal record, or one pregnancy / baby
  sensitive boolean not null,                    -- may see sensitive tests (HIV, syphilis, HBsAg)
  -- principal: exactly one of a clinician, a team, or a hospital's labour-room roles
  staff_id uuid references public.staff(id),
  team_id uuid references public.teams(id),
  hospital_id uuid references public.hospitals(id),
  hospital_roles text[] check (hospital_roles <@ '{obstetrician,paediatrician}'),
  -- source: exactly the record that created it
  source text not null check (source in ('assignment','labour_room','referral','override')),
  assignment_id uuid references public.care_assignments(id),
  admission_id uuid references public.admissions(id),
  referral_id uuid references public.referrals(id),
  override_id uuid references public.access_overrides(id),
  valid_from timestamptz not null,
  valid_until timestamptz,
  check (num_nonnulls(staff_id, team_id, hospital_id) = 1),
  check ((hospital_id is null) = (hospital_roles is null)),
  check ((scope = 'mother') = (pregnancy_id is null and baby_id is null)),
  check (scope = 'mother' or (pregnancy_id is null) <> (baby_id is null)),
  check (num_nonnulls(assignment_id, admission_id, referral_id, override_id) = 1),
  check ((source = 'assignment') = (assignment_id is not null)),
  check ((source = 'labour_room') = (admission_id is not null)),
  check ((source = 'referral') = (referral_id is not null)),
  check ((source = 'override') = (override_id is not null))
);
create index access_grants_staff on public.access_grants(staff_id) where staff_id is not null;
create index access_grants_team on public.access_grants(team_id) where team_id is not null;
-- labour-room grants are read only while open; closed admissions drop out of this index, so years of past
-- admissions are never scanned
create index access_grants_hospital_open on public.access_grants(hospital_id) where hospital_id is not null and valid_until is null;
create index access_grants_mother on public.access_grants(mother_id);
create index access_grants_assignment on public.access_grants(assignment_id) where assignment_id is not null;
create index access_grants_admission on public.access_grants(admission_id) where admission_id is not null;
create index access_grants_referral on public.access_grants(referral_id) where referral_id is not null;
create index access_grants_override on public.access_grants(override_id) where override_id is not null;
create index access_grants_pregnancy on public.access_grants(pregnancy_id) where pregnancy_id is not null;
create index access_grants_baby on public.access_grants(baby_id) where baby_id is not null;

-- A referring clinician can share specific results (including sensitive ones) with the receiving department.
create table public.referral_shared_results (
  referral_id uuid not null references public.referrals(id),
  investigation_id uuid not null references public.investigations(id),
  mother_id uuid not null references public.mothers(id),
  shared_by uuid not null references public.staff(id),
  shared_at timestamptz not null default now(),
  primary key (referral_id, investigation_id)
);
create index referral_shared_results_investigation on public.referral_shared_results(investigation_id);
create index referral_shared_results_mother on public.referral_shared_results(mother_id);

-- DPDP erasure requests. Personal/contact data is erased; the clinical record is retained for the period the
-- law requires and then handled by the hospital's retention process.
create table public.erasure_requests (
  id uuid primary key default gen_random_uuid(),
  mother_id uuid not null references public.mothers(id),
  received_at timestamptz not null default now(),
  received_via text not null check (received_via in ('app','hospital')),
  status text not null default 'received' check (status in ('received','completed','rejected')),
  completed_at timestamptz,
  completed_by uuid references public.staff(id),
  note text,
  check ((status = 'completed') = (completed_at is not null))
);
create index erasure_requests_mother on public.erasure_requests(mother_id);

-- ════════════════════════════════════════════════════════════════════════════════
-- Subject lookup indexes. Expression indexes such as coalesce(pregnancy_id, baby_id) enforce uniqueness but
-- cannot serve `pregnancy_id = $1`; every subject column gets a plain partial index.
-- tests/020_scenarios.sql S189 fails if any reference column used for lookups lacks a leading index.
-- ════════════════════════════════════════════════════════════════════════════════
create index patient_identifiers_baby on public.patient_identifiers(baby_id) where baby_id is not null;
create index documented_conditions_pregnancy on public.documented_conditions(pregnancy_id) where pregnancy_id is not null;
create index pregnancy_datings_investigation on public.pregnancy_datings(investigation_id) where investigation_id is not null;
create index referrals_baby on public.referrals(baby_id) where baby_id is not null;
create index medications_pregnancy on public.medications(pregnancy_id) where pregnancy_id is not null;
create index medications_baby on public.medications(baby_id) where baby_id is not null;
create index care_assignments_pregnancy on public.care_assignments(pregnancy_id) where pregnancy_id is not null;
create index care_assignments_baby on public.care_assignments(baby_id) where baby_id is not null;
create index documents_pregnancy on public.documents(pregnancy_id) where pregnancy_id is not null;
create index documents_baby on public.documents(baby_id) where baby_id is not null;
create index self_logs_baby on public.self_logs(baby_id, at) where baby_id is not null;
create index discharges_pregnancy on public.discharges(pregnancy_id) where pregnancy_id is not null;
create index discharges_baby on public.discharges(baby_id) where baby_id is not null;
create index ai_drafts_pregnancy on public.ai_drafts(pregnancy_id) where pregnancy_id is not null;
create index ai_drafts_baby on public.ai_drafts(baby_id) where baby_id is not null;
