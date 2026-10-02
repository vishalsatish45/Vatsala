-- Access starts when the record is saved at the latest (found by the app's end-to-end run, tests R013a).
--
-- A grant used to start at the record's clinical time: an assignment's from_at, an admission's admitted_at, a
-- referral's created_at. Those can be ahead of the server clock — a phone clock a few seconds fast, or demo time
-- travel ("+7 days") — and then the clinician who just registered a patient could not see her until that moment
-- passed. Clinical times stay as recorded; only access is clamped: valid_from = least(clinical time, now()).
-- The paediatric team's start at 34+0 weeks stays in the future on purpose.

create or replace function app.grants_from_assignment() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  starts timestamptz := least(new.from_at, now());
begin
  if tg_op = 'INSERT' then
    insert into public.access_grants (mother_id, pregnancy_id, baby_id, scope, sensitive, team_id, staff_id, source,
                                      assignment_id, valid_from, valid_until)
    select new.mother_id, s.pregnancy_id, s.baby_id, s.scope, true, p.team_id, p.staff_id, 'assignment',
           new.id, s.valid_from, s.valid_until
    from (
      select null::uuid as pregnancy_id, null::uuid as baby_id, 'mother' as scope, starts as valid_from,
             new.to_at as valid_until
        where new.specialty = 'obstetrics'
      union all
      select new.pregnancy_id, null, 'subject', greatest(starts, app.paeds_start(new.pregnancy_id)), new.to_at
        where new.specialty = 'paediatrics' and new.pregnancy_id is not null
      union all
      -- a baby's paediatric episode (and the handoff view of its birth pregnancy) ends with the 0–24-month schedule
      select null, new.baby_id, 'subject', starts, least(new.to_at, b.dob + interval '25 months')
        from public.babies b where b.id = new.baby_id
      union all
      select b.pregnancy_id, null, 'subject', starts, least(new.to_at, b.dob + interval '25 months')
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

-- Re-dating moves the paediatric team's start (34+0 weeks); access already granted never moves later than now.
create or replace function app.grants_from_dating() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_current then
    update public.access_grants a
      set valid_from = greatest(least(ca.from_at, now()), app.paeds_start(new.pregnancy_id))
      from public.care_assignments ca
      where a.assignment_id = ca.id and ca.pregnancy_id = new.pregnancy_id and ca.specialty = 'paediatrics'
        and a.pregnancy_id = new.pregnancy_id;
  end if;
  return null;
end $$;

create or replace function app.grants_from_admission() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.access_grants (mother_id, pregnancy_id, scope, sensitive, hospital_id, hospital_roles, source,
                                      admission_id, valid_from, valid_until)
    select new.mother_id, new.pregnancy_id, 'subject', true, g.hospital_id, '{obstetrician,paediatrician}', 'labour_room',
           new.id, least(new.admitted_at, now()), new.discharged_at
    from public.pregnancies g where g.id = new.pregnancy_id;
  elsif new.discharged_at is distinct from old.discharged_at then
    update public.access_grants set valid_until = new.discharged_at where admission_id = new.id;
  end if;
  return null;
end $$;

create or replace function app.grants_from_referral() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.access_grants (mother_id, pregnancy_id, baby_id, scope, sensitive, team_id, source,
                                      referral_id, valid_from, valid_until)
    values (new.mother_id, new.pregnancy_id, new.baby_id, 'subject', false, new.to_team_id, 'referral',
            new.id, least(new.created_at, now()), new.ended_at + interval '30 days');
  elsif new.ended_at is distinct from old.ended_at then
    update public.access_grants set valid_until = new.ended_at + interval '30 days' where referral_id = new.id;
  end if;
  return null;
end $$;

-- Existing grants that start in the future for that reason start now (not the paediatric 34-week start).
update public.access_grants g set valid_from = now()
  where g.valid_from > now()
    and not exists (select 1 from public.care_assignments ca
                    where ca.id = g.assignment_id and ca.specialty = 'paediatrics' and ca.pregnancy_id is not null);
