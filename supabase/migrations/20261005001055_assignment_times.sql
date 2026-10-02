-- Care assignments never start in the future, and ending one never puts its end before its start.
--
-- Registration stores a back-dateable registration DATE; turned into a time it is that day's 00:00 UTC (05:30 IST).
-- Between midnight and 05:30 IST a pregnancy registered "today" therefore got assignments starting a few hours
-- ahead, and closing it (end of care, close episode) failed on care_assignments' "to_at >= from_at" check.
-- from_at is immutable once written, so it is clamped on the way in; the close trigger also never ends an
-- assignment before it began.

create function app.assignment_starts_by_now() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.from_at := least(new.from_at, now());
  return new;
end $$;

-- Runs before care_assignments_rules (triggers fire in name order), so every rule sees the clamped time.
create trigger care_assignments_from_now before insert on public.care_assignments
  for each row execute function app.assignment_starts_by_now();

create or replace function app.end_assignments_on_close() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'closed' and old.status <> 'closed' then
    update public.care_assignments set to_at = greatest(now(), from_at) where pregnancy_id = new.id and to_at is null;
  end if;
  return null;
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
