-- Local development fixtures. Two tenants, a consultant, and a user per power level.
-- Every login below uses the password: Password123!
--
-- The signup trigger on auth.users builds an entire tenant (company, admin user,
-- starter forms) for every new auth user. This seed builds its own fixtures
-- explicitly, so that trigger has to be off during the load. Left on, each seed
-- user silently creates a second throwaway tenant, and the load then fails on a
-- duplicate slug because every fixture id starts with the same 8 hex characters.
--
-- The narrow fix (alter table auth.users disable trigger ...) is not available:
-- auth.users is owned by supabase_auth_admin, and the seed runs as postgres, which
-- is not a superuser and cannot set role to the owner. session_replication_role is
-- the only lever this role has. It also suspends foreign key checks, which is
-- acceptable here only because the seed is insert-only and internally consistent:
-- nothing cascades during the load. Do not copy this into code that deletes.
set session_replication_role = replica;

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values
  ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'consultant@corpathways.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Cor Pathway 360 Consultant"}', now(), now()),
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'superadmin@northwind.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Nora Super"}', now(), now()),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@northwind.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Alex Admin"}', now(), now()),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'manager@northwind.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Maya Manager"}', now(), now()),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'supervisor@northwind.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Sam Supervisor"}', now(), now()),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'worker@northwind.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Will Worker"}', now(), now()),
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'superadmin@blueridge.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Bri Super"}', now(), now()),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'worker@blueridge.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Blake Worker"}', now(), now())
on conflict (id) do nothing;

-- GoTrue reads these token columns into plain Go strings, so a NULL is not "no token",
-- it is a scan failure. Leaving them NULL makes every login return
-- "Database error querying schema" (a 500 that the app surfaces as "Invalid email or
-- password", which sends you hunting for the wrong bug entirely). The columns are
-- nullable in the table and the insert above does not name them, so set them to the
-- empty string that GoTrue expects. Without this, no seeded account can log in to a
-- freshly reset database.
update auth.users
set
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  reauthentication_token = coalesce(reauthentication_token, '')
where
  confirmation_token is null
  or recovery_token is null
  or email_change is null
  or email_change_token_new is null
  or email_change_token_current is null
  or phone_change is null
  or phone_change_token is null
  or reauthentication_token is null;

insert into public.tenants (id, name, slug, document_control_enabled)
values
  ('10000000-0000-0000-0000-000000000001', 'Northwind Civil', 'northwind-civil', true),
  ('10000000-0000-0000-0000-000000000002', 'Blue Ridge Fabrication', 'blue-ridge-fabrication', false)
on conflict (id) do nothing;

insert into public.consultants (id, email, full_name)
values ('00000000-0000-0000-0000-000000000001', 'consultant@corpathways.test', 'Cor Pathway 360 Consultant')
on conflict (id) do nothing;

insert into public.permission_profiles (id, tenant_id, name, power_ceiling, capabilities, is_default)
values
  ('20000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000001', 'App Admin', 'admin', '{"forms":true,"workers":true,"locations":true}', true),
  ('20000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000001', 'App Supervisor', 'supervisor', '{"forms":true,"follow_ups":true}', false),
  ('20000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000001', 'Worker Solo', 'worker', '{"team_forms":false}', false),
  ('20000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000002', 'App Admin', 'admin', '{"forms":true,"workers":true,"locations":true}', true),
  ('20000000-0000-0000-0000-000000000202', '10000000-0000-0000-0000-000000000002', 'Worker Team', 'worker', '{"team_forms":true}', false)
on conflict (id) do nothing;

insert into public.users (
  id,
  tenant_id,
  email,
  full_name,
  power_level,
  reach_type,
  permission_profile_id,
  app_access,
  offline_sync_days
)
values
  ('00000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000001', 'superadmin@northwind.test', 'Nora Super', 'super_admin', 'all_locations', '20000000-0000-0000-0000-000000000101', 'super_admin_access', 30),
  ('00000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000001', 'admin@northwind.test', 'Alex Admin', 'admin', 'all_locations', '20000000-0000-0000-0000-000000000101', 'admin_access', 30),
  ('00000000-0000-0000-0000-000000000103', '10000000-0000-0000-0000-000000000001', 'manager@northwind.test', 'Maya Manager', 'manager', 'all_locations', '20000000-0000-0000-0000-000000000101', 'admin_access', 30),
  ('00000000-0000-0000-0000-000000000104', '10000000-0000-0000-0000-000000000001', 'supervisor@northwind.test', 'Sam Supervisor', 'supervisor', 'specific_locations', '20000000-0000-0000-0000-000000000102', 'app_access', 30),
  ('00000000-0000-0000-0000-000000000105', '10000000-0000-0000-0000-000000000001', 'worker@northwind.test', 'Will Worker', 'worker', 'specific_locations', '20000000-0000-0000-0000-000000000103', 'app_access', 30),
  ('00000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000002', 'superadmin@blueridge.test', 'Bri Super', 'super_admin', 'all_locations', '20000000-0000-0000-0000-000000000201', 'super_admin_access', 30),
  ('00000000-0000-0000-0000-000000000202', '10000000-0000-0000-0000-000000000002', 'worker@blueridge.test', 'Blake Worker', 'worker', 'specific_locations', '20000000-0000-0000-0000-000000000202', 'app_access', 30)
on conflict (id) do nothing;

insert into public.locations (id, tenant_id, name, code, visibility_rule, start_date, default_for_new_workers)
values
  ('30000000-0000-0000-0000-000000000101', '10000000-0000-0000-0000-000000000001', 'Riverside Project', 'RIVERSIDE', 'only_workers_assigned', current_date, true),
  ('30000000-0000-0000-0000-000000000102', '10000000-0000-0000-0000-000000000001', 'Queen Street Yard', 'QUEEN', 'only_workers_assigned', current_date, false),
  ('30000000-0000-0000-0000-000000000201', '10000000-0000-0000-0000-000000000002', 'Blue Ridge Shop', 'SHOP', 'only_workers_assigned', current_date, true)
on conflict (id) do nothing;

insert into public.user_locations (tenant_id, user_id, location_id)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000104', '30000000-0000-0000-0000-000000000101'),
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000105', '30000000-0000-0000-0000-000000000101'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000202', '30000000-0000-0000-0000-000000000201')
on conflict (tenant_id, user_id, location_id) do nothing;

insert into public.company_settings (tenant_id, company_name, address, phone, timezone, company_id)
values
  ('10000000-0000-0000-0000-000000000001', 'Northwind Civil', '100 Riverside Road', '555-0101', 'America/Vancouver', 'ACME'),
  ('10000000-0000-0000-0000-000000000002', 'Blue Ridge Fabrication', '40 Industrial Way', '555-0202', 'America/Vancouver', 'BRF')
on conflict (tenant_id) do nothing;

insert into public.print_settings (tenant_id, header_option, logo_placement)
values
  ('10000000-0000-0000-0000-000000000001', 'company_info_and_logo', 'left'),
  ('10000000-0000-0000-0000-000000000002', 'company_info_only', 'left')
on conflict (tenant_id) do nothing;

set session_replication_role = origin;
