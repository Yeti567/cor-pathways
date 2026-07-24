-- Inventory module, slice 6: transfers, the two-leg move through transit.
--
-- A transfer is a load: a truck takes stock from one place to another. It happens in two
-- legs so that stock in flight is never invisible. Departing posts each line from the
-- origin into the virtual transit place; arriving posts it from transit to the
-- destination. Between the two, the stock sits in transit and is plainly on the books.
--
-- The header below records the load (which truck, which driver, where from, where to, and
-- when). It does NOT record the manifest a second time: what was loaded and what was
-- delivered are read straight from the movements this transfer posted, tagged by
-- transfer_id, so the ledger stays the one source of truth. A leg mismatch (loaded 60,
-- delivered 58) simply leaves a residual sitting in transit, which is the drift detector,
-- not a bug to paper over.

create table if not exists "public"."inventory_transfer" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,

  -- The truck doing the hauling, and the driver. Metadata about the load, not stocking
  -- places: the origin and destination below are where the stock actually moves.
  "vehicle_id" uuid,
  "driver_id" uuid,

  "from_location_id" uuid not null,
  "to_location_id" uuid not null,

  "status" text default 'in_transit' not null,
  "departed_at" timestamp with time zone default "now"() not null,
  "arrived_at" timestamp with time zone,
  "note" text,
  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "inventory_transfer_status_check"
    check ("status" = any (array['in_transit'::text, 'arrived'::text, 'cancelled'::text])),

  -- A load goes somewhere else, not in a circle.
  constraint "inventory_transfer_endpoints_check" check ("from_location_id" <> "to_location_id"),

  -- arrived_at is set only once the load has arrived or been stood down, and an arrived
  -- load must carry the time it arrived.
  constraint "inventory_transfer_arrived_at_check"
    check (("arrived_at" is null) or ("status" = any (array['arrived'::text, 'cancelled'::text]))),
  constraint "inventory_transfer_arrived_status_check"
    check (("status" <> 'arrived'::text) or ("arrived_at" is not null))
);

alter table "public"."inventory_transfer" owner to "postgres";

comment on table "public"."inventory_transfer" is
  'A load moving stock between two places in two legs through transit. The header records the truck, driver, origin, destination, and timing; what was loaded and delivered is read from the movements it posted (tagged by transfer_id), never stored twice.';

alter table only "public"."inventory_transfer"
  add constraint "inventory_transfer_pkey" primary key ("id");

alter table only "public"."inventory_transfer"
  add constraint "inventory_transfer_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."inventory_transfer"
  add constraint "inventory_transfer_vehicle_id_fkey" foreign key ("vehicle_id") references "public"."equipment"("id") on delete set null;

alter table only "public"."inventory_transfer"
  add constraint "inventory_transfer_driver_id_fkey" foreign key ("driver_id") references "public"."users"("id") on delete set null;

-- Restrict, like the ledger: a place that has carried a load keeps its history.
alter table only "public"."inventory_transfer"
  add constraint "inventory_transfer_from_location_id_fkey" foreign key ("from_location_id") references "public"."inventory_location"("id") on delete restrict;

alter table only "public"."inventory_transfer"
  add constraint "inventory_transfer_to_location_id_fkey" foreign key ("to_location_id") references "public"."inventory_location"("id") on delete restrict;

alter table only "public"."inventory_transfer"
  add constraint "inventory_transfer_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

create index if not exists "inventory_transfer_tenant_status_idx"
  on "public"."inventory_transfer" ("tenant_id", "status", "departed_at" desc);

create or replace trigger "inventory_transfer_set_updated_at"
  before update on "public"."inventory_transfer"
  for each row execute function "public"."set_updated_at"();

-- Tie the ledger to the transfer that caused each movement. Nullable, because most
-- movements (receipts, write-offs, adjustments) belong to no transfer. Restrict on
-- delete, so a transfer that has posted movements cannot be removed out from under its
-- own history; a load is stood down by cancelling it, which posts reversing movements.
alter table "public"."inventory_movement"
  add column if not exists "transfer_id" uuid;

alter table "public"."inventory_movement"
  drop constraint if exists "inventory_movement_transfer_id_fkey";

alter table "public"."inventory_movement"
  add constraint "inventory_movement_transfer_id_fkey" foreign key ("transfer_id") references "public"."inventory_transfer"("id") on delete restrict;

create index if not exists "inventory_movement_transfer_idx"
  on "public"."inventory_movement" ("transfer_id") where "transfer_id" is not null;

comment on column "public"."inventory_movement"."transfer_id" is
  'The transfer this movement belongs to, if any. Departure legs post from the origin to transit; arrival legs post from transit to the destination. Both carry the same transfer_id.';

-- Row level security. Tenant members plus an allowed consultant. No delete for end users:
-- a departed load is voided by cancelling it, not deleted.
alter table "public"."inventory_transfer" enable row level security;

create policy "inventory_transfer_tenant_select" on "public"."inventory_transfer"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_transfer_tenant_insert" on "public"."inventory_transfer"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_transfer_tenant_update" on "public"."inventory_transfer"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

grant select, insert, update on table "public"."inventory_transfer" to "authenticated";
revoke delete on table "public"."inventory_transfer" from "authenticated";
grant select, insert, update, delete on table "public"."inventory_transfer" to "service_role";
