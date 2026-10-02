-- A mother's details, second pass (registration rework, October 2026).
--
-- New on public.mothers (RCH register / MCP card fields, as documented):
--   marital_status   married | unmarried | widowed | separated_divorced
--   husband_phone    91XXXXXXXXXX, not her own number. With husband_name, kept only while she is recorded as married:
--                    the RPCs refuse husband details for anyone else (PT422) and clear them when the status changes
--                    away from married. (Rows from before this migration may hold a husband's name with no status.)
--   email            a simple address shape, up to 120 characters
--   address_line     house / street, one line, up to 200 characters (village, district, state, PIN stay as they are)
--   aadhaar_last4    the LAST FOUR digits of her Aadhaar number only. The full number is never collected or stored;
--                    the app shows it masked as XXXX-XXXX-1234.
--
-- check_mother_fields / apply_mother_details / update_mother / find_mother are replaced to carry them; the new
-- personal columns are audited as {"changed": true} (app.pii_columns) and cleared by DPDP erasure.

alter table public.mothers
  add column marital_status text check (marital_status in ('married','unmarried','widowed','separated_divorced')),
  add column husband_phone text check (husband_phone ~ '^91[6-9][0-9]{9}$'),
  add column email text check (length(email) <= 120 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  add column address_line text check (length(address_line) between 1 and 200),
  add column aadhaar_last4 text check (aadhaar_last4 ~ '^[0-9]{4}$'),
  add constraint mothers_husband_phone_not_hers check (husband_phone is null or husband_phone <> phone),
  add constraint mothers_husband_phone_married check (husband_phone is null or marital_status = 'married'),
  add constraint mothers_husband_only_married check (marital_status is null or marital_status = 'married' or husband_name is null);

insert into app.pii_columns values
  ('mothers','husband_phone'), ('mothers','email'), ('mothers','address_line'), ('mothers','aadhaar_last4');

-- ════════════════════════════════════════════════════════════════════════════════
-- Input checks (replaces 20261005000980): the registration form and "Edit details" mirror each one
-- ════════════════════════════════════════════════════════════════════════════════

-- p_current: her record before this change (null when registering a new mother), so a husband's details sent alone
-- are checked against the marital status already on record.
create or replace function app.check_mother_fields(pm jsonb, p_current public.mothers default null) returns void
language plpgsql stable set search_path = '' as $$
declare
  ec jsonb := pm -> 'emergency_contact';
  mobile constant text := '^91[6-9][0-9]{9}$';
  v_status text := case when pm ? 'marital_status' then nullif(pm ->> 'marital_status', '') else p_current.marital_status end;
  v_phone text := case when pm ? 'phone' then pm ->> 'phone' else p_current.phone end;
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
    if pm ->> 'alt_phone' = v_phone then
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
  -- the same 10–60 years as an age typed in (age_at_registration)
  if nullif(pm ->> 'dob', '') is not null
     and ((pm ->> 'dob')::date <= current_date - interval '61 years' or (pm ->> 'dob')::date > current_date - interval '10 years') then
    raise exception 'The date of birth must give an age from 10 to 60' using errcode = 'PT422';
  end if;
  if pm ? 'age' and pm ? 'dob' and jsonb_typeof(pm -> 'age') is distinct from 'number' and nullif(pm ->> 'dob', '') is null then
    raise exception 'Enter her age or her date of birth' using errcode = 'PT422';
  end if;
  if nullif(pm ->> 'email', '') is not null
     and (length(pm ->> 'email') > 120 or trim(pm ->> 'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then
    raise exception 'Enter an email address like name@example.com (up to 120 characters)' using errcode = 'PT422';
  end if;
  if pm ? 'address_line' and length(trim(coalesce(pm ->> 'address_line', ''))) > 200 then
    raise exception 'House / street: up to 200 characters' using errcode = 'PT422';
  end if;
  if pm ? 'marital_status' and nullif(pm ->> 'marital_status', '') is not null
     and pm ->> 'marital_status' not in ('married','unmarried','widowed','separated_divorced') then
    raise exception 'Marital status must be married, unmarried, widowed or separated_divorced' using errcode = 'PT422';
  end if;
  -- A husband's details are recorded only for a married woman.
  if (nullif(trim(pm ->> 'husband_name'), '') is not null or nullif(pm ->> 'husband_phone', '') is not null)
     and v_status is distinct from 'married' then
    raise exception 'Husband''s details are recorded only when her marital status is married' using errcode = 'PT422';
  end if;
  if pm ? 'husband_name' and length(coalesce(pm ->> 'husband_name', '')) > 120 then
    raise exception 'Husband''s name: up to 120 characters' using errcode = 'PT422';
  end if;
  if nullif(pm ->> 'husband_phone', '') is not null then
    if pm ->> 'husband_phone' !~ mobile then
      raise exception 'Husband''s mobile must be a 10-digit mobile number' using errcode = 'PT422';
    end if;
    if pm ->> 'husband_phone' = v_phone then
      raise exception 'Husband''s mobile must differ from her mobile' using errcode = 'PT422';
    end if;
  end if;
  -- Only the last four digits: a full (12-digit) Aadhaar number is refused, never stored.
  if nullif(trim(pm ->> 'aadhaar_last4'), '') is not null and trim(pm ->> 'aadhaar_last4') !~ '^[0-9]{4}$' then
    raise exception 'Enter only the last 4 digits of her Aadhaar number' using errcode = 'PT422';
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

-- The old one-argument form is replaced by the one above (its second argument defaults to null).
drop function app.check_mother_fields(jsonb);

-- Writes the details present in pm (absent keys keep their value; an empty text clears an optional field). A marital
-- status other than married clears the husband's details. security definer: called by update_mother /
-- register_pregnancy after they checked role, access and input. Phone re-linking: see 20261005000980.
create or replace function app.apply_mother_details(p_mother uuid, pm jsonb, p_staff uuid) returns public.mothers
language plpgsql security definer set search_path = '' as $$
declare
  m public.mothers;
  v_phone text;
  v_user uuid;
  v_status text;
begin
  select * into m from public.mothers where id = p_mother for update;
  v_phone := case when pm ? 'phone' then pm ->> 'phone' else m.phone end;
  v_status := case when pm ? 'marital_status' then nullif(pm ->> 'marital_status', '') else m.marital_status end;
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
    email = case when pm ? 'email' then nullif(trim(pm ->> 'email'), '') else email end,
    marital_status = v_status,
    address_line = case when pm ? 'address_line' then nullif(trim(pm ->> 'address_line'), '') else address_line end,
    village = case when pm ? 'village' then nullif(trim(pm ->> 'village'), '') else village end,
    district = case when pm ? 'district' then nullif(trim(pm ->> 'district'), '') else district end,
    state = case when pm ? 'state' then nullif(trim(pm ->> 'state'), '') else state end,
    pincode = case when pm ? 'pincode' then nullif(trim(pm ->> 'pincode'), '') else pincode end,
    husband_name = case when pm ? 'marital_status' and v_status is distinct from 'married' then null
                        when pm ? 'husband_name' then nullif(trim(pm ->> 'husband_name'), '') else husband_name end,
    husband_phone = case when pm ? 'marital_status' and v_status is distinct from 'married' then null
                         when pm ? 'husband_phone' then nullif(trim(pm ->> 'husband_phone'), '') else husband_phone end,
    aadhaar_last4 = case when pm ? 'aadhaar_last4' then nullif(trim(pm ->> 'aadhaar_last4'), '') else aadhaar_last4 end,
    alt_phone = case when pm ? 'alt_phone' then nullif(trim(pm ->> 'alt_phone'), '') else alt_phone end,
    emergency_contact = case when pm ? 'emergency_contact' then nullif(pm -> 'emergency_contact', 'null'::jsonb)
                             else emergency_contact end
  where id = m.id
  returning * into m;
  perform app.add_mother_identifiers(m.id, pm, p_staff);
  return m;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Correct a mother's details (replaces 20261005000980: the new fields, in the form's order)
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function public.update_mother(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  before public.mothers;
  m public.mothers;
  pm jsonb := p - 'idempotency_key' - 'mother_id' - 'version';
begin
  perform app.only_keys(p, array['idempotency_key','mother_id','version',
    'name','dob','dob_estimated','age','phone','alt_phone','email','marital_status','husband_name','husband_phone',
    'address_line','village','district','state','pincode','rch_id','aadhaar_last4','abha_number','abha_address','lang',
    'emergency_contact']);
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
  perform app.check_mother_fields(pm, before);
  m := app.apply_mother_details(before.id, pm, s.id);
  -- Field names only: the values are personal data (the row trigger marks them as changed).
  perform app.audit_event('update_mother', 'mothers', m.id::text, m.id,
    jsonb_build_object('fields', (select jsonb_agg(k order by k) from jsonb_object_keys(pm) k),
                       'login_relinked', m.phone is distinct from before.phone));
  return app.idem_finish(p, jsonb_build_object('mother_id', m.id, 'version', m.version));
end $$;

-- Returning mother lookup (replaces 20261005000980): also her marital status and house / street for the prefill.
-- Still no phone numbers, email or ids.
create or replace function public.find_mother(p jsonb) returns jsonb
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
    'dob_estimated', m.dob_estimated, 'lang', m.lang, 'marital_status', m.marital_status, 'address_line', m.address_line,
    'village', m.village, 'district', m.district, 'state', m.state, 'pincode', m.pincode, 'husband_name', m.husband_name,
    'active_pregnancy', exists (select 1 from public.pregnancies g where g.mother_id = m.id and g.status = 'active'),
    'pregnancies', (select count(*) from public.pregnancies g where g.mother_id = m.id));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- DPDP erasure (replaces 20261005000130): the new personal columns are erased too
-- ════════════════════════════════════════════════════════════════════════════════

create or replace function app.erase_mother_personal_data(p_request uuid, p_by uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r public.erasure_requests;
  m public.mothers;
begin
  select * into r from public.erasure_requests where id = p_request for update;
  if r.id is null or r.status <> 'received' then
    raise exception 'erasure request % is not open', p_request;
  end if;
  select * into m from public.mothers where id = r.mother_id for update;
  perform set_config('app.erasure', 'on', true);

  update public.consents set withdrawn_at = now(), withdrawn_reason = 'Erasure request'
    where mother_id = m.id and decision = 'accepted' and withdrawn_at is null;
  update public.caregivers set revoked_at = coalesce(revoked_at, now()) where mother_id = m.id;
  update public.caregivers set name = 'Erased', relation = 'erased', phone = null, user_id = null where mother_id = m.id;
  if m.user_id is not null then
    delete from public.notifications where user_id = m.user_id;
    delete from public.push_tokens where user_id = m.user_id;
  end if;
  update public.mothers set
      name = 'Erased ' || left(m.id::text, 8),
      age_at_registration = coalesce(age_at_registration, extract(year from age(created_at, dob))::int),
      dob = null, phone = null, alt_phone = null, husband_name = null, husband_phone = null, email = null,
      address_line = null, aadhaar_last4 = null, village = null, pincode = null,
      emergency_contact = null, user_id = null, erased_at = now()
    where id = m.id;

  update public.erasure_requests set status = 'completed', completed_at = now(), completed_by = p_by where id = r.id;
  insert into public.audit_log (actor_label, role, action, entity_type, entity_id, mother_id, meta)
  values ('data protection', 'system', 'erasure', 'mothers', m.id::text, m.id, jsonb_build_object('request', r.id));
  perform set_config('app.erasure', '', true);
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
