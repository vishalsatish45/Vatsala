-- Cross-row invariants found by the first-principles review.
--   A. key columns of mutable rows never change (a task can't move to another mother, an MCH id can't be edited)
--   B. linked records describe the same subject (same pregnancy / same baby), not just the same mother
--   C. teams, memberships, assignments and overrides are coherent (specialty, active, same hospital)
--   D. corrections point at the record they correct
--   E. test, discharge and medicine workflows can't reach impossible states
--   F. whole-episode invariants checked at COMMIT (deferred): every pregnancy has one current dating that
--      matches its EDD and, while active, an obstetric team; delivered ⇔ a delivery record; babies = plurality;
--      a referral's status is its latest event
-- Demo reset (app.demo_reset) bypasses A only, like the fact guards.

-- ── A. Key columns of mutable rows never change ─────────────────────────────────

create function app.guard_keys() returns trigger
language plpgsql set search_path = '' as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  k text;
begin
  -- demo reset and the DPDP erasure procedure (app.erase_mother_personal_data) are the only bypasses
  if app.demo_reset_active() or coalesce(current_setting('app.erasure', true), '') = 'on' then return new; end if;
  foreach k in array tg_argv loop
    if (o -> k) is distinct from (n -> k) then
      raise exception '%.% cannot be changed after the record is created', tg_table_name, k;
    end if;
  end loop;
  return new;
end $$;

do $$
declare
  r record;
begin
  for r in select * from (values
    ('mothers',        array['id','created_by','created_at']),
    ('caregivers',     array['id','mother_id','phone','added_by','added_at']),
    ('pregnancies',    array['id','mch_id','mother_id','hospital_id','registered_on','source','created_by','created_at']),
    ('babies',         array['id','child_id','mother_id','pregnancy_id','delivery_id','birth_order','dob','sex','birth_weight_g',
                             'length_cm','head_circ_cm','ga_at_birth_days','apgar1','apgar5','outcome','stillbirth_type',
                             'resuscitation','birth_defects','breastfed_within_1h','vitamin_k']),
    ('admissions',     array['id','pregnancy_id','mother_id','ip_no','admitted_at','admitted_by','reason']),
    ('investigations', array['id','mother_id','pregnancy_id','baby_id','code','label','generated_by']),
    ('referrals',      array['id','mother_id','pregnancy_id','baby_id','to_team_id','from_encounter_id','urgency','reason',
                             'question','created_by','created_at']),
    ('medications',    array['id','mother_id','pregnancy_id','baby_id','kind','name','dose','route','slots','instructions',
                             'start_on','prescribed_by','recorded_at']),
    ('immunizations',  array['id','mother_id','pregnancy_id','baby_id','code']),
    ('tasks',          array['id','mother_id','pregnancy_id','baby_id','kind','template_key','referral_id','generated_by','created_at']),
    ('callbacks',      array['id','mother_id','requested_by','requested_by_label','channel','signs','note','voice_path',
                             'voice_seconds','at']),
    ('discharges',     array['id','mother_id','pregnancy_id','baby_id','admission_id','started_at']),
    ('discharge_items',array['discharge_id','mother_id','key']),
    ('ai_drafts',      array['id','mother_id','pregnancy_id','baby_id','kind','content','engine','model','generated_by','generated_at']),
    ('documents',      array['id','mother_id','pregnancy_id','baby_id','kind','storage_path','mime','captured_by','captured_at']),
    ('staff',          array['id','hospital_id','created_at']),
    ('teams',          array['id','hospital_id','kind','specialty']),
    ('hospitals',      array['id','code','created_at']),
    ('team_members',   array['id','team_id','staff_id','from_at']),
    ('care_assignments', array['id','mother_id','pregnancy_id','baby_id','specialty','team_id','primary_staff_id','from_at',
                               'assigned_by','reason']),
    ('access_overrides', array['id','staff_id','mother_id','reason','granted_at','expires_at'])
  ) as t(tbl, keys)
  loop
    execute format('create trigger %I before update on public.%I for each row execute function app.guard_keys(%s)',
      r.tbl || '_keys', r.tbl, (select string_agg(quote_literal(c), ', ') from unnest(r.keys) c));
  end loop;
end $$;

-- Tags: everything but the removal columns is the record.
create trigger tags_immutable before update on public.tags
  for each row execute function app.guard_fact_update('removed_by', 'removed_at', 'removed_reason');

-- A confirmed transcription is part of the record.
create function app.documents_confirmed_final() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.confirmed_at is not null and (new.fields is distinct from old.fields or new.confirmed_at is distinct from old.confirmed_at) then
    raise exception 'a confirmed document cannot be changed';
  end if;
  return new;
end $$;
create trigger documents_confirmed_final before update on public.documents
  for each row execute function app.documents_confirmed_final();

-- ── B. Linked records describe the same subject ─────────────────────────────────
-- TG_ARGV: pairs of (column, parent table). The parent's (pregnancy_id, baby_id) must equal the row's.
-- security definer: reads parents the caller may not see.

create function app.enforce_same_subject() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
  p jsonb;
  i int := 0;
  col text;
  parent text;
begin
  while i < tg_nargs loop
    col := tg_argv[i];
    parent := tg_argv[i + 1];
    i := i + 2;
    continue when n ->> col is null;
    execute format('select to_jsonb(x) from public.%I x where x.id = $1', parent) into p using (n ->> col)::uuid;
    if (p ->> 'pregnancy_id') is distinct from (n ->> 'pregnancy_id')
       or (p ->> 'baby_id') is distinct from (n ->> 'baby_id') then
      raise exception '%.% must belong to the same pregnancy or baby as the %', tg_table_name, col, rtrim(tg_table_name, 's')
        using errcode = 'foreign_key_violation';
    end if;
  end loop;
  return new;
end $$;

create trigger babies_same_subject before insert or update on public.babies
  for each row execute function app.enforce_same_subject('delivery_id', 'deliveries');
create trigger deliveries_same_subject before insert or update on public.deliveries
  for each row execute function app.enforce_same_subject('admission_id', 'admissions');
create trigger discharges_same_subject before insert or update on public.discharges
  for each row execute function app.enforce_same_subject('admission_id', 'admissions');
create trigger tasks_same_subject before insert or update on public.tasks
  for each row execute function app.enforce_same_subject('completed_by_encounter_id', 'encounters', 'referral_id', 'referrals');
create trigger immunizations_same_subject before insert or update on public.immunizations
  for each row execute function app.enforce_same_subject('given_in_encounter_id', 'encounters');
create trigger referrals_same_subject before insert or update on public.referrals
  for each row execute function app.enforce_same_subject('from_encounter_id', 'encounters');
create trigger datings_same_subject before insert on public.pregnancy_datings
  for each row execute function app.enforce_same_subject('investigation_id', 'investigations');
create trigger encounters_same_subject before insert on public.encounters
  for each row execute function app.enforce_same_subject('document_id', 'documents');

-- A baby's child id is its pregnancy's MCH id + birth order.
create function app.baby_child_id() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.child_id <> (select g.mch_id from public.pregnancies g where g.id = new.pregnancy_id) || '-B' || new.birth_order then
    raise exception 'child id must be the pregnancy''s MCH id followed by -B%', new.birth_order using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger babies_child_id before insert on public.babies
  for each row execute function app.baby_child_id();

-- ── C. Teams, memberships, assignments, overrides are coherent ──────────────────

create function app.role_specialty(p_role text) returns text
language sql immutable set search_path = '' as $$
  select case p_role when 'obstetrician' then 'obstetrics' when 'paediatrician' then 'paediatrics' end
$$;

create function app.check_team_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  t public.teams;
  parent public.teams;
  s public.staff;
begin
  if tg_table_name = 'teams' then
    if new.parent_team_id is not null then
      select * into parent from public.teams where id = new.parent_team_id;
      if parent.kind <> 'department' or parent.specialty <> new.specialty then
        raise exception 'a unit belongs to a department of the same specialty' using errcode = 'check_violation';
      end if;
    end if;
  elsif tg_table_name = 'team_members' then
    select * into t from public.teams where id = new.team_id;
    select * into s from public.staff where id = new.staff_id;
    -- obstetric/paediatric units take clinicians of that specialty (nurses and coordinators may join any team)
    if new.to_at is null and t.kind = 'unit' and s.role in ('obstetrician','paediatrician','specialist')
       and app.role_specialty(s.role) is distinct from t.specialty then
      raise exception 'a % cannot join the % unit %', s.role, t.specialty, t.name using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'care_assignments' and new.to_at is null then
    select * into t from public.teams where id = new.team_id;
    if not t.active then
      raise exception 'team % is inactive', t.name using errcode = 'check_violation';
    end if;
    if new.primary_staff_id is not null then
      select * into s from public.staff where id = new.primary_staff_id;
      if not s.active or app.role_specialty(s.role) is distinct from new.specialty then
        raise exception 'the primary clinician must be an active % clinician',
          case new.specialty when 'obstetrics' then 'obstetric' else 'paediatric' end using errcode = 'check_violation';
      end if;
    end if;
  end if;
  return new;
end $$;

create trigger teams_rules before insert or update on public.teams
  for each row execute function app.check_team_rules();
create trigger team_members_rules before insert on public.team_members
  for each row execute function app.check_team_rules();
create trigger care_assignments_rules before insert on public.care_assignments
  for each row execute function app.check_team_rules();

-- An override is only for a mother with a pregnancy at the clinician's hospital, by an obstetrician or
-- paediatrician.
create function app.check_override() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  s public.staff;
begin
  select * into s from public.staff where id = new.staff_id;
  if not s.active or s.role not in ('obstetrician','paediatrician') then
    raise exception 'only an active obstetrician or paediatrician can use an emergency override' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.pregnancies g where g.mother_id = new.mother_id and g.hospital_id = s.hospital_id) then
    raise exception 'an override is only for patients of your hospital' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger access_overrides_rules before insert on public.access_overrides
  for each row execute function app.check_override();

-- ── D. Corrections point at the record they correct ─────────────────────────────

create function app.check_supersedes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev jsonb;
begin
  if new.supersedes is null then return new; end if;
  execute format('select to_jsonb(x) from public.%I x where x.id = $1', tg_table_name) into prev using new.supersedes;
  if tg_table_name = 'observations' then
    if prev ->> 'code' <> new.code or (prev ->> 'pregnancy_id') is distinct from new.pregnancy_id::text
       or (prev ->> 'baby_id') is distinct from new.baby_id::text then
      raise exception 'a correction must be for the same measurement of the same patient' using errcode = 'check_violation';
    end if;
  elsif (prev ->> 'investigation_id')::uuid is distinct from new.investigation_id then
    raise exception 'a corrected result must belong to the same test' using errcode = 'check_violation';
  end if;
  if prev ->> 'status' = 'entered_in_error' then
    raise exception 'an entry marked in error cannot be corrected; record a new one' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger observations_supersedes before insert on public.observations
  for each row execute function app.check_supersedes();
create trigger investigation_results_supersedes before insert on public.investigation_results
  for each row execute function app.check_supersedes();

-- ── E. Workflows can't reach impossible states ──────────────────────────────────

-- Results only for tests that are going ahead; 'resulted'/'reviewed' need a live result.
create function app.check_result_allowed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select status from public.investigations where id = new.investigation_id) in ('not_done','not_applicable') then
    raise exception 'this test was marked not done; it cannot take a result' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger investigation_results_allowed before insert on public.investigation_results
  for each row execute function app.check_result_allowed();

create function app.check_investigation_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('resulted','reviewed') and not exists (
       select 1 from public.investigation_results r where r.investigation_id = new.id and r.status <> 'entered_in_error') then
    raise exception 'a test without a result cannot be %', new.status using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger investigations_status before insert or update of status on public.investigations
  for each row execute function app.check_investigation_status();

-- Withdrawing a test's last live result sends the test back to waiting for one (and clears any review),
-- so a test can never stay "resulted"/"reviewed" with nothing behind it. This trigger is the only writer.
create function app.reset_test_without_results() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'entered_in_error' and old.status <> 'entered_in_error'
     and not exists (select 1 from public.investigation_results r
                     where r.investigation_id = new.investigation_id and r.status <> 'entered_in_error') then
    update public.investigations
      set status = case when collected_at is not null then 'collected' when ordered_at is not null then 'ordered' else 'due' end,
          reviewed_at = null, reviewed_by = null, follow_up = null
      where id = new.investigation_id and status in ('resulted','reviewed');
  end if;
  return null;
end $$;
create trigger investigation_results_reset after update of status on public.investigation_results
  for each row execute function app.reset_test_without_results();

-- A discharge item belongs to the right subject; a discharge completes only when every item is resolved.
create function app.check_discharge_item() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select grp from public.pick_lists where list = 'discharge_item' and code = new.key)
     <> (select case when d.baby_id is null then 'mother' else 'baby' end from public.discharges d where d.id = new.discharge_id) then
    raise exception 'discharge item % does not apply to this patient', new.key using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger discharge_items_subject before insert on public.discharge_items
  for each row execute function app.check_discharge_item();

create function app.check_discharge_complete() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.completed_at is not null and old.completed_at is null then
    if not exists (select 1 from public.discharge_items i where i.discharge_id = new.id) then
      raise exception 'a discharge needs its checklist' using errcode = 'check_violation';
    end if;
    if exists (select 1 from public.discharge_items i where i.discharge_id = new.id and i.state is null) then
      raise exception 'every discharge item must be done, N/A or deferred with a reason' using errcode = 'check_violation';
    end if;
  end if;
  if old.completed_at is not null and new.completed_at is distinct from old.completed_at then
    raise exception 'a completed discharge cannot be reopened' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger discharges_complete before update on public.discharges
  for each row execute function app.check_discharge_complete();

create function app.check_discharge_item_open() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select completed_at from public.discharges where id = new.discharge_id) is not null then
    raise exception 'the discharge is complete; its checklist cannot change' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger discharge_items_open before insert or update on public.discharge_items
  for each row execute function app.check_discharge_item_open();

-- Doses are logged only against an active prescription.
create function app.check_dose() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.medications m where m.id = new.medication_id and m.kind = 'prescription' and m.status = 'active') then
    raise exception 'doses can be logged only for an active prescription' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger med_doses_prescription before insert on public.med_doses
  for each row execute function app.check_dose();

-- ── F. Whole-episode invariants, checked at COMMIT ──────────────────────────────

create function app.check_pregnancy(p_pregnancy uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  g public.pregnancies;
  d public.deliveries;
  n_current int;
  current_edd date;
  n_babies int;
begin
  select * into g from public.pregnancies where id = p_pregnancy;
  if g.id is null or app.demo_reset_active() then return; end if;
  select count(*), max(edd) into n_current, current_edd from public.pregnancy_datings where pregnancy_id = g.id and is_current;
  if n_current <> 1 or current_edd is distinct from g.edd then
    raise exception 'pregnancy % must have exactly one current dating matching its EDD', g.mch_id using errcode = 'check_violation';
  end if;
  if g.status = 'active' and not exists (select 1 from public.care_assignments a
       where a.pregnancy_id = g.id and a.specialty = 'obstetrics' and a.to_at is null) then
    raise exception 'pregnancy % has no obstetric team', g.mch_id using errcode = 'check_violation';
  end if;
  select * into d from public.deliveries where pregnancy_id = g.id;
  if (d.id is not null) <> (g.end_reason is not distinct from 'delivered') then
    raise exception 'pregnancy % : "delivered" and the delivery record must go together', g.mch_id using errcode = 'check_violation';
  end if;
  if d.id is not null then
    select count(*) into n_babies from public.babies where delivery_id = d.id;
    if n_babies <> d.plurality then
      raise exception 'delivery of % records % babies but plurality %', g.mch_id, n_babies, d.plurality using errcode = 'check_violation';
    end if;
  end if;
end $$;

create function app.check_pregnancy_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := to_jsonb(new);
begin
  perform app.check_pregnancy(case when tg_table_name = 'pregnancies' then new.id else (n ->> 'pregnancy_id')::uuid end);
  if tg_table_name = 'care_assignments' and n ->> 'baby_id' is not null then
    perform app.check_pregnancy((select pregnancy_id from public.babies where id = (n ->> 'baby_id')::uuid));
  end if;
  return null;
end $$;

create constraint trigger pregnancies_invariants after insert or update on public.pregnancies
  deferrable initially deferred for each row execute function app.check_pregnancy_trigger();
create constraint trigger datings_invariants after insert or update on public.pregnancy_datings
  deferrable initially deferred for each row execute function app.check_pregnancy_trigger();
create constraint trigger assignments_invariants after insert or update on public.care_assignments
  deferrable initially deferred for each row execute function app.check_pregnancy_trigger();
create constraint trigger deliveries_invariants after insert or update on public.deliveries
  deferrable initially deferred for each row execute function app.check_pregnancy_trigger();
create constraint trigger babies_invariants after insert or update on public.babies
  deferrable initially deferred for each row execute function app.check_pregnancy_trigger();

-- A referral's status is its latest event (the event table is the history the UI shows).
create function app.check_referral_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- read through jsonb: the two tables name the referral column differently
  rid uuid := case when tg_table_name = 'referrals' then (to_jsonb(new) ->> 'id')::uuid
                   else (to_jsonb(new) ->> 'referral_id')::uuid end;
  cur text;
  last_event text;
begin
  if app.demo_reset_active() then return null; end if;
  select status into cur from public.referrals where id = rid;
  select e.status into last_event from public.referral_events e where e.referral_id = rid order by e.at desc, e.id desc limit 1;
  if last_event is distinct from cur then
    raise exception 'referral status (%) must match its latest event (%)', cur, coalesce(last_event, 'none')
      using errcode = 'check_violation';
  end if;
  return null;
end $$;

create constraint trigger referrals_invariants after insert or update on public.referrals
  deferrable initially deferred for each row execute function app.check_referral_trigger();
create constraint trigger referral_events_invariants after insert on public.referral_events
  deferrable initially deferred for each row execute function app.check_referral_trigger();

do $$ begin perform app.apply_api_grants(); end $$;
