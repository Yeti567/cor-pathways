-- Inventory module, slice 9: reorder points and low-stock alerts.
--
-- One nullable number on an item: the level at or below which someone should be told to
-- reorder before it runs out. Null means "do not watch this", which is the sensible
-- default for rental units and one-off tools; it earns its keep on PPE, filters, oil, and
-- fittings, the things whose absence stops a job.
--
-- The alert itself needs no schema. It is derived: on-hand across the real places is
-- summed from inventory_balance and compared to this number, and a notification is posted
-- through the same machinery equipment service reminders already use. Nothing here stores
-- an alert state, so nothing here can drift out of step with the ledger.

alter table "public"."inventory_item"
  add column if not exists "reorder_point" numeric(14,3);

alter table "public"."inventory_item"
  add constraint "inventory_item_reorder_point_check"
  check ("reorder_point" is null or "reorder_point" >= 0);

comment on column "public"."inventory_item"."reorder_point" is
  'Low-stock threshold in stock units. When on-hand across real places is at or below this, a reorder notification is raised. Null means the item is not watched.';
