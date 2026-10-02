-- Admission, delivery, newborn, vaccines, discharge, episode end, prescriptions, notifications
-- (PRD F-18…F-24, F-46, F-04). Same contract as every RPC: allowlist → idempotency →
-- role + object access → version → set-based writes → audit → stored response.
--
-- Vaccine schedules are generated here from vaccine_catalogue (D4). Follow-up visits after discharge are planned
-- on the device (shared/domain POSTNATAL_STANDARD + tag templates) and plausibility-checked here.
-- Notifications carry a kind and a target id only — never names or clinical detail (PRD F-04).

-- ════════════════════════════════════════════════════════════════════════════════
-- Notifications
-- ════════════════════════════════════════════════════════════════════════════════

create function app.notify(p_users uuid[], p_kind text, p_target_type text, p_target_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, target_type, target_id)
  select distinct u, p_kind, p_target_type, p_target_id from unnest(p_users) u where u is not null
$$;

-- Signed-in members of a team (and optionally one more clinician), excluding the caller.
create function app.team_users(p_team uuid, p_extra_staff uuid default null) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct s.user_id), '{}') from public.staff s
  where s.active and s.user_id is not null and s.user_id is distinct from (select auth.uid())
    and (s.id = p_extra_staff or s.id in (select tm.staff_id from public.team_members tm where tm.team_id = p_team and tm.to_at is null))
$$;

-- The mother and the caregivers holding a scope, who have accepted the app notice.
create function app.family_users(p_mother uuid, p_scope text) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(u), '{}') from (
    select m.user_id u from public.mothers m
    where m.id = p_mother and m.user_id is not null and app.consent_active(m.id, m.user_id, 'app')
    union
    select c.user_id from public.caregivers c
    where c.mother_id = p_mother and c.revoked_at is null and c.user_id is not null and app.consent_active(c.mother_id, c.user_id, 'app')
      and case p_scope when 'schedule' then c.scope_schedule when 'baby' then c.scope_baby else false end) x
$$;

-- A family call-back reaches the treating team at once (PRD F-04, F-25): her obstetric team, or else her
-- baby's paediatric team. request_callback refuses when neither exists, so no request is left unseen.
create function app.callback_team(p_mother uuid) returns public.care_assignments
language sql stable security definer set search_path = '' as $$
  select ca.* from public.care_assignments ca
  where ca.mother_id = p_mother and ca.to_at is null
    and (ca.specialty = 'obstetrics' or ca.baby_id is not null)
  order by (ca.specialty = 'obstetrics') desc, ca.from_at desc limit 1
$$;

create function app.notify_callback() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  a public.care_assignments := app.callback_team(new.mother_id);
begin
  perform app.notify(app.team_users(a.team_id, a.primary_staff_id), 'callback_requested', 'callback', new.id);
  return null;
end $$;
create trigger callbacks_notify after insert on public.callbacks for each row execute function app.notify_callback();

-- No treating team (episode closed): the family is told to call the hospital, instead of a request nobody sees.
create function app.callback_needs_team() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (app.callback_team(new.mother_id)).id is null then
    raise exception 'Please call the hospital directly' using errcode = 'PT409';
  end if;
  return new;
end $$;
create trigger callbacks_need_team before insert on public.callbacks for each row execute function app.callback_needs_team();

-- Referral steps: a new referral to the department; every later step to the referrer.
create function app.notify_referral() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  r public.referrals;
begin
  select * into r from public.referrals where id = new.referral_id;
  if new.status = 'requested' then
    perform app.notify(app.team_users(r.to_team_id), 'referral_requested', 'referral', r.id);
  else
    perform app.notify(array(select s.user_id from public.staff s where s.id = r.created_by and s.active
                             and s.user_id is distinct from (select auth.uid())), 'referral_' || new.status, 'referral', r.id);
  end if;
  return null;
end $$;
create trigger referral_events_notify after insert on public.referral_events for each row execute function app.notify_referral();

-- A booked appointment reaches the family (schedule scope, or baby scope for a baby).
create function app.notify_appointment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'referral_appt' then
    perform app.notify(app.family_users(new.mother_id, case when new.baby_id is null then 'schedule' else 'baby' end),
                       'appointment_booked', 'task', new.id);
  end if;
  return null;
end $$;
create trigger tasks_notify after insert on public.tasks for each row execute function app.notify_appointment();

-- ════════════════════════════════════════════════════════════════════════════════
-- Helpers
-- ════════════════════════════════════════════════════════════════════════════════

-- Follow-up visits planned on the device after discharge: kinds allowed, inside a sane window, not duplicated.
create function app.add_followups(p_mother uuid, p_pregnancy uuid, p_baby uuid, p_tasks jsonb, p_from date) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
  bad text;
begin
  perform app.only_keys_each(p_tasks, array['id','kind','title','template_key','due_from','due_by'], 'follow_up_tasks');
  select string_agg(coalesce(x.title, '?'), ', ') into bad
  from jsonb_to_recordset(p_tasks) as x(kind text, title text, template_key text, due_from date, due_by date)
  where x.kind not in (case when p_baby is null then 'pn_visit' else 'nb_visit' end, 'template')
     or nullif(trim(x.title), '') is null or x.due_by is null
     or (x.kind = 'template') <> (x.template_key is not null)
     or (x.due_from is not null and (x.due_from > x.due_by or x.due_by - x.due_from > 31))
     or x.due_by < p_from or x.due_by > p_from + 400;
  if bad is not null then
    raise exception 'These follow-up visits are not possible: %', bad using errcode = 'PT422';
  end if;
  insert into public.tasks (id, mother_id, pregnancy_id, baby_id, kind, title, template_key, due_from, due_by, generated_by)
  select coalesce(x.id, gen_random_uuid()), p_mother, p_pregnancy, p_baby, x.kind, trim(x.title), x.template_key,
         x.due_from, x.due_by, case when x.kind = 'template' then 'template' else 'protocol' end
  from jsonb_to_recordset(p_tasks) as x(id uuid, kind text, title text, template_key text, due_from date, due_by date);
  get diagnostics n = row_count;
  return n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Admission and delivery
-- ════════════════════════════════════════════════════════════════════════════════

create function public.admit(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  g public.pregnancies;
  t timestamptz;
  ip text;
  a public.admissions;
begin
  perform app.only_keys(p, array['idempotency_key','id','pregnancy_id','reason','at']);
  prior := app.idem_begin('admit', p);
  if prior is not null then return prior; end if;
  s := app.require_writer((p ->> 'pregnancy_id')::uuid, null);
  select * into g from public.pregnancies where id = (p ->> 'pregnancy_id')::uuid;
  if g.status = 'closed' then
    raise exception 'This pregnancy episode is closed' using errcode = 'PT409';
  end if;
  t := app.effective_time(p ->> 'at');
  ip := 'IP-' || to_char(app.local_date(g.hospital_id, t), 'YYYY') || '-'
        || lpad(app.next_number(g.hospital_id, 'ip', to_char(app.local_date(g.hospital_id, t), 'YYYY'))::text, 6, '0');
  begin
    insert into public.admissions (id, pregnancy_id, mother_id, ip_no, admitted_at, reason, admitted_by)
    values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), g.id, g.mother_id, ip, t, nullif(trim(p ->> 'reason'), ''), s.id)
    returning * into a;
  exception when unique_violation then
    raise exception 'She is already admitted' using errcode = 'PT409';
  end;
  return app.idem_finish(p, jsonb_build_object('admission_id', a.id, 'ip_no', a.ip_no));
end $$;

-- An admission that ends without a delivery (e.g. antenatal observation). After a delivery the mother's
-- discharge checklist closes the admission instead.
create function public.end_admission(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  a public.admissions;
begin
  perform app.only_keys(p, array['idempotency_key','admission_id','at']);
  prior := app.idem_begin('end_admission', p);
  if prior is not null then return prior; end if;
  select * into a from public.admissions where id = (p ->> 'admission_id')::uuid for update;
  if a.id is null then perform app.not_visible(); end if;
  s := app.require_writer(a.pregnancy_id, null);
  if a.discharged_at is not null then
    raise exception 'This admission has ended' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.discharges d where d.admission_id = a.id) then
    raise exception 'Complete the discharge checklist instead' using errcode = 'PT409';
  end if;
  update public.admissions set discharged_at = app.effective_time(p ->> 'at'), discharged_by = s.id where id = a.id;
  return app.idem_finish(p, jsonb_build_object('admission_id', a.id, 'ended', true));
end $$;

-- One transaction (PRD F-18): delivery → babies with linked ids → paediatric team → UIP schedule (birth doses
-- as recorded) → discharge checklists → remaining ANC visits cancelled → pregnancy delivered → notifications.
-- A stillborn baby gets no team, no vaccines, no checklist and no cheerful content.
create function public.record_delivery(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  g public.pregnancies;
  pd jsonb;
  t timestamptz;
  d_date date;
  n_babies int;
  adm uuid;
  paeds public.care_assignments;
  dl public.deliveries;
  b record;
  dis uuid;
  result jsonb := '[]';
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','delivery','babies']);
  pd := app.only_keys(coalesce(p -> 'delivery', '{}'), array['id','at','place','labour_onset','mode','indication','blood_loss_ml',
          'perineum','complications','complications_note','medicines','medicines_note','maternal_condition','attended_by'], 'delivery');
  perform app.only_keys_each(p -> 'babies', array['id','sex','birth_weight_g','length_cm','head_circ_cm','apgar1','apgar5','outcome',
          'stillbirth_type','resuscitation','birth_defects','breastfed_within_1h','vitamin_k','birth_doses_given'], 'babies');
  prior := app.idem_begin('record_delivery', p);
  if prior is not null then return prior; end if;

  s := app.require_writer((p ->> 'pregnancy_id')::uuid, null);
  select * into g from public.pregnancies where id = (p ->> 'pregnancy_id')::uuid for update;
  if g.status <> 'active' then
    raise exception 'A delivery is recorded for an ongoing pregnancy' using errcode = 'PT409';
  end if;
  n_babies := jsonb_array_length(coalesce(p -> 'babies', '[]'::jsonb));
  if n_babies not between 1 and 4 then
    raise exception 'Record between one and four babies' using errcode = 'PT422';
  end if;
  t := app.effective_time(pd ->> 'at');
  d_date := app.local_date(g.hospital_id, t);
  select id into adm from public.admissions where pregnancy_id = g.id and discharged_at is null;
  select * into paeds from public.care_assignments where pregnancy_id = g.id and specialty = 'paediatrics' and to_at is null;

  update public.pregnancies set status = 'delivered', end_reason = 'delivered', ended_on = d_date where id = g.id;
  update public.tasks set cancelled_at = t, override_reason = 'Delivered'
    where pregnancy_id = g.id and kind = 'anc_visit' and completed_at is null and cancelled_at is null;

  insert into public.deliveries (id, pregnancy_id, mother_id, admission_id, at, place, labour_onset, mode, indication, plurality,
                                 blood_loss_ml, perineum, complications, complications_note, medicines, medicines_note,
                                 maternal_condition, attended_by, recorded_by)
  values (coalesce((pd ->> 'id')::uuid, gen_random_uuid()), g.id, g.mother_id, adm, t, coalesce(pd ->> 'place', 'this_facility'),
          pd ->> 'labour_onset', pd ->> 'mode', nullif(trim(pd ->> 'indication'), ''), n_babies, (pd ->> 'blood_loss_ml')::int,
          pd ->> 'perineum', coalesce(app.text_array(pd -> 'complications', 'complications'), '{}'), nullif(trim(pd ->> 'complications_note'), ''),
          coalesce(app.text_array(pd -> 'medicines', 'medicines'), '{}'), nullif(trim(pd ->> 'medicines_note'), ''),
          pd ->> 'maternal_condition', pd ->> 'attended_by', s.id)
  returning * into dl;

  for b in select x.*, row_number() over () as birth_order
           from jsonb_to_recordset(p -> 'babies') as x(id uuid, sex text, birth_weight_g int, length_cm numeric, head_circ_cm numeric,
                apgar1 int, apgar5 int, outcome text, stillbirth_type text, resuscitation boolean, birth_defects text,
                breastfed_within_1h boolean, vitamin_k boolean, birth_doses_given boolean) loop
    declare
      bid uuid := coalesce(b.id, gen_random_uuid());
    begin
      insert into public.babies (id, child_id, mother_id, pregnancy_id, delivery_id, birth_order, dob, sex, birth_weight_g, length_cm,
                                 head_circ_cm, ga_at_birth_days, apgar1, apgar5, outcome, stillbirth_type, resuscitation, birth_defects,
                                 breastfed_within_1h, vitamin_k)
      values (bid, g.mch_id || '-B' || b.birth_order, g.mother_id, g.id, dl.id, b.birth_order, t, coalesce(b.sex, 'U'), b.birth_weight_g,
              b.length_cm, b.head_circ_cm, 280 - (g.edd - d_date), b.apgar1, b.apgar5, b.outcome, b.stillbirth_type, b.resuscitation,
              nullif(trim(b.birth_defects), ''), b.breastfed_within_1h, b.vitamin_k);
      if b.outcome = 'live' then
        insert into public.care_assignments (mother_id, baby_id, specialty, team_id, from_at, assigned_by, reason)
        values (g.mother_id, bid, 'paediatrics', paeds.team_id, t, s.id, 'Birth');
        insert into public.immunizations (mother_id, baby_id, code, due_on, status, given_on, primary_source, given_by)
        select g.mother_id, bid, v.code, d_date + v.age_days,
               case when v.age_days = 0 and coalesce(b.birth_doses_given, false) then 'given' else 'due' end,
               case when v.age_days = 0 and coalesce(b.birth_doses_given, false) then d_date end,
               case when v.age_days = 0 and coalesce(b.birth_doses_given, false) then true end,
               case when v.age_days = 0 and coalesce(b.birth_doses_given, false) then s.id end
        from public.vaccine_catalogue v where v.applies_to = 'baby' and v.active;
        insert into public.discharges (id, mother_id, baby_id, started_at) values (gen_random_uuid(), g.mother_id, bid, t) returning id into dis;
        insert into public.discharge_items (discharge_id, mother_id, key)
        select dis, g.mother_id, l.code from public.pick_lists l where l.list = 'discharge_item' and l.grp = 'baby' and l.active;
        perform app.notify(app.team_users(paeds.team_id), 'baby_born', 'baby', bid);
        perform app.notify(app.family_users(g.mother_id, 'baby'), 'baby_arrived', 'baby', bid);
      end if;
      result := result || jsonb_build_array(jsonb_build_object('baby_id', bid, 'child_id', g.mch_id || '-B' || b.birth_order));
    end;
  end loop;

  insert into public.discharges (id, mother_id, pregnancy_id, admission_id, started_at) values (gen_random_uuid(), g.mother_id, g.id, adm, t)
  returning id into dis;
  insert into public.discharge_items (discharge_id, mother_id, key)
  select dis, g.mother_id, l.code from public.pick_lists l where l.list = 'discharge_item' and l.grp = 'mother' and l.active;

  perform app.audit_event('record_delivery', 'deliveries', dl.id::text, g.mother_id,
                          jsonb_build_object('babies', n_babies, 'mode', dl.mode));
  return app.idem_finish(p, jsonb_build_object('delivery_id', dl.id, 'babies', result));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Newborn and vaccines
-- ════════════════════════════════════════════════════════════════════════════════

create function public.add_newborn_obs(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  b public.babies;
  e public.encounters;
begin
  perform app.only_keys(p, array['idempotency_key','encounter_id','baby_id','at','observations','note']);
  perform app.only_keys_each(p -> 'observations', array['code','value_num','value_text','unit'], 'observations');
  prior := app.idem_begin('add_newborn_obs', p);
  if prior is not null then return prior; end if;
  s := app.require_writer(null, (p ->> 'baby_id')::uuid);
  select * into b from public.babies where id = (p ->> 'baby_id')::uuid;
  if b.outcome <> 'live' or b.deceased_at is not null then
    raise exception 'Observations are recorded for a living baby' using errcode = 'PT409';
  end if;
  insert into public.encounters (id, mother_id, baby_id, kind, at, by_staff, note)
  values (coalesce((p ->> 'encounter_id')::uuid, gen_random_uuid()), b.mother_id, b.id, 'newborn', app.effective_time(p ->> 'at'),
          s.id, nullif(trim(p ->> 'note'), ''))
  returning * into e;
  insert into public.observations (encounter_id, mother_id, baby_id, code, value_num, value_text, unit, at, by_staff)
  select e.id, b.mother_id, b.id, x.code, x.value_num, nullif(trim(x.value_text), ''), x.unit, e.at, s.id
  from jsonb_to_recordset(coalesce(p -> 'observations', '[]'::jsonb)) as x(code text, value_num numeric, value_text text, unit text);
  update public.tasks set completed_at = e.at, completed_by_encounter_id = e.id
    where baby_id = b.id and kind = 'nb_visit' and completed_at is null and cancelled_at is null
      and due_from <= app.local_date((select hospital_id from public.pregnancies where id = b.pregnancy_id), e.at) + 2
      and id = (select k.id from public.tasks k where k.baby_id = b.id and k.kind = 'nb_visit' and k.completed_at is null
                and k.cancelled_at is null order by k.due_by limit 1);
  return app.idem_finish(p, jsonb_build_object('encounter_id', e.id));
end $$;

-- Given (here or reported from a card) or not given with a reason. Giving Td-1 schedules Td-2 four weeks later.
create function public.record_vaccine(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  z public.immunizations;
  act text := p ->> 'action';
begin
  perform app.only_keys(p, array['idempotency_key','id','version','action','given_on','batch','expiry_on','manufacturer','site','route',
                                 'location','primary_source','reason','encounter_id']);
  prior := app.idem_begin('record_vaccine', p);
  if prior is not null then return prior; end if;
  select * into z from public.immunizations where id = (p ->> 'id')::uuid for update;
  if z.id is null then perform app.not_visible(); end if;
  s := app.require_writer(z.pregnancy_id, z.baby_id);
  perform app.check_version(z.version, p);
  if z.status <> 'due' then
    raise exception 'This dose is already %', z.status using errcode = 'PT409';
  end if;
  if act = 'given' then
    if (p ->> 'given_on')::date > current_date + 1 and not app.is_demo() then
      raise exception 'A dose cannot be given in the future' using errcode = 'PT422';
    end if;
    update public.immunizations set status = 'given', given_on = (p ->> 'given_on')::date,
           primary_source = coalesce((p ->> 'primary_source')::boolean, true), batch = nullif(trim(p ->> 'batch'), ''),
           expiry_on = (p ->> 'expiry_on')::date, manufacturer = p ->> 'manufacturer', site = p ->> 'site',
           route = coalesce(p ->> 'route', (select v.route from public.vaccine_catalogue v where v.code = z.code)),
           location = p ->> 'location', given_by = case when coalesce((p ->> 'primary_source')::boolean, true) then s.id end,
           given_in_encounter_id = (p ->> 'encounter_id')::uuid
      where id = z.id;
    if z.code = 'td1' then
      insert into public.immunizations (mother_id, pregnancy_id, code, due_on)
      select z.mother_id, z.pregnancy_id, 'td2', (p ->> 'given_on')::date + 28
      where not exists (select 1 from public.immunizations x where x.pregnancy_id = z.pregnancy_id and x.code = 'td2'
                        and x.status <> 'entered_in_error');
    end if;
  elsif act = 'not_given' then
    update public.immunizations set status = 'not_given', not_given_reason = app.require_reason(p ->> 'reason', 'A dose not given')
      where id = z.id;
  else
    raise exception 'Unknown action %', act using errcode = 'PT422';
  end if;
  select * into z from public.immunizations where id = z.id;
  return app.idem_finish(p, jsonb_build_object('id', z.id, 'status', z.status, 'version', z.version));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Discharge
-- ════════════════════════════════════════════════════════════════════════════════

create function public.set_discharge_item(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  d public.discharges;
  n int;
begin
  perform app.only_keys(p, array['idempotency_key','discharge_id','key','state','reason']);
  prior := app.idem_begin('set_discharge_item', p);
  if prior is not null then return prior; end if;
  select * into d from public.discharges where id = (p ->> 'discharge_id')::uuid;
  if d.id is null then perform app.not_visible(); end if;
  s := app.require_writer(d.pregnancy_id, d.baby_id);
  if p ->> 'state' in ('na','deferred') then perform app.require_reason(p ->> 'reason', 'N/A or deferred'); end if;
  update public.discharge_items set state = p ->> 'state', reason = nullif(trim(p ->> 'reason'), ''), updated_by = s.id, updated_at = now()
    where discharge_id = d.id and key = p ->> 'key';
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Unknown checklist item %', p ->> 'key' using errcode = 'PT422';
  end if;
  return app.idem_finish(p, jsonb_build_object('key', p ->> 'key', 'state', p ->> 'state'));
end $$;

-- Gating (PRD F-21) is enforced by the database; completing the mother's discharge ends her admission. The
-- follow-up plan (postnatal / newborn visits, tag-template follow-ups) arrives planned and is checked here.
create function public.complete_discharge(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  d public.discharges;
  t timestamptz;
  n int;
  hosp uuid;
begin
  perform app.only_keys(p, array['idempotency_key','discharge_id','version','follow_up_tasks','at']);
  prior := app.idem_begin('complete_discharge', p);
  if prior is not null then return prior; end if;
  select * into d from public.discharges where id = (p ->> 'discharge_id')::uuid for update;
  if d.id is null then perform app.not_visible(); end if;
  s := app.require_writer(d.pregnancy_id, d.baby_id);
  perform app.check_version(d.version, p);
  if d.completed_at is not null then
    raise exception 'This discharge is complete' using errcode = 'PT409';
  end if;
  t := app.effective_time(p ->> 'at');
  select g.hospital_id into hosp from public.pregnancies g
    where g.id = coalesce(d.pregnancy_id, (select b.pregnancy_id from public.babies b where b.id = d.baby_id));
  begin
    update public.discharges set completed_at = t, completed_by = s.id where id = d.id;
  exception when check_violation then
    raise exception 'Every checklist item must be done, N/A or deferred with a reason' using errcode = 'PT409';
  end;
  if d.admission_id is not null then
    update public.admissions set discharged_at = t, discharged_by = s.id where id = d.admission_id and discharged_at is null;
  end if;
  n := app.add_followups(d.mother_id, d.pregnancy_id, d.baby_id, coalesce(p -> 'follow_up_tasks', '[]'::jsonb), app.local_date(hosp, t));
  perform app.audit_event('complete_discharge', 'discharges', d.id::text, d.mother_id, jsonb_build_object('follow_ups', n));
  return app.idem_finish(p, jsonb_build_object('discharge_id', d.id, 'follow_ups', n));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Ending an episode; a baby's death
-- ════════════════════════════════════════════════════════════════════════════════

-- Ends an ongoing pregnancy early (miscarriage, ectopic, transfer …) or closes a delivered episode once
-- postnatal care is done (reason 'delivered'). Open visits, due tests and doses are closed with the reason;
-- closing ends the care assignments (trigger). A maternal death also marks the mother so no reminder is sent.
create function public.end_pregnancy(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  g public.pregnancies;
  reason text := p ->> 'reason';
  t timestamptz;
  v_note text;
begin
  perform app.only_keys(p, array['idempotency_key','pregnancy_id','version','reason','ended_on','note']);
  prior := app.idem_begin('end_pregnancy', p);
  if prior is not null then return prior; end if;
  s := app.require_writer((p ->> 'pregnancy_id')::uuid, null);
  select * into g from public.pregnancies where id = (p ->> 'pregnancy_id')::uuid for update;
  perform app.check_version(g.version, p);
  if g.status = 'closed' then
    raise exception 'This episode is already closed' using errcode = 'PT409';
  end if;
  if (reason = 'delivered') <> (g.status = 'delivered') then
    raise exception 'A delivered episode closes with reason "delivered"; an ongoing pregnancy ends with its outcome'
      using errcode = 'PT422';
  end if;
  if exists (select 1 from public.admissions a where a.pregnancy_id = g.id and a.discharged_at is null) then
    raise exception 'End the admission first' using errcode = 'PT409';
  end if;
  t := now();
  v_note := 'Pregnancy ended (' || reason || ')';
  update public.pregnancies set status = 'closed', end_reason = reason,
         ended_on = case when reason = 'delivered' then ended_on else coalesce((p ->> 'ended_on')::date, app.local_date(g.hospital_id, t)) end
    where id = g.id;
  update public.tasks set cancelled_at = t, override_reason = v_note
    where pregnancy_id = g.id and completed_at is null and cancelled_at is null;
  update public.investigations set status = 'not_applicable', not_done_reason = v_note
    where pregnancy_id = g.id and status in ('due','ordered','collected');
  update public.immunizations set status = 'not_given', not_given_reason = v_note where pregnancy_id = g.id and status = 'due';
  update public.medications set status = 'stopped', stopped_reason = v_note
    where pregnancy_id = g.id and status = 'active' and kind = 'prescription';
  if reason = 'maternal_death' then
    update public.mothers set deceased_at = coalesce((p ->> 'ended_on')::date::timestamptz, t) where id = g.mother_id;
  end if;
  perform app.audit_event('end_pregnancy', 'pregnancies', g.id::text, g.mother_id,
                          jsonb_build_object('reason', reason, 'note', p ->> 'note'));
  return app.idem_finish(p, jsonb_build_object('pregnancy_id', g.id, 'status', 'closed', 'end_reason', reason));
end $$;

create function public.record_baby_death(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  b public.babies;
  t timestamptz;
begin
  perform app.only_keys(p, array['idempotency_key','baby_id','version','at','note']);
  prior := app.idem_begin('record_baby_death', p);
  if prior is not null then return prior; end if;
  s := app.require_writer(null, (p ->> 'baby_id')::uuid);
  select * into b from public.babies where id = (p ->> 'baby_id')::uuid for update;
  perform app.check_version(b.version, p);
  if b.outcome <> 'live' or b.deceased_at is not null then
    raise exception 'Already recorded' using errcode = 'PT409';
  end if;
  t := app.effective_time(p ->> 'at');
  update public.babies set deceased_at = t where id = b.id;
  update public.tasks set cancelled_at = t, override_reason = 'Baby died' where baby_id = b.id and completed_at is null and cancelled_at is null;
  update public.immunizations set status = 'not_given', not_given_reason = 'Baby died' where baby_id = b.id and status = 'due';
  update public.investigations set status = 'not_applicable', not_done_reason = 'Baby died'
    where baby_id = b.id and status in ('due','ordered','collected');
  update public.care_assignments set to_at = t where baby_id = b.id and to_at is null;
  perform app.audit_event('baby_death', 'babies', b.id::text, b.mother_id, jsonb_build_object('note', p ->> 'note'));
  return app.idem_finish(p, jsonb_build_object('baby_id', b.id, 'recorded', true));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Prescriptions (only clinician-entered prescriptions drive reminders; the app never suggests a medicine)
-- ════════════════════════════════════════════════════════════════════════════════

create function public.prescribe(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  v_preg uuid := (p ->> 'pregnancy_id')::uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  m public.medications;
begin
  perform app.only_keys(p, array['idempotency_key','id','pregnancy_id','baby_id','name','dose','route','slots','instructions','start_on','end_on']);
  prior := app.idem_begin('prescribe', p);
  if prior is not null then return prior; end if;
  s := app.require_writer(v_preg, v_baby);
  if nullif(trim(p ->> 'name'), '') is null or coalesce(cardinality(app.text_array(p -> 'slots', 'slots')), 0) = 0 then
    raise exception 'A prescription needs the medicine and at least one time of day' using errcode = 'PT422';
  end if;
  insert into public.medications (id, mother_id, pregnancy_id, baby_id, kind, name, dose, route, slots, instructions, start_on, end_on, prescribed_by)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()),
          coalesce((select mother_id from public.pregnancies where id = v_preg), (select mother_id from public.babies where id = v_baby)),
          v_preg, v_baby, 'prescription', trim(p ->> 'name'), p ->> 'dose', p ->> 'route', app.text_array(p -> 'slots', 'slots'),
          nullif(trim(p ->> 'instructions'), ''), coalesce((p ->> 'start_on')::date, current_date), (p ->> 'end_on')::date, s.id)
  returning * into m;
  return app.idem_finish(p, jsonb_build_object('medication_id', m.id));
end $$;

create function public.stop_medication(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  m public.medications;
begin
  perform app.only_keys(p, array['idempotency_key','id','version','reason']);
  prior := app.idem_begin('stop_medication', p);
  if prior is not null then return prior; end if;
  select * into m from public.medications where id = (p ->> 'id')::uuid for update;
  if m.id is null then perform app.not_visible(); end if;
  s := app.require_writer(m.pregnancy_id, m.baby_id);
  perform app.check_version(m.version, p);
  if m.status <> 'active' or m.kind <> 'prescription' then
    raise exception 'This is not an active prescription' using errcode = 'PT409';
  end if;
  update public.medications set status = 'stopped', stopped_reason = app.require_reason(p ->> 'reason', 'Stopping a medicine')
    where id = m.id;
  return app.idem_finish(p, jsonb_build_object('medication_id', m.id, 'status', 'stopped'));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════

insert into app.api_functions values
  ('public','admit'), ('public','end_admission'), ('public','record_delivery'), ('public','add_newborn_obs'),
  ('public','record_vaccine'), ('public','set_discharge_item'), ('public','complete_discharge'), ('public','end_pregnancy'),
  ('public','record_baby_death'), ('public','prescribe'), ('public','stop_medication');

do $$ begin perform app.apply_api_grants(); end $$;
