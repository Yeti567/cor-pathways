-- Point the ELD integration at the contracted fleet as well as the company's own.
--
-- WHY. The ELD tables were built assuming the units carrying the telematics devices are
-- rows in public.equipment and the drivers are rows in public.transport_driver. For this
-- client neither is true, and the fleet data says so plainly: public.equipment holds 160
-- units and every single one is a trailer, while the contractor sheet carries 73 tractors
-- across 32 carriers and not one of them belongs to this company. They own the trailers;
-- their contractors provide every power unit and every driver. A trailer carries no ELD,
-- so a Samsara sync against public.equipment could never match anything, and its drivers
-- had nowhere to land at all.
--
-- ONE ACCOUNT, MANY OWNERS. The telematics account is the hiring company's: they own the
-- devices and pay the subscription, and the carriers simply run them in their trucks. So
-- there is one connection, one fleet list, and every truck in it belongs to one of about
-- thirty different companies with nothing in the provider's data saying which. That is
-- why a link's target is per-record rather than per-connection, and why the import screen
-- refuses to guess: who owns a truck is recorded on the carrier's own expiry sheet and
-- nowhere else, so the units are created from there and the provider matches to them by
-- VIN, plate or unit number.
--
-- WHY BOTH TARGETS RATHER THAN A SWAP. A company that runs its own tractors alongside
-- hired ones is the normal case elsewhere, and this client could buy one tomorrow. So a
-- link points at exactly one of the two, and which one is a property of the link rather
-- than of the deployment. The check constraints below are what make "exactly one" a rule
-- the database enforces instead of a convention the next connector forgets.
--
-- SAFE TO APPLY. Every one of these tables is empty, and transport_driver is empty too,
-- so nothing is being migrated and no existing link changes meaning. Making the old
-- columns nullable is the only alteration to something that already existed, and a
-- nullable column accepts everything the not-null one did.

-- 1. Vehicle side.

alter table "public"."eld_vehicle_link"
  add column if not exists "contracted_equipment_id" uuid;
alter table "public"."eld_vehicle_link" alter column "equipment_id" drop not null;

alter table "public"."eld_device"
  add column if not exists "contracted_equipment_id" uuid;
alter table "public"."eld_device" alter column "equipment_id" drop not null;

alter table "public"."eld_vehicle_event"
  add column if not exists "contracted_equipment_id" uuid;
alter table "public"."eld_vehicle_event" alter column "equipment_id" drop not null;

alter table only "public"."eld_vehicle_link"
  add constraint "eld_vehicle_link_contracted_equipment_id_fkey"
  foreign key ("contracted_equipment_id") references "public"."contracted_equipment"("id") on delete cascade;

alter table only "public"."eld_device"
  add constraint "eld_device_contracted_equipment_id_fkey"
  foreign key ("contracted_equipment_id") references "public"."contracted_equipment"("id") on delete cascade;

alter table only "public"."eld_vehicle_event"
  add constraint "eld_vehicle_event_contracted_equipment_id_fkey"
  foreign key ("contracted_equipment_id") references "public"."contracted_equipment"("id") on delete cascade;

-- 2. Driver side.

alter table "public"."eld_driver_link"
  add column if not exists "contracted_driver_id" uuid;
alter table "public"."eld_driver_link" alter column "driver_id" drop not null;

alter table "public"."eld_driver_profile"
  add column if not exists "contracted_driver_id" uuid;
alter table "public"."eld_driver_profile" alter column "driver_id" drop not null;

alter table "public"."eld_driver_event"
  add column if not exists "contracted_driver_id" uuid;
alter table "public"."eld_driver_event"
  add column if not exists "contracted_equipment_id" uuid;
alter table "public"."eld_driver_event" alter column "driver_id" drop not null;

alter table "public"."transport_duty_status_event"
  add column if not exists "contracted_driver_id" uuid;
alter table "public"."transport_duty_status_event" alter column "driver_id" drop not null;

alter table only "public"."eld_driver_link"
  add constraint "eld_driver_link_contracted_driver_id_fkey"
  foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete cascade;

alter table only "public"."eld_driver_profile"
  add constraint "eld_driver_profile_contracted_driver_id_fkey"
  foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete cascade;

alter table only "public"."eld_driver_event"
  add constraint "eld_driver_event_contracted_driver_id_fkey"
  foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete cascade;

alter table only "public"."eld_driver_event"
  add constraint "eld_driver_event_contracted_equipment_id_fkey"
  foreign key ("contracted_equipment_id") references "public"."contracted_equipment"("id") on delete set null;

alter table only "public"."transport_duty_status_event"
  add constraint "transport_duty_status_event_contracted_driver_id_fkey"
  foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete cascade;

-- 3. Exactly one target.
--
-- Without these, a row with neither target is an orphan nothing will ever render, and a
-- row with both is a telematics record claiming to be two different trucks. Both are the
-- kind of thing that gets written once by a connector bug and then quietly reported as
-- fact for a year.

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('eld_vehicle_link',            'equipment_id', 'contracted_equipment_id'),
      ('eld_device',                  'equipment_id', 'contracted_equipment_id'),
      ('eld_vehicle_event',           'equipment_id', 'contracted_equipment_id'),
      ('eld_driver_link',             'driver_id',    'contracted_driver_id'),
      ('eld_driver_profile',          'driver_id',    'contracted_driver_id'),
      ('eld_driver_event',            'driver_id',    'contracted_driver_id'),
      ('transport_duty_status_event', 'driver_id',    'contracted_driver_id')
    ) as t(tbl, own_col, contracted_col)
  loop
    if not exists (
      select 1 from pg_constraint where conname = r.tbl || '_one_target_check'
    ) then
      execute format(
        'alter table public.%I add constraint %I check ((%I is not null) <> (%I is not null))',
        r.tbl, r.tbl || '_one_target_check', r.own_col, r.contracted_col
      );
    end if;
  end loop;
end
$$;

-- The vehicle on a driver event is optional (a duty status change is not always in a
-- truck), so this one is "at most one" rather than "exactly one".
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'eld_driver_event_one_vehicle_target_check'
  ) then
    alter table "public"."eld_driver_event"
      add constraint "eld_driver_event_one_vehicle_target_check"
      check (not ("equipment_id" is not null and "contracted_equipment_id" is not null));
  end if;
end
$$;

-- 4. Uniqueness and lookup indexes for the new targets.
--
-- eld_driver_profile carried a unique on (tenant_id, provider, driver_id). A contracted
-- driver needs the same guarantee or a provider could file two profiles for one person.

create unique index if not exists "eld_driver_profile_tenant_provider_contracted_driver_key"
  on "public"."eld_driver_profile" ("tenant_id", "provider", "contracted_driver_id")
  where "contracted_driver_id" is not null;

create index if not exists "eld_vehicle_link_contracted_equipment_idx"
  on "public"."eld_vehicle_link" ("contracted_equipment_id")
  where "contracted_equipment_id" is not null;

create index if not exists "eld_device_contracted_equipment_idx"
  on "public"."eld_device" ("contracted_equipment_id")
  where "contracted_equipment_id" is not null;

create index if not exists "eld_vehicle_event_contracted_equipment_idx"
  on "public"."eld_vehicle_event" ("contracted_equipment_id")
  where "contracted_equipment_id" is not null;

create index if not exists "eld_driver_link_contracted_driver_idx"
  on "public"."eld_driver_link" ("contracted_driver_id")
  where "contracted_driver_id" is not null;

create index if not exists "eld_driver_event_contracted_driver_idx"
  on "public"."eld_driver_event" ("contracted_driver_id", "occurred_at")
  where "contracted_driver_id" is not null;

create index if not exists "transport_duty_status_event_contracted_driver_idx"
  on "public"."transport_duty_status_event" ("contracted_driver_id", "started_at")
  where "contracted_driver_id" is not null;

comment on column "public"."eld_vehicle_link"."contracted_equipment_id" is
  'The contracted unit this provider vehicle maps to. Exactly one of equipment_id and this is set: a telematics device is in one truck, and that truck is either this company''s or a hired carrier''s.';

comment on column "public"."eld_driver_link"."contracted_driver_id" is
  'The contracted driver this provider driver maps to. Exactly one of driver_id and this is set.';

-- 5. Driver safety scorecards.
--
-- Same dual target for the same reason: the drivers a provider scores are the ones
-- carrying its devices, and here those belong to the hired carriers.

alter table "public"."eld_driver_performance" add column if not exists "contracted_driver_id" uuid;
alter table "public"."eld_driver_performance" alter column "driver_id" drop not null;

alter table only "public"."eld_driver_performance"
  add constraint "eld_driver_performance_contracted_driver_id_fkey"
  foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'eld_driver_performance_one_target_check') then
    alter table "public"."eld_driver_performance"
      add constraint "eld_driver_performance_one_target_check"
      check (("driver_id" is not null) <> ("contracted_driver_id" is not null));
  end if;
end
$$;

create unique index if not exists "eld_driver_performance_tenant_provider_contracted_driver_key"
  on "public"."eld_driver_performance" ("tenant_id", "provider", "contracted_driver_id")
  where "contracted_driver_id" is not null;

-- NOT given a contracted target, deliberately: equipment_meter_log. An odometer reading
-- belongs to a unit this company services, and a contracted unit has no meter history,
-- no scheduled service and no maintenance log here. The odometer sync therefore advances
-- own-fleet units only and reports contracted ones as skipped rather than inventing a
-- place to put them.
