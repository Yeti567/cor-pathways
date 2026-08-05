-- Subcontractor carrier module, slice 1a: the toggle.
--
-- The ninth tenant module toggle. Ships off by default so a fresh install and every
-- fork carry the switch without carrying the clutter. Like the other toggles this is
-- product configuration, not a paywall: it decides whether the module appears in that
-- tenant's nav, nothing more.
--
-- What the module is for: a carrier that hires other carriers to cover work it cannot
-- reach itself needs their insurance, their carrier profile, and their WCB paperwork on
-- file, with expiry dates, so nothing lapses unnoticed.
--
-- What it is NOT for, and the reason the column is named for subcontractors rather than
-- for compliance: Alberta Transportation imposes no document-collection duty on a
-- carrier that hires another carrier. Its duties run to whoever holds the Safety Fitness
-- Certificate, and an independent subcontract carrier holds their own. This module is
-- the hiring company's own due diligence file, driven by its insurer, its customer
-- contracts, WCB liability, and negligent-hiring exposure. Nothing in the UI should
-- claim otherwise.

alter table "public"."tenants"
  add column if not exists "subcontractors_enabled" boolean default false not null;

comment on column "public"."tenants"."subcontractors_enabled" is
  'Subcontractor carrier module on/off. Collects hired carriers'' insurance, carrier profile, and WCB documents with expiry tracking. Due diligence, not an Alberta Transportation requirement.';
