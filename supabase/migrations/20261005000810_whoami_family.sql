-- whoami: what the Family app needs at sign-in that the first version left out (found while wiring the app):
--   mother.purposes / caregiving[].purposes  the purposes of her own active consent (reminder channels shown in
--                                            settings), null when she has not accepted the notice
--   caregiving[].name                        the caregiver's own name as the mother entered it (greeting)
-- Still never returns phone numbers or anyone else's data.

create or replace function public.whoami() returns jsonb
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
                 'consented', k.id is not null, 'purposes', to_jsonb(k.purposes))
               from public.mothers m
               left join lateral (select x.id, x.purposes from public.consents x where x.mother_id = m.id and x.user_id = m.user_id
                                  and x.decision = 'accepted' and x.withdrawn_at is null order by x.at desc limit 1) k on true
               where m.user_id = (select auth.uid())),
    'caregiving', coalesce((select jsonb_agg(jsonb_build_object(
                  'caregiver_id', c.id, 'name', c.name, 'mother_id', m.id, 'mother_name', m.name, 'relation', c.relation,
                  'scopes', jsonb_build_object('schedule', c.scope_schedule, 'baby', c.scope_baby,
                                               'logs', c.scope_logs, 'tests', c.scope_tests),
                  'consented', k.id is not null, 'purposes', to_jsonb(k.purposes)))
                from public.caregivers c join public.mothers m on m.id = c.mother_id
                left join lateral (select x.id, x.purposes from public.consents x where x.mother_id = m.id and x.user_id = c.user_id
                                   and x.decision = 'accepted' and x.withdrawn_at is null order by x.at desc limit 1) k on true
                where c.user_id = (select auth.uid()) and c.revoked_at is null and m.erased_at is null), '[]'::jsonb))
$$;

do $$ begin perform app.apply_api_grants(); end $$;
