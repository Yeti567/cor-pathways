-- RLS on the error sink.
--
-- This table holds stack traces and error context from a live compliance system,
-- so who can read it matters more than for most tables. The intended shape:
-- any signed-in member may REPORT a failure, because the worker whose phone broke
-- is the one who has to send it; only an admin may READ one, because a trace can
-- carry more about a person than a colleague should see.
--
-- Run with: supabase test db

begin;

set search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

-- The signup trigger would build its own tenant per auth user and collide with the
-- fixtures below. Scoped to this transaction, and this test is insert-only.
set local session_replication_role = replica;

select plan(8);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('94000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'err-admin-a@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('94000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'err-worker-a@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('94000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'err-admin-b@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.tenants (id, name, slug)
values
  ('95000000-0000-0000-0000-000000000001', 'Err Tenant A', 'err-tenant-a'),
  ('95000000-0000-0000-0000-000000000002', 'Err Tenant B', 'err-tenant-b');

insert into public.users (id, tenant_id, email, full_name, power_level, reach_type, app_access)
values
  ('94000000-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000001', 'err-admin-a@example.test', 'Err Admin A', 'admin', 'all_locations', 'admin_access'),
  ('94000000-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000001', 'err-worker-a@example.test', 'Err Worker A', 'worker', 'all_locations', 'app_access'),
  ('94000000-0000-0000-0000-000000000003', '95000000-0000-0000-0000-000000000002', 'err-admin-b@example.test', 'Err Admin B', 'admin', 'all_locations', 'admin_access');

insert into public.app_error (tenant_id, signature, source, kind, message)
values
  ('95000000-0000-0000-0000-000000000001', 'client:aaaa1111', 'client', 'unhandled_error', 'Tenant A failure'),
  ('95000000-0000-0000-0000-000000000002', 'client:bbbb2222', 'client', 'unhandled_error', 'Tenant B failure');

insert into public.app_error_signature (tenant_id, signature, source, kind, sample_message, first_seen_at, last_seen_at)
values
  ('95000000-0000-0000-0000-000000000001', 'client:aaaa1111', 'client', 'unhandled_error', 'Tenant A failure', now(), now()),
  ('95000000-0000-0000-0000-000000000002', 'client:bbbb2222', 'client', 'unhandled_error', 'Tenant B failure', now(), now());

create or replace function pg_temp.cross_tenant_error_insert_blocked()
returns boolean
language plpgsql
as $$
begin
  begin
    insert into public.app_error (tenant_id, signature, source, kind, message)
    values ('95000000-0000-0000-0000-000000000002', 'client:cccc3333', 'client', 'unhandled_error', 'Blocked cross tenant');
    return false;
  exception
    when insufficient_privilege then return true;
    when check_violation then return true;
  end;
end;
$$;

create or replace function pg_temp.own_tenant_error_insert_allowed()
returns boolean
language plpgsql
as $$
begin
  begin
    insert into public.app_error (tenant_id, signature, source, kind, message)
    values ('95000000-0000-0000-0000-000000000001', 'client:dddd4444', 'client', 'unhandled_error', 'Own tenant report');
    return true;
  exception
    when others then return false;
  end;
end;
$$;

set local role authenticated;

-- A worker: may report, must not read.
select set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000002', true);

select ok(pg_temp.own_tenant_error_insert_allowed(), 'A worker can report a failure from their own device');
select ok(pg_temp.cross_tenant_error_insert_blocked(), 'A worker cannot report into another tenant');
select is((select count(*)::integer from public.app_error), 0, 'A worker cannot read error rows, which carry stack traces');
select is((select count(*)::integer from public.app_error_signature), 0, 'A worker cannot read error signatures');

-- An admin of tenant A: may read their own tenant, and only their own.
select set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000001', true);

select ok((select count(*)::integer from public.app_error) >= 1, 'An admin can read their own tenant''s errors');
select is((select count(*)::integer from public.app_error where tenant_id = '95000000-0000-0000-0000-000000000002'), 0, 'An admin cannot read another tenant''s errors');
select is((select count(*)::integer from public.app_error_signature), 1, 'An admin sees only their own tenant''s signatures');

-- An admin of tenant B must not see tenant A, even though both are admins.
select set_config('request.jwt.claim.sub', '94000000-0000-0000-0000-000000000003', true);

select is((select count(*)::integer from public.app_error where tenant_id = '95000000-0000-0000-0000-000000000001'), 0, 'Another tenant''s admin cannot read these errors');

select * from finish();
rollback;
