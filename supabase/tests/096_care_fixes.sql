-- Care Team fixes (20261005001000, 20261005001001): intensity after delivery, tags as deltas, what a visit keeps,
-- referral appointments need a place, a department reads only its own referrals, audit entries name their record.
-- Called as real users. Rolled back; synthetic data only.
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

\set t_neph '00000000-0000-4000-8001-000000000008'
\set ref_card '00000000-0000-4000-800e-000000000001'
\set ref_neph '00000000-0000-4000-800e-0000000009e1'
\set inv_hb '00000000-0000-4000-8008-0000000009e1'

set local role authenticated;

-- ════════════════════════════════════════════════════════════════════════════════
-- 1. Intensity: ANC visits are planned only for an ongoing pregnancy
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.set_intensity(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_meena',
  'intensity', 'close', 'new_tasks', jsonb_build_array(jsonb_build_object('kind', 'anc_visit', 'title', 'ANC visit · 40 weeks',
  'due_from', current_date + 1, 'due_by', current_date + 3)))),
  'C001 a delivered pregnancy gets no new ANC visits (the family would see them)', '%ongoing pregnancy%', 'PT409');
select pg_temp.ok((public.set_intensity(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_meena', 'intensity', 'close'))
                   ->> 'created')::int = 0, 'C002 after delivery the intensity alone is recorded');
reset role;
select pg_temp.ok((select intensity = 'close' from public.pregnancies where id = :'p_meena')
  and not exists (select 1 from public.tasks where pregnancy_id = :'p_meena' and kind = 'anc_visit'),
  'C003 …and no ANC visit exists for the delivered pregnancy');
set local role authenticated;
select pg_temp.as_user(:'priya');
select pg_temp.ok((public.set_intensity(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'intensity', 'enhanced',
  'new_tasks', jsonb_build_array(jsonb_build_object('kind', 'anc_visit', 'title', 'ANC visit · 35 weeks', 'due_from', current_date + 8,
  'due_by', current_date + 10)))) ->> 'created')::int = 1, 'C004 an ongoing pregnancy is still re-planned');
select pg_temp.as_user(:'neha');
select pg_temp.ok((public.set_intensity(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_kavya', 'intensity', 'close',
  'new_tasks', jsonb_build_array(jsonb_build_object('kind', 'anc_visit', 'title', 'ANC visit · 32 weeks', 'due_from', current_date + 10,
  'due_by', current_date + 12)))) ->> 'created')::int = 1, 'C005 an admitted pregnancy is ongoing: it is re-planned');

-- ════════════════════════════════════════════════════════════════════════════════
-- 2. Tags as deltas: another clinician's change is never undone
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
select pg_temp.ok((public.set_tags(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'add', '["gdm"]'::jsonb))
                   -> 'added') = '["gdm"]', 'C006 a tag is added');
select pg_temp.as_user(:'meera');
select public.set_tags(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'add', '["anaemia"]'::jsonb,
  'note', 'Documented at OPD'));
-- Priya's screen was opened before Meera's change: she adds one tag; Meera's stays
select pg_temp.as_user(:'priya');
select public.set_tags(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'add', '["heart"]'::jsonb));
select pg_temp.ok((select array_agg(code order by code) from public.tags where pregnancy_id = :'p_lakshmi' and removed_at is null)
                  = '{anaemia,gdm,heart}', 'C007 a tag another clinician set meanwhile is kept (no lost update)');
call pg_temp.fails(format('select public.set_tags(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'remove', '["gdm"]'::jsonb, 'removal_reason', '  ')), 'C008 removing a tag still needs a reason', '%needs a reason%', 'PT422');
select pg_temp.ok((public.set_tags(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'remove', '["gdm"]'::jsonb,
  'removal_reason', 'Entered in error')) -> 'removed') = '["gdm"]', 'C009 a tag removed with its reason');
select pg_temp.as_user(:'meera');
select pg_temp.ok((public.set_tags(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'remove', '["gdm"]'::jsonb,
  'removal_reason', 'Duplicate')) -> 'removed') = '[]', 'C010 removing a tag someone already removed changes nothing');
select pg_temp.ok((public.set_tags(jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi', 'add', '["anaemia"]'::jsonb))
                   -> 'added') = '[]', 'C011 adding an active tag again keeps one tag');
reset role;
select pg_temp.ok((select removed_reason from public.tags where pregnancy_id = :'p_lakshmi' and code = 'gdm') = 'Entered in error'
  and (select count(*) from public.tags where pregnancy_id = :'p_lakshmi' and code = 'anaemia') = 1,
  'C012 the first removal''s reason is kept; no duplicate tag');
select pg_temp.ok(exists (select 1 from public.audit_log where action = 'set_tags' and entity_id = :'p_lakshmi'
                          and meta -> 'removed' = '["gdm"]'), 'C013 each change is audited with what it added and removed');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.set_tags(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'codes', '["heart"]'::jsonb)), 'C014 the old full list is refused (it removed other people''s tags)', '%unexpected field%', 'PT422');
call pg_temp.fails(format('select public.set_tags(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'add', '["heart"]'::jsonb, 'remove', '["heart"]'::jsonb, 'removal_reason', 'x')), 'C015 a tag cannot be added and removed at once', '%in one change%', 'PT422');
call pg_temp.fails(format('select public.set_tags(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi')),
  'C016 an empty change is refused', '%add or remove%', 'PT422');
call pg_temp.fails(format('select public.set_tags(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'add', 'heart')), 'C017 a wrongly typed list is refused', '%must be a list%', 'PT422');
select pg_temp.as_user(:'arjun');
call pg_temp.fails(format('select public.set_tags(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_asha',
  'add', '["heart"]'::jsonb)), 'C018 a paediatrician does not tag a pregnancy', '%role%', 'PT403');
select pg_temp.as_user(:'neha');
call pg_temp.fails(format('select public.set_tags(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'add', '["heart"]'::jsonb)), 'C019 another unit''s obstetrician gets "not found"', 'Not found', 'PT404');

-- ════════════════════════════════════════════════════════════════════════════════
-- 3. A visit keeps its counselling topics and the fetal movements reported
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
select public.record_visit(jsonb_build_object('idempotency_key', pg_temp.k(), 'encounter_id', '00000000-0000-4000-8005-0000000009e1',
  'pregnancy_id', :'p_lakshmi', 'ga_days', 231, 'counselling', '["nutrition","warning_signs"]'::jsonb,
  'observations', jsonb_build_array(jsonb_build_object('code', 'weight', 'value_num', 61),
                                    jsonb_build_object('code', 'fetal_movements', 'value_text', 'Reduced'))));
reset role;
select pg_temp.ok((select counselling = '{nutrition,warning_signs}' from public.encounters where id = '00000000-0000-4000-8005-0000000009e1')
  and (select value_text = 'Reduced' from public.observations where encounter_id = '00000000-0000-4000-8005-0000000009e1' and code = 'fetal_movements'),
  'C020 counselling codes and fetal movements (as reported) are stored with the visit');
set local role authenticated;
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.record_visit(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'encounter_id', pg_temp.k(), 'ga_days', 231, 'counselling', '["Nutrition"]'::jsonb)), 'C021 counselling topics are codes, not labels', '%unknown%');
call pg_temp.fails(format('select public.record_visit(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'pregnancy_id', :'p_lakshmi',
  'encounter_id', pg_temp.k(), 'ga_days', 231, 'observations', jsonb_build_array(jsonb_build_object('code', 'fetal_movements', 'value_text', 'Absent')))),
  'C022 fetal movements are one of the listed answers', '%must be one of%');

-- ════════════════════════════════════════════════════════════════════════════════
-- 4. Referral moves by side; an appointment needs time and place
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
call pg_temp.fails(format('select public.advance_referral(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'ref_card',
  'to', 'declined', 'note', 'x')), 'C023 the referrer cannot decline her own referral', '%cannot be moved%', 'PT409');
select pg_temp.as_user(:'kiran');
call pg_temp.fails(format('select public.advance_referral(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'ref_card',
  'to', 'cancelled', 'note', 'x')), 'C024 the department cannot cancel the referral', '%cannot be moved%', 'PT409');
call pg_temp.fails(format('select public.advance_referral(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'ref_card',
  'to', 'declined')), 'C025 declining needs a reason', '%needs a reason%', 'PT422');
select public.advance_referral(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'ref_card', 'to', 'accepted'));
call pg_temp.fails(format('select public.advance_referral(%L::jsonb)', jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'ref_card',
  'to', 'scheduled', 'scheduled_at', now() + interval '3 days', 'place', '  ')), 'C026 an appointment needs its place', '%needs the place%', 'PT422');
select public.advance_referral(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'ref_card', 'to', 'scheduled',
  'scheduled_at', now() + interval '3 days', 'place', 'Cardiology OPD, room 4'));
reset role;
select pg_temp.ok((select place = 'Cardiology OPD, room 4' and appointment_at is not null from public.tasks
                   where referral_id = :'ref_card' and cancelled_at is null), 'C027 the family''s appointment has the time and place typed');
set local role authenticated;
select pg_temp.as_user(:'priya');
select public.advance_referral(jsonb_build_object('idempotency_key', pg_temp.k(), 'id', :'ref_card', 'to', 'cancelled',
  'note', 'Seen at the district hospital'));
reset role;
select pg_temp.ok((select status = 'cancelled' from public.referrals where id = :'ref_card')
  and not exists (select 1 from public.tasks where referral_id = :'ref_card' and cancelled_at is null),
  'C028 the referrer cancels: the referral stays "cancelled" and its appointment goes');

-- ════════════════════════════════════════════════════════════════════════════════
-- 5. A department reads only the referrals addressed to it
-- ════════════════════════════════════════════════════════════════════════════════
-- Lakshmi also has a Nephrology referral (nobody in this cast is in Nephrology), with a booked appointment and a
-- (non-sensitive) result shared with it.
select set_config('request.jwt.claims', '', true);
insert into public.investigations (id, mother_id, pregnancy_id, code, label, due_from, due_by) values
  (:'inv_hb', :'m_lakshmi', :'p_lakshmi', 'hb3', 'Repeat Hb (3rd trimester)', current_date - 7, current_date + 21);
insert into public.referrals (id, mother_id, pregnancy_id, to_team_id, urgency, reason, question, status, scheduled_at, place, created_by, created_at)
values (:'ref_neph', :'m_lakshmi', :'p_lakshmi', :'t_neph', 'routine', 'Documented proteinuria (lab)', 'Kidney review?', 'scheduled',
        now() + interval '5 days', 'Nephrology OPD', :'s_priya', now() - interval '3 days');
insert into public.referral_events (referral_id, mother_id, status, at, by_staff) values
  (:'ref_neph', :'m_lakshmi', 'requested', now() - interval '3 days', :'s_priya'),
  (:'ref_neph', :'m_lakshmi', 'accepted', now() - interval '2 days', :'s_priya'),
  (:'ref_neph', :'m_lakshmi', 'scheduled', now() - interval '1 day', :'s_priya');
insert into public.tasks (mother_id, pregnancy_id, kind, title, referral_id, place, due_from, due_by, appointment_at, generated_by)
values (:'m_lakshmi', :'p_lakshmi', 'referral_appt', 'Nephrology appointment', :'ref_neph', 'Nephrology OPD',
        current_date + 5, current_date + 5, now() + interval '5 days', 'clinician');
insert into public.referral_shared_results (referral_id, investigation_id, mother_id, shared_by)
values (:'ref_neph', :'inv_hb', :'m_lakshmi', :'s_priya');

set local role authenticated;
select pg_temp.as_user(:'kiran');
select pg_temp.ok((select count(*) from public.pregnancies where id = :'p_lakshmi') = 1
  and (select count(*) from public.referrals where pregnancy_id = :'p_lakshmi') = 1
  and (select count(*) from public.referrals where id = :'ref_card') = 1,
  'C029 Cardiology sees the referred pregnancy and its own referral, not Nephrology''s');
select pg_temp.ok((select count(*) from public.referral_events where referral_id = :'ref_neph') = 0
  and (select count(*) from public.referral_events where referral_id = :'ref_card') > 0,
  'C030 …nor Nephrology''s referral timeline');
select pg_temp.ok((select count(*) from public.referral_shared_results where referral_id = :'ref_neph') = 0,
  'C031 …nor the results shared with Nephrology');
select pg_temp.ok((select count(*) from public.tasks where referral_id = :'ref_neph') = 0
  and (select count(*) from public.tasks where pregnancy_id = :'p_lakshmi' and kind = 'anc_visit') > 0,
  'C032 …nor Nephrology''s appointment, while the pregnancy''s visits stay visible');
select pg_temp.ok((select count(*) from public.referrals) = 2, 'C033 Cardiology still sees exactly its two referrals (open + ended 10 days ago)');

select pg_temp.as_user(:'priya');
select pg_temp.ok((select count(*) from public.referrals where pregnancy_id = :'p_lakshmi') = 2
  and (select count(*) from public.tasks where referral_id = :'ref_neph') = 1
  and (select count(*) from public.referral_shared_results where referral_id = :'ref_neph') = 1,
  'C034 the obstetric team sees all of her referrals, appointments and shared results');
select pg_temp.as_user(:'arjun');
select pg_temp.ok((select count(*) from public.referrals where pregnancy_id = :'p_asha') = 1,
  'C035 the paediatric team (treating, from 34 weeks) sees the pregnancy''s referrals');
select pg_temp.as_user(:'other');
select pg_temp.ok((select count(*) from public.referrals) + (select count(*) from public.tasks) = 0,
  'C036 another hospital still sees no referral or task');

-- ════════════════════════════════════════════════════════════════════════════════
-- 6. "Who viewed this record": entries name the record they are about
-- ════════════════════════════════════════════════════════════════════════════════
select pg_temp.as_user(:'priya');
select public.log_access(jsonb_build_object('pregnancy_id', :'p_lakshmi'));
select pg_temp.ok((select count(*) from public.audit_log where action = 'view_record' and entity_type = 'pregnancies'
                   and entity_id = :'p_lakshmi' and mother_id = :'m_lakshmi') = 1,
  'C037 the treating team reads the view entry with the record''s id and mother');
select pg_temp.as_user(:'kiran');
select public.log_access(jsonb_build_object('pregnancy_id', :'p_lakshmi'));
select pg_temp.ok((select count(*) from public.audit_log where mother_id = :'m_lakshmi' and action = 'view_record') = 1
  and (select count(*) from public.audit_log where mother_id = :'m_lakshmi' and actor is distinct from :'kiran'::uuid) = 0,
  'C038 a specialist reads only her own entries of that record');

reset role;
set constraints all immediate;
select pg_temp.ok(true, 'C039 every commit-time invariant holds');

select format('  096_care_fixes: all %s checks passed', n) from t_count \gset
\echo :format
rollback;
