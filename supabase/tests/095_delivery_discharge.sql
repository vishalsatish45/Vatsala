-- Admission → delivery → discharge → newborn fixes (20261005000990): long template windows, times in order, closing
-- a delivered episode, vaccine doses entered in error. Called as real users. Rolled back; synthetic data only.
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

\set baby1 '00000000-0000-4000-800c-0000000009b1'
\set baby2 '00000000-0000-4000-800c-0000000009b2'
insert into public.immunizations (id, mother_id, pregnancy_id, code, due_on) values
  ('00000000-0000-4000-8018-0000000009a1', :'m_sunita', :'p_sunita', 'td1', current_date);

set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Admission times
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'neha');
select (select id from public.admissions where pregnancy_id = :'p_kavya') as adm_kavya \gset
call pg_temp.fails(format('select public.end_admission(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'admission_id', :'adm_kavya',
  'at', now() - interval '4 hours')), 'D001 an admission cannot end before it began (clear message, not a constraint error)', '%before it began%', 'PT422');
select public.end_admission(jsonb_build_object('idempotency_key', pg_temp.k(), 'admission_id', :'adm_kavya', 'at', now() - interval '1 hour'));
reset role;
select pg_temp.ok((select discharged_at = now() - interval '1 hour' from public.admissions where id = :'adm_kavya'),
  'D002 the admission ends at the documented time');
set local role authenticated;

select pg_temp.as_user(:'priya');
select public.admit(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'reason', 'Labour pains (as documented)',
  'at', now() - interval '3 hours'))::text as adm \gset
reset role;
select pg_temp.ok((select admitted_at = now() - interval '3 hours' and reason = 'Labour pains (as documented)' from public.admissions
                   where id = (:'adm'::jsonb ->> 'admission_id')::uuid), 'D003 admission keeps its documented time and reason');
set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- Delivery (twins, one stillborn without a birth weight) and the GDM follow-up
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
select public.record_delivery(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'delivery', jsonb_build_object('mode', 'vaginal', 'at', now() - interval '2 hours', 'place', 'this_facility', 'perineum', 'Labial tear (as documented)',
                                 'attended_by', 'Dr. Priya', 'maternal_condition', 'Stable (as documented)'),
  'babies', jsonb_build_array(
     jsonb_build_object('id', :'baby1', 'sex', 'M', 'outcome', 'stillbirth', 'stillbirth_type', 'macerated'),
     jsonb_build_object('id', :'baby2', 'sex', 'F', 'birth_weight_g', 2600, 'length_cm', 47.5, 'head_circ_cm', 33, 'outcome', 'live',
                        'breastfed_within_1h', true, 'vitamin_k', true, 'birth_doses_given', true))));
reset role;
select pg_temp.ok((select birth_weight_g is null from public.babies where id = :'baby1')
  and (select perineum = 'Labial tear (as documented)' from public.deliveries where pregnancy_id = :'p_lakshmi'),
  'D004 a stillborn baby needs no birth weight; perineum is free text as documented');
set local role authenticated;

select pg_temp.as_user(:'priya');
select (select id from public.discharges where pregnancy_id = :'p_lakshmi') as dis_m \gset
call pg_temp.fails(format('select public.end_pregnancy(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'reason', 'delivered')), 'D005 a delivered episode closes only after the mother''s discharge', '%discharge checklist first%', 'PT409');
call pg_temp.fails(format('select public.set_discharge_item(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_m',
  'key', 'fp', 'state', 'na')), 'D006 N/A without a reason is refused', '%needs a reason%', 'PT422');
select public.set_discharge_item(jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_m', 'key', k,
  'state', case when k = 'fp' then 'na' else 'done' end, 'reason', case when k = 'fp' then 'Other: discussed at day 7 visit' end))
from unnest(array['vitals','meds','warning','pn_visit','fp','bf']) k;
call pg_temp.fails(format('select public.complete_discharge(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_m',
  'at', now() - interval '150 minutes')), 'D007 a discharge cannot be before the delivery', '%before the delivery%', 'PT422');
call pg_temp.fails(format('select public.complete_discharge(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_m',
  'follow_up_tasks', jsonb_build_array(jsonb_build_object('kind', 'template', 'template_key', 'tpl_x', 'title', 'Too wide',
                                                          'due_from', current_date + 1, 'due_by', current_date + 94)))),
  'D008 a follow-up window wider than 92 days is still refused', '%follow-up visits are not possible%', 'PT422');
select public.complete_discharge(jsonb_build_object('idempotency_key', pg_temp.k(), 'discharge_id', :'dis_m', 'at', now() - interval '30 minutes',
  'follow_up_tasks', jsonb_build_array(
     jsonb_build_object('kind', 'pn_visit', 'title', 'Postnatal check · day 3', 'due_from', current_date + 3, 'due_by', current_date + 4),
     jsonb_build_object('kind', 'template', 'template_key', 'tpl_glucose', 'title', 'Glucose test · weeks 6–12',
                        'due_from', current_date + 42, 'due_by', current_date + 84))));
reset role;
select pg_temp.ok((select count(*) from public.tasks where pregnancy_id = :'p_lakshmi' and template_key = 'tpl_glucose' and due_by - due_from = 42) = 1
  and (select completed_at = now() - interval '30 minutes' from public.discharges where id = :'dis_m')
  and (select discharged_at = now() - interval '30 minutes' from public.admissions where id = (:'adm'::jsonb ->> 'admission_id')::uuid),
  'D009 a GDM-tagged mother is discharged at the documented time with the weeks 6–12 glucose follow-up');
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.end_pregnancy(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'reason', 'delivered'));
select pg_temp.ok(true, 'D010 after the discharge the delivered episode closes');

-- ════════════════════════════════════════════════════════════════════════════════
-- Vaccine doses entered in error
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'arjun');
select (select id from public.immunizations where baby_id = :'baby2' and code = 'bcg') as bcg,
       (select id from public.immunizations where baby_id = :'baby2' and code = 'penta1') as penta,
       (select id from public.immunizations where baby_id = :'baby2' and code = 'opv1') as opv1 \gset
call pg_temp.fails(format('select public.mark_entered_in_error(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'immunization',
  'id', :'penta', 'reason', 'Typing error')), 'D011 a dose with nothing recorded cannot be withdrawn', '%Nothing has been recorded%', 'PT409');
call pg_temp.fails(format('select public.mark_entered_in_error(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'immunization',
  'id', :'bcg')), 'D012 withdrawing a dose needs a reason', '%needs a reason%', 'PT422');
call pg_temp.fails(format('select public.mark_entered_in_error(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'care_note',
  'id', :'bcg', 'reason', 'x', 'replacement_id', pg_temp.k())), 'D013 replacement_id is only for a vaccine dose', '%only for a vaccine dose%', 'PT422');
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.mark_entered_in_error(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'immunization',
  'id', :'bcg', 'reason', 'Typing error')), 'D014 a baby''s dose is the paediatric team''s to correct', '%role%', 'PT403');
select pg_temp.as_user(:'arjun');
select public.mark_entered_in_error(jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'immunization', 'id', :'bcg',
  'reason', 'Recorded on the wrong baby', 'replacement_id', '00000000-0000-4000-8018-0000000009c1'))::text as eie \gset
reset role;
select pg_temp.ok((:'eie'::jsonb ->> 'replacement_id') = '00000000-0000-4000-8018-0000000009c1'
  and (select status = 'entered_in_error' and given_on is not null and eie_reason = 'Recorded on the wrong baby' and eie_by = :'s_arjun'
       from public.immunizations where id = :'bcg')
  and (select status = 'due' and code = 'bcg' and given_on is null from public.immunizations where id = '00000000-0000-4000-8018-0000000009c1'),
  'D015 a withdrawn dose keeps what was recorded; the dose is due again under the id the phone chose');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'entered_in_error' and entity_type = 'immunizations' and entity_id = :'bcg'),
  'D016 the correction is audited');
set local role authenticated;
select pg_temp.as_user(:'arjun');
select public.record_vaccine(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8018-0000000009c1', 'action', 'given',
  'given_on', current_date, 'primary_source', false, 'location', 'Reported from MCP card', 'batch', 'B-1', 'manufacturer', 'Demo Labs',
  'site', 'Left upper arm', 'route', 'ID', 'expiry_on', current_date + 100));
call pg_temp.fails(format('select public.mark_entered_in_error(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'immunization',
  'id', :'bcg', 'reason', 'again')), 'D017 a withdrawn dose stays withdrawn', '%Already marked%', 'PT409');
-- early dose (before its due date) as documented, then "not given" withdrawn
select public.record_vaccine(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'opv1', 'action', 'given', 'given_on', current_date));
select public.record_vaccine(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'penta', 'action', 'not_given', 'reason', 'Stock out'));
select public.mark_entered_in_error(jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'immunization', 'id', :'penta', 'reason', 'Wrong dose'));
reset role;
select pg_temp.ok((select status = 'given' and primary_source = false and batch = 'B-1' and route = 'ID' and given_by is null
                   from public.immunizations where id = '00000000-0000-4000-8018-0000000009c1')
  and (select status = 'given' and given_on < due_on from public.immunizations where id = :'opv1')
  and (select count(*) from public.immunizations where baby_id = :'baby2' and code = 'penta1' and status = 'due') = 1,
  'D018 a card-reported dose, an early dose and a withdrawn "not given" are kept as documented');

-- Td-1 withdrawn → the Td-2 planned from it is withdrawn too (until Td-1 is recorded again)
set local role authenticated;
select pg_temp.as_user(:'neha');
select public.record_vaccine(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', '00000000-0000-4000-8018-0000000009a1', 'action', 'given',
  'given_on', current_date));
select public.mark_entered_in_error(jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'immunization',
  'id', '00000000-0000-4000-8018-0000000009a1', 'reason', 'Typing error'));
reset role;
select pg_temp.ok((select count(*) from public.immunizations where pregnancy_id = :'p_sunita' and code = 'td2' and status <> 'entered_in_error') = 0
  and (select count(*) from public.immunizations where pregnancy_id = :'p_sunita' and code = 'td1' and status = 'due') = 1,
  'D019 withdrawing Td-1 withdraws the Td-2 planned from it; Td-1 is due again');

-- ════════════════════════════════════════════════════════════════════════════════
-- A baby's death on the day of birth
-- ════════════════════════════════════════════════════════════════════════════════
set local role authenticated;
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.record_baby_death(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'baby_id', :'baby2',
  'at', now() - interval '3 hours')), 'D020 a death before the time of birth is refused plainly', '%before the time of birth%', 'PT422');
select public.record_baby_death(jsonb_build_object('idempotency_key', pg_temp.k(), 'baby_id', :'baby2', 'at', now() - interval '1 hour'));
reset role;
select pg_temp.ok((select deceased_at = now() - interval '1 hour' from public.babies where id = :'baby2')
  and not exists (select 1 from public.care_assignments where baby_id = :'baby2' and (to_at is null or to_at < from_at)),
  'D021 a death on the day of birth is recorded at its time; the paediatric assignment ends then');
-- the assignment has ended; a correction now needs emergency access (granted directly here)
insert into public.access_overrides (staff_id, mother_id, reason, granted_at, expires_at)
values (:'s_arjun', :'m_lakshmi', 'Correcting the vaccine record', now(), now() + interval '1 hour');
set local role authenticated;
select pg_temp.as_user(:'arjun');
select public.mark_entered_in_error(jsonb_build_object('idempotency_key', pg_temp.k(), 'kind', 'immunization', 'id', :'opv1', 'reason', 'Typing error'));
reset role;
select pg_temp.ok((select status = 'not_given' and not_given_reason = 'Baby died' from public.immunizations
                   where baby_id = :'baby2' and code = 'opv1' and status <> 'entered_in_error'),
  'D022 after a death a withdrawn dose does not come back as a reminder');
set constraints all immediate;
select pg_temp.ok(true, 'D023 every commit-time invariant holds');

select format('  095_delivery_discharge: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
