-- ---------------------------------------------------------------------------
-- DISPOSABLE. Demo content for product screenshots only.
--
-- This exists so screenshots of the app show a working system instead of a set
-- of empty states. It is NOT part of the dev fixtures in supabase/seed.sql and
-- nothing in the app depends on it. Delete this file once the screenshots are
-- captured, or run the teardown block at the bottom.
--
--   psql "$DB_URL" -f scripts/demo-data.sql
--
-- Everything below is invented for the fictional tenant "Northwind Civil".
-- Northwind is a long-standing placeholder company name, which is the point:
-- it cannot be mistaken for a real customer. No real person, company, incident
-- or certificate appears here.
-- ---------------------------------------------------------------------------

\set tenant '''10000000-0000-0000-0000-000000000001'''
\set admin  '''00000000-0000-0000-0000-000000000102'''
\set riverside '''30000000-0000-0000-0000-000000000101'''
\set queen '''30000000-0000-0000-0000-000000000102'''

begin;

-- ---------------------------------------------------------------------------
-- 1. Names. The fixture names ("Alex Admin", "Maya Manager") read as test data
--    in a screenshot. Emails stay on .test so the accounts remain obviously
--    fictional.
-- ---------------------------------------------------------------------------
update public.users set full_name = 'Dana Fraser'     where id = :admin;
update public.users set full_name = 'Priya Nandal'    where email = 'manager@northwind.test';
update public.users set full_name = 'Curtis Beaudry'  where email = 'supervisor@northwind.test';
update public.users set full_name = 'Ryan Whitecalf'  where email = 'worker@northwind.test';
update public.users set full_name = 'Marta Oyelaran'  where email = 'superadmin@northwind.test';

insert into public.worker_profiles (tenant_id, user_id, title, employee_number, hired_on, phone)
select :tenant, u.id, v.title, v.emp, v.hired::date, v.phone
from (values
  ('superadmin@northwind.test', 'Operations Manager',   'NW-1001', '2019-04-15', '780-555-0142'),
  ('admin@northwind.test',      'Safety Coordinator',   'NW-1004', '2021-02-01', '780-555-0188'),
  ('manager@northwind.test',    'Project Manager',      'NW-1012', '2020-09-08', '780-555-0155'),
  ('supervisor@northwind.test', 'Site Supervisor',      'NW-1027', '2022-05-16', '780-555-0173'),
  ('worker@northwind.test',     'Equipment Operator',   'NW-1044', '2023-03-27', '780-555-0119')
) as v(email, title, emp, hired, phone)
join public.users u on u.email = v.email and u.tenant_id = :tenant
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Certification types and tickets. Deliberately mixed: mostly current, two
--    inside the renewal window, one expired, so the deficiency panel has
--    something real to report rather than sitting at zero.
-- ---------------------------------------------------------------------------
insert into public.certification_types (id, tenant_id, name, expires) values
  ('20000000-0000-0000-0000-0000000000c1', :tenant, 'Standard First Aid with CPR-C', true),
  ('20000000-0000-0000-0000-0000000000c2', :tenant, 'H2S Alive',                     true),
  ('20000000-0000-0000-0000-0000000000c3', :tenant, 'Ground Disturbance 201',        true),
  ('20000000-0000-0000-0000-0000000000c4', :tenant, 'WHMIS 2015',                    true),
  ('20000000-0000-0000-0000-0000000000c5', :tenant, 'Class 1 Driver Licence',        true),
  ('20000000-0000-0000-0000-0000000000c6', :tenant, 'Confined Space Entry and Monitor', true)
on conflict (id) do nothing;

insert into public.certifications (tenant_id, worker_profile_id, certification_type_id, name, issued_on, expires_on)
select :tenant, wp.id, v.type_id::uuid, v.name, (current_date + v.issued_offset), (current_date + v.expiry_offset)
from (values
  ('superadmin@northwind.test', '20000000-0000-0000-0000-0000000000c1', 'Standard First Aid with CPR-C',      -700, 395),
  ('superadmin@northwind.test', '20000000-0000-0000-0000-0000000000c2', 'H2S Alive',                          -320, 410),
  ('admin@northwind.test',      '20000000-0000-0000-0000-0000000000c1', 'Standard First Aid with CPR-C',      -540, 555),
  ('admin@northwind.test',      '20000000-0000-0000-0000-0000000000c4', 'WHMIS 2015',                         -280, 450),
  ('manager@northwind.test',    '20000000-0000-0000-0000-0000000000c3', 'Ground Disturbance 201',             -690, 40),
  ('manager@northwind.test',    '20000000-0000-0000-0000-0000000000c2', 'H2S Alive',                          -400, 330),
  ('supervisor@northwind.test', '20000000-0000-0000-0000-0000000000c6', 'Confined Space Entry and Monitor',   -350, 15),
  ('supervisor@northwind.test', '20000000-0000-0000-0000-0000000000c1', 'Standard First Aid with CPR-C',      -430, 665),
  ('worker@northwind.test',     '20000000-0000-0000-0000-0000000000c5', 'Class 1 Driver Licence',             -900, 620),
  ('worker@northwind.test',     '20000000-0000-0000-0000-0000000000c2', 'H2S Alive',                          -760, -22)
) as v(email, type_id, name, issued_offset, expiry_offset)
join public.users u on u.email = v.email and u.tenant_id = :tenant
join public.worker_profiles wp on wp.user_id = u.id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. Equipment. A small mixed fleet, one unit down for repair.
-- ---------------------------------------------------------------------------
insert into public.equipment
  (tenant_id, unit_number, name, category, make, model, year, tracking_mode, current_meter, status, location_id, is_commercial, created_by)
values
  (:tenant, '204', 'Crew Cab',           'vehicle',          'Ford',      'F-350',      2022, 'mileage', 118420, 'active', :riverside, true,  :admin),
  (:tenant, '211', 'Crew Cab',           'vehicle',          'RAM',       '2500',       2021, 'mileage', 164905, 'active', :queen,     true,  :admin),
  (:tenant, '318', 'Excavator',          'mobile_equipment', 'John Deere','130G',       2020, 'hours',     4870, 'active', :riverside, false, :admin),
  (:tenant, '322', 'Skid Steer',         'mobile_equipment', 'Bobcat',    'S650',       2019, 'hours',     6115, 'down',   null,       false, :admin),
  (:tenant, '405', 'Tandem Dump',        'vehicle',          'Kenworth',  'T880',       2023, 'mileage',  71230, 'active', :queen,     true,  :admin),
  (:tenant, '512', 'Light Tower',        'light_tower',      'Generac',   'MLT6',       2021, 'hours',     2240, 'active', :riverside, false, :admin)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 4. Submissions. Six weeks of ordinary paperwork spread across the crew, the
--    two locations and all six starter forms, weighted the way real usage is:
--    lots of pre-trips, fewer incidents.
-- ---------------------------------------------------------------------------
insert into public.submissions
  (tenant_id, form_id, location_id, submitted_by, status, sync_state, submitted_at, created_at)
select
  :tenant,
  f.id,
  case when (g % 2) = 0 then :riverside::uuid else :queen::uuid end,
  u.id,
  'completed',
  'synced',
  now() - ((g || ' days')::interval) - ((g % 7 || ' hours')::interval),
  now() - ((g || ' days')::interval) - ((g % 7 || ' hours')::interval)
from generate_series(0, 41) as g
cross join lateral (
  select id from public.forms
  where tenant_id = :tenant
    and code = case
      when g % 10 in (0,1,2,3,4) then 'PRE-TRIP'
      when g % 10 in (5,6)       then 'JHA'
      when g % 10 = 7            then 'EQ-CHECK'
      when g % 10 = 8            then 'TBT'
      when g % 10 = 9 and g < 20 then 'INC-RPT'
      else 'OFFICE-INSP'
    end
  limit 1
) f
cross join lateral (
  select id from public.users
  where tenant_id = :tenant and email <> 'consultant@corpathways.test'
  order by md5(g::text || email) limit 1
) u;

-- ---------------------------------------------------------------------------
-- 5. Corrective actions. The mix that matters for a COR audit: most closed out,
--    a couple still open, one overdue. A screenshot of all-green is not
--    credible and does not show the tracking working.
-- ---------------------------------------------------------------------------
insert into public.follow_ups
  (tenant_id, title, description, status, assigned_to, due_at, completed_at, created_at)
select :tenant, v.title, v.descr, v.status,
       (select id from public.users where tenant_id = :tenant and email = v.email),
       now() + ((v.due_days || ' days')::interval),
       case when v.status = 'completed' then now() - ((v.age_days - 2 || ' days')::interval) else null end,
       now() - ((v.age_days || ' days')::interval)
from (values
  ('Replace cracked mirror on unit 211',        'Passenger side convex mirror cracked, noted on pre-trip. Unit stays in yard until replaced.', 'completed', 'supervisor@northwind.test', -18, 24),
  ('Housekeeping at Riverside laydown',         'Offcuts and banding accumulating by the pipe rack. Assign daily cleanup to the crew lead.',   'completed', 'manager@northwind.test',    -12, 19),
  ('Restock eyewash station, Queen Street',     'Station bottles past their date. Replace and add to the monthly inspection checklist.',       'completed', 'admin@northwind.test',      -9,  14),
  ('Toolbox talk on trenching after near miss', 'Cover spoil pile setback and ladder placement with the whole crew before the next dig.',      'completed', 'supervisor@northwind.test', -6,  11),
  ('Repair hydraulic leak on unit 322',         'Skid steer down with a leak at the left lift cylinder. Parts on order, unit tagged out.',     'open',      'manager@northwind.test',    4,   7),
  ('Renew expired H2S Alive for one operator',  'Ticket lapsed. Operator off any sour site until the renewal is on file.',                     'open',      'admin@northwind.test',      -3,  5),
  ('Add wheel chocks to both crew cabs',        'Chocks missing from the pre-trip kit in units 204 and 211.',                                  'open',      'supervisor@northwind.test', 9,   2)
) as v(title, descr, status, email, due_days, age_days);

commit;

-- ---------------------------------------------------------------------------
-- Teardown. Run this to put the demo tenant back to bare fixtures.
-- ---------------------------------------------------------------------------
-- begin;
-- delete from public.follow_ups   where tenant_id = '10000000-0000-0000-0000-000000000001';
-- delete from public.submissions  where tenant_id = '10000000-0000-0000-0000-000000000001';
-- delete from public.equipment    where tenant_id = '10000000-0000-0000-0000-000000000001';
-- delete from public.certifications where tenant_id = '10000000-0000-0000-0000-000000000001';
-- delete from public.certification_types where tenant_id = '10000000-0000-0000-0000-000000000001';
-- delete from public.worker_profiles where tenant_id = '10000000-0000-0000-0000-000000000001';
-- commit;
