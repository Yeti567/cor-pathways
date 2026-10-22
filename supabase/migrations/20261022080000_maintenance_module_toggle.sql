-- Maintenance module, slice 2: the toggle.
--
-- Internal maintenance work orders for the tenant's own assets are a tenant module toggle
-- like inventory and purchasing. It ships off by default, so a fresh install and every
-- fork carry the switch without carrying the clutter. Like the other toggles this is
-- product configuration, not a paywall: it decides whether the module appears for that
-- tenant, nothing more.
--
-- The inspection deficiency loop (slice 3) rides on the same switch: with it off, a
-- failed inspection item raises its corrective action exactly as it always has and
-- nothing else.
--
-- The column is additive with a default, so every existing row stays valid and no
-- backfill is required.

alter table "public"."tenants"
  add column if not exists "maintenance_enabled" boolean default false not null;

comment on column "public"."tenants"."maintenance_enabled" is
  'Maintenance module on/off. Internal work orders for the company''s own assets: tasks, labour, parts from inventory, outside costs, preventive work from scheduled service, and work orders raised by failed inspection items.';
