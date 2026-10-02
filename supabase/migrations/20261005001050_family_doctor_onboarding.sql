-- Family face: the assigned doctor, and the details the onboarding screen shows before consent.
--
--   family_context            `pregnancy.doctor`: the display name of the named doctor (primary clinician) of the
--                             pregnancy's CURRENT obstetric assignment, or null (a team with no named doctor, an ended
--                             episode). Not sensitive: the mother and her caregivers may both see it.
--   family_onboarding_info    NEW. Callable BEFORE consent by the mother herself or an active caregiver (the onboarding
--                             "Your details" step comes before the notice is accepted, and family_context answers
--                             PT404 until then). Returns only who she is and where she is cared for: her name, the
--                             caller's own number, her MCH id and EDD (mother only), the hospital name and the doctor's
--                             name. Nothing clinical. Staff, strangers and removed caregivers get PT404.
--
-- NULL-safe for a pregnancy without an EDD yet (dating recorded later by the doctor): `edd` is passed through as is.

-- The doctor's display name for a pregnancy: primary clinician of the current obstetric assignment, active staff only.
-- Security definer: families read no tables; only called by the family read functions below,
-- after app.family_actor has decided the caller may see this mother. Not callable from the API.
create or replace function app.family_doctor_name(p_pregnancy uuid) returns text
language sql stable security definer set search_path = '' as $$
  select s.name from public.care_assignments a join public.staff s on s.id = a.primary_staff_id
  where a.pregnancy_id = p_pregnancy and a.specialty = 'obstetrics' and a.to_at is null and s.active
  limit 1
$$;

-- Body as in 20261005000800_family_dto.sql, plus `pregnancy.doctor`.
create or replace function public.family_context(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
  mid uuid;
  m public.mothers;
  g public.pregnancies;
  is_mother boolean;
begin
  perform app.only_keys(p, array['mother_id']);
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  mid := (actor ->> 'mother_id')::uuid;
  is_mother := actor ->> 'role' = 'mother';
  select * into m from public.mothers where id = mid;
  g := app.current_pregnancy(mid);
  return jsonb_build_object(
    'role', actor ->> 'role',
    'scopes', actor -> 'scopes',
    'mother', jsonb_build_object('id', m.id, 'name', m.name, 'lang', m.lang,
                                 'age', case when is_mother then coalesce(extract(year from age(current_date, m.dob))::int,
                                                                          m.age_at_registration) end,
                                 'card_fields', case when is_mother then to_jsonb(m.card_fields) end),
    'hospital', (select jsonb_build_object('name', h.name, 'phone_opd', h.phone_opd, 'phone_labour', h.phone_labour,
                                           'address', h.address, 'maps_url', h.maps_url)
                 from public.hospitals h where h.id = g.hospital_id),
    'pregnancy', case when g.id is not null then jsonb_build_object('id', g.id, 'mch_id', case when is_mother then g.mch_id end,
                   'registered_on', g.registered_on,
                   'edd', g.edd, 'status', g.status,
                   'ended_on', g.ended_on, 'end_reason', case when g.end_reason in ('delivered') then g.end_reason end,
                   'closer_follow_up', g.intensity <> 'routine',
                   'doctor', app.family_doctor_name(g.id)) end,
    'babies', case when (actor -> 'scopes' ->> 'baby')::boolean then coalesce((select jsonb_agg(jsonb_build_object(
                'id', b.id, 'name', b.name, 'dob', b.dob, 'sex', b.sex, 'live', b.outcome = 'live' and b.deceased_at is null)
                order by b.dob, b.birth_order) from public.babies b where b.mother_id = mid and b.pregnancy_id = g.id), '[]'::jsonb) end,
    -- emergency card facts, mother only, never sensitive (PRD F-45)
    'card', case when is_mother then jsonb_build_object(
              'blood_group', (select coalesce(
                  (select r.value_text from public.investigation_results r join public.investigations i on i.id = r.investigation_id
                   where i.mother_id = mid and i.code = 'bg' and r.status <> 'entered_in_error' and i.status = 'reviewed'
                   order by r.reported_at desc limit 1),
                  (select o.value_text from public.observations o where o.mother_id = mid and o.code = 'blood_group'
                   and o.status <> 'entered_in_error' order by o.at desc limit 1))),
              'allergies', coalesce((select jsonb_agg(a.substance order by a.substance) from public.allergies a
                                     where a.mother_id = mid and a.status = 'final'), '[]'::jsonb),
              'conditions', coalesce((select jsonb_agg(d.label order by d.label) from public.documented_conditions d
                                      where d.mother_id = mid and d.status = 'final' and d.clinical_status = 'active'), '[]'::jsonb),
              'emergency_contact', m.emergency_contact) end);
end $$;

-- Onboarding "Your details" (ON-03), before consent. A caregiver names the mother (`mother_id`); a mother is resolved
-- from her own login. Security definer: families read no tables; app.family_actor(…, false) has already checked
-- that the caller IS this mother or an active (not removed) caregiver of hers — consent is the only check skipped.
-- `phone` is the caller's own number (local 10 digits), never anyone else's.
create or replace function public.family_onboarding_info(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
  mid uuid;
  is_mother boolean;
  m public.mothers;
  g public.pregnancies;
  own_phone text;
begin
  perform app.only_keys(p, array['mother_id']);
  actor := app.family_actor((p ->> 'mother_id')::uuid, false);
  mid := (actor ->> 'mother_id')::uuid;
  is_mother := actor ->> 'role' = 'mother';
  select * into m from public.mothers where id = mid;
  g := app.current_pregnancy(mid);
  own_phone := case when is_mother then m.phone
                    else (select c.phone from public.caregivers c where c.id = (actor ->> 'caregiver_id')::uuid) end;
  return jsonb_build_object(
    'role', actor ->> 'role',
    'mother', jsonb_build_object('name', m.name),
    'phone', case when own_phone ~ '^91[0-9]{10}$' then substr(own_phone, 3) else own_phone end,
    'mch_id', case when is_mother then g.mch_id end,
    'hospital', (select jsonb_build_object('name', h.name) from public.hospitals h where h.id = g.hospital_id),
    'doctor', case when g.id is not null then app.family_doctor_name(g.id) end,
    'edd', case when is_mother then g.edd end);
end $$;

insert into app.api_functions values ('public','family_onboarding_info');

do $$ begin perform app.apply_api_grants(); end $$;
