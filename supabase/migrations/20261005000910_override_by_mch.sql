-- Emergency access by MCH id ("break the glass"). A clinician in the labour room usually has the
-- mother's MCH card, not her record id: grant_override now takes EITHER mother_id OR mch_id (exactly one).
--   * mch_id is looked up only among pregnancies of the caller's hospital; an unknown number and a patient she may
--     not open look the same (PT404), so MCH ids cannot be probed.
--   * never on her own record; reason required; 24 hours; audited — as before.
--   * returns {override_id, expires_at, mother_id, pregnancy_id} so the app can open the record at once
--     (pregnancy_id: the named pregnancy, or for mother_id her current pregnancy at this hospital).

create or replace function public.grant_override(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  prior jsonb;
  s public.staff;
  o public.access_overrides;
  v_mother uuid;
  v_preg uuid;
begin
  perform app.only_keys(p, array['idempotency_key','mother_id','mch_id','reason']);
  if (p ->> 'mother_id' is null) = (p ->> 'mch_id' is null) then
    raise exception 'Give either mother_id or mch_id' using errcode = 'PT422';
  end if;
  prior := app.idem_begin('grant_override', p);
  if prior is not null then return prior; end if;

  s := app.require_staff(array['obstetrician','paediatrician']);
  if p ->> 'mch_id' is not null then
    select g.mother_id, g.id into v_mother, v_preg from public.pregnancies g
      where g.mch_id = upper(trim(p ->> 'mch_id')) and g.hospital_id = s.hospital_id;
  else
    v_mother := (p ->> 'mother_id')::uuid;
    select g.id into v_preg from public.pregnancies g
      where g.mother_id = v_mother and g.hospital_id = s.hospital_id
      order by (g.status = 'active') desc, g.registered_on desc limit 1;
  end if;
  if v_preg is null
     or exists (select 1 from public.mothers m where m.id = v_mother and m.user_id = (select auth.uid())) then
    perform app.not_visible();
  end if;
  insert into public.access_overrides (staff_id, mother_id, reason, expires_at)
  values (s.id, v_mother, app.require_reason(p ->> 'reason', 'An emergency override'), now() + interval '24 hours')
  returning * into o;
  perform app.audit_event('override_granted', 'access_overrides', o.id::text, o.mother_id,
                          jsonb_build_object('reason', o.reason, 'by', case when p ? 'mch_id' then 'mch_id' else 'mother_id' end));
  return app.idem_finish(p, jsonb_build_object('override_id', o.id, 'expires_at', o.expires_at,
                                               'mother_id', v_mother, 'pregnancy_id', v_preg));
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
