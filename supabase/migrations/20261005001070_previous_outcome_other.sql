-- Previous pregnancies: "Other" outcome (as documented, with a note). The outcome list lives in the table's check and
-- in the functions that validate a previous pregnancy (registration, register edit, record correction); each function
-- holding the list is redefined with 'other' added, so they never drift from the table.

alter table public.previous_pregnancies drop constraint previous_pregnancies_outcome_check;
alter table public.previous_pregnancies add constraint previous_pregnancies_outcome_check check (outcome in
  ('live_birth','stillbirth','miscarriage','induced_abortion','ectopic','molar','neonatal_death','other'));

do $$
declare
  old_list constant text := $l$('live_birth','stillbirth','miscarriage','induced_abortion','ectopic','molar','neonatal_death')$l$;
  new_list constant text := $l$('live_birth','stillbirth','miscarriage','induced_abortion','ectopic','molar','neonatal_death','other')$l$;
  f record;
  n int := 0;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace s on s.oid = p.pronamespace
    where s.nspname in ('public', 'app') and p.prokind = 'f' and position(old_list in p.prosrc) > 0
  loop
    execute replace(pg_get_functiondef(f.oid), old_list, new_list);
    n := n + 1;
  end loop;
  if n = 0 then
    raise exception 'previous_outcome_other: no function holds the outcome list';
  end if;
end $$;

do $$ begin perform app.apply_api_grants(); end $$;
