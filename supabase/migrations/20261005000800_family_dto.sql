-- Family read functions: fields the Family screens show that the first version left out (found while wiring the
-- app). Bodies are unchanged apart from the added fields.
--   family_context  for the mother only: her age and her MCH id (both on her emergency card); for everyone:
--                   registered_on (where her journey starts)
--   family_tests    code and kind (the app names a test and its place from them)
-- A caregiver gets neither the age nor the MCH id (the card is the mother's, PRD F-45).

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
                   'closer_follow_up', g.intensity <> 'routine') end,
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

create or replace function public.family_tests(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
  mid uuid;
  is_mother boolean;
begin
  perform app.only_keys(p, array['mother_id']);
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  perform app.require_scope(actor, 'tests');
  mid := (actor ->> 'mother_id')::uuid;
  is_mother := actor ->> 'role' = 'mother';
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'code', i.code, 'kind', c.kind, 'label', i.label, 'baby_id', i.baby_id, 'due_from', i.due_from, 'due_by', i.due_by,
      'status', case when i.status in ('due','ordered','collected') then 'due'
                     when i.status in ('resulted','reviewed') then 'done' else 'not_done' end,
      'result', case when is_mother and i.status = 'reviewed' then (
                  select jsonb_build_object('value_num', r.value_num, 'value_text', r.value_text, 'unit', r.unit,
                                            'recorded_on', r.reported_at)
                  from public.investigation_results r where r.investigation_id = i.id and r.status <> 'entered_in_error'
                  order by r.entered_at desc limit 1) end)
    order by i.due_by)
    from public.investigations i join public.investigation_catalogue c on c.code = i.code
    where i.mother_id = mid and not i.sensitive
      and (i.baby_id is null or (actor -> 'scopes' ->> 'baby')::boolean)), '[]'::jsonb);
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
