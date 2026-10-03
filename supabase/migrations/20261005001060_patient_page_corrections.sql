-- Patient page rework (3 Oct 2026): a visit is recorded at its own date and time, and a recorded fact is corrected
-- by a new version that supersedes it — never edited in place.
--
--   1. `supersedes` on encounters and the documented history (conditions, allergies, previous pregnancies), checked
--      like observations / results already are: same patient (and, for a visit, same kind and subject), and never an
--      entry already withdrawn.
--   2. record_visit: the visit's `at` (the date and time of the visit, default now) may not be in the future (outside
--      demo mode, as before) and may not be before the pregnancy was registered (hospital calendar day).

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. Corrections point at what they correct
-- ════════════════════════════════════════════════════════════════════════════════

alter table public.encounters add column supersedes uuid references public.encounters(id);
alter table public.documented_conditions add column supersedes uuid references public.documented_conditions(id);
alter table public.allergies add column supersedes uuid references public.allergies(id);
alter table public.previous_pregnancies add column supersedes uuid references public.previous_pregnancies(id);

-- One live correction per record: a version is replaced at most once.
create unique index encounters_supersedes on public.encounters(supersedes) where supersedes is not null;
create unique index documented_conditions_supersedes on public.documented_conditions(supersedes) where supersedes is not null;
create unique index allergies_supersedes on public.allergies(supersedes) where supersedes is not null;
create unique index previous_pregnancies_supersedes on public.previous_pregnancies(supersedes) where supersedes is not null;

-- security definer: reads the corrected row whatever the caller may see (the RPC already checked access to it).
create or replace function app.check_supersedes() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  prev jsonb;
  n jsonb := to_jsonb(new);
begin
  if new.supersedes is null then return new; end if;
  execute format('select to_jsonb(x) from public.%I x where x.id = $1', tg_table_name) into prev using new.supersedes;
  if prev is null then
    raise exception 'a correction must point at an existing record' using errcode = 'foreign_key_violation';
  end if;
  if tg_table_name = 'observations' then
    if prev ->> 'code' <> n ->> 'code' or (prev ->> 'pregnancy_id') is distinct from (n ->> 'pregnancy_id')
       or (prev ->> 'baby_id') is distinct from (n ->> 'baby_id') then
      raise exception 'a correction must be for the same measurement of the same patient' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'investigation_results' then
    if (prev ->> 'investigation_id') is distinct from (n ->> 'investigation_id') then
      raise exception 'a corrected result must belong to the same test' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'encounters' then
    if prev ->> 'kind' <> n ->> 'kind' or (prev ->> 'pregnancy_id') is distinct from (n ->> 'pregnancy_id')
       or (prev ->> 'baby_id') is distinct from (n ->> 'baby_id') then
      raise exception 'a corrected visit must be the same kind of visit of the same patient' using errcode = 'check_violation';
    end if;
  elsif (prev ->> 'mother_id') is distinct from (n ->> 'mother_id') then
    raise exception 'a correction must be for the same mother' using errcode = 'check_violation';
  end if;
  if prev ->> 'status' = 'entered_in_error' then
    raise exception 'an entry marked in error cannot be corrected; record a new one' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger encounters_supersedes before insert on public.encounters
  for each row execute function app.check_supersedes();
create trigger documented_conditions_supersedes before insert on public.documented_conditions
  for each row execute function app.check_supersedes();
create trigger allergies_supersedes before insert on public.allergies
  for each row execute function app.check_supersedes();
create trigger previous_pregnancies_supersedes before insert on public.previous_pregnancies
  for each row execute function app.check_supersedes();

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. record_visit at the date and time of the visit
-- ════════════════════════════════════════════════════════════════════════════════

-- When a visit happened: not in the future (app.effective_time, outside demo mode) and not before the pregnancy was
-- registered (the hospital's calendar day, so a visit seen in the morning and registered later that day still fits).
create function app.visit_time(g public.pregnancies, p_at text) returns timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  t timestamptz := app.effective_time(p_at);
begin
  if app.local_date(g.hospital_id, t) < app.local_date(g.hospital_id, g.registered_on) then
    raise exception 'A visit cannot be dated before the pregnancy was registered' using errcode = 'PT422';
  end if;
  return t;
end $$;

-- Same contract as 20261005000300; `at` is now checked against the registration (app.visit_time).
create or replace function public.record_visit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  g public.pregnancies;
  e public.encounters;
  closed int := 0;
  cancelled int;
  created int;
begin
  perform app.only_keys(p, array['idempotency_key','encounter_id','pregnancy_id','at','ga_days','observations','checklist',
                                 'complaints','complaints_note','counselling','note','completeness','close_task_id',
                                 'cancel_task_ids','new_tasks']);
  perform app.only_keys_each(p -> 'observations', array['code','value_num','value_text','unit'], 'observations');
  perform app.only_keys_each(p -> 'checklist', array['component','state','reason'], 'checklist');
  perform app.only_keys_each(p -> 'new_tasks', array['id','kind','title','due_from','due_by','appointment_at','place'], 'new_tasks');
  prior := app.idem_begin('record_visit', p);
  if prior is not null then return prior; end if;

  s := app.require_writer((p ->> 'pregnancy_id')::uuid, null);
  select * into g from public.pregnancies where id = (p ->> 'pregnancy_id')::uuid;
  if g.status <> 'active' then
    raise exception 'ANC visits are recorded for an ongoing pregnancy' using errcode = 'PT409';
  end if;

  insert into public.encounters (id, mother_id, pregnancy_id, kind, at, by_staff, ga_days, complaints, complaints_note,
                                 counselling, note, completeness)
  values (coalesce((p ->> 'encounter_id')::uuid, gen_random_uuid()), g.mother_id, g.id, 'anc', app.visit_time(g, p ->> 'at'),
          s.id, (p ->> 'ga_days')::int, coalesce(app.text_array(p -> 'complaints', 'complaints'), '{}'), nullif(trim(p ->> 'complaints_note'), ''),
          coalesce(app.text_array(p -> 'counselling', 'counselling'), '{}'), nullif(trim(p ->> 'note'), ''), (p ->> 'completeness')::numeric)
  returning * into e;

  insert into public.observations (encounter_id, mother_id, pregnancy_id, code, value_num, value_text, unit, at, by_staff)
  select e.id, e.mother_id, e.pregnancy_id, x.code, x.value_num, nullif(trim(x.value_text), ''), x.unit, e.at, s.id
  from jsonb_to_recordset(coalesce(p -> 'observations', '[]'::jsonb)) as x(code text, value_num numeric, value_text text, unit text);

  insert into public.encounter_checklist (encounter_id, mother_id, component, state, reason)
  select e.id, e.mother_id, x.component, x.state, nullif(trim(x.reason), '')
  from jsonb_to_recordset(coalesce(p -> 'checklist', '[]'::jsonb)) as x(component text, state text, reason text);

  if p ->> 'close_task_id' is not null then
    update public.tasks set completed_at = e.at, completed_by_encounter_id = e.id
      where id = (p ->> 'close_task_id')::uuid and pregnancy_id = g.id and kind = 'anc_visit'
        and completed_at is null and cancelled_at is null;
    get diagnostics closed = row_count;
    if closed = 0 then
      raise exception 'That visit is no longer open. Refresh and try again.' using errcode = 'PT409';
    end if;
  end if;
  cancelled := app.cancel_tasks(g.id, p -> 'cancel_task_ids', 'anc_visit', 'Re-planned after visit', app.event_time(p ->> 'at'));
  created := app.add_tasks(g, coalesce(p -> 'new_tasks', '[]'::jsonb), array['anc_visit'], 'protocol');

  return app.idem_finish(p, jsonb_build_object('encounter_id', e.id, 'closed_task_id', p ->> 'close_task_id',
                                               'cancelled', cancelled, 'created', created));
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
