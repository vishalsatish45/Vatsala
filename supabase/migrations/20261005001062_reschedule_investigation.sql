-- The doctor moves a test's due window (patient page rework, 3 Oct 2026). Dates only — never a clinical judgement:
-- the window must exist for this patient (inside the pregnancy for a maternal test, after birth for a baby's), from
-- ≤ by, at most a year wide, with a reason. Only a test still waiting for its result moves (due / ordered /
-- collected); a result's date tested is corrected with correct_result. Writer rules as for results
-- (app.require_writer), version-checked, refused on a closed episode, audited with the old and new window.

create function public.reschedule_investigation(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  i public.investigations;
  g public.pregnancies;
  b public.babies;
  v_from date;
  v_by date;
  reason text;
begin
  perform app.only_keys(p, array['idempotency_key','id','version','due_from','due_by','reason','at']);
  prior := app.idem_begin('reschedule_investigation', p);
  if prior is not null then return prior; end if;

  select * into i from public.investigations where id = (p ->> 'id')::uuid for update;
  if i.id is null or not app.can_see_investigation(i) then perform app.not_visible(); end if;
  s := app.require_writer(i.pregnancy_id, i.baby_id);
  perform app.check_version(i.version, p);
  if i.status not in ('due','ordered','collected') then
    raise exception 'Only a test still waiting for its result can be moved (this one is %)', i.status using errcode = 'PT409';
  end if;
  perform app.require_open_episode(i.pregnancy_id);
  reason := app.require_reason(p ->> 'reason', 'Moving a test window');
  begin
    v_from := (p ->> 'due_from')::date;
    v_by := (p ->> 'due_by')::date;
  exception when others then
    raise exception 'Give the window as dates (YYYY-MM-DD)' using errcode = 'PT422';
  end;
  if v_from is null or v_by is null or v_from > v_by or v_by - v_from > 366 then
    raise exception 'The window needs a start on or before its end (at most a year wide)' using errcode = 'PT422';
  end if;
  if i.pregnancy_id is not null then
    select * into g from public.pregnancies where id = i.pregnancy_id;
    if v_by < app.local_date(g.hospital_id, g.registered_on) - 1
       or (g.edd is not null and (v_by > g.edd + 14 or v_from < g.edd - 300)) then
      raise exception 'This window is outside the pregnancy' using errcode = 'PT422';
    end if;
  else
    select * into b from public.babies where id = i.baby_id;
    if v_by < (select app.local_date(x.hospital_id, b.dob) from public.pregnancies x where x.id = b.pregnancy_id) then
      raise exception 'A baby''s test cannot be due before the birth' using errcode = 'PT422';
    end if;
  end if;
  if v_from = i.due_from and v_by = i.due_by then
    raise exception 'The window is unchanged' using errcode = 'PT409';
  end if;

  update public.investigations set due_from = v_from, due_by = v_by where id = i.id;
  perform app.audit_event('reschedule_investigation', 'investigations', i.id::text, i.mother_id,
                          jsonb_build_object('from', jsonb_build_array(i.due_from, i.due_by), 'to', jsonb_build_array(v_from, v_by),
                                             'reason', reason));
  select * into i from public.investigations where id = i.id;
  return app.idem_finish(p, jsonb_build_object('id', i.id, 'due_from', i.due_from, 'due_by', i.due_by, 'version', i.version));
end $$;

insert into app.api_functions values ('public','reschedule_investigation');

do $$ begin perform app.apply_api_grants(); end $$;
