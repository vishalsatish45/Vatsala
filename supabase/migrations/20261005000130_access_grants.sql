-- Access grants and DPDP erasure.
--
-- access_grants is derived data with exactly one writer: the triggers below. Each source event writes or
-- closes its grants, so RLS never re-derives the rules at query time:
--
--   source                         principal                 scope                           sensitive  valid
--   obstetric assignment           team + primary clinician  the whole maternal record       yes        from → to
--   paediatric assignment, pregn.  team + primary clinician  that pregnancy                  yes*       from 34+0 wk → to
--   paediatric assignment, baby    team + primary clinician  the baby + its birth pregnancy  yes*       from → to
--   admission (labour room)        hospital's OB + paeds     that pregnancy (+ its babies)   yes        admitted → discharged
--   referral                       receiving department      the referred pregnancy / baby   no**       created → ended + 30 days
--   emergency override             the clinician             the whole maternal record       yes        granted → expires / ended
--
--   *  newborn care needs maternal serology (HIV exposure, HBsAg, syphilis), as the handoff panel lists (PRD F-19)
--   ** sensitive results reach a specialist only when the referrer shares that result (referral_shared_results)
--
-- Re-dating a pregnancy moves the paediatric start date. Team membership changes rewrite nothing: grants are
-- held by the team and resolved against current membership at read time.

-- Local midnight at 34+0 weeks (EDD − 42 days) in the hospital's time zone.
create function app.paeds_start(p_pregnancy uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((g.edd - 42)::timestamp at time zone h.timezone)
  from public.pregnancies g join public.hospitals h on h.id = g.hospital_id
  where g.id = p_pregnancy
$$;

-- ── Assignments ─────────────────────────────────────────────────────────────────

create function app.grants_from_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.access_grants (mother_id, pregnancy_id, baby_id, scope, sensitive, team_id, staff_id, source,
                                      assignment_id, valid_from, valid_until)
    select new.mother_id, s.pregnancy_id, s.baby_id, s.scope, true, p.team_id, p.staff_id, 'assignment',
           new.id, s.valid_from, s.valid_until
    from (
      select null::uuid as pregnancy_id, null::uuid as baby_id, 'mother' as scope, new.from_at as valid_from,
             new.to_at as valid_until
        where new.specialty = 'obstetrics'
      union all
      select new.pregnancy_id, null, 'subject', greatest(new.from_at, app.paeds_start(new.pregnancy_id)), new.to_at
        where new.specialty = 'paediatrics' and new.pregnancy_id is not null
      union all
      -- a baby's paediatric episode (and the handoff view of its birth pregnancy) ends with the 0–24-month schedule
      select null, new.baby_id, 'subject', new.from_at, least(new.to_at, b.dob + interval '25 months')
        from public.babies b where b.id = new.baby_id
      union all
      select b.pregnancy_id, null, 'subject', new.from_at, least(new.to_at, b.dob + interval '25 months')
        from public.babies b where b.id = new.baby_id
    ) s
    cross join (values (new.team_id, null::uuid), (null::uuid, new.primary_staff_id)) as p(team_id, staff_id)
    where p.team_id is not null or p.staff_id is not null;
  elsif new.to_at is distinct from old.to_at then
    -- ending an assignment only ever shortens a grant
    update public.access_grants set valid_until = case when valid_until is null then new.to_at else least(valid_until, new.to_at) end
      where assignment_id = new.id;
  end if;
  return null;
end $$;

create trigger care_assignments_grants after insert or update of to_at on public.care_assignments
  for each row execute function app.grants_from_assignment();

-- Re-dating moves the paediatric team's start (34+0 weeks) for that pregnancy.
create function app.grants_from_dating() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_current then
    update public.access_grants a
      set valid_from = greatest(ca.from_at, app.paeds_start(new.pregnancy_id))
      from public.care_assignments ca
      where a.assignment_id = ca.id and ca.pregnancy_id = new.pregnancy_id and ca.specialty = 'paediatrics'
        and a.pregnancy_id = new.pregnancy_id;
  end if;
  return null;
end $$;

create trigger pregnancy_datings_grants after insert on public.pregnancy_datings
  for each row execute function app.grants_from_dating();

-- Closing a pregnancy ends its care assignments, so a team's working set is its active patients and stays
-- bounded over the years. A returning mother's new pregnancy gets a new assignment, which reopens her history.
create function app.end_assignments_on_close() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'closed' and old.status <> 'closed' then
    update public.care_assignments set to_at = now() where pregnancy_id = new.id and to_at is null;
  end if;
  return null;
end $$;

create trigger pregnancies_end_assignments after update of status on public.pregnancies
  for each row execute function app.end_assignments_on_close();

-- ── Labour room ─────────────────────────────────────────────────────────────────

create function app.grants_from_admission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.access_grants (mother_id, pregnancy_id, scope, sensitive, hospital_id, hospital_roles, source,
                                      admission_id, valid_from, valid_until)
    select new.mother_id, new.pregnancy_id, 'subject', true, g.hospital_id, '{obstetrician,paediatrician}', 'labour_room',
           new.id, new.admitted_at, new.discharged_at
    from public.pregnancies g where g.id = new.pregnancy_id;
  elsif new.discharged_at is distinct from old.discharged_at then
    update public.access_grants set valid_until = new.discharged_at where admission_id = new.id;
  end if;
  return null;
end $$;

create trigger admissions_grants after insert or update of discharged_at on public.admissions
  for each row execute function app.grants_from_admission();

-- ── Referrals ───────────────────────────────────────────────────────────────────

create function app.grants_from_referral() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.access_grants (mother_id, pregnancy_id, baby_id, scope, sensitive, team_id, source,
                                      referral_id, valid_from, valid_until)
    values (new.mother_id, new.pregnancy_id, new.baby_id, 'subject', false, new.to_team_id, 'referral',
            new.id, new.created_at, new.ended_at + interval '30 days');
  elsif new.ended_at is distinct from old.ended_at then
    update public.access_grants set valid_until = new.ended_at + interval '30 days' where referral_id = new.id;
  end if;
  return null;
end $$;

create trigger referrals_grants after insert or update of ended_at on public.referrals
  for each row execute function app.grants_from_referral();

-- ── Emergency overrides ─────────────────────────────────────────────────────────

create function app.grants_from_override() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.access_grants (mother_id, scope, sensitive, staff_id, source, override_id, valid_from, valid_until)
    values (new.mother_id, 'mother', true, new.staff_id, 'override', new.id, new.granted_at,
            least(new.expires_at, coalesce(new.ended_at, new.expires_at)));
  elsif new.ended_at is distinct from old.ended_at then
    update public.access_grants set valid_until = least(new.expires_at, coalesce(new.ended_at, new.expires_at))
      where override_id = new.id;
  end if;
  return null;
end $$;

create trigger access_overrides_grants after insert or update of ended_at on public.access_overrides
  for each row execute function app.grants_from_override();

-- ── DPDP erasure ────────────────────────────────────────────────────────────────
-- Erases a mother's personal and contact data (and her caregivers' links to her), unlinks her login, withdraws
-- consent and clears her notifications. The clinical record is retained for the legally required period; the
-- audit log never held personal values (app.pii_columns), so nothing in it needs rewriting.
-- Run by the hospital's data-protection process with the service role — not callable from the app.
-- After it: delete the auth user (Auth admin API) and her voice notes in Storage (Edge Function job).

create function app.erasure_active() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.erasure', true), '') = 'on'
$$;

create function app.erase_mother_personal_data(p_request uuid, p_by uuid) returns void
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
      dob = null, phone = null, alt_phone = null, husband_name = null, village = null, pincode = null,
      emergency_contact = null, user_id = null, erased_at = now()
    where id = m.id;

  update public.erasure_requests set status = 'completed', completed_at = now(), completed_by = p_by where id = r.id;
  insert into public.audit_log (actor_label, role, action, entity_type, entity_id, mother_id, meta)
  values ('data protection', 'system', 'erasure', 'mothers', m.id::text, m.id, jsonb_build_object('request', r.id));
  perform set_config('app.erasure', '', true);
end $$;

-- An erased record stays erased.
create function app.mothers_erased_final() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.erased_at is not null and not app.demo_reset_active() then
    raise exception 'an erased record cannot be changed';
  end if;
  return new;
end $$;
create trigger mothers_erased_final before update on public.mothers
  for each row execute function app.mothers_erased_final();

do $$ begin perform app.apply_api_grants(); end $$;
