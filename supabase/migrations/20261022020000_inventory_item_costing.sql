-- Purchasing module: what an inventory item costs, and how many to buy at a time.
--
-- unit_cost is the last received cost, written by receiving a purchase order line. It
-- is a convenience for pricing the next order, not a valuation: the ledger stays a
-- record of quantities. reorder_qty is how many to order when the item is reordered,
-- the companion of the reorder point that already says when.

alter table "public"."inventory_item"
  add column if not exists "unit_cost" numeric(14,4);

alter table "public"."inventory_item"
  add column if not exists "reorder_qty" numeric(14,3);

alter table "public"."inventory_item"
  drop constraint if exists "inventory_item_unit_cost_check";

alter table "public"."inventory_item"
  add constraint "inventory_item_unit_cost_check"
  check ("unit_cost" is null or "unit_cost" >= 0);

alter table "public"."inventory_item"
  drop constraint if exists "inventory_item_reorder_qty_check";

alter table "public"."inventory_item"
  add constraint "inventory_item_reorder_qty_check"
  check ("reorder_qty" is null or "reorder_qty" > 0);

comment on column "public"."inventory_item"."unit_cost" is
  'Last received cost per unit, set when a purchase order line for this item is received. Null until the first receipt.';

comment on column "public"."inventory_item"."reorder_qty" is
  'How many to order at a time. Used as the starting quantity when the item is put on a purchase order.';
