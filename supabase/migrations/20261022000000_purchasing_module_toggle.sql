-- Purchasing module, slice 1: the toggle.
--
-- Purchasing is a tenant module toggle like inventory. It ships off by default, so a
-- fresh install and every fork carry the switch without carrying the clutter. Like the
-- other toggles this is product configuration, not a paywall: it decides whether the
-- module appears in that tenant's nav, nothing more.
--
-- The column is additive with a default, so every existing row stays valid and no
-- backfill is required.

alter table "public"."tenants"
  add column if not exists "purchasing_enabled" boolean default false not null;

comment on column "public"."tenants"."purchasing_enabled" is
  'Purchasing module on/off. Suppliers, purchase requests and orders, approval rules, receiving into inventory, and a CSV export for the finance system.';
