-- The maintenance work order rules hold in the database, not just in the app.
--
-- Every check here goes straight at the tables and functions as a signed-in member, the
-- way a person with a token and the API could, with the server actions bypassed entirely.
-- It also walks the slice 3 loop: a failed inspection item raises a work order only when
-- the module is on, at the severity's priority, and never twice for the same item and
-- asset.
--
-- Run with: supabase test db supabase/tests/maintenance-work-orders.sql

begin;

set search_path = public, extensions;
create extension if not exists pgtap with schema extensions;

-- The signup trigger builds its own tenant per auth user and would collide with the
-- fixtures, and the maintenance guards would refuse fixture rows written with no session
-- flag. Triggers are off while the fixtures go in, and back on before anything is tested.
set local session_replication_role = replica;

select plan(33);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('b1000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wo-admin@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('b1000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wo-worker@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('b1000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'wo-manager@example.test', crypt('Password123!', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.tenants (id, name, slug, maintenance_enabled, inventory_enabled)
values ('b2000000-0000-0000-0000-000000000001', 'Maintenance Test Tenant', 'maintenance-test-tenant', true, true);

-- An admin, a worker with the phone app only, and a manager who can use the admin panel
-- but is not an admin.
insert into public.users (id, tenant_id, email, full_name, power_level, reach_type, app_access)
values
  ('b1000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'wo-admin@example.test', 'Sample Admin', 'admin', 'all_locations', 'admin_access'),
  ('b1000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'wo-worker@example.test', 'Sample Mechanic', 'worker', 'all_locations', 'app_access'),
  ('b1000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001', 'wo-manager@example.test', 'Sample Manager', 'manager', 'all_locations', 'admin_access');

insert into public.locations (id, tenant_id, name, code)
values ('b3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'Public Works Yard', 'YARD');

-- A metered vehicle with a reading on file, and a meter-based oil change on it.
insert into public.equipment (id, tenant_id, unit_number, name, category, tracking_mode, current_meter, status)
values ('b4000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'T-100', 'Sample pickup', 'vehicle', 'mileage', 1000, 'active');

insert into public.equipment_scheduled_service (
  id, tenant_id, equipment_id, title, service_type, interval_mode, due_meter, recurrence_unit, recurrence_value, is_active
)
values (
  'b5000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b4000000-0000-0000-0000-000000000001',
  'Oil change', 'oil_change', 'by_meter', 1050, 'meter', 500, true
);

-- Stock: ten filters on a shelf in the yard, at 12.50 each.
insert into public.inventory_location (id, tenant_id, kind, location_id)
values ('b6000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'yard', 'b3000000-0000-0000-0000-000000000001');

insert into public.inventory_item (id, tenant_id, name, unit_cost)
values ('b7000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'Oil filter', 12.5);

insert into public.inventory_balance (tenant_id, item_id, location_id, qty, allows_negative)
values ('b2000000-0000-0000-0000-000000000001', 'b7000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001', 10, false);

-- A corrective action on the vehicle, waiting for a work order.
insert into public.follow_ups (id, tenant_id, title, description, status, equipment_id)
values (
  'b8000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'Corrective action: Wipers',
  'Wiper blades are torn.', 'open', 'b4000000-0000-0000-0000-000000000001'
);

-- An inspection form with one critical item that raises work orders, and a submission
-- that failed it.
insert into public.forms (id, tenant_id, name, code)
values ('b9000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'Light vehicle pre-use inspection', 'MUN-VEH-PRE');

insert into public.form_sections (id, tenant_id, form_id, title)
values ('b9100000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'Walk-around');

insert into public.form_items (id, tenant_id, form_id, section_id, field_type, label, flaggable, settings)
values (
  'b9200000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001',
  'b9100000-0000-0000-0000-000000000001', 'pass_fail_na', 'Tires', true,
  '{"severity": "critical", "autoWorkOrder": true, "allowEvidencePhotos": false}'::jsonb
);

insert into public.submissions (id, tenant_id, form_id, submitted_by)
values
  ('b9300000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002'),
  ('b9300000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002'),
  ('b9300000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001', 'b9000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');

insert into public.submission_values (tenant_id, submission_id, form_item_id, value)
values
  ('b2000000-0000-0000-0000-000000000001', 'b9300000-0000-0000-0000-000000000001', 'b9200000-0000-0000-0000-000000000001', '"fail"'::jsonb),
  ('b2000000-0000-0000-0000-000000000001', 'b9300000-0000-0000-0000-000000000002', 'b9200000-0000-0000-0000-000000000001', '"fail"'::jsonb),
  ('b2000000-0000-0000-0000-000000000001', 'b9300000-0000-0000-0000-000000000003', 'b9200000-0000-0000-0000-000000000001', '{"value": "fail"}'::jsonb);

set local session_replication_role = origin;
set local role authenticated;

-- === The admin raises work from the corrective action and the scheduled service ==========
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.create_work_order_from_follow_up('b8000000-0000-0000-0000-000000000001', 'high')$$,
  'A manager raises a work order from a corrective action'
);

select is(
  (select maintenance_work_order_id from public.follow_ups where id = 'b8000000-0000-0000-0000-000000000001'),
  (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'),
  'The corrective action and the work order point at each other'
);

select is(
  public.create_work_order_from_follow_up('b8000000-0000-0000-0000-000000000001'),
  (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'),
  'Raising it again hands back the open work order instead of a second one'
);

select lives_ok(
  $$select public.create_preventive_work_order('b5000000-0000-0000-0000-000000000001', 'normal')$$,
  'A manager raises the preventive work order for a scheduled service'
);

select is(
  public.create_preventive_work_order('b5000000-0000-0000-0000-000000000001', 'normal'),
  (select id from public.maintenance_work_order where scheduled_service_id = 'b5000000-0000-0000-0000-000000000001'),
  'Raising preventive work again hands back the open work order'
);

select is(
  (select count(*)::integer from public.maintenance_work_order where scheduled_service_id = 'b5000000-0000-0000-0000-000000000001'),
  1,
  'Raising preventive work twice leaves one open work order for the service'
);

-- Approve and assign the corrective work to the mechanic.
select lives_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'), 'approve')$$,
  'The admin approves the work order'
);

update public.maintenance_work_order
   set assignee_id = 'b1000000-0000-0000-0000-000000000002'
 where follow_up_id = 'b8000000-0000-0000-0000-000000000001';

select lives_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'), 'assign')$$,
  'The admin assigns it to the mechanic'
);

-- === The mechanic, with the phone app only ===========================================
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);

select throws_ok(
  $$update public.maintenance_work_order set status = 'closed' where follow_up_id = 'b8000000-0000-0000-0000-000000000001'$$,
  '42501', null,
  'A member cannot set a work order''s status directly'
);

select throws_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where scheduled_service_id = 'b5000000-0000-0000-0000-000000000001'), 'approve')$$,
  '42501', null,
  'A worker cannot approve a work order'
);

select throws_ok(
  $$insert into public.maintenance_work_order_event (tenant_id, work_order_id, action)
    values ('b2000000-0000-0000-0000-000000000001',
            (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'), 'closed')$$,
  '42501', null,
  'The trail cannot be written directly'
);

select lives_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'), 'start')$$,
  'The mechanic starts the work assigned to them'
);

-- A part from stock: listed, issued through the ledger, returned through the ledger.
insert into public.maintenance_work_order_part (id, tenant_id, work_order_id, item_id, description, qty, unit_cost, line_total)
values (
  'ba000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001',
  (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'),
  'b7000000-0000-0000-0000-000000000001', 'Oil filter', 2, 12.5, 25
);

select lives_ok(
  $$select public.issue_maintenance_work_order_part('ba000000-0000-0000-0000-000000000001', 'b6000000-0000-0000-0000-000000000001')$$,
  'The mechanic issues a stock part from the yard'
);

select is(
  (select m.movement_type || ':' || m.qty::text || ':' || coalesce(m.from_location_id::text, '') || ':' || coalesce(m.to_location_id::text, 'none')
     from public.inventory_movement m
     join public.maintenance_work_order_part p on p.movement_id = m.id
    where p.id = 'ba000000-0000-0000-0000-000000000001'),
  'consume:2.000:b6000000-0000-0000-0000-000000000001:none',
  'Issuing a part posts a consume movement through the ledger'
);

select is(
  (select qty from public.inventory_balance
    where item_id = 'b7000000-0000-0000-0000-000000000001' and location_id = 'b6000000-0000-0000-0000-000000000001'),
  8.000::numeric,
  'The ledger takes the part off the shelf'
);

select is(
  (select parts_cost from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'),
  25.00::numeric,
  'The issued part counts in the parts cost at the item''s unit cost'
);

select lives_ok(
  $$select public.return_maintenance_work_order_part('ba000000-0000-0000-0000-000000000001')$$,
  'The mechanic returns the part'
);

select is(
  (select m.movement_type || ':' || coalesce(m.to_location_id::text, '')
     from public.inventory_movement m
     join public.maintenance_work_order_part p on p.return_movement_id = m.id
    where p.id = 'ba000000-0000-0000-0000-000000000001')
  || ':' || (select qty::text from public.inventory_balance
              where item_id = 'b7000000-0000-0000-0000-000000000001' and location_id = 'b6000000-0000-0000-0000-000000000001'),
  'reversal:b6000000-0000-0000-0000-000000000001:10.000',
  'Returning a part posts a reversal movement'
);

select throws_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'), 'complete', null, '  ', 1100)$$,
  'P0001', null,
  'Completion needs notes'
);

select throws_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'), 'complete', null, 'Replaced both blades.', null)$$,
  'P0001', null,
  'Completion on a metered asset needs a reading'
);

select lives_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'), 'complete', null, 'Replaced both blades.', 1100)$$,
  'The mechanic completes the work with notes and a reading'
);

select is(
  (select status from public.follow_ups where id = 'b8000000-0000-0000-0000-000000000001'),
  'completed',
  'Completing completes the corrective action'
);

-- === The admin finishes the preventive work, then closes the repair =====================
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);

select lives_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where scheduled_service_id = 'b5000000-0000-0000-0000-000000000001'), 'approve')$$,
  'The admin approves the preventive work'
);

select lives_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where scheduled_service_id = 'b5000000-0000-0000-0000-000000000001'), 'complete', null, 'Oil and filter changed.', 1200)$$,
  'The admin completes the preventive work with a reading'
);

select is(
  (select due_meter from public.equipment_scheduled_service where id = 'b5000000-0000-0000-0000-000000000001'),
  1700::numeric,
  'Completing advances the scheduled service by the completion meter'
);

select lives_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'), 'close')$$,
  'The admin closes the repair'
);

select is(
  (select count(*)::integer from public.equipment_maintenance_log
    where equipment_id = 'b4000000-0000-0000-0000-000000000001' and title like 'WO-%' and deleted_at is null),
  1,
  'Closing writes the asset''s maintenance log'
);

select is(
  (select value from public.equipment_meter_log
    where equipment_id = 'b4000000-0000-0000-0000-000000000001' and source = 'maintenance'),
  1100::numeric,
  'Closing writes the completion reading to the meter log'
);

select throws_ok(
  $$insert into public.maintenance_work_order_labour (tenant_id, work_order_id, worker_id, hours, rate, cost)
    values ('b2000000-0000-0000-0000-000000000001',
            (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'),
            'b1000000-0000-0000-0000-000000000002', 1, 50, 50)$$,
  '42501', null,
  'Costs are locked once the work order is closed'
);

-- === A manager who is not an admin ======================================================
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000003', true);

select throws_ok(
  $$select public.transition_maintenance_work_order(
      (select id from public.maintenance_work_order where follow_up_id = 'b8000000-0000-0000-0000-000000000001'), 'reopen', 'Invoice arrived late')$$,
  '42501', null,
  'Only an admin reopens a closed work order'
);

-- === The inspection loop ================================================================
-- Off first: the corrective action lands exactly as it always has, and nothing else.
reset role;
update public.tenants set maintenance_enabled = false where id = 'b2000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);

insert into public.follow_ups (tenant_id, title, status, equipment_id, form_item_id, parent_submission_id)
values (
  'b2000000-0000-0000-0000-000000000001', 'Major vehicle defect: Tires', 'open',
  'b4000000-0000-0000-0000-000000000001', 'b9200000-0000-0000-0000-000000000001', 'b9300000-0000-0000-0000-000000000001'
);

select is(
  (select count(*)::integer from public.maintenance_work_order where source = 'inspection'),
  0,
  'With maintenance off, a failed inspection item raises no work order'
);

reset role;
update public.tenants set maintenance_enabled = true where id = 'b2000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);

insert into public.follow_ups (tenant_id, title, status, equipment_id, form_item_id, parent_submission_id)
values (
  'b2000000-0000-0000-0000-000000000001', 'Major vehicle defect: Tires', 'open',
  'b4000000-0000-0000-0000-000000000001', 'b9200000-0000-0000-0000-000000000001', 'b9300000-0000-0000-0000-000000000002'
);

select is(
  (select priority from public.maintenance_work_order
    where source = 'inspection' and source_id = 'b9200000-0000-0000-0000-000000000001'
      and equipment_id = 'b4000000-0000-0000-0000-000000000001'),
  'urgent',
  'With maintenance on, a failed critical item raises an urgent work order'
);

-- The same item fails again on the same asset while the work is open: linked, not doubled.
insert into public.follow_ups (tenant_id, title, status, equipment_id, form_item_id, parent_submission_id)
values (
  'b2000000-0000-0000-0000-000000000001', 'Major vehicle defect: Tires', 'open',
  'b4000000-0000-0000-0000-000000000001', 'b9200000-0000-0000-0000-000000000001', 'b9300000-0000-0000-0000-000000000003'
);

select is(
  (select count(*)::integer || ':' || count(distinct f.maintenance_work_order_id)::integer
     from public.follow_ups f
    where f.form_item_id = 'b9200000-0000-0000-0000-000000000001'
      and f.maintenance_work_order_id is not null),
  '2:1',
  'A second open work order for the same item and asset is refused: the repeat failure joins the open one'
);

select * from finish();
rollback;
