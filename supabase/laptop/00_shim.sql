-- LAPTOP ONLY — never applied to a Supabase project.
-- Recreates the small part of Supabase that our migrations depend on, so the same migration files run
-- unchanged on a plain Postgres 17: the API roles, auth.users, auth.uid()/role()/jwt(), the default
-- privileges Supabase grants on `public`, and the Realtime publication.
-- Tests impersonate a user the way PostgREST does:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<user uuid>","role":"authenticated"}';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin noinherit; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  phone text unique,               -- Supabase stores phones as digits with country code, no '+': 919000000001
  email text unique,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  )
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Supabase's defaults: the API roles get privileges on everything created in `public`; RLS decides rows.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- Logical replication is off on the laptop (no Realtime server); the publication only has to exist.
set client_min_messages = error;
create publication supabase_realtime;
reset client_min_messages;
