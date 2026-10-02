-- Row-level security. SELECT policies only — every write goes
-- through an RPC. Visibility comes from access_grants (maintained by triggers, 20261005000130), read through
-- the helpers below:
--
--   app.my_grants()               the signed-in clinician's live grants: held by her, by a team she belongs to,
--                                 or by her hospital's labour-room roles; never grants on her own record
--   app.visible_mother_ids()      any grant → the mother's documented history (allergies, conditions, past pregnancies)
--   app.care_mother_ids()         treating teams, labour room, overrides (not referrals) → call-backs, home readings,
--                                 caregivers, consents
--   app.full_mother_ids()         whole-record grants (obstetric team, override): every row of these mothers,
--                                 sensitive tests included, plus the audit trail and erasure requests
--   app.subject_ids()             pregnancies / babies granted one by one (paediatrics, labour room, referral),
--                                 plus babies of a granted pregnancy; ids are UUIDs, so one set serves both
--   app.sensitive_subject_ids()   the subset of those where HIV / syphilis / HBsAg results may be seen
--   app.shared_investigation_ids()  results a referrer shared with my department
--
-- Performance (measured): whole-record access is tested on mother_id first and never expanded
-- into pregnancy ids; OR short-circuits, so for the treating team the subject and sensitivity checks never run.
--
-- Families read no clinical table directly (DTO functions); tables give them only their
-- own consents, notifications and push tokens.
--
-- Shape: `col in (select app.helper())` — security-definer set-returning helpers in the private app schema,
-- evaluated once per query (hashed subplan), uuid = uuid only, so user filters stay index-usable under RLS.

-- ── Helpers ─────────────────────────────────────────────────────────────────────

-- security definer: reads staff/team rows the policies on those tables would otherwise filter.
create function app.staff_hospital_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select s.hospital_id from public.staff s where s.user_id = (select auth.uid()) and s.active
$$;

create function app.my_staff_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s where s.user_id = (select auth.uid()) and s.active
$$;

-- security definer: reads access_grants; returns only grants held by the signed-in clinician (directly, through
-- a current team membership, or through her hospital role), live now, and never on her own record.
-- Three indexed lookups (by staff, by team, by hospital) instead of one OR, so each uses its own index.
create function app.my_grants() returns setof public.access_grants
language sql stable security definer set search_path = '' as $$
  with me as (
    select s.id, s.hospital_id, s.role from public.staff s where s.user_id = (select auth.uid()) and s.active
  ),
  held as (
    select g.* from public.access_grants g join me on g.staff_id = me.id
    union all
    select g.* from public.access_grants g
      join public.team_members tm on tm.team_id = g.team_id and tm.to_at is null
      join me on tm.staff_id = me.id
    union all
    select g.* from public.access_grants g
      join me on g.hospital_id = me.hospital_id and me.role = any(g.hospital_roles)
      where g.valid_until is null            -- labour-room grants are live only while the admission is open
  )
  select h.* from held h
  where h.valid_from <= now() and (h.valid_until is null or h.valid_until > now())
    and h.mother_id is distinct from (select m.id from public.mothers m where m.user_id = (select auth.uid()))
$$;

create function app.visible_mother_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct mother_id from app.my_grants()
$$;

create function app.care_mother_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct mother_id from app.my_grants() where source <> 'referral'
$$;

create function app.full_mother_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select distinct mother_id from app.my_grants() where scope = 'mother'
$$;

create function app.subject_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with g as (select * from app.my_grants() where scope = 'subject')
  select coalesce(pregnancy_id, baby_id) from g
  union
  select b.id from public.babies b where b.pregnancy_id in (select pregnancy_id from g where pregnancy_id is not null)
$$;

create function app.sensitive_subject_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with g as (select * from app.my_grants() where scope = 'subject' and sensitive)
  select coalesce(pregnancy_id, baby_id) from g
  union
  select b.id from public.babies b where b.pregnancy_id in (select pregnancy_id from g where pregnancy_id is not null)
$$;

create function app.shared_investigation_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select rs.investigation_id from public.referral_shared_results rs
  where rs.referral_id in (select referral_id from app.my_grants() where source = 'referral')
$$;

insert into app.api_functions values
  ('app','staff_hospital_ids'), ('app','my_staff_id'), ('app','my_grants'), ('app','visible_mother_ids'),
  ('app','care_mother_ids'), ('app','full_mother_ids'), ('app','subject_ids'), ('app','sensitive_subject_ids'),
  ('app','shared_investigation_ids');

-- ── Reference data: any signed-in user ──────────────────────────────────────────

create policy read_reference on public.pick_lists for select to authenticated using (true);
create policy read_reference on public.tag_catalogue for select to authenticated using (true);
create policy read_reference on public.observation_codes for select to authenticated using (true);
create policy read_reference on public.investigation_catalogue for select to authenticated using (true);
create policy read_reference on public.vaccine_catalogue for select to authenticated using (true);
create policy read_reference on public.app_settings for select to authenticated using (true);

-- ── Organisation: staff of the same hospital ────────────────────────────────────

create policy read_own_hospital on public.hospitals for select to authenticated using (
  id in (select app.staff_hospital_ids()));
create policy read_own_hospital on public.teams for select to authenticated using (
  hospital_id in (select app.staff_hospital_ids()));
create policy read_own_hospital on public.staff for select to authenticated using (
  hospital_id in (select app.staff_hospital_ids()));
create policy read_own_hospital on public.team_members for select to authenticated using (
  team_id in (select t.id from public.teams t where t.hospital_id in (select app.staff_hospital_ids())));

-- ── The mother and her documented history: anyone with a grant on her ───────────

create policy read_visible on public.mothers for select to authenticated using (id in (select app.visible_mother_ids()));
create policy read_visible on public.allergies for select to authenticated using (mother_id in (select app.visible_mother_ids()));
create policy read_visible on public.documented_conditions for select to authenticated using (mother_id in (select app.visible_mother_ids()));
create policy read_visible on public.previous_pregnancies for select to authenticated using (mother_id in (select app.visible_mother_ids()));
create policy read_visible on public.patient_identifiers for select to authenticated using (
  mother_id in (select app.full_mother_ids())
  or (baby_id is null and mother_id in (select app.visible_mother_ids()))
  or baby_id in (select app.subject_ids()));

-- ── Care-level data: treating teams, labour room, overrides (not referral specialists) ──

create policy read_care on public.callbacks for select to authenticated using (mother_id in (select app.care_mother_ids()));
create policy read_care on public.self_logs for select to authenticated using (mother_id in (select app.care_mother_ids()));
create policy read_care on public.caregivers for select to authenticated using (mother_id in (select app.care_mother_ids()));
create policy read_care on public.consents for select to authenticated using (
  user_id = (select auth.uid()) or mother_id in (select app.care_mother_ids()));

-- ── Pregnancy- and baby-scoped records ──────────────────────────────────────────
-- Whole-record holders match on mother_id; everyone else on the granted pregnancy / baby.

create policy read_subject on public.pregnancies for select to authenticated using (
  mother_id in (select app.full_mother_ids()) or id in (select app.subject_ids()));
create policy read_subject on public.babies for select to authenticated using (
  mother_id in (select app.full_mother_ids()) or id in (select app.subject_ids()));

do $$
declare
  t text;
begin
  -- tables with only a pregnancy subject
  foreach t in array array['pregnancy_datings','deliveries','admissions'] loop
    execute format('create policy read_subject on public.%I for select to authenticated using (
      mother_id in (select app.full_mother_ids()) or pregnancy_id in (select app.subject_ids()))', t);
  end loop;
  -- tables whose rows are about a pregnancy or a baby
  foreach t in array array['encounters','observations','tasks','tags','care_notes','medications','immunizations',
                           'discharges','documents','ai_drafts','referrals','care_assignments'] loop
    execute format('create policy read_subject on public.%I for select to authenticated using (
      mother_id in (select app.full_mother_ids()) or coalesce(pregnancy_id, baby_id) in (select app.subject_ids()))', t);
  end loop;
end $$;

-- Tests: whole-record holders see all; others need the subject, and for a sensitive test also sensitive access
-- to that subject or a result shared with their referral.
create policy read_subject on public.investigations for select to authenticated using (
  mother_id in (select app.full_mother_ids())
  or (coalesce(pregnancy_id, baby_id) in (select app.subject_ids())
      and (not sensitive
           or coalesce(pregnancy_id, baby_id) in (select app.sensitive_subject_ids())
           or id in (select app.shared_investigation_ids()))));

-- Child rows follow their parent's visibility (the parent's own policy applies inside the sub-select).
create policy read_parent on public.investigation_results for select to authenticated using (
  investigation_id in (select i.id from public.investigations i));
create policy read_parent on public.referral_events for select to authenticated using (
  referral_id in (select r.id from public.referrals r));
create policy read_parent on public.referral_shared_results for select to authenticated using (
  referral_id in (select r.id from public.referrals r) and investigation_id in (select i.id from public.investigations i));
create policy read_parent on public.encounter_checklist for select to authenticated using (
  encounter_id in (select e.id from public.encounters e));
create policy read_parent on public.discharge_items for select to authenticated using (
  discharge_id in (select d.id from public.discharges d));
create policy read_parent on public.task_contacts for select to authenticated using (
  task_id in (select k.id from public.tasks k));
create policy read_parent on public.med_doses for select to authenticated using (
  medication_id in (select m.id from public.medications m));

-- ── Whole-record data: obstetric team and overrides ─────────────────────────────

create policy read_full on public.audit_log for select to authenticated using (
  mother_id in (select app.full_mother_ids()) or actor = (select auth.uid()));
create policy read_full on public.erasure_requests for select to authenticated using (
  mother_id in (select app.full_mother_ids()));
create policy read_full on public.access_overrides for select to authenticated using (
  staff_id = (select app.my_staff_id()) or mother_id in (select app.full_mother_ids()));
create policy read_full on public.access_grants for select to authenticated using (
  staff_id = (select app.my_staff_id()) or mother_id in (select app.full_mother_ids()));

-- ── Per-user rows ───────────────────────────────────────────────────────────────

create policy read_own on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy read_own on public.push_tokens for select to authenticated using (user_id = (select auth.uid()));

-- ── Every table has a read policy, except those deliberately closed to API roles ──

do $$
declare
  missing text;
begin
  select string_agg(t.tablename, ', ') into missing
  from pg_tables t
  where t.schemaname = 'public'
    and t.tablename not in ('id_counters','idempotency_keys')     -- server-internal; no API access by design
    and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = t.tablename);
  if missing is not null then
    raise exception 'tables without a read policy: %', missing;
  end if;
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
