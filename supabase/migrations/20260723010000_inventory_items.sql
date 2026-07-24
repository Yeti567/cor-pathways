-- Inventory module, slice 2: what you stock.
--
-- Two tables, no movement yet. An item describes a thing the company keeps track of,
-- and a category groups items for filtering. Quantities arrive with the ledger in a
-- later slice, which is why nothing here records an amount: an item is a definition,
-- not a count. Counts belong to a location.
--
-- The three flags on an item replace a rigid type hierarchy. Anything a company stocks
-- is described by how it is counted, whether it comes back, and whether time on it is
-- billable:
--
--   rig mat           bulk   returnable      billable
--   rented generator  serial returnable      billable
--   hand tool         bulk   returnable      not billable
--   PPE, filters, oil bulk   not returnable  not billable
--
-- That covers the cases without special-casing any of them.

create table if not exists "public"."inventory_category" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "name" text not null,
  "sort_order" integer default 0 not null,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null
);

alter table "public"."inventory_category" owner to "postgres";

comment on table "public"."inventory_category" is
  'Groups inventory items for filtering (Mats, Tools, PPE, Parts, Consumables). Deliberately flat: a tree is a later problem if it ever becomes one.';

create table if not exists "public"."inventory_item" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "category_id" uuid,
  "name" text not null,
  "sku" text,
  "tracking_mode" text default 'bulk'::text not null,
  "unit_of_measure" text default 'each'::text not null,
  "returnable" boolean default true not null,
  "billable" boolean default false not null,
  "default_rate" numeric(12,2),
  "rate_basis" text,
  "equipment_id" uuid,
  "notes" text,
  "active" boolean default true not null,
  "created_by" uuid,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  -- Bulk items are counted; serial items are identified one by one. Mutually exclusive,
  -- and fixed per item rather than per movement, so the ledger never has to ask.
  constraint "inventory_item_tracking_mode_check"
    check ("tracking_mode" = any (array['bulk'::text, 'serial'::text])),

  -- A rate only means something alongside the period it is charged for, and neither
  -- means anything on an item that is not billed. Keeping the three in step here stops
  -- a half-configured item reaching the billing slice and quietly charging nothing.
  constraint "inventory_item_rate_basis_check"
    check ("rate_basis" is null or "rate_basis" = any (array['day'::text, 'week'::text, 'month'::text, 'each'::text])),
  constraint "inventory_item_default_rate_check"
    check ("default_rate" is null or "default_rate" >= 0),
  constraint "inventory_item_billable_rate_check"
    check ("billable" or ("default_rate" is null and "rate_basis" is null)),

  -- Only an individually identified unit can point at an equipment record. A rented
  -- generator is both an inventory unit that moves and an equipment record with service
  -- intervals; a pallet of mats is not one machine and must not claim to be.
  constraint "inventory_item_equipment_serial_check"
    check ("equipment_id" is null or "tracking_mode" = 'serial'::text)
);

alter table "public"."inventory_item" owner to "postgres";

comment on table "public"."inventory_item" is
  'A thing the company stocks. Describes the item, never the quantity: how many, and where, lives in the movement ledger and its balances.';

comment on column "public"."inventory_item"."tracking_mode" is
  'bulk = counted in quantity; serial = each unit identified individually. Not to be confused with equipment.tracking_mode, which is mileage or hours.';

comment on column "public"."inventory_item"."equipment_id" is
  'Optional link to an equipment record, for a serialized unit that also needs a maintenance life (service intervals, meters, CVIP). Inventory answers how many and where; Equipment answers what condition and serviced when.';

comment on column "public"."inventory_item"."deleted_at" is
  'Soft delete. An item referenced by historical movements must never vanish, or the ledger stops explaining itself.';

alter table only "public"."inventory_category"
  add constraint "inventory_category_pkey" primary key ("id");

alter table only "public"."inventory_item"
  add constraint "inventory_item_pkey" primary key ("id");

alter table only "public"."inventory_category"
  add constraint "inventory_category_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."inventory_item"
  add constraint "inventory_item_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- Clearing a category leaves its items intact and uncategorised, rather than deleting
-- stock records as a side effect of tidying up a filter list.
alter table only "public"."inventory_item"
  add constraint "inventory_item_category_id_fkey" foreign key ("category_id") references "public"."inventory_category"("id") on delete set null;

alter table only "public"."inventory_item"
  add constraint "inventory_item_equipment_id_fkey" foreign key ("equipment_id") references "public"."equipment"("id") on delete set null;

alter table only "public"."inventory_item"
  add constraint "inventory_item_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

-- Names and SKUs are unique per tenant, not globally: two companies may both stock a
-- "Rig Mat". Case-insensitive, because "Rig Mat" and "rig mat" are the same thing to
-- everyone except a database.
create unique index if not exists "inventory_category_tenant_name_key"
  on "public"."inventory_category" ("tenant_id", lower("name"));

create unique index if not exists "inventory_item_tenant_sku_key"
  on "public"."inventory_item" ("tenant_id", lower("sku"))
  where "sku" is not null and "deleted_at" is null;

create index if not exists "inventory_item_tenant_active_name_idx"
  on "public"."inventory_item" ("tenant_id", "active", "name");

create index if not exists "inventory_item_tenant_category_idx"
  on "public"."inventory_item" ("tenant_id", "category_id");

create or replace trigger "inventory_category_set_updated_at"
  before update on "public"."inventory_category"
  for each row execute function "public"."set_updated_at"();

create or replace trigger "inventory_item_set_updated_at"
  before update on "public"."inventory_item"
  for each row execute function "public"."set_updated_at"();

-- Row level security. Same shape as every other tenant-scoped table: members of the
-- tenant, plus a consultant the tenant has allowed in.
alter table "public"."inventory_category" enable row level security;
alter table "public"."inventory_item" enable row level security;

create policy "inventory_category_tenant_select" on "public"."inventory_category"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_category_tenant_insert" on "public"."inventory_category"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_category_tenant_update" on "public"."inventory_category"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_category_tenant_delete" on "public"."inventory_category"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_item_tenant_select" on "public"."inventory_item"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_item_tenant_insert" on "public"."inventory_item"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_item_tenant_update" on "public"."inventory_item"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_item_tenant_delete" on "public"."inventory_item"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does NOT grant table access. Without an explicit privilege,
-- PostgREST answers "permission denied for table" however permissive the policies are.
-- The baseline sets ALTER DEFAULT PRIVILEGES, but that is keyed to the role that ran it,
-- so a table created by any other role would silently miss out. Granting here is cheap
-- and removes the doubt.
grant select, insert, update, delete on table "public"."inventory_category" to "authenticated";
grant select, insert, update, delete on table "public"."inventory_category" to "service_role";
grant select, insert, update, delete on table "public"."inventory_item" to "authenticated";
grant select, insert, update, delete on table "public"."inventory_item" to "service_role";
