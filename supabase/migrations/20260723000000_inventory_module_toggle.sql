-- Inventory module, slice 1: the toggle and the location kind.
--
-- Inventory is the eighth tenant module toggle. It ships off by default so a fresh
-- install and every fork carry the switch without carrying the clutter. Like the other
-- toggles this is product configuration, not a paywall: it decides whether the module
-- appears in that tenant's nav, nothing more.
--
-- No inventory tables yet. This migration only establishes the switch and gives
-- locations the kind they need before they can hold stock. Both columns are additive
-- with defaults, so every existing row stays valid and no backfill is required.

alter table "public"."tenants"
  add column if not exists "inventory_enabled" boolean default false not null;

comment on column "public"."tenants"."inventory_enabled" is
  'Inventory tracking module on/off. Counts and locates anything the company stocks: rental units, tools, PPE, consumables, parts.';

-- Locations become stocking places, not just worker-visibility groupings.
--
-- 'yard' is the default so every existing location keeps working untouched. The two
-- virtual kinds are the ones that make the ledger honest: 'transit' holds a load that
-- has left but not arrived, so stock in flight is visible instead of missing, and
-- 'loss' absorbs damage, shrinkage, and count corrections, so a balance is never
-- silently rewritten. Virtual locations are the only ones allowed to go negative, a
-- constraint that arrives with the balances table in a later slice.
alter table "public"."locations"
  add column if not exists "location_kind" text default 'yard' not null;

alter table "public"."locations"
  drop constraint if exists "locations_location_kind_check";

alter table "public"."locations"
  add constraint "locations_location_kind_check" check (
    "location_kind" = any (array[
      'yard'::text,
      'customer_site'::text,
      'transit'::text,
      'loss'::text,
      'vendor'::text,
      'worker'::text,
      'vehicle'::text,
      'job'::text
    ])
  );

comment on column "public"."locations"."location_kind" is
  'What sort of place this is for inventory purposes. Physical: yard, customer_site, vendor, worker, vehicle, job. Virtual: transit (in flight), loss (damage, shrinkage, count adjustments).';

-- Every on-hand and transfer screen filters by tenant and kind, so index the pair.
create index if not exists "locations_tenant_id_location_kind_idx"
  on "public"."locations" ("tenant_id", "location_kind");
