-- Purchasing module: who the tenant buys from, and what each supplier sells.
--
-- A supplier is a company record, not a stocking place. Receiving brings stock in from
-- outside the company through the inventory ledger's existing "receive" movement, which
-- has no origin inside the system, so a supplier never needs a row in public.locations
-- (the human-facing list of places people go) or in inventory_location.

create table if not exists "public"."supplier" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "name" text not null,
  "contact_name" text,
  "phone" text,
  "email" text,
  "address" text,
  -- Our account number with them, printed on an order so they can find us.
  "account_number" text,
  "terms_notes" text,
  "categories" text[] default '{}'::text[] not null,
  "active" boolean default true not null,
  "notes" text,
  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null
);

alter table "public"."supplier" owner to "postgres";

comment on table "public"."supplier" is
  'A company the tenant buys from. Archived rather than deleted once an order names it, so the order history keeps its supplier.';

create table if not exists "public"."supplier_item" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "supplier_id" uuid not null,
  "item_id" uuid not null,
  "supplier_part_number" text,
  "pack_size" numeric(14,3),
  "lead_time_days" integer,
  -- Updated by receiving, so the next order starts from what was last paid.
  "last_unit_cost" numeric(14,4),
  "preferred" boolean default false not null,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "supplier_item_pack_size_check" check ("pack_size" is null or "pack_size" > 0),
  constraint "supplier_item_lead_time_days_check" check ("lead_time_days" is null or "lead_time_days" >= 0),
  constraint "supplier_item_last_unit_cost_check" check ("last_unit_cost" is null or "last_unit_cost" >= 0)
);

alter table "public"."supplier_item" owner to "postgres";

comment on table "public"."supplier_item" is
  'What a supplier sells: their part number, pack size, lead time and last price for one of our inventory items. At most one preferred supplier per item.';

alter table only "public"."supplier"
  add constraint "supplier_pkey" primary key ("id");

alter table only "public"."supplier_item"
  add constraint "supplier_item_pkey" primary key ("id");

alter table only "public"."supplier"
  add constraint "supplier_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."supplier"
  add constraint "supplier_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."supplier_item"
  add constraint "supplier_item_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."supplier_item"
  add constraint "supplier_item_supplier_id_fkey" foreign key ("supplier_id") references "public"."supplier"("id") on delete cascade;

alter table only "public"."supplier_item"
  add constraint "supplier_item_item_id_fkey" foreign key ("item_id") references "public"."inventory_item"("id") on delete cascade;

-- Names are unique per tenant and case-insensitive, so the same supplier is not entered
-- twice under two capitalisations.
create unique index if not exists "supplier_tenant_name_key"
  on "public"."supplier" ("tenant_id", lower("name"));

create index if not exists "supplier_tenant_active_name_idx"
  on "public"."supplier" ("tenant_id", "active", "name");

create unique index if not exists "supplier_item_supplier_item_key"
  on "public"."supplier_item" ("supplier_id", "item_id");

-- One preferred supplier per item.
create unique index if not exists "supplier_item_tenant_preferred_key"
  on "public"."supplier_item" ("tenant_id", "item_id") where "preferred";

create index if not exists "supplier_item_tenant_item_idx"
  on "public"."supplier_item" ("tenant_id", "item_id");

create or replace trigger "supplier_set_updated_at"
  before update on "public"."supplier"
  for each row execute function "public"."set_updated_at"();

create or replace trigger "supplier_item_set_updated_at"
  before update on "public"."supplier_item"
  for each row execute function "public"."set_updated_at"();

alter table "public"."supplier" enable row level security;
alter table "public"."supplier_item" enable row level security;

create policy "supplier_tenant_select" on "public"."supplier"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "supplier_tenant_insert" on "public"."supplier"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "supplier_tenant_update" on "public"."supplier"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "supplier_tenant_delete" on "public"."supplier"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "supplier_item_tenant_select" on "public"."supplier_item"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "supplier_item_tenant_insert" on "public"."supplier_item"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "supplier_item_tenant_update" on "public"."supplier_item"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "supplier_item_tenant_delete" on "public"."supplier_item"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does not grant table access; without these PostgREST answers
-- "permission denied for table" however permissive the policies are.
grant select, insert, update, delete on table "public"."supplier" to "authenticated";
grant select, insert, update, delete on table "public"."supplier" to "service_role";
grant select, insert, update, delete on table "public"."supplier_item" to "authenticated";
grant select, insert, update, delete on table "public"."supplier_item" to "service_role";
