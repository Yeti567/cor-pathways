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
begin
  -- Tear down any prior demo. Deleting the tenant cascades every row it owns.
  select tenant_id into v_tenant from public.users where id = demo_user;
  if v_tenant is not null then
    delete from public.tenants where id = v_tenant;
  end if;
  delete from auth.users where id = demo_user;

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
     set inventory_enabled = true, document_control_enabled = true, trades_enabled = true, demo_mode = true
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
