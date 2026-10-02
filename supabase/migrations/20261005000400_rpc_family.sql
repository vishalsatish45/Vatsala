-- Family RPCs and read functions.
--
-- Families never read clinical tables directly. Each Family screen calls one read function that returns exactly
-- the fields it shows, after applying consent and the caregiver's scopes:
--   family_context   who I am acting as, her hospital, pregnancy, babies, (mother only) emergency-card facts
--   family_schedule  visits and appointments, vaccines, test windows — no staff notes or override reasons
--   family_tests     every non-sensitive test's status; values only to the mother and only after clinician review
--   family_readings  hospital readings (mother only) and home readings
--   family_baby      a baby's birth details, vaccines, weights, home logs
--   family_medicines active prescriptions and the doses logged
--   family_callbacks call-back requests and whether the hospital called back
--   family_caregivers (mother only) who she shares with, and what
-- Sensitive tests (HIV, syphilis, HBsAg) never appear. Stillborn / deceased babies get no schedule items.
--
-- Writes follow the Care Team rules: payload allowlist, idempotency key, version check, PT4xx codes.

-- ════════════════════════════════════════════════════════════════════════════════
-- Who is calling, for which mother
-- ════════════════════════════════════════════════════════════════════════════════

-- The mother's own active app consent (or verbal consent recorded by a clinician, for caregiver sharing).
create function app.consent_active(p_mother uuid, p_user uuid, p_purpose text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.consents k
                 where k.mother_id = p_mother and k.decision = 'accepted' and k.withdrawn_at is null
                   and p_purpose = any(k.purposes)
                   and (k.user_id = p_user or (p_user is null and k.user_id is null and k.recorded_by is not null)))
$$;

-- Resolves the mother the caller acts for: herself, or (with p_mother) a mother she is an active caregiver of.
-- Returns {mother_id, role, caregiver_id, label, scopes{schedule,baby,logs,tests}}. With p_require_consent,
-- the mother needs her own app consent; a caregiver needs her own consent plus the mother's caregiver-sharing
-- consent (given in the app or recorded verbally by a clinician). Anything else is "not found".
create function app.family_actor(p_mother uuid, p_require_consent boolean default true) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  m public.mothers;
  c public.caregivers;
begin
  select * into m from public.mothers where user_id = me;
  if m.id is not null and (p_mother is null or p_mother = m.id) then
    if p_require_consent and not app.consent_active(m.id, me, 'app') then perform app.not_visible(); end if;
    return jsonb_build_object('mother_id', m.id, 'role', 'mother', 'label', 'mother',
      'scopes', jsonb_build_object('schedule', true, 'baby', true, 'logs', true, 'tests', true));
  end if;
  select * into c from public.caregivers where user_id = me and mother_id = p_mother and revoked_at is null;
  if c.id is null then perform app.not_visible(); end if;
  if p_require_consent and (not app.consent_active(c.mother_id, me, 'app')
       or not (app.consent_active(c.mother_id, (select x.user_id from public.mothers x where x.id = c.mother_id), 'caregiver_sharing')
               or app.consent_active(c.mother_id, null, 'caregiver_sharing'))) then
    perform app.not_visible();
  end if;
  return jsonb_build_object('mother_id', c.mother_id, 'role', 'caregiver', 'caregiver_id', c.id,
    'label', 'caregiver: ' || c.name || ' (' || c.relation || ')',
    'scopes', jsonb_build_object('schedule', c.scope_schedule, 'baby', c.scope_baby, 'logs', c.scope_logs, 'tests', c.scope_tests));
end $$;

create function app.require_scope(actor jsonb, p_scope text) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if not coalesce((actor -> 'scopes' ->> p_scope)::boolean, false) then
    raise exception 'Not found' using errcode = 'PT404';
  end if;
end $$;

create function app.require_mother(actor jsonb) returns void
language plpgsql immutable set search_path = '' as $$
begin
  if actor ->> 'role' <> 'mother' then
    raise exception 'Only the mother can do this' using errcode = 'PT403';
  end if;
end $$;

-- The mother's current (or most recent) pregnancy.
create function app.current_pregnancy(p_mother uuid) returns public.pregnancies
language sql stable security definer set search_path = '' as $$
  select g.* from public.pregnancies g where g.mother_id = p_mother
  order by (g.status = 'active') desc, g.registered_on desc limit 1
$$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Consent, card, caregivers
-- ════════════════════════════════════════════════════════════════════════════════

-- Records the notice the user accepted (or declined) and the purposes; replaces her previous consent for this
-- mother. Reminder channels are the reminders_* purposes. Works before consent exists (onboarding).
create function public.record_consent(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  purposes text[];
  k public.consents;
begin
  perform app.only_keys(p, array['idempotency_key','mother_id','notice_version','lang','purposes','decision']);
  prior := app.idem_begin('record_consent', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor((p ->> 'mother_id')::uuid, false);
  purposes := coalesce(app.text_array(p -> 'purposes', 'purposes'), '{}');
  if actor ->> 'role' = 'caregiver' and 'caregiver_sharing' = any(purposes) then
    raise exception 'Only the mother decides about sharing with caregivers' using errcode = 'PT403';
  end if;
  if p ->> 'notice_version' is distinct from (select value #>> '{}' from public.app_settings where key = 'consent_notice_version') then
    raise exception 'Please read the current notice' using errcode = 'PT409';
  end if;
  update public.consents set withdrawn_at = now(), withdrawn_reason = 'Replaced by a newer consent'
    where mother_id = (actor ->> 'mother_id')::uuid and user_id = (select auth.uid()) and decision = 'accepted' and withdrawn_at is null;
  insert into public.consents (user_id, mother_id, notice_version, lang, purposes, decision)
  values ((select auth.uid()), (actor ->> 'mother_id')::uuid, p ->> 'notice_version', p ->> 'lang',
          case when p ->> 'decision' = 'accepted' then purposes else '{}' end, p ->> 'decision')
  returning * into k;
  return app.idem_finish(p, jsonb_build_object('consent_id', k.id, 'decision', k.decision, 'purposes', to_jsonb(k.purposes)));
end $$;

-- Withdrawing consent stops app access (hers, and her caregivers' if she is the mother); the record is kept.
create function public.withdraw_consent(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  n int;
begin
  perform app.only_keys(p, array['idempotency_key','mother_id','reason']);
  prior := app.idem_begin('withdraw_consent', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor((p ->> 'mother_id')::uuid, false);
  update public.consents set withdrawn_at = now(), withdrawn_reason = coalesce(nullif(trim(p ->> 'reason'), ''), 'Withdrawn in the app')
    where mother_id = (actor ->> 'mother_id')::uuid and user_id = (select auth.uid()) and decision = 'accepted' and withdrawn_at is null;
  get diagnostics n = row_count;
  return app.idem_finish(p, jsonb_build_object('withdrawn', n));
end $$;

create function public.set_card_fields(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  m public.mothers;
begin
  perform app.only_keys(p, array['idempotency_key','version','fields']);
  prior := app.idem_begin('set_card_fields', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor(null);
  perform app.require_mother(actor);
  select * into m from public.mothers where id = (actor ->> 'mother_id')::uuid for update;
  perform app.check_version(m.version, p);
  update public.mothers set card_fields = coalesce(app.text_array(p -> 'fields', 'fields'), '{}') where id = m.id;
  return app.idem_finish(p, jsonb_build_object('fields', p -> 'fields'));
end $$;

create function public.add_caregiver(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  sc jsonb;
  m public.mothers;
  c public.caregivers;
begin
  perform app.only_keys(p, array['idempotency_key','id','phone','name','relation','scopes']);
  sc := app.only_keys(coalesce(p -> 'scopes', '{}'), array['schedule','baby','logs','tests'], 'scopes');
  prior := app.idem_begin('add_caregiver', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor(null);
  perform app.require_mother(actor);
  select * into m from public.mothers where id = (actor ->> 'mother_id')::uuid;
  if p ->> 'phone' = m.phone then
    raise exception 'That is your own number — a shared phone needs no separate caregiver' using errcode = 'PT422';
  end if;
  if nullif(trim(p ->> 'name'), '') is null or nullif(trim(p ->> 'relation'), '') is null then
    raise exception 'Give the caregiver''s name and relation' using errcode = 'PT422';
  end if;
  begin
    insert into public.caregivers (id, mother_id, phone, name, relation, scope_schedule, scope_baby, scope_logs, scope_tests, added_by)
    values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), m.id, p ->> 'phone', trim(p ->> 'name'), trim(p ->> 'relation'),
            coalesce((sc ->> 'schedule')::boolean, true), coalesce((sc ->> 'baby')::boolean, true),
            coalesce((sc ->> 'logs')::boolean, false), coalesce((sc ->> 'tests')::boolean, false), (select auth.uid()))
    returning * into c;
  exception when unique_violation then
    raise exception 'This person is already your caregiver' using errcode = 'PT409';
  end;
  return app.idem_finish(p, jsonb_build_object('caregiver_id', c.id));
end $$;

create function public.update_caregiver(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  sc jsonb;
  c public.caregivers;
begin
  perform app.only_keys(p, array['idempotency_key','id','version','scopes']);
  sc := app.only_keys(coalesce(p -> 'scopes', '{}'), array['schedule','baby','logs','tests'], 'scopes');
  prior := app.idem_begin('update_caregiver', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor(null);
  perform app.require_mother(actor);
  select * into c from public.caregivers where id = (p ->> 'id')::uuid and mother_id = (actor ->> 'mother_id')::uuid
    and revoked_at is null for update;
  if c.id is null then perform app.not_visible(); end if;
  perform app.check_version(c.version, p);
  update public.caregivers set scope_schedule = coalesce((sc ->> 'schedule')::boolean, scope_schedule),
         scope_baby = coalesce((sc ->> 'baby')::boolean, scope_baby), scope_logs = coalesce((sc ->> 'logs')::boolean, scope_logs),
         scope_tests = coalesce((sc ->> 'tests')::boolean, scope_tests)
    where id = c.id returning * into c;
  return app.idem_finish(p, jsonb_build_object('caregiver_id', c.id, 'version', c.version));
end $$;

-- Instant; the caregiver's next call sees nothing (every read re-checks the caregiver row).
create function public.revoke_caregiver(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  n int;
begin
  perform app.only_keys(p, array['idempotency_key','id']);
  prior := app.idem_begin('revoke_caregiver', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor(null);
  perform app.require_mother(actor);
  update public.caregivers set revoked_at = now(), revoked_by = (select auth.uid())
    where id = (p ->> 'id')::uuid and mother_id = (actor ->> 'mother_id')::uuid and revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then perform app.not_visible(); end if;
  return app.idem_finish(p, jsonb_build_object('revoked', true));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Family inputs
-- ════════════════════════════════════════════════════════════════════════════════

-- "Ask the hospital to call me". Ticked signs are stored as codes and never evaluated (PRD F-42).
-- The voice note is uploaded first to the path the app was given: voice-notes/<mother_id>/<callback id>.m4a
create function public.request_callback(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  v_id uuid;
  mid uuid;
begin
  perform app.only_keys(p, array['idempotency_key','id','mother_id','signs','note','voice_seconds','at']);
  prior := app.idem_begin('request_callback', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  mid := (actor ->> 'mother_id')::uuid;
  v_id := coalesce((p ->> 'id')::uuid, gen_random_uuid());
  insert into public.callbacks (id, mother_id, requested_by, requested_by_label, channel, signs, note, voice_path, voice_seconds, at)
  values (v_id, mid, (select auth.uid()), actor ->> 'label', 'app', coalesce(app.text_array(p -> 'signs', 'signs'), '{}'),
          nullif(trim(p ->> 'note'), ''),
          case when p ? 'voice_seconds' then 'voice-notes/' || mid || '/' || v_id || '.m4a' end,
          (p ->> 'voice_seconds')::int, app.effective_time(p ->> 'at'));
  return app.idem_finish(p, jsonb_build_object('callback_id', v_id,
    'voice_path', case when p ? 'voice_seconds' then 'voice-notes/' || mid || '/' || v_id || '.m4a' end));
end $$;

-- Home readings: stored as entered, shown as "home reading", never evaluated.
create function public.submit_self_log(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  mid uuid;
  v_baby uuid := (p ->> 'baby_id')::uuid;
  l public.self_logs;
begin
  perform app.only_keys(p, array['idempotency_key','id','mother_id','baby_id','kind','value','at']);
  prior := app.idem_begin('submit_self_log', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  mid := (actor ->> 'mother_id')::uuid;
  perform app.require_scope(actor, case when v_baby is null then 'logs' else 'baby' end);
  if v_baby is not null and not exists (select 1 from public.babies b where b.id = v_baby and b.mother_id = mid
                                        and b.outcome = 'live' and b.deceased_at is null) then
    perform app.not_visible();
  end if;
  insert into public.self_logs (id, mother_id, baby_id, kind, value, at, by_user, by_label)
  values (coalesce((p ->> 'id')::uuid, gen_random_uuid()), mid, v_baby, p ->> 'kind', trim(p ->> 'value'),
          app.effective_time(p ->> 'at'), (select auth.uid()), actor ->> 'label')
  returning * into l;
  return app.idem_finish(p, jsonb_build_object('self_log_id', l.id));
end $$;

-- The person who logged a reading (or the mother) can withdraw it.
create function public.retract_self_log(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  l public.self_logs;
begin
  perform app.only_keys(p, array['idempotency_key','id','mother_id','reason']);
  prior := app.idem_begin('retract_self_log', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  select * into l from public.self_logs where id = (p ->> 'id')::uuid and mother_id = (actor ->> 'mother_id')::uuid;
  if l.id is null or not (actor ->> 'role' = 'mother' or l.by_user = (select auth.uid())) then perform app.not_visible(); end if;
  if l.status = 'entered_in_error' then
    raise exception 'Already withdrawn' using errcode = 'PT409';
  end if;
  update public.self_logs set status = 'entered_in_error', eie_reason = app.require_reason(p ->> 'reason', 'Withdrawing a reading'),
         eie_at = now() where id = l.id;
  return app.idem_finish(p, jsonb_build_object('self_log_id', l.id, 'status', 'entered_in_error'));
end $$;

-- Taken / skipped for a prescribed medicine; logging the same slot again replaces the answer.
create function public.log_dose(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  actor jsonb;
  med public.medications;
begin
  perform app.only_keys(p, array['idempotency_key','medication_id','mother_id','date','slot','status','at']);
  prior := app.idem_begin('log_dose', p);
  if prior is not null then return prior; end if;
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  perform app.require_scope(actor, 'logs');
  select * into med from public.medications where id = (p ->> 'medication_id')::uuid and mother_id = (actor ->> 'mother_id')::uuid;
  if med.id is null then perform app.not_visible(); end if;
  if not ((p ->> 'slot') = any(med.slots)) then
    raise exception 'This medicine is not prescribed for the % slot', p ->> 'slot' using errcode = 'PT422';
  end if;
  insert into public.med_doses (medication_id, mother_id, date, slot, status, at, by_user)
  values (med.id, med.mother_id, (p ->> 'date')::date, p ->> 'slot', p ->> 'status', app.effective_time(p ->> 'at'), (select auth.uid()))
  on conflict (medication_id, date, slot) do update set status = excluded.status, at = excluded.at, by_user = excluded.by_user;
  return app.idem_finish(p, jsonb_build_object('medication_id', med.id, 'date', p ->> 'date', 'slot', p ->> 'slot', 'status', p ->> 'status'));
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Notifications (both faces)
-- ════════════════════════════════════════════════════════════════════════════════

create function public.register_push_token(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform app.only_keys(p, array['token','platform']);
  if (select auth.uid()) is null then perform app.not_visible(); end if;
  insert into public.push_tokens (token, user_id, platform) values (p ->> 'token', (select auth.uid()), p ->> 'platform')
  on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
  return jsonb_build_object('registered', true);
end $$;

create function public.mark_notifications_read(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  perform app.only_keys(p, array['ids','all']);
  update public.notifications set read_at = now()
    where user_id = (select auth.uid()) and read_at is null
      and (coalesce((p ->> 'all')::boolean, false)
           or id = any(array(select x::uuid from jsonb_array_elements_text(coalesce(p -> 'ids', '[]'::jsonb)) x)));
  get diagnostics n = row_count;
  return jsonb_build_object('marked', n);
end $$;

-- ════════════════════════════════════════════════════════════════════════════════
-- Read functions (one per Family screen)
-- ════════════════════════════════════════════════════════════════════════════════

create function public.family_context(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
  mid uuid;
  m public.mothers;
  g public.pregnancies;
  is_mother boolean;
begin
  perform app.only_keys(p, array['mother_id']);
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  mid := (actor ->> 'mother_id')::uuid;
  is_mother := actor ->> 'role' = 'mother';
  select * into m from public.mothers where id = mid;
  g := app.current_pregnancy(mid);
  return jsonb_build_object(
    'role', actor ->> 'role',
    'scopes', actor -> 'scopes',
    'mother', jsonb_build_object('id', m.id, 'name', m.name, 'lang', m.lang,
                                 'card_fields', case when is_mother then to_jsonb(m.card_fields) end),
    'hospital', (select jsonb_build_object('name', h.name, 'phone_opd', h.phone_opd, 'phone_labour', h.phone_labour,
                                           'address', h.address, 'maps_url', h.maps_url)
                 from public.hospitals h where h.id = g.hospital_id),
    'pregnancy', case when g.id is not null then jsonb_build_object('id', g.id, 'edd', g.edd, 'status', g.status,
                   'ended_on', g.ended_on, 'end_reason', case when g.end_reason in ('delivered') then g.end_reason end,
                   'closer_follow_up', g.intensity <> 'routine') end,
    'babies', case when (actor -> 'scopes' ->> 'baby')::boolean then coalesce((select jsonb_agg(jsonb_build_object(
                'id', b.id, 'name', b.name, 'dob', b.dob, 'sex', b.sex, 'live', b.outcome = 'live' and b.deceased_at is null)
                order by b.dob, b.birth_order) from public.babies b where b.mother_id = mid and b.pregnancy_id = g.id), '[]'::jsonb) end,
    -- emergency card facts, mother only, never sensitive (PRD F-45)
    'card', case when is_mother then jsonb_build_object(
              'blood_group', (select coalesce(
                  (select r.value_text from public.investigation_results r join public.investigations i on i.id = r.investigation_id
                   where i.mother_id = mid and i.code = 'bg' and r.status <> 'entered_in_error' and i.status = 'reviewed'
                   order by r.reported_at desc limit 1),
                  (select o.value_text from public.observations o where o.mother_id = mid and o.code = 'blood_group'
                   and o.status <> 'entered_in_error' order by o.at desc limit 1))),
              'allergies', coalesce((select jsonb_agg(a.substance order by a.substance) from public.allergies a
                                     where a.mother_id = mid and a.status = 'final'), '[]'::jsonb),
              'conditions', coalesce((select jsonb_agg(d.label order by d.label) from public.documented_conditions d
                                      where d.mother_id = mid and d.status = 'final' and d.clinical_status = 'active'), '[]'::jsonb),
              'emergency_contact', m.emergency_contact) end);
end $$;

-- Visits, appointments, vaccines and test windows ahead (and the last 30 days), within the caller's scopes.
create function public.family_schedule(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
  mid uuid;
  sch boolean;
  bab boolean;
begin
  perform app.only_keys(p, array['mother_id']);
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  mid := (actor ->> 'mother_id')::uuid;
  sch := (actor -> 'scopes' ->> 'schedule')::boolean;
  bab := (actor -> 'scopes' ->> 'baby')::boolean;
  return jsonb_build_object(
    'visits', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'kind', k.kind, 'title', k.title, 'baby_id', k.baby_id,
                 'due_from', k.due_from, 'due_by', k.due_by, 'appointment_at', k.appointment_at, 'place', k.place,
                 'done', k.completed_at is not null) order by k.due_by)
               from public.tasks k left join public.babies b on b.id = k.baby_id
               where k.mother_id = mid and k.cancelled_at is null
                 and (k.completed_at is null or k.completed_at > now() - interval '30 days')
                 and ((k.baby_id is null and sch) or (k.baby_id is not null and bab and b.outcome = 'live' and b.deceased_at is null))),
               '[]'::jsonb),
    'vaccines', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'code', z.code, 'label', v.label, 'group', v.grp,
                 'baby_id', z.baby_id, 'due_on', z.due_on, 'status', z.status, 'given_on', z.given_on) order by z.due_on)
               from public.immunizations z join public.vaccine_catalogue v on v.code = z.code
               left join public.babies b on b.id = z.baby_id
               where z.mother_id = mid and z.status <> 'entered_in_error'
                 and ((z.baby_id is null and sch) or (z.baby_id is not null and bab and b.outcome = 'live' and b.deceased_at is null))),
               '[]'::jsonb),
    'tests_due', case when sch then coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'label', i.label,
                 'due_from', i.due_from, 'due_by', i.due_by) order by i.due_by)
               from public.investigations i where i.mother_id = mid and i.baby_id is null and not i.sensitive
                 and i.status in ('due','ordered','collected')), '[]'::jsonb) else '[]'::jsonb end);
end $$;

-- Status of every non-sensitive test; the value only for the mother, and only once a clinician has reviewed it.
create function public.family_tests(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
  mid uuid;
  is_mother boolean;
begin
  perform app.only_keys(p, array['mother_id']);
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  perform app.require_scope(actor, 'tests');
  mid := (actor ->> 'mother_id')::uuid;
  is_mother := actor ->> 'role' = 'mother';
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', i.id, 'label', i.label, 'baby_id', i.baby_id, 'due_from', i.due_from, 'due_by', i.due_by,
      'status', case when i.status in ('due','ordered','collected') then 'due'
                     when i.status in ('resulted','reviewed') then 'done' else 'not_done' end,
      'result', case when is_mother and i.status = 'reviewed' then (
                  select jsonb_build_object('value_num', r.value_num, 'value_text', r.value_text, 'unit', r.unit,
                                            'recorded_on', r.reported_at)
                  from public.investigation_results r where r.investigation_id = i.id and r.status <> 'entered_in_error'
                  order by r.entered_at desc limit 1) end)
    order by i.due_by)
    from public.investigations i
    where i.mother_id = mid and not i.sensitive
      and (i.baby_id is null or (actor -> 'scopes' ->> 'baby')::boolean)), '[]'::jsonb);
end $$;

-- Hospital readings (mother only, "recorded at hospital") and home readings; newest first, bounded.
create function public.family_readings(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
  mid uuid;
  lim int;
begin
  perform app.only_keys(p, array['mother_id','limit']);
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  perform app.require_scope(actor, 'logs');
  mid := (actor ->> 'mother_id')::uuid;
  lim := least(coalesce((p ->> 'limit')::int, 50), 200);
  return jsonb_build_object(
    'hospital', case when actor ->> 'role' = 'mother' then coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
                  select jsonb_build_object('code', o.code, 'value_num', o.value_num, 'value_text', o.value_text, 'unit', o.unit, 'at', o.at) x
                  from public.observations o where o.mother_id = mid and o.baby_id is null and o.status <> 'entered_in_error'
                    and o.code in ('weight','bp_sys','bp_dia','fundal_height','fhr')
                  order by o.at desc limit lim) q), '[]'::jsonb) end,
    'home', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
               select jsonb_build_object('id', l.id, 'kind', l.kind, 'value', l.value, 'at', l.at, 'by', l.by_label) x
               from public.self_logs l where l.mother_id = mid and l.baby_id is null and l.status = 'final'
               order by l.at desc limit lim) q), '[]'::jsonb));
end $$;

create function public.family_baby(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
  b public.babies;
begin
  perform app.only_keys(p, array['mother_id','baby_id']);
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  perform app.require_scope(actor, 'baby');
  select * into b from public.babies where id = (p ->> 'baby_id')::uuid and mother_id = (actor ->> 'mother_id')::uuid;
  if b.id is null then perform app.not_visible(); end if;
  return jsonb_build_object(
    'id', b.id, 'name', b.name, 'child_id', b.child_id, 'dob', b.dob, 'sex', b.sex, 'birth_weight_g', b.birth_weight_g,
    'live', b.outcome = 'live' and b.deceased_at is null,
    'vaccines', case when b.outcome = 'live' and b.deceased_at is null then coalesce((select jsonb_agg(jsonb_build_object(
                  'code', z.code, 'label', v.label, 'group', v.grp, 'due_on', z.due_on, 'status', z.status, 'given_on', z.given_on)
                  order by z.due_on) from public.immunizations z join public.vaccine_catalogue v on v.code = z.code
                  where z.baby_id = b.id and z.status <> 'entered_in_error'), '[]'::jsonb) else '[]'::jsonb end,
    'weights', coalesce((select jsonb_agg(jsonb_build_object('grams', o.value_num, 'at', o.at) order by o.at)
                from public.observations o where o.baby_id = b.id and o.code = 'nb_weight' and o.status <> 'entered_in_error'), '[]'::jsonb),
    'home', coalesce((select jsonb_agg(x order by x ->> 'at' desc) from (
               select jsonb_build_object('id', l.id, 'kind', l.kind, 'value', l.value, 'at', l.at, 'by', l.by_label) x
               from public.self_logs l where l.baby_id = b.id and l.status = 'final' order by l.at desc limit 50) q), '[]'::jsonb));
end $$;

create function public.family_medicines(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
  mid uuid;
begin
  perform app.only_keys(p, array['mother_id']);
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  perform app.require_scope(actor, 'logs');
  mid := (actor ->> 'mother_id')::uuid;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'dose', m.dose, 'slots', to_jsonb(m.slots),
      'instructions', m.instructions, 'start_on', m.start_on, 'end_on', m.end_on,
      'doses', coalesce((select jsonb_agg(jsonb_build_object('date', d.date, 'slot', d.slot, 'status', d.status) order by d.date, d.slot)
                         from public.med_doses d where d.medication_id = m.id and d.date > current_date - 8), '[]'::jsonb))
      order by m.name)
    from public.medications m where m.mother_id = mid and m.kind = 'prescription' and m.status = 'active'), '[]'::jsonb);
end $$;

-- The mother sees all her requests; a caregiver sees the ones she made. Staff notes are never included.
create function public.family_callbacks(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
begin
  perform app.only_keys(p, array['mother_id']);
  actor := app.family_actor((p ->> 'mother_id')::uuid);
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'at', c.at, 'signs', to_jsonb(c.signs), 'has_voice', c.voice_path is not null,
      'called_back', c.closed_at is not null, 'closed_at', c.closed_at, 'by', c.requested_by_label) order by c.at desc)
    from public.callbacks c
    where c.mother_id = (actor ->> 'mother_id')::uuid
      and (actor ->> 'role' = 'mother' or c.requested_by = (select auth.uid()))
      and c.at > now() - interval '90 days'), '[]'::jsonb);
end $$;

create function public.family_caregivers(p jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  actor jsonb;
begin
  perform app.only_keys(p, array[]::text[]);
  actor := app.family_actor(null);
  perform app.require_mother(actor);
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'relation', c.relation, 'phone', c.phone,
      'version', c.version, 'scopes', jsonb_build_object('schedule', c.scope_schedule, 'baby', c.scope_baby, 'logs', c.scope_logs,
      'tests', c.scope_tests), 'added_at', c.added_at, 'has_signed_in', c.user_id is not null) order by c.added_at)
    from public.caregivers c where c.mother_id = (actor ->> 'mother_id')::uuid and c.revoked_at is null), '[]'::jsonb);
end $$;

-- ════════════════════════════════════════════════════════════════════════════════

insert into app.api_functions values
  ('public','record_consent'), ('public','withdraw_consent'), ('public','set_card_fields'), ('public','add_caregiver'),
  ('public','update_caregiver'), ('public','revoke_caregiver'), ('public','request_callback'), ('public','submit_self_log'),
  ('public','retract_self_log'), ('public','log_dose'), ('public','register_push_token'), ('public','mark_notifications_read'),
  ('public','family_context'), ('public','family_schedule'), ('public','family_tests'), ('public','family_readings'),
  ('public','family_baby'), ('public','family_medicines'), ('public','family_callbacks'), ('public','family_caregivers');

do $$ begin perform app.apply_api_grants(); end $$;
