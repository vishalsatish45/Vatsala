-- Dating is a later step (registration rework, October 2026).
--
-- A pregnancy is registered without a dating; the doctor records the dating at her first check-up. Until then:
--   * pregnancies.edd is null and there is no current pregnancy_datings row (the commit-time invariant allows
--     "no dating at all", never "two" or "one that disagrees with the EDD");
--   * no ANC visit or test window can be planned (check_planned_tasks / check_planned_tests refuse them);
--   * the paediatric team's 34-week access does not start: app.paeds_start is 'infinity' for an undated pregnancy, so
--     its grant row exists but is never valid until a dating moves it (app.grants_from_dating);
--   * family read functions return edd = null (they read the column as it is).
--
-- The first dating goes through redate_pregnancy (now also "record dating"): it takes the planned ANC visits AND the
-- test windows, exactly what registration used to plan, and is audited as 'record_dating'. Every dating (at
-- registration, first or re-dating) is checked by one helper, app.check_dating: calendar arithmetic only.

alter table public.pregnancies alter column edd drop not null;

-- Local midnight at 34+0 weeks (EDD − 42 days) in the hospital's time zone; 'infinity' while undated, so a paediatric
-- grant computed from it never starts before the pregnancy is dated (greatest() would otherwise ignore a null).
create or replace function app.paeds_start(p_pregnancy uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select coalesce(((g.edd - 42)::timestamp at time zone h.timezone), 'infinity'::timestamptz)
  from public.pregnancies g join public.hospitals h on h.id = g.hospital_id
  where g.id = p_pregnancy
$$;

-- ── Commit-time invariant (replaces 20261005000120): dated ⇔ exactly one current dating equal to the EDD ──────────
create or replace function app.check_pregnancy(p_pregnancy uuid) returns void
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
  if n_current <> (case when g.edd is null then 0 else 1 end) or current_edd is distinct from g.edd then
    raise exception 'pregnancy % must have exactly one current dating matching its EDD (none while undated)', g.mch_id
      using errcode = 'check_violation';
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

-- ── Plans need a dating (replaces 20261005000300) ─────────────────────────────────
create or replace function app.check_planned_tasks(g public.pregnancies, p_tasks jsonb, p_kinds text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  bad text;
begin
  if jsonb_array_length(p_tasks) > 30 then
    raise exception 'Too many planned visits in one request' using errcode = 'PT422';
  end if;
  if g.edd is null and exists (select 1 from jsonb_to_recordset(p_tasks) as x(kind text) where x.kind = 'anc_visit') then
    raise exception 'ANC visits are planned once the pregnancy is dated. Record the dating first.' using errcode = 'PT422';
  end if;
  select string_agg(coalesce(x.title, '?'), ', ') into bad
  from jsonb_to_recordset(p_tasks) as x(kind text, title text, due_from date, due_by date)
  where not (x.kind = any(p_kinds))
     or x.due_by is null or nullif(trim(x.title), '') is null
     or (x.due_from is not null and (x.due_from > x.due_by or x.due_by - x.due_from > 21))
     or x.due_by < app.local_date(g.hospital_id, g.registered_on) - 1
     or (x.kind = 'anc_visit' and x.due_by > g.edd + 14);
  if bad is not null then
    raise exception 'These planned visits are not possible for this pregnancy: %', bad using errcode = 'PT422';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_tasks) as x(kind text, due_by date) group by x.kind, x.due_by having count(*) > 1)
     or exists (select 1 from jsonb_to_recordset(p_tasks) as x(kind text, due_by date)
                join public.tasks k on k.pregnancy_id = g.id and k.kind = x.kind and k.due_by = x.due_by
                                   and k.completed_at is null and k.cancelled_at is null) then
    raise exception 'Two visits of the same kind are planned on one day' using errcode = 'PT422';
  end if;
end $$;

create or replace function app.check_planned_tests(g public.pregnancies, p_tests jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  bad text;
begin
  if g.edd is null and jsonb_array_length(p_tests) > 0 then
    raise exception 'Test windows are planned once the pregnancy is dated. Record the dating first.' using errcode = 'PT422';
  end if;
  select string_agg(coalesce(x.code, '?'), ', ') into bad
  from jsonb_to_recordset(p_tests) as x(code text, due_from date, due_by date)
  left join public.investigation_catalogue c on c.code = x.code and c.active and c.applies_to = 'mother'
  where c.code is null or x.due_from is null or x.due_by is null or x.due_from > x.due_by
     or x.due_by > g.edd + 14 or x.due_from < g.edd - 300;
  if bad is not null then
    raise exception 'These planned tests are not possible for this pregnancy: %', bad using errcode = 'PT422';
  end if;
end $$;

-- ── One check for every dating: registration, first dating, re-dating ─────────────
-- Returns the EDD. Calendar arithmetic only (src/data/payloads.ts eddFor): LMP + 280 days; scan date + (280 − GA at
-- the scan); or the EDD the clinician decided. Nothing here judges a dating; it only refuses one that cannot be.
create function app.check_dating(pd jsonb) returns date
language plpgsql stable set search_path = '' as $$
declare
  v_method text := coalesce(pd ->> 'method', 'lmp');
  v_edd date := (pd ->> 'edd')::date;
  v_lmp date := (pd ->> 'lmp')::date;
  v_scan date := (pd ->> 'scan_on')::date;
  v_scan_ga int := app.int_field(pd, 'ga_at_scan_days', 28, 300, 'Gestational age at the scan (days)');
begin
  if v_method not in ('lmp','scan','clinician') then
    raise exception 'Dating method must be lmp, scan or clinician' using errcode = 'PT422';
  end if;
  if v_edd is null then
    raise exception 'The EDD is required' using errcode = 'PT422';
  end if;
  -- (a day's grace for the phone's time zone; demo mode may travel in time)
  if not app.is_demo() and (v_lmp > current_date + 1 or v_scan > current_date + 1) then
    raise exception 'The LMP and the scan date cannot be in the future' using errcode = 'PT422';
  end if;
  if v_method = 'lmp' and (v_lmp is null or v_edd <> v_lmp + 280) then
    raise exception 'For LMP dating, the EDD is the LMP + 280 days' using errcode = 'PT422';
  end if;
  if v_method = 'scan' and (v_scan is null or v_scan_ga is null or v_edd <> v_scan + (280 - v_scan_ga)) then
    raise exception 'For scan dating, give the scan date and the gestational age at the scan' using errcode = 'PT422';
  end if;
  if pd ? 'lmp_certain' and jsonb_typeof(pd -> 'lmp_certain') not in ('boolean','null') then
    raise exception 'lmp_certain must be true or false' using errcode = 'PT422';
  end if;
  if length(coalesce(pd ->> 'note', '')) > 500 then
    raise exception 'Dating note: up to 500 characters' using errcode = 'PT422';
  end if;
  return v_edd;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Record dating / re-date (replaces 20261005000300)
-- ════════════════════════════════════════════════════════════════════════════════
-- The first dating of an undated pregnancy plans what registration used to: the ANC visits (new_tasks) and the test
-- windows (investigations), both planned by shared/domain on the phone and plausibility-checked here.
-- The paediatric team's 34-week start follows the new EDD (trigger app.grants_from_dating). A re-dating replans the
-- future ANC visits only; test windows are not re-planned (PT422 if sent).
create or replace function public.redate_pregnancy(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  g public.pregnancies;
  pd jsonb;
  v_at timestamptz;
  v_edd date;
  first_dating boolean;
  cancelled int;
  created int;
  n_tests int := 0;
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','version','dating','cancel_task_ids','new_tasks','investigations','at']);
  pd := app.only_keys(coalesce(p -> 'dating', '{}'), array['method','lmp','lmp_certain','scan_on','ga_at_scan_days','investigation_id','edd','note'], 'dating');
  perform app.only_keys_each(p -> 'new_tasks', array['id','kind','title','due_from','due_by','appointment_at','place'], 'new_tasks');
  perform app.only_keys_each(p -> 'investigations', array['id','code','due_from','due_by','late'], 'investigations');
  prior := app.idem_begin('redate_pregnancy', p);
  if prior is not null then return prior; end if;

  s := app.require_writer((p ->> 'pregnancy_id')::uuid, null);
  select * into g from public.pregnancies where id = (p ->> 'pregnancy_id')::uuid for update;
  perform app.check_version(g.version, p);
  if g.status <> 'active' then
    raise exception 'Only an ongoing pregnancy can be dated or re-dated' using errcode = 'PT409';
  end if;
  if jsonb_typeof(p -> 'dating') is distinct from 'object' then
    raise exception 'Record the dating (LMP, scan or the EDD you decided)' using errcode = 'PT422';
  end if;
  v_edd := app.check_dating(pd);
  first_dating := g.edd is null;
  if not first_dating and jsonb_array_length(coalesce(p -> 'investigations', '[]'::jsonb)) > 0 then
    raise exception 'Test windows are planned at the first dating only' using errcode = 'PT422';
  end if;

  v_at := app.event_time(p ->> 'at');
  insert into public.pregnancy_datings (pregnancy_id, mother_id, method, lmp, lmp_certain, scan_on, ga_at_scan_days,
                                        investigation_id, edd, note, decided_by, decided_at)
  values (g.id, g.mother_id, coalesce(pd ->> 'method', 'lmp'), (pd ->> 'lmp')::date, (pd ->> 'lmp_certain')::boolean,
          (pd ->> 'scan_on')::date, app.int_field(pd, 'ga_at_scan_days', 28, 300, 'Gestational age at the scan (days)'),
          (pd ->> 'investigation_id')::uuid, v_edd, nullif(trim(pd ->> 'note'), ''), s.id, v_at);
  select * into g from public.pregnancies where id = g.id;
  cancelled := app.cancel_tasks(g.id, p -> 'cancel_task_ids', 'anc_visit', 'Re-planned after re-dating', v_at);
  created := app.add_tasks(g, coalesce(p -> 'new_tasks', '[]'::jsonb), array['anc_visit'], 'protocol');
  if first_dating then
    perform app.check_planned_tests(g, coalesce(p -> 'investigations', '[]'::jsonb));
    insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by, late, generated_by)
    select coalesce(x.id, gen_random_uuid()), g.mother_id, g.id, x.code, c.label, x.due_from, x.due_by, coalesce(x.late, false), 'protocol'
    from jsonb_to_recordset(coalesce(p -> 'investigations', '[]'::jsonb)) as x(id uuid, code text, due_from date, due_by date, late boolean)
    join public.investigation_catalogue c on c.code = x.code;
    get diagnostics n_tests = row_count;
  end if;
  perform app.audit_event(case when first_dating then 'record_dating' else 'redate_pregnancy' end, 'pregnancies', g.id::text, g.mother_id,
                          jsonb_build_object('edd', v_edd, 'method', coalesce(pd ->> 'method', 'lmp'), 'visits', created, 'tests', n_tests));
  return app.idem_finish(p, jsonb_build_object('edd', g.edd, 'version', g.version, 'first_dating', first_dating,
                                               'cancelled', cancelled, 'created', created, 'tests', n_tests));
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
