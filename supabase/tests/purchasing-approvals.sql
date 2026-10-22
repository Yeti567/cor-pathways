-- The purchasing approval rules hold in the database, not just in the app.
--
-- Every check here goes straight at the tables and functions as a signed-in member,
-- the way a person with a token and the API could, with the server actions bypassed
-- entirely. The app checks the same rules first; this is what stops a direct call
-- getting round them.
--
-- Run with: supabase test db supabase/tests/purchasing-approvals.sql

begin;

set search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

-- The signup trigger builds its own tenant per auth user and would collide with the
-- fixtures, and the purchasing guards would refuse fixture rows written with no session.
-- Triggers are off while the fixtures go in, and back on before anything is tested.
set local session_replication_role = replica;

select plan(16);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('a1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po-requester@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('a1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po-approver@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('a1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'po-worker@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.tenants (id, name, slug)
values ('a2000000-0000-0000-0000-000000000001', 'Purchasing Test Tenant', 'purchasing-test-tenant');

-- The requester can use the admin panel but is not an admin. The approver is an admin.
-- The worker has the phone app only.
insert into public.users (id, tenant_id, email, full_name, power_level, reach_type, app_access)
values
  ('a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'po-requester@example.test', 'Sample Requester', 'manager', 'all_locations', 'admin_access'),
  ('a1000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'po-approver@example.test', 'Sample Approver', 'admin', 'all_locations', 'admin_access'),
  ('a1000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'po-worker@example.test', 'Sample Worker', 'worker', 'all_locations', 'app_access');

insert into public.supplier (id, tenant_id, name)
values ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Example Supply');

-- One band that catches every order, naming the requester as well as the approver, so
-- the self-approval refusal is tested against a rule that would otherwise allow it.
insert into public.purchase_approval_rule (id, tenant_id, name, threshold, approver_user_ids, style, level)
values (
  'a4000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Every order', 0,
  array['a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002']::uuid[], 'band', 1
);

insert into public.purchase_order (id, tenant_id, number, title, status, requester_id, created_by, supplier_id, subtotal, total)
values (
  'a5000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 1, 'Test order', 'draft',
  'a1000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001', 100, 100
);

insert into public.purchase_order_line (id, tenant_id, purchase_order_id, line_number, kind, description, qty_ordered, unit_cost, line_total)
values (
  'a6000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000001', 1, 'non_stock', 'Gravel', 1, 100, 100
);

insert into public.purchase_order_event (tenant_id, purchase_order_id, action, actor_user_id, created_at)
values ('a2000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'created', 'a1000000-0000-0000-0000-000000000001', now() - interval '1 hour');

set local session_replication_role = origin;
set local role authenticated;

-- === The requester ==============================================================
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$update public.purchase_order set status = 'approved', approved_at = now() where id = 'a5000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'A member cannot set an order''s status directly'
);

select throws_ok(
  $$select public.transition_purchase_order('a5000000-0000-0000-0000-000000000001', 'approve')$$,
  '42501', null,
  'A draft cannot jump straight to approved'
);

select throws_ok(
  $$insert into public.purchase_order_event (tenant_id, purchase_order_id, action, actor_user_id) values ('a2000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001', 'approved', 'a1000000-0000-0000-0000-000000000002')$$,
  '42501', null,
  'A member cannot write an approval into the trail under another name'
);

select throws_ok(
  $$update public.purchase_approval_rule set approver_user_ids = array['a1000000-0000-0000-0000-000000000001']::uuid[] where id = 'a4000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'A non-admin cannot rewrite who approves'
);

select lives_ok(
  $$select public.transition_purchase_order('a5000000-0000-0000-0000-000000000001', 'submit')$$,
  'The requester submits their order'
);

select is(
  (select status from public.purchase_order where id = 'a5000000-0000-0000-0000-000000000001'),
  'pending_approval',
  'Submitting moves the order to awaiting approval'
);

select is(
  (select actor_user_id from public.purchase_order_event where purchase_order_id = 'a5000000-0000-0000-0000-000000000001' and action = 'submitted'),
  'a1000000-0000-0000-0000-000000000001'::uuid,
  'The trail names the signed-in user, taken from the session'
);

select throws_ok(
  $$select public.transition_purchase_order('a5000000-0000-0000-0000-000000000001', 'approve')$$,
  '42501', null,
  'The requester cannot approve their own order, even when the rule names them'
);

select throws_ok(
  $$update public.purchase_order_line set unit_cost = 1, line_total = 1 where id = 'a6000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'The requester cannot change lines while the order waits for approval'
);

-- === A worker with the phone app only ===========================================
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$select public.transition_purchase_order('a5000000-0000-0000-0000-000000000001', 'approve')$$,
  '42501', null,
  'A member without admin panel access cannot approve'
);

-- === The approver ===============================================================
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000002', true);

select lives_ok(
  $$select public.transition_purchase_order('a5000000-0000-0000-0000-000000000001', 'approve')$$,
  'An approver named on the rule approves'
);

select is(
  (select status from public.purchase_order where id = 'a5000000-0000-0000-0000-000000000001'),
  'approved',
  'One approval in the band finishes the order'
);

select is(
  (select actor_user_id from public.purchase_order_event where purchase_order_id = 'a5000000-0000-0000-0000-000000000001' and action = 'approved'),
  'a1000000-0000-0000-0000-000000000002'::uuid,
  'The approval is recorded against the approver'
);

-- === Back to the requester, after approval ======================================
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$update public.purchase_order_line set unit_cost = 1, line_total = 1 where id = 'a6000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'Costs are locked once the order is approved'
);

select throws_ok(
  $$insert into public.purchase_receipt (tenant_id, purchase_order_id) values ('a2000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'A receipt cannot be written except by receiving against the order'
);

select throws_ok(
  $$delete from public.purchase_order where id = 'a5000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'An order is cancelled, never deleted'
);

select * from finish();
rollback;
