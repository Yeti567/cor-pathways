-- RLS on worker certifications.
--
-- A worker renews their OWN ticket from their phone, and can do nothing at all to
-- a colleague's. Before migration 20260814000000 every policy on this table was
-- tenant-wide, so any authenticated member could rewrite or delete a coworker's
-- compliance record straight over PostgREST. This test is what stops that coming
-- back, because the app-side check is not the thing under test here: the point is
-- that the database refuses even when the app is bypassed entirely.
--
-- Run with: supabase test db supabase/tests/certification-self-service-rls.sql

begin;

set search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

-- The signup trigger builds its own tenant per auth user and would collide with
-- the fixtures below. Scoped to this transaction.
set local session_replication_role = replica;

select plan(9);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('96000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cert-worker-a@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('96000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cert-worker-b@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('96000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cert-admin@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.tenants (id, name, slug)
values ('97000000-0000-0000-0000-000000000001', 'Cert Tenant', 'cert-tenant');

insert into public.users (id, tenant_id, email, full_name, power_level, reach_type, app_access)
values
  ('96000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', 'cert-worker-a@example.test', 'Cert Worker A', 'worker', 'all_locations', 'app_access'),
  ('96000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', 'cert-worker-b@example.test', 'Cert Worker B', 'worker', 'all_locations', 'app_access'),
  ('96000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001', 'cert-admin@example.test', 'Cert Admin', 'admin', 'all_locations', 'admin_access');

insert into public.worker_profiles (id, tenant_id, user_id)
values
  ('98000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001'),
  ('98000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002');

insert into public.certifications (id, tenant_id, worker_profile_id, name, expires_on)
values
  ('99000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', 'A ticket', '2027-01-01'),
  ('99000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000002', 'B ticket', '2027-01-01');

-- A blocked write arrives in one of two shapes and both count as refused. A USING
-- violation quietly affects zero rows; a WITH CHECK violation raises. Moving a
-- ticket onto a colleague is the second kind: it passes USING, because the row is
-- mine at the moment I ask, and fails WITH CHECK, because it would not be after.
create or replace function pg_temp.rows_changed(statement text)
returns integer
language plpgsql
as $$
declare
  affected integer;
begin
  execute statement;
  get diagnostics affected = row_count;
  return affected;
exception
  when insufficient_privilege then return 0;
  when check_violation then return 0;
end;
$$;

set local role authenticated;

-- === The worker whose ticket it is ==========================================
select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000001', true);

select is(
  pg_temp.rows_changed($$update public.certifications set attachment_path = 'own.jpg', expires_on = '2028-01-01' where id = '99000000-0000-0000-0000-000000000001'$$),
  1,
  'A worker renews their own ticket'
);

select is(
  pg_temp.rows_changed($$insert into public.certifications (tenant_id, worker_profile_id, name) values ('97000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', 'A new ticket')$$),
  1,
  'A worker files a new ticket on their own profile'
);

-- === The same worker, reaching for a colleague ==============================
select is(
  pg_temp.rows_changed($$update public.certifications set attachment_path = 'stolen.jpg' where id = '99000000-0000-0000-0000-000000000002'$$),
  0,
  'A worker cannot rewrite a colleague''s ticket'
);

select is(
  pg_temp.rows_changed($$update public.certifications set worker_profile_id = '98000000-0000-0000-0000-000000000002' where id = '99000000-0000-0000-0000-000000000001'$$),
  0,
  'A worker cannot move their own ticket onto a colleague'
);

select is(
  pg_temp.rows_changed($$insert into public.certifications (tenant_id, worker_profile_id, name) values ('97000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000002', 'Planted')$$),
  0,
  'A worker cannot file a ticket onto a colleague'
);

select is(
  pg_temp.rows_changed($$delete from public.certifications where id = '99000000-0000-0000-0000-000000000001'$$),
  0,
  'A worker cannot delete a compliance record, not even their own'
);

-- === The administrator ======================================================
-- Nothing above may cost an admin the ability to run the ticket library.
select set_config('request.jwt.claim.sub', '96000000-0000-0000-0000-000000000003', true);

select is(
  pg_temp.rows_changed($$update public.certifications set attachment_path = 'admin.jpg' where id = '99000000-0000-0000-0000-000000000002'$$),
  1,
  'An admin still manages any worker''s ticket'
);

select is(
  pg_temp.rows_changed($$insert into public.certifications (tenant_id, worker_profile_id, name) values ('97000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000002', 'Loaded by the office')$$),
  1,
  'An admin still bulk loads a ticket onto any worker'
);

select is(
  pg_temp.rows_changed($$delete from public.certifications where id = '99000000-0000-0000-0000-000000000002'$$),
  1,
  'An admin still deletes a ticket'
);

select * from finish();
rollback;
