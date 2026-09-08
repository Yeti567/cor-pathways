-- Worksite Demo: the reset function, and a call to run it once.
--
-- public.reset_worksite_demo() tears the demo tenant down and rebuilds it from scratch, so
-- the demo self-heals: whatever a visitor toggles or creates is wiped and the clean story
-- is laid back down. It is scheduled nightly with pg_cron (see the companion setup below),
-- and can be run by hand any time with:  select public.reset_worksite_demo();
--
-- The demo login is a deliberately shared, public credential:
--     email:    demo@corpathway360.com
--     password: WorksiteDemo1!
--
-- The tenant is marked demo_mode = true, which blocks all uploads into it (see the
-- 20260724040000 migration). Combined with leaving OPENROUTER_API_KEY and EMAIL_DELIVERY_*
-- unset on this deployment, a visitor can look through everything but cannot upload, spend,
-- or send anything.

create or replace function "public"."reset_worksite_demo"() returns "void"
    language "plpgsql" security definer
    set "search_path" to 'public', 'extensions', 'pg_temp'
    as $$
declare
  demo_user uuid := 'd0000000-0000-0000-0000-000000000001';
  v_tenant uuid;
  v_yard_loc uuid; v_cardium_loc uuid; v_pembina_loc uuid;
  v_truck_eq uuid;
  v_transit uuid; v_loss uuid; v_yard uuid; v_cardium uuid; v_pembina uuid; v_truck uuid;
  v_rigmat uuid; v_accessmat uuid; v_gloves uuid; v_pads uuid;
  v_adj uuid;
  v_worker_profile uuid;
begin
  -- Tear down any prior demo. Deleting the tenant cascades every row it owns.
  select tenant_id into v_tenant from public.users where id = demo_user;
  if v_tenant is not null then
    delete from public.tenants where id = v_tenant;
  end if;
  -- Every demo auth user shares this id prefix: the admin plus the seven drivers.
  -- public.users cascades with the tenant, but auth.users does not, so clear them
  -- here or the next reset collides on the email unique index.
  delete from auth.users where id::text like 'd0000000-0000-0000-0000-%';

  -- Create the demo login. The signup trigger builds the tenant, the super-admin user, the
  -- permission profiles, and the starter forms, lists, and orientation. The eight token
  -- columns are set to the empty string GoTrue expects, or login returns a 500.
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    created_at, updated_at
  ) values (
    demo_user,
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated',
    'demo@corpathway360.com',
    extensions.crypt('WorksiteDemo1!', extensions.gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{"company_name":"Worksite Demo","full_name":"Demo Admin"}',
    '', '', '', '', '', '', '', '',
    now(), now()
  );

  -- Enrich: switch on the modules to show, mark the tenant as a demo (blocks uploads), and
  -- lay down the rig-mat rental inventory story. Movement dates are backdated so the billing
  -- report and the history read like a company that has been running a while.
  select tenant_id into v_tenant from public.users where id = demo_user;

  update public.tenants
     set inventory_enabled = true, document_control_enabled = true, trades_enabled = true,
         transport_enabled = true, daily_inspection_enabled = true,
         demo_mode = true, demo_uploads_enabled = true
   where id = v_tenant;

  insert into public.locations (tenant_id, name, code) values (v_tenant, 'Leduc Yard', 'YARD') returning id into v_yard_loc;
  insert into public.locations (tenant_id, name, code) values (v_tenant, 'Cardium Well 14-22', 'CW1422') returning id into v_cardium_loc;
  insert into public.locations (tenant_id, name, code) values (v_tenant, 'Pembina Lease 3', 'PL3') returning id into v_pembina_loc;

  insert into public.equipment (tenant_id, unit_number, tracking_mode, name, category)
    values (v_tenant, 'T-01', 'mileage', 'Picker Truck', 'vehicle') returning id into v_truck_eq;

  insert into public.inventory_location (tenant_id, kind, name) values (v_tenant, 'transit', 'In transit') returning id into v_transit;
  insert into public.inventory_location (tenant_id, kind, name) values (v_tenant, 'loss', 'Loss and write-off') returning id into v_loss;
  insert into public.inventory_location (tenant_id, kind, location_id) values (v_tenant, 'yard', v_yard_loc) returning id into v_yard;
  insert into public.inventory_location (tenant_id, kind, location_id) values (v_tenant, 'customer_site', v_cardium_loc) returning id into v_cardium;
  insert into public.inventory_location (tenant_id, kind, location_id) values (v_tenant, 'customer_site', v_pembina_loc) returning id into v_pembina;
  insert into public.inventory_location (tenant_id, kind, equipment_id) values (v_tenant, 'vehicle', v_truck_eq) returning id into v_truck;

  insert into public.inventory_item (tenant_id, name, unit_of_measure, tracking_mode, returnable, billable, default_rate, rate_basis, created_by)
    values (v_tenant, 'Rig Mat 4x8', 'each', 'bulk', true, true, 12, 'day', demo_user) returning id into v_rigmat;
  insert into public.inventory_item (tenant_id, name, unit_of_measure, tracking_mode, returnable, billable, default_rate, rate_basis, created_by)
    values (v_tenant, 'Access Mat 8x14', 'each', 'bulk', true, true, 18, 'day', demo_user) returning id into v_accessmat;
  insert into public.inventory_item (tenant_id, name, unit_of_measure, tracking_mode, returnable, billable, reorder_point, created_by)
    values (v_tenant, 'Nitrile Gloves', 'box', 'bulk', false, false, 20, demo_user) returning id into v_gloves;
  insert into public.inventory_item (tenant_id, name, unit_of_measure, tracking_mode, returnable, billable, reorder_point, created_by)
    values (v_tenant, 'Absorbent Pads', 'bale', 'bulk', false, false, 10, demo_user) returning id into v_pads;

  insert into public.inventory_movement (tenant_id, item_id, qty, to_location_id, movement_type, occurred_at, created_by) values
    (v_tenant, v_rigmat, 200, v_yard, 'receive', now() - interval '40 days', demo_user),
    (v_tenant, v_accessmat, 80, v_yard, 'receive', now() - interval '40 days', demo_user),
    (v_tenant, v_gloves, 15, v_yard, 'receive', now() - interval '20 days', demo_user),
    (v_tenant, v_pads, 40, v_yard, 'receive', now() - interval '20 days', demo_user);

  insert into public.inventory_movement (tenant_id, item_id, qty, from_location_id, to_location_id, movement_type, occurred_at, created_by) values
    (v_tenant, v_rigmat, 60, v_yard, v_cardium, 'transfer', now() - interval '22 days', demo_user),
    (v_tenant, v_accessmat, 30, v_yard, v_pembina, 'transfer', now() - interval '12 days', demo_user),
    (v_tenant, v_rigmat, 40, v_yard, v_truck, 'transfer', now() - interval '3 days', demo_user);

  insert into public.inventory_movement (tenant_id, item_id, qty, from_location_id, to_location_id, movement_type, occurred_at, created_by) values
    (v_tenant, v_rigmat, 20, v_cardium, v_yard, 'transfer', now() - interval '5 days', demo_user);

  insert into public.inventory_movement (tenant_id, item_id, qty, from_location_id, to_location_id, movement_type, occurred_at, created_by) values
    (v_tenant, v_pads, 6, v_yard, v_cardium, 'consume', now() - interval '8 days', demo_user);

  insert into public.inventory_movement (tenant_id, item_id, qty, from_location_id, to_location_id, movement_type, occurred_at, note, created_by) values
    (v_tenant, v_pads, 3, v_yard, v_loss, 'write_off', now() - interval '6 days', 'Water damaged', demo_user);

  insert into public.inventory_movement (tenant_id, item_id, qty, from_location_id, to_location_id, movement_type, occurred_at, note, created_by)
    values (v_tenant, v_rigmat, 4, v_yard, v_loss, 'adjustment', now() - interval '1 day', 'Physical count', demo_user)
    returning id into v_adj;
  insert into public.inventory_count (tenant_id, item_id, location_id, counted_qty, expected_qty, delta, movement_id, note, counted_at, counted_by)
    values (v_tenant, v_rigmat, v_yard, 116, 120, -4, v_adj, 'Quarterly count', now() - interval '1 day', demo_user);

  -- ---------------------------------------------------------------------------
  -- Fleet and drivers. Everything below is invented: the names, the VINs, the
  -- plates and the licence numbers are all fictional, and the addresses use the
  -- reserved example.com domain so nothing can ever reach a real inbox.
  --
  -- Dates are written relative to current_date, so the dashboard tells the same
  -- story whenever the demo is reset: documents already expired, others due
  -- inside 15, 30, 45 and 60 days, one unit down, and services overdue.
  -- ---------------------------------------------------------------------------

  select id into v_worker_profile
    from public.permission_profiles
   where tenant_id = v_tenant and name = 'Worker Team';

  -- Five trucks. T-105 is down, and a down unit may not hold a location.
  insert into public.equipment (
    tenant_id, unit_number, name, category, make, model, year, vin_or_serial,
    license_plate, tracking_mode, current_meter, status, is_commercial, location_id,
    created_by, notes
  ) values
    (v_tenant, 'T-101', 'Tractor 101', 'vehicle', 'Kenworth', 'T880', 2021, '1XKDD40X9MJ411001', 'DEMO101', 'mileage', 412750, 'active', true, v_yard_loc, demo_user, 'Highway tractor, tridem.'),
    (v_tenant, 'T-102', 'Tractor 102', 'vehicle', 'Peterbilt', '579', 2020, '1XPBD49X7LD411002', 'DEMO102', 'mileage', 538120, 'active', true, v_cardium_loc, demo_user, 'Highway tractor, tandem.'),
    (v_tenant, 'T-103', 'Tractor 103', 'vehicle', 'Freightliner', 'Cascadia', 2022, '3AKJHHDR4NS411003', 'DEMO103', 'mileage', 246980, 'active', true, v_pembina_loc, demo_user, 'Lease unit.'),
    (v_tenant, 'T-104', 'Tractor 104', 'vehicle', 'Western Star', '4900', 2019, '5KJJAVDR8KP411004', 'DEMO104', 'mileage', 701340, 'active', true, v_yard_loc, demo_user, 'Winter road spec.'),
    (v_tenant, 'T-105', 'Tractor 105', 'vehicle', 'Mack', 'Anthem', 2018, '1M1AN07Y8JM411005', 'DEMO105', 'mileage', 815600, 'down', true, null, demo_user, 'In the shop: air leak on the trailer supply line.');

  -- Registration, insurance and CVIP on every unit, plus two permits. The spread of
  -- expiry dates is what fills the renewal windows on the dashboard.
  insert into public.equipment_document (
    tenant_id, equipment_id, doc_type, title, issued_date, expiry_date,
    reminder_lead_days, created_by
  )
  select v_tenant, e.id, d.doc_type, d.title,
         current_date - d.issued_days, current_date + d.exp_days, 30, demo_user
    from (values
      ('T-101', 'registration', 'Cab card 2026',           340,  21),
      ('T-101', 'insurance',    'Fleet liability policy',  357,   8),
      ('T-101', 'cvip',         'CVIP inspection',         370,  -5),
      ('T-102', 'registration', 'Cab card 2026',           327,  38),
      ('T-102', 'insurance',    'Fleet liability policy',  185, 180),
      ('T-102', 'cvip',         'CVIP inspection',         338,  27),
      ('T-103', 'registration', 'Cab card 2026',           310,  55),
      ('T-103', 'insurance',    'Fleet liability policy',  353,  12),
      ('T-103', 'cvip',         'CVIP inspection',         125, 240),
      ('T-104', 'registration', 'Cab card 2026',            65, 300),
      ('T-104', 'insurance',    'Fleet liability policy',  322,  43),
      ('T-104', 'cvip',         'CVIP inspection',         307,  58),
      ('T-105', 'registration', 'Cab card 2025',           377, -12),
      ('T-105', 'insurance',    'Fleet liability policy',  275,  90),
      ('T-105', 'cvip',         'CVIP inspection',         332,  33),
      ('T-101', 'permit',       'Overweight permit',       120, 150),
      ('T-104', 'permit',       'Dangerous goods permit',  200,  70)
    ) as d(unit, doc_type, title, issued_days, exp_days)
    join public.equipment e on e.tenant_id = v_tenant and e.unit_number = d.unit;

  -- Scheduled service: two overdue by date, one overdue on the meter, two upcoming.
  insert into public.equipment_scheduled_service (
    tenant_id, equipment_id, title, service_type, interval_mode, due_date, due_meter,
    warn_meter, recurrence_unit, recurrence_value, date_lead_days, last_completed_at,
    created_by
  )
  select v_tenant, e.id, s.title, s.service_type, s.interval_mode,
         case when s.due_days is null then null else current_date + s.due_days end,
         s.due_meter, s.warn_meter, s.rec_unit, s.rec_value, s.lead_days,
         case when s.last_days is null then null else current_date - s.last_days end,
         demo_user
    from (values
      ('T-101', 'Engine oil and filter',     'oil_change',            'by_date',    -9, null::numeric, null::numeric, 'days',     120,   14,  129),
      ('T-103', 'Annual safety inspection',  'inspection',            'by_date',    -3, null,          null,          'months',    12,   30,  368),
      ('T-102', 'Engine oil and filter',     'oil_change',            'by_meter', null, 535000,        530000,        'meter',  25000, null, null),
      ('T-104', 'Brake adjustment check',    'scheduled_maintenance', 'by_date',    20, null,          null,          'days',      90,   14,   70),
      ('T-105', 'Engine oil and filter',     'oil_change',            'by_date',    46, null,          null,          'days',     120,   14,   74)
    ) as s(unit, title, service_type, interval_mode, due_days, due_meter, warn_meter,
           rec_unit, rec_value, lead_days, last_days)
    join public.equipment e on e.tenant_id = v_tenant and e.unit_number = s.unit;

  -- Seven drivers. An empty encrypted_password is the invitation path through
  -- authz.handle_new_core_pathways_user: the trigger creates nothing, so the rows
  -- written here are the only ones and no second company is ever minted.
  drop table if exists _demo_drivers;
  create temp table _demo_drivers as
  select * from (values
    ('d0000000-0000-0000-0000-000000000002'::uuid, 'Dale Kowalchuk',   'dale.kowalchuk@example.com',   'Lead Driver',      'EMP-1042', '780-555-0142', 2450, '1', 240, 'T-101'),
    ('d0000000-0000-0000-0000-000000000003'::uuid, 'Marcy Trenholm',   'marcy.trenholm@example.com',   'Driver',           'EMP-1057', '780-555-0158', 1310, '1',  45, 'T-102'),
    ('d0000000-0000-0000-0000-000000000004'::uuid, 'Wes Barsby',       'wes.barsby@example.com',       'Driver',           'EMP-1063', '780-555-0173',  905, '1',  -8, 'T-103'),
    ('d0000000-0000-0000-0000-000000000005'::uuid, 'Priya Nandal',     'priya.nandal@example.com',     'Driver',           'EMP-1071', '780-555-0191',  640, '1', 120, 'T-104'),
    ('d0000000-0000-0000-0000-000000000006'::uuid, 'Gordie Pelletier', 'gordie.pelletier@example.com', 'Yard and Swamper', 'EMP-1078', '780-555-0204',  430, '3', 200, null),
    ('d0000000-0000-0000-0000-000000000007'::uuid, 'Trish Amberly',    'trish.amberly@example.com',    'Driver',           'EMP-1084', '780-555-0217',  285, '1',  18, null),
    ('d0000000-0000-0000-0000-000000000008'::uuid, 'Nolan Fitzhugh',   'nolan.fitzhugh@example.com',   'Driver',           'EMP-1090', '780-555-0225',   96, '1', 330, 'T-105')
  ) as t(uid, full_name, email, title, emp_no, phone, hired_days, lic_class, lic_days, unit);

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    created_at, updated_at
  )
  select d.uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         d.email, '', now(),
         '{"provider":"email","providers":["email"]}'::jsonb,
         jsonb_build_object('full_name', d.full_name),
         '', '', '', '', '', '', '', '',
         now() - (d.hired_days || ' days')::interval, now()
    from _demo_drivers d;

  insert into public.users (
    id, tenant_id, email, full_name, power_level, reach_type,
    permission_profile_id, app_access, offline_sync_days, invite_accepted_at
  )
  select d.uid, v_tenant, d.email, d.full_name, 'worker', 'all_locations',
         v_worker_profile, 'app_access', 30,
         now() - (d.hired_days || ' days')::interval
    from _demo_drivers d;

  insert into public.worker_profiles (
    tenant_id, user_id, title, phone, employee_number, hired_on
  )
  select v_tenant, d.uid, d.title, d.phone, d.emp_no, current_date - d.hired_days
    from _demo_drivers d;

  insert into public.transport_driver (
    tenant_id, user_id, full_name, license_number, license_class, license_expiry,
    hired_on, status, hos_cycle, hos_regime, created_by
  )
  select v_tenant, d.uid, d.full_name,
         'AB' || lpad((410000 + row_number() over (order by d.emp_no))::text, 7, '0'),
         d.lic_class, current_date + d.lic_days, current_date - d.hired_days,
         'active', 'cycle_1', 'federal', demo_user
    from _demo_drivers d;

  -- Each driver takes the truck they are named against.
  update public.equipment e
     set assigned_to = d.uid
    from _demo_drivers d
   where e.tenant_id = v_tenant and d.unit is not null and e.unit_number = d.unit;

  -- The ticket types this fleet cares about. The four marked mandatory are the ones
  -- the ticket dashboard counts against every worker.
  insert into public.certification_types (tenant_id, name, expires, is_mandatory) values
    (v_tenant, 'H2S Alive', true, true),
    (v_tenant, 'Standard First Aid', true, true),
    (v_tenant, 'WHMIS', true, true),
    (v_tenant, 'TDG', true, true),
    (v_tenant, 'Ground Disturbance 201', true, false),
    (v_tenant, 'Defensive Driving', true, false),
    (v_tenant, 'Air Brake (Q Endorsement)', false, false),
    (v_tenant, 'Site Orientation', true, false)
  on conflict (tenant_id, name) do nothing;

  -- Tickets, deliberately uneven: two already expired, several inside the reminder
  -- window, and Gordie Pelletier missing TDG entirely so a gap is visible.
  insert into public.certifications (
    tenant_id, worker_profile_id, certification_type_id, name, issued_on, expires_on
  )
  select v_tenant, wp.id, ct.id, c.cert_name,
         current_date - c.issued_days,
         case when ct.expires then current_date + c.exp_days else null end
    from (values
      ('dale.kowalchuk@example.com',   'H2S Alive',                 730,  365),
      ('dale.kowalchuk@example.com',   'Standard First Aid',        400,  695),
      ('dale.kowalchuk@example.com',   'WHMIS',                     300,   65),
      ('dale.kowalchuk@example.com',   'TDG',                       690,   40),
      ('dale.kowalchuk@example.com',   'Ground Disturbance 201',    500,  595),
      ('marcy.trenholm@example.com',   'H2S Alive',                 800,   -6),
      ('marcy.trenholm@example.com',   'Standard First Aid',        260,  835),
      ('marcy.trenholm@example.com',   'WHMIS',                     180,  185),
      ('marcy.trenholm@example.com',   'TDG',                       350,   22),
      ('wes.barsby@example.com',       'H2S Alive',                 640,  455),
      ('wes.barsby@example.com',       'Standard First Aid',        690,  405),
      ('wes.barsby@example.com',       'WHMIS',                     420,  -31),
      ('wes.barsby@example.com',       'TDG',                       210,  155),
      ('wes.barsby@example.com',       'Defensive Driving',         150,  580),
      ('priya.nandal@example.com',     'H2S Alive',                 120, 1075),
      ('priya.nandal@example.com',     'Standard First Aid',        140,  955),
      ('priya.nandal@example.com',     'WHMIS',                     110,  255),
      ('priya.nandal@example.com',     'TDG',                       130,  600),
      ('gordie.pelletier@example.com', 'H2S Alive',                 355,   11),
      ('gordie.pelletier@example.com', 'Standard First Aid',        300,  795),
      ('gordie.pelletier@example.com', 'WHMIS',                     220,  145),
      ('trish.amberly@example.com',    'H2S Alive',                 260,  835),
      ('trish.amberly@example.com',    'Standard First Aid',        250,  845),
      ('trish.amberly@example.com',    'WHMIS',                     240,  125),
      ('trish.amberly@example.com',    'TDG',                       230,   52),
      ('nolan.fitzhugh@example.com',   'H2S Alive',                  80, 1015),
      ('nolan.fitzhugh@example.com',   'Standard First Aid',         75, 1020),
      ('nolan.fitzhugh@example.com',   'TDG',                        70,  660),
      ('nolan.fitzhugh@example.com',   'Air Brake (Q Endorsement)',  90,    0)
    ) as c(email, cert_name, issued_days, exp_days)
    join public.users u on u.tenant_id = v_tenant and u.email = c.email
    join public.worker_profiles wp on wp.user_id = u.id
    join public.certification_types ct on ct.tenant_id = v_tenant and ct.name = c.cert_name;

  -- Site orientations. Every hauler that pulls into somebody else's terminal, plant
  -- or battery gets oriented by the site owner and carries a card with an expiry.
  -- There is no fixed list of sites, so they all sit under the one Site Orientation
  -- ticket type and the specific site is the record's own name. That is the pattern
  -- to show a customer: pick the type, type where they were oriented.
  insert into public.certifications (
    tenant_id, worker_profile_id, certification_type_id, name, issued_on, expires_on
  )
  select v_tenant, wp.id, ct.id, c.site_name,
         current_date - c.issued_days, current_date + c.exp_days
    from (values
      ('dale.kowalchuk@example.com',   'Redwater Fuel Terminal site orientation',  200,  165),
      ('dale.kowalchuk@example.com',   'Pembina Gas Plant site orientation',       310,   25),
      ('marcy.trenholm@example.com',   'Redwater Fuel Terminal site orientation',  150,  215),
      ('marcy.trenholm@example.com',   'Cardium Battery 14-22 site orientation',   400,  -18),
      ('wes.barsby@example.com',       'Athabasca Lodge site orientation',          95,  270),
      ('priya.nandal@example.com',     'Redwater Fuel Terminal site orientation',   60,  305),
      ('priya.nandal@example.com',     'Leduc Cardlock site orientation',           75,  290),
      ('trish.amberly@example.com',    'Pembina Gas Plant site orientation',       340,    9),
      ('nolan.fitzhugh@example.com',   'Leduc Cardlock site orientation',           40,  325)
    ) as c(email, site_name, issued_days, exp_days)
    join public.users u on u.tenant_id = v_tenant and u.email = c.email
    join public.worker_profiles wp on wp.user_id = u.id
    join public.certification_types ct
      on ct.tenant_id = v_tenant and ct.name = 'Site Orientation';

  drop table if exists _demo_drivers;
end;
$$;

alter function "public"."reset_worksite_demo"() owner to "postgres";

-- Not an RPC. Only the scheduler (and a superuser by hand) reconciles the demo.
revoke execute on function "public"."reset_worksite_demo"() from "public", "anon", "authenticated";

-- Run it once now.
select public.reset_worksite_demo();

-- ---------------------------------------------------------------------------
-- Nightly schedule (one-time setup; safe to re-run).
--   create extension if not exists pg_cron;
--   select cron.schedule('worksite-demo-nightly-reset', '0 9 * * *',
--     $$select public.reset_worksite_demo();$$);
-- 09:00 UTC is the small hours in Alberta, so a reset never interrupts a live demo.
-- ---------------------------------------------------------------------------
