-- Admission → delivery → newborn → vaccines → discharge → episode end; pregnancy loss, baby death, prescriptions,
-- notifications. Called as real users. Rolled back; synthetic data only.
begin;

create temp table t_count (n int not null);
insert into t_count values (0);
grant all on t_count to authenticated;

create function pg_temp.ok(cond boolean, what text) returns void language plpgsql as $$
begin
  update t_count set n = n + 1;
  if not coalesce(cond, false) then raise exception 'FAIL: %', what; end if;
end $$;

create procedure pg_temp.fails(stmt text, what text, msg_like text default '%', code text default null) language plpgsql as $$
begin
  update t_count set n = n + 1;
  begin
    execute stmt;
  exception when others then
    if sqlerrm not like msg_like or (code is not null and sqlstate <> code) then
      raise exception 'FAIL: % (wrong error: % [%])', what, sqlerrm, sqlstate;
    end if;
    return;
  end;
  raise exception 'FAIL: % (statement succeeded)', what;
end $$;

create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true)
$$;
create function pg_temp.k() returns text language sql volatile as $$ select gen_random_uuid()::text $$;

\ir _fixtures.psql
insert into public.immunizations (id, mother_id, pregnancy_id, code, due_on) values
  ('00000000-0000-4000-8018-0000000000a1', :'m_sunita', :'p_sunita', 'td1', current_date);
insert into public.investigations (mother_id, pregnancy_id, code, label, due_from, due_by) values
  (:'m_sunita', :'p_sunita', 'ogtt', 'OGTT 75 g', current_date, current_date + 20);

select jsonb_build_object('idempotency_key', '00000000-0000-4000-a000-0000000006d1', 'pregnancy_id', :'p_lakshmi',
  'delivery', jsonb_build_object('id', '00000000-0000-4000-800d-0000000006d1', 'mode', 'lscs_emergency', 'indication', 'Twin, malpresentation',
                                 'labour_onset', 'spontaneous', 'blood_loss_ml', 650, 'complications', '["pph"]'::jsonb, 'medicines', '["oxytocin"]'::jsonb),
  'babies', jsonb_build_array(
     jsonb_build_object('id', '00000000-0000-4000-800c-0000000006d1', 'sex', 'F', 'birth_weight_g', 2350, 'apgar1', 7, 'apgar5', 9,
                        'outcome', 'live', 'vitamin_k', true, 'breastfed_within_1h', true, 'birth_doses_given', true),
     jsonb_build_object('id', '00000000-0000-4000-800c-0000000006d2', 'sex', 'M', 'birth_weight_g', 1900, 'outcome', 'stillbirth',
                        'stillbirth_type', 'fresh')))::text as dlv \gset

set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Admission
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.admit(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi')),
  'L001 a paediatrician cannot admit a mother', '%role%', 'PT403');
select pg_temp.as_user(:'priya');
select public.admit(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'reason', 'Labour'))::text as adm \gset
select pg_temp.ok((:'adm'::jsonb ->> 'ip_no') ~ '^IP-[0-9]{4}-000001$', 'L002 admission issues the IP number');
call pg_temp.fails(format('select public.admit(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi')),
  'L003 she cannot be admitted twice', '%already admitted%', 'PT409');
select pg_temp.as_user(:'arjun');
select pg_temp.ok((select count(*) from public.pregnancies where id = :'p_lakshmi') = 1, 'L004 the labour room opens her to the paediatrician');

-- ════════════════════════════════════════════════════════════════════════════════
-- Delivery
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.record_delivery(%L::jsonb)', jsonb_set(jsonb_set(:'dlv'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k())),
  '{delivery,complications}', '["PPH"]')), 'L005 complications are codes', '%unknown delivery_complication%');
call pg_temp.fails(format('select public.record_delivery(%L::jsonb)', jsonb_set(jsonb_set(:'dlv'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k())),
  '{delivery,cause}', '"x"')), 'L006 unknown delivery fields are refused', '%unexpected field(s) in delivery%', 'PT422');
call pg_temp.fails(format('select public.record_delivery(%L::jsonb)', jsonb_set(jsonb_set(:'dlv'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k())),
  '{babies}', '[]')), 'L007 a delivery records its babies', '%between one and four%', 'PT422');
select public.record_delivery(:'dlv'::jsonb)::text as dlv_out \gset
select pg_temp.ok(jsonb_array_length(:'dlv_out'::jsonb -> 'babies') = 2
  and (:'dlv_out'::jsonb -> 'babies' -> 1 ->> 'child_id') like 'MCH-2026-000101-B2', 'L008 twins get linked child ids (…-B1, …-B2)');
select pg_temp.ok(public.record_delivery(:'dlv'::jsonb) = :'dlv_out'::jsonb, 'L009 a retry records the delivery once');
reset role;
select pg_temp.ok((select status = 'delivered' and end_reason = 'delivered' and ended_on is not null from public.pregnancies where id = :'p_lakshmi')
  and (select plurality from public.deliveries where pregnancy_id = :'p_lakshmi') = 2
  and (select admission_id is not null from public.deliveries where pregnancy_id = :'p_lakshmi')
  and not exists (select 1 from public.tasks where pregnancy_id = :'p_lakshmi' and kind = 'anc_visit' and completed_at is null and cancelled_at is null),
  'L010 delivered: pregnancy closed to ANC, plurality 2, linked to the admission');
select pg_temp.ok((select count(*) from public.immunizations where baby_id = '00000000-0000-4000-800c-0000000006d1') = 23
  and (select count(*) from public.immunizations where baby_id = '00000000-0000-4000-800c-0000000006d1' and status = 'given') = 3
  and (select count(*) from public.immunizations where baby_id = '00000000-0000-4000-800c-0000000006d2') = 0,
  'L011 the liveborn twin gets the UIP schedule (birth doses given); the stillborn twin gets none');
select pg_temp.ok((select count(*) from public.care_assignments where baby_id = '00000000-0000-4000-800c-0000000006d1') = 1
  and (select count(*) from public.care_assignments where baby_id = '00000000-0000-4000-800c-0000000006d2') = 0
  and (select count(*) from public.discharges where mother_id = :'m_lakshmi') = 2,
  'L012 the liveborn twin has a paediatric team and a checklist; the mother has hers');
select pg_temp.ok((select ga_at_birth_days from public.babies where id = '00000000-0000-4000-800c-0000000006d1') = 280 - 49,
  'L013 GA at birth is computed by the server from the EDD');
select pg_temp.ok(exists (select 1 from public.notifications where user_id = :'arjun' and kind = 'baby_born')
  and exists (select 1 from public.notifications where user_id = :'lakshmi_u' and kind = 'baby_arrived')
  and not exists (select 1 from public.notifications where user_id = :'ravi'),
  'L014 the paediatric team and the consented mother are told; a caregiver without consent is not');
select pg_temp.ok(not exists (select 1 from public.notifications where params <> '{}'), 'L015 notifications carry no names or clinical detail');
set constraints all immediate;
select pg_temp.ok(true, 'L016 every commit-time invariant holds after the delivery');
set constraints all deferred;
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.record_delivery(%L::jsonb)', jsonb_set(:'dlv'::jsonb, '{idempotency_key}', to_jsonb(pg_temp.k()))),
  'L017 a delivered pregnancy cannot deliver again', '%ongoing pregnancy%', 'PT409');

-- ════════════════════════════════════════════════════════════════════════════════
-- Newborn and vaccines
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails(format('select public.add_newborn_obs(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'baby_id', '00000000-0000-4000-800c-0000000006d1', 'observations', '[]'::jsonb)), 'L018 newborn observations are the paediatric team''s', '%role%', 'PT403');
select pg_temp.as_user(:'arjun');
select public.add_newborn_obs(jsonb_build_object('idempotency_key', pg_temp.k(), 'baby_id', '00000000-0000-4000-800c-0000000006d1',
  'observations', jsonb_build_array(jsonb_build_object('code', 'nb_weight', 'value_num', 2300), jsonb_build_object('code', 'nb_feeding', 'value_text', 'Breastfeeding'))));
call pg_temp.fails(format('select public.add_newborn_obs(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(),
  'baby_id', '00000000-0000-4000-800c-0000000006d2', 'observations', '[]'::jsonb)), 'L019 no observations for a stillborn baby', '%living baby%', 'PT409');
select (select id from public.immunizations where baby_id = '00000000-0000-4000-800c-0000000006d1' and code = 'penta1') as penta \gset
call pg_temp.fails(format('select public.record_vaccine(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'penta', 'action', 'not_given')),
  'L020 a dose not given needs a reason', '%needs a reason%', 'PT422');
select public.record_vaccine(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'penta', 'action', 'given', 'given_on', current_date,
  'batch', 'PV-2291', 'expiry_on', current_date + 200, 'site', 'Left thigh'));
select pg_temp.ok((select status = 'given' and route = 'IM' and batch = 'PV-2291' and given_by = :'s_arjun' from public.immunizations where id = :'penta'),
  'L021 a dose given records batch, expiry, site, route (from the catalogue) and who gave it');
call pg_temp.fails(format('select public.record_vaccine(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'penta', 'action', 'given',
  'given_on', current_date)), 'L022 a dose is recorded once', '%already given%', 'PT409');
select pg_temp.as_user(:'neha');
select public.record_vaccine(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8018-0000000000a1', 'action', 'given',
  'given_on', current_date - 2, 'primary_source', false, 'location', 'Sub-centre (from MCP card)'));
reset role;
select pg_temp.ok((select due_on from public.immunizations where pregnancy_id = :'p_sunita' and code = 'td2') = current_date + 26
  and (select given_by is null and primary_source = false from public.immunizations where id = '00000000-0000-4000-8018-0000000000a1'),
  'L023 Td-1 reported from a card schedules Td-2 four weeks later');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Discharge
-- ════════════════════════════════════════════════════════════════════════════════
select (select id from public.discharges where baby_id = '00000000-0000-4000-800c-0000000006d1') as dis_b,
       (select id from public.discharges where pregnancy_id = :'p_lakshmi') as dis_m \gset
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.set_discharge_item(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_b',
  'key', 'hugs', 'state', 'done')), 'L024 only the checklist''s own items', '%Unknown checklist item%', 'PT422');
call pg_temp.fails(format('select public.complete_discharge(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_b')),
  'L025 a discharge cannot complete with open items', '%Every checklist item%', 'PT409');
call pg_temp.fails(format('select public.set_discharge_item(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_b',
  'key', 'jaundice', 'state', 'deferred')), 'L026 deferring needs a reason', '%needs a reason%', 'PT422');
select public.set_discharge_item(jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_b', 'key', k,
  'state', case when k = 'jaundice' then 'deferred' else 'done' end, 'reason', case when k = 'jaundice' then 'Review at day 3 visit' end))
from unnest(array['feeding','weight','birth_doses','jaundice','nb_visit','education']) k;
call pg_temp.fails(format('select public.complete_discharge(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_b',
  'follow_up_tasks', jsonb_build_array(jsonb_build_object('kind', 'pn_visit', 'title', 'Postnatal', 'due_by', current_date + 7)))),
  'L027 a baby''s follow-ups are newborn visits', '%follow-up visits are not possible%', 'PT422');
select public.complete_discharge(jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_b',
  'follow_up_tasks', jsonb_build_array(jsonb_build_object('kind', 'nb_visit', 'title', 'Newborn check · day 7', 'due_from', current_date + 6, 'due_by', current_date + 7),
                                       jsonb_build_object('kind', 'template', 'template_key', 'tpl_wt1', 'title', 'Weight visit · week 1', 'due_from', current_date + 7, 'due_by', current_date + 9))));
select pg_temp.ok((select count(*) from public.tasks where baby_id = '00000000-0000-4000-800c-0000000006d1') = 2,
  'L028 the baby''s follow-up plan is in place');
select pg_temp.as_user(:'priya');
select public.set_discharge_item(jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_m', 'key', k, 'state', 'done'))
from unnest(array['vitals','meds','warning','pn_visit','fp','bf']) k;
select public.complete_discharge(jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_m',
  'follow_up_tasks', jsonb_build_array(jsonb_build_object('kind', 'pn_visit', 'title', 'Postnatal check · day 7', 'due_from', current_date + 6, 'due_by', current_date + 7),
                                       jsonb_build_object('kind', 'template', 'template_key', 'tpl_bp', 'title', 'BP check visit · day 3–5', 'due_from', current_date + 3, 'due_by', current_date + 5))));
reset role;
select pg_temp.ok((select discharged_at is not null from public.admissions where pregnancy_id = :'p_lakshmi'),
  'L029 completing the mother''s discharge ends her admission');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.set_discharge_item(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_m',
  'key', 'fp', 'state', 'na', 'reason', 'x')), 'L030 a completed checklist is frozen', '%discharge is complete%');

-- ════════════════════════════════════════════════════════════════════════════════
-- Prescriptions
-- ════════════════════════════════════════════════════════════════════════════════
call pg_temp.fails(format('select public.prescribe(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'name', 'IFA', 'slots', '[]'::jsonb)), 'L031 a prescription needs a time of day', '%at least one time of day%', 'PT422');
select public.prescribe(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8010-0000000006d1', 'pregnancy_id', :'p_lakshmi',
  'name', 'IFA', 'dose', '1 tablet', 'slots', '["afternoon"]'::jsonb, 'instructions', 'After lunch'));
call pg_temp.fails(format('select public.stop_medication(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8010-0000000006d1')),
  'L032 stopping a medicine needs a reason', '%needs a reason%', 'PT422');
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok((public.family_medicines() -> 0 ->> 'name') = 'IFA', 'L033 a new prescription appears in her medicines');
select pg_temp.as_user(:'priya');
select public.stop_medication(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8010-0000000006d1', 'reason', 'Course completed'));
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok(jsonb_array_length(public.family_medicines()) = 0, 'L034 a stopped medicine leaves her reminders');

-- ════════════════════════════════════════════════════════════════════════════════
-- Closing episodes, loss
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.end_pregnancy(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_sunita',
  'reason', 'delivered')), 'L035 an ongoing pregnancy ends with its actual outcome', '%ends with its outcome%', 'PT422');
select public.end_pregnancy(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_sunita', 'reason', 'miscarriage', 'note', 'Documented at 12 weeks'));
reset role;
select pg_temp.ok(not exists (select 1 from public.tasks where pregnancy_id = :'p_sunita' and completed_at is null and cancelled_at is null)
  and not exists (select 1 from public.investigations where pregnancy_id = :'p_sunita' and status in ('due','ordered','collected'))
  and not exists (select 1 from public.immunizations where pregnancy_id = :'p_sunita' and status = 'due')
  and not exists (select 1 from public.care_assignments where pregnancy_id = :'p_sunita' and to_at is null),
  'L036 a loss closes open visits, tests and doses with the reason, and ends the care assignments');
set local role authenticated;
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.end_pregnancy(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_kavya',
  'reason', 'transferred_out')), 'L037 an admitted mother''s episode ends after the admission', '%End the admission first%', 'PT409');
select pg_temp.as_user(:'priya');
select public.end_pregnancy(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'reason', 'delivered'));
select pg_temp.ok((select count(*) from public.pregnancies where id = :'p_lakshmi') = 0,
  'L038 closing a delivered episode ends the obstetric team''s working access');
select pg_temp.as_user(:'arjun');
select pg_temp.ok((select count(*) from public.babies where id = '00000000-0000-4000-800c-0000000006d1') = 1,
  'L039 …while the baby''s paediatric team keeps caring for the baby');
select public.record_baby_death(jsonb_build_object('idempotency_key', pg_temp.k(), 'baby_id', '00000000-0000-4000-800c-0000000006d1', 'note', 'Documented'));
reset role;
select pg_temp.ok(not exists (select 1 from public.tasks where baby_id = '00000000-0000-4000-800c-0000000006d1' and completed_at is null and cancelled_at is null)
  and not exists (select 1 from public.immunizations where baby_id = '00000000-0000-4000-800c-0000000006d1' and status = 'due'),
  'L040 after a baby''s death no visits or doses remain open');
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
select pg_temp.ok(jsonb_array_length(public.family_schedule() -> 'vaccines') = 0
  and not exists (select 1 from jsonb_array_elements(public.family_schedule() -> 'visits') v where v ->> 'baby_id' is not null),
  'L041 the family sees no baby reminders after the loss');

-- ════════════════════════════════════════════════════════════════════════════════
-- Notifications from referrals and call-backs
-- ════════════════════════════════════════════════════════════════════════════════
reset role;
delete from public.notifications;
set local role authenticated;
select pg_temp.as_user(:'lakshmi_u');
call pg_temp.fails(format('select public.request_callback(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'signs', '["heavy_bleeding"]'::jsonb)),
  'L042 with no treating team left, she is told to call the hospital — never a request nobody sees', '%call the hospital%', 'PT409');
reset role;
set local role authenticated;
select pg_temp.as_user(:'neha');
select public.create_referral(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-800e-0000000006d1', 'pregnancy_id', :'p_asha',
  'to_team_id', :'t_cardio', 'urgency', 'routine', 'reason', 'Documented murmur', 'question', 'Review?'));
select pg_temp.as_user(:'kiran');
select public.advance_referral(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-800e-0000000006d1', 'to', 'accepted'));
reset role;
select pg_temp.ok(exists (select 1 from public.notifications where user_id = :'kiran' and kind = 'referral_requested')
  and exists (select 1 from public.notifications n join public.staff s on s.user_id = n.user_id
              where s.id = :'s_neha' and n.kind = 'referral_accepted'),
  'L043 a new referral reaches the department; its progress reaches the referrer');
select pg_temp.ok(not exists (select 1 from public.notifications where user_id = :'kiran' and kind = 'referral_accepted'),
  'L044 nobody is notified of their own action');

select format('  060_rpc_delivery: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
