-- A department reads only its own referrals (audit of 2 Oct 2026). Tests: supabase/tests/096_care_fixes.sql.
--
-- A referral grant (source 'referral') opens the referred pregnancy or baby to the receiving
-- department, and read_subject on `referrals` matched any row of that subject — so a department saw the other
-- departments' referrals of the same pregnancy (their reasons, questions and recommendations), their timelines and
-- the results shared with them, and their appointment tasks. Now:
--
--   referrals        whole-record holders (obstetric team, override) and treating grants (paediatrics, labour room)
--                    see all of the subject's referrals; a referral grant sees only the referral it came from.
--   referral_events, referral_shared_results
--                    follow their referral (read_parent, unchanged) — so they are scoped too.
--   tasks            a referral appointment is visible only with its referral (restrictive policy: every other
--                    task row is unaffected).
--
-- Shape as everywhere: `col in (select app.helper())`, security-definer helpers, uuid = uuid.

-- Subjects granted other than by a referral (treating teams, labour room), plus babies of such a pregnancy.
create function app.care_subject_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  with g as (select * from app.my_grants() where scope = 'subject' and source <> 'referral')
  select coalesce(pregnancy_id, baby_id) from g
  union
  select b.id from public.babies b where b.pregnancy_id in (select pregnancy_id from g where pregnancy_id is not null)
$$;

-- The referrals addressed to the signed-in clinician's departments (live referral grants).
create function app.my_referral_ids() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select referral_id from app.my_grants() where source = 'referral' and referral_id is not null
$$;

insert into app.api_functions values ('app','care_subject_ids'), ('app','my_referral_ids');

drop policy read_subject on public.referrals;
create policy read_subject on public.referrals for select to authenticated using (
  mother_id in (select app.full_mother_ids())
  or coalesce(pregnancy_id, baby_id) in (select app.care_subject_ids())
  or id in (select app.my_referral_ids()));

-- Restrictive: ANDed with read_subject on tasks. Only referral appointments are affected.
create policy referral_scope on public.tasks as restrictive for select to authenticated using (
  referral_id is null or referral_id in (select r.id from public.referrals r));

do $$ begin perform app.apply_api_grants(); end $$;
