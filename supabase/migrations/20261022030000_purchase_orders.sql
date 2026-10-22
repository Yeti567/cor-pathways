-- Purchasing module: the purchase order and its lines.
--
-- One record is both the request and the order. It moves through statuses rather than
-- being copied from a requisition into a separate order, so there is never a second
-- object to keep in step. The status rules live in src/lib/purchasing.ts; the database
-- holds the shape and the invariants that must never be broken whoever writes the row.
--
-- Finance is out of scope on purpose. Tax is a stored amount the user enters, account
-- codes are text kept for the export, and nothing here posts to a ledger or a payable.

create table if not exists "public"."purchase_order" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,

  -- Assigned per tenant by trigger, shown as PO-000123.
  "number" integer not null,
  "title" text not null,
  "status" text default 'draft'::text not null,
  "requester_id" uuid,

  -- The department or yard the order is for. Approval rules can be scoped to it.
  "location_id" uuid,
  "supplier_id" uuid,
  "account_code" text,

  -- The maintenance work order this purchase is for. Wired in a later slice; until then
  -- it stays null and carries no foreign key, because the table it will point at does
  -- not exist yet.
  "work_order_id" uuid,

  "needed_by" date,

  -- Where received stock goes by default: a stocking place from the inventory module.
  "ship_to_location_id" uuid,
  "notes" text,

  -- Placed before approval because it could not wait. Approval still follows, and the
  -- trail says which way round it happened.
  "emergency" boolean default false not null,

  "discount" numeric(14,2) default 0 not null,
  "shipping" numeric(14,2) default 0 not null,
  "tax" numeric(14,2) default 0 not null,
  "subtotal" numeric(14,2) default 0 not null,
  "total" numeric(14,2) default 0 not null,

  -- One timestamp per status change, so a report can ask "approved in March" without
  -- reading the trail.
  "submitted_at" timestamp with time zone,
  "approved_at" timestamp with time zone,
  "rejected_at" timestamp with time zone,
  "ordered_at" timestamp with time zone,
  "received_at" timestamp with time zone,
  "closed_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "exported_at" timestamp with time zone,

  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "purchase_order_status_check" check (
    "status" = any (array[
      'draft'::text,
      'pending_approval'::text,
      'rejected'::text,
      'approved'::text,
      'ordered'::text,
      'partially_received'::text,
      'received'::text,
      'closed'::text,
      'cancelled'::text
    ])
  ),

  constraint "purchase_order_amounts_check" check (
    "discount" >= 0 and "shipping" >= 0 and "tax" >= 0 and "subtotal" >= 0 and "total" >= 0
  ),

  -- The total is arithmetic, not an opinion. Holding it here means a report summing
  -- totals can never disagree with one summing the parts.
  constraint "purchase_order_total_check" check (
    "total" = "subtotal" - "discount" + "shipping" + "tax"
  ),

  constraint "purchase_order_number_check" check ("number" > 0)
);

alter table "public"."purchase_order" owner to "postgres";

comment on table "public"."purchase_order" is
  'A purchase request that becomes an order as it moves through its statuses: draft, pending approval, rejected, approved, ordered, partially received, received, closed, cancelled.';

comment on column "public"."purchase_order"."work_order_id" is
  'Reserved for the maintenance work order this purchase serves. Unused until work orders exist.';

comment on column "public"."purchase_order"."exported_at" is
  'When the order was last included in a finance CSV export. The export never posts anything; the finance system does that.';

create table if not exists "public"."purchase_order_line" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "purchase_order_id" uuid not null,
  "line_number" integer default 1 not null,

  -- stock: an inventory item, received into a stocking place through the ledger.
  -- non_stock: anything else, described in words.
  -- work_order_part: reserved for parts pulled from a work order in a later slice.
  "kind" text default 'non_stock'::text not null,
  "item_id" uuid,
  "description" text not null,
  "unit" text default 'each'::text not null,
  "qty_ordered" numeric(14,3) not null,
  "qty_received" numeric(14,3) default 0 not null,
  "unit_cost" numeric(14,4) default 0 not null,
  "line_total" numeric(14,2) default 0 not null,

  -- Overrides the order's account code for this line in the export.
  "account_code" text,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "purchase_order_line_kind_check" check (
    "kind" = any (array['stock'::text, 'non_stock'::text, 'work_order_part'::text])
  ),

  constraint "purchase_order_line_stock_item_check" check ("kind" <> 'stock'::text or "item_id" is not null),

  constraint "purchase_order_line_qty_check" check ("qty_ordered" > 0),

  -- Over-receipt is refused on the line. Extra stock that turned up goes on a line of its
  -- own, so the order still says what was asked for.
  constraint "purchase_order_line_received_check" check ("qty_received" >= 0 and "qty_received" <= "qty_ordered"),

  constraint "purchase_order_line_cost_check" check ("unit_cost" >= 0 and "line_total" >= 0)
);

alter table "public"."purchase_order_line" owner to "postgres";

comment on table "public"."purchase_order_line" is
  'One line of a purchase order: a stock item or a described purchase, how many were ordered and received, and the cost.';

alter table only "public"."purchase_order"
  add constraint "purchase_order_pkey" primary key ("id");

alter table only "public"."purchase_order_line"
  add constraint "purchase_order_line_pkey" primary key ("id");

alter table only "public"."purchase_order"
  add constraint "purchase_order_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."purchase_order"
  add constraint "purchase_order_requester_id_fkey" foreign key ("requester_id") references "public"."users"("id") on delete set null;

alter table only "public"."purchase_order"
  add constraint "purchase_order_location_id_fkey" foreign key ("location_id") references "public"."locations"("id") on delete set null;

-- Restrict: a supplier named on an order is archived, never deleted out from under it.
alter table only "public"."purchase_order"
  add constraint "purchase_order_supplier_id_fkey" foreign key ("supplier_id") references "public"."supplier"("id") on delete restrict;

alter table only "public"."purchase_order"
  add constraint "purchase_order_ship_to_location_id_fkey" foreign key ("ship_to_location_id") references "public"."inventory_location"("id") on delete set null;

alter table only "public"."purchase_order"
  add constraint "purchase_order_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."purchase_order_line"
  add constraint "purchase_order_line_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."purchase_order_line"
  add constraint "purchase_order_line_purchase_order_id_fkey" foreign key ("purchase_order_id") references "public"."purchase_order"("id") on delete cascade;

alter table only "public"."purchase_order_line"
  add constraint "purchase_order_line_item_id_fkey" foreign key ("item_id") references "public"."inventory_item"("id") on delete restrict;

create unique index if not exists "purchase_order_tenant_number_key"
  on "public"."purchase_order" ("tenant_id", "number");

create index if not exists "purchase_order_tenant_status_idx"
  on "public"."purchase_order" ("tenant_id", "status", "created_at" desc);

create index if not exists "purchase_order_tenant_supplier_idx"
  on "public"."purchase_order" ("tenant_id", "supplier_id");

create index if not exists "purchase_order_tenant_ordered_idx"
  on "public"."purchase_order" ("tenant_id", "ordered_at");

create index if not exists "purchase_order_line_order_idx"
  on "public"."purchase_order_line" ("purchase_order_id", "line_number");

-- The next order number for a tenant.
--
-- An advisory lock keyed to the tenant serializes two orders created at the same moment,
-- so they cannot both read the same maximum and collide on the unique index. The lock is
-- held for the transaction only. Security invoker: the caller can already see every order
-- in their own tenant, which is all the maximum needs.
create or replace function "public"."assign_purchase_order_number"() returns "trigger"
    language "plpgsql" security invoker
    set "search_path" to 'public', 'pg_temp'
    as $$
begin
  if new.number is null then
    perform pg_advisory_xact_lock(hashtextextended('purchase_order_number:' || new.tenant_id::text, 0));

    select coalesce(max(po.number), 0) + 1
      into new.number
      from public.purchase_order po
     where po.tenant_id = new.tenant_id;
  end if;

  return new;
end;
$$;

alter function "public"."assign_purchase_order_number"() owner to "postgres";

-- A trigger function has no business on the public API. Revoking EXECUTE does not stop
-- the trigger, which runs whoever holds the privilege.
revoke execute on function "public"."assign_purchase_order_number"() from "public", "anon", "authenticated";

create or replace trigger "purchase_order_assign_number"
  before insert on "public"."purchase_order"
  for each row execute function "public"."assign_purchase_order_number"();

create or replace trigger "purchase_order_set_updated_at"
  before update on "public"."purchase_order"
  for each row execute function "public"."set_updated_at"();

create or replace trigger "purchase_order_line_set_updated_at"
  before update on "public"."purchase_order_line"
  for each row execute function "public"."set_updated_at"();

alter table "public"."purchase_order" enable row level security;
alter table "public"."purchase_order_line" enable row level security;

create policy "purchase_order_tenant_select" on "public"."purchase_order"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_order_tenant_insert" on "public"."purchase_order"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_order_tenant_update" on "public"."purchase_order"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_order_tenant_delete" on "public"."purchase_order"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_order_line_tenant_select" on "public"."purchase_order_line"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_order_line_tenant_insert" on "public"."purchase_order_line"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_order_line_tenant_update" on "public"."purchase_order_line"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "purchase_order_line_tenant_delete" on "public"."purchase_order_line"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

grant select, insert, update, delete on table "public"."purchase_order" to "authenticated";
grant select, insert, update, delete on table "public"."purchase_order" to "service_role";
grant select, insert, update, delete on table "public"."purchase_order_line" to "authenticated";
grant select, insert, update, delete on table "public"."purchase_order_line" to "service_role";
