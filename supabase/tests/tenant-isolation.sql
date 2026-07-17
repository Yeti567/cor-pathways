begin;

set search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

-- This test builds its tenants and users explicitly, so the signup trigger on
-- auth.users must not also build them. Left on, it inserts a public.users row for
-- each auth user below, which then collides with this test's own insert. Scoped to
-- this transaction, and the test is insert-only, so suspending foreign key checks
-- alongside the trigger costs nothing here.
set local session_replication_role = replica;

select plan(7);

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
  ('90000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tenant-a-test@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('90000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tenant-b-test@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.tenants (id, name, slug)
values
  ('91000000-0000-0000-0000-000000000001', 'Tenant A Test', 'tenant-a-test'),
  ('91000000-0000-0000-0000-000000000002', 'Tenant B Test', 'tenant-b-test');

insert into public.users (id, tenant_id, email, full_name, power_level, reach_type, app_access)
values
  ('90000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'tenant-a-test@example.test', 'Tenant A User', 'admin', 'all_locations', 'admin_access'),
  ('90000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', 'tenant-b-test@example.test', 'Tenant B User', 'admin', 'all_locations', 'admin_access');

insert into public.locations (id, tenant_id, name, code)
values
  ('92000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'Tenant A Location', 'A-LOC'),
  ('92000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', 'Tenant B Location', 'B-LOC');

insert into public.equipment (id, tenant_id, unit_number, name, tracking_mode, location_id)
values
  ('93000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-000000000001', 'A-47', 'Tenant A Truck', 'mileage', '92000000-0000-0000-0000-000000000001'),
  ('93000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000002', 'B-12', 'Tenant B Loader', 'hours', '92000000-0000-0000-0000-000000000002');

insert into public.tenant_audit_log (tenant_id, actor_user_id, actor_role, action, entity_table, entity_id, metadata)
values
  ('91000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'admin', 'location.create', 'locations', '92000000-0000-0000-0000-000000000001', '{"name":"Tenant A Location"}'),
  ('91000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000002', 'admin', 'location.create', 'locations', '92000000-0000-0000-0000-000000000002', '{"name":"Tenant B Location"}');

create or replace function pg_temp.cross_tenant_insert_blocked()
returns boolean
language plpgsql
as $$
begin
  begin
    insert into public.locations (tenant_id, name, code)
    values ('91000000-0000-0000-0000-000000000002', 'Blocked Cross Tenant Insert', 'BLOCKED');
    return false;
  exception
    when insufficient_privilege then return true;
    when check_violation then return true;
  end;
end;
$$;

create or replace function pg_temp.cross_tenant_equipment_insert_blocked()
returns boolean
language plpgsql
as $$
begin
  begin
    insert into public.equipment (tenant_id, unit_number, name, tracking_mode)
    values ('91000000-0000-0000-0000-000000000002', 'BLOCKED-EQ', 'Blocked Equipment', 'hours');
    return false;
  exception
    when insufficient_privilege then return true;
    when check_violation then return true;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '90000000-0000-0000-0000-000000000001', true);

select is((select count(*)::integer from public.locations), 1, 'Tenant A sees only its own location');
select is((select count(*)::integer from public.locations where tenant_id = '91000000-0000-0000-0000-000000000002'), 0, 'Tenant A cannot see Tenant B rows');
select ok(pg_temp.cross_tenant_insert_blocked(), 'Tenant A cannot insert Tenant B rows');
select is((select count(*)::integer from public.equipment), 1, 'Tenant A sees only its own equipment');
select ok(pg_temp.cross_tenant_equipment_insert_blocked(), 'Tenant A cannot insert Tenant B equipment');
select is((select count(*)::integer from public.tenant_audit_log), 1, 'Tenant A admin sees only its own audit log');
select is((select count(*)::integer from public.tenant_audit_log where tenant_id = '91000000-0000-0000-0000-000000000002'), 0, 'Tenant A admin cannot see Tenant B audit rows');

select * from finish();
rollback;
