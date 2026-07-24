-- Inventory module, slice 3: places stock can sit.
--
-- CORRECTION TO SLICE 1. That migration added locations.location_kind, intending the
-- existing locations table to hold every stocking place including the two virtual ones,
-- transit and loss. Building on it showed why that is wrong.
--
-- public.locations is the human-facing list of places people go. It feeds worker
-- assignment, visitor sign-in, equipment, incidents, workflows and the worker app,
-- across roughly thirty queries, and only six of them filter anything at all. There is no
-- single chokepoint. Adding "In transit" and "Loss / write-off" rows to it would surface
-- them in every one of those pickers as though a worker could be assigned to them, and
-- avoiding that would mean remembering an exclusion in every existing query and every
-- future one. This codebase has already been bitten twice by rules that had to be
-- remembered everywhere: the missing table grants, and an RLS test that only read one
-- migration. A third is not worth the tidiness of one shared table.
--
-- So the ledger gets its own endpoints table. A stocking place either points at
-- something real (a location, a truck, a worker) or is virtual and points at nothing.
-- The ledger then has exactly one foreign key target, balances stay simple, and
-- public.locations is left completely untouched.

alter table "public"."locations" drop constraint if exists "locations_location_kind_check";
drop index if exists "public"."locations_tenant_id_location_kind_idx";
alter table "public"."locations" drop column if exists "location_kind";

create table if not exists "public"."inventory_location" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "kind" text not null,

  -- Exactly one of these is set, decided by kind. A stocking place is a view onto
  -- something that already exists rather than a copy of it, so a renamed yard or a
  -- re-registered truck stays correct here with no second edit.
  "location_id" uuid,
  "equipment_id" uuid,
  "user_id" uuid,

  -- Only virtual places carry their own name; a backed place shows its backing record's
  -- name, so the two can never drift apart.
  "name" text,

  "active" boolean default true not null,
  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "inventory_location_kind_check" check (
    "kind" = any (array[
      'yard'::text,
      'customer_site'::text,
      'vendor'::text,
      'job'::text,
      'vehicle'::text,
      'worker'::text,
      'transit'::text,
      'loss'::text
    ])
  ),

  -- The backing reference a kind requires, and nothing else. Written as one constraint so
  -- there is no combination of columns that satisfies the parts but not the whole.
  constraint "inventory_location_backing_check" check (
    case "kind"
      when 'yard' then "location_id" is not null and "equipment_id" is null and "user_id" is null
      when 'customer_site' then "location_id" is not null and "equipment_id" is null and "user_id" is null
      when 'vendor' then "location_id" is not null and "equipment_id" is null and "user_id" is null
      when 'job' then "location_id" is not null and "equipment_id" is null and "user_id" is null
      when 'vehicle' then "equipment_id" is not null and "location_id" is null and "user_id" is null
      when 'worker' then "user_id" is not null and "location_id" is null and "equipment_id" is null
      else "location_id" is null and "equipment_id" is null and "user_id" is null
    end
  ),

  -- A virtual place has no backing record to borrow a name from, so it must carry one.
  constraint "inventory_location_virtual_name_check" check (
    "kind" not in ('transit', 'loss') or "name" is not null
  )
);

alter table "public"."inventory_location" owner to "postgres";

comment on table "public"."inventory_location" is
  'Where stock can sit: a yard or customer site, a truck, a worker, or one of the two virtual places. Deliberately separate from public.locations, which is the human-facing list of places people go and must not gain rows nobody can visit.';

comment on column "public"."inventory_location"."kind" is
  'Physical: yard, customer_site, vendor, job (backed by a location), vehicle (backed by equipment), worker (backed by a user). Virtual: transit (a load that has left but not arrived) and loss (damage, shrinkage, count corrections).';

alter table only "public"."inventory_location"
  add constraint "inventory_location_pkey" primary key ("id");

alter table only "public"."inventory_location"
  add constraint "inventory_location_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- Restrict, not cascade. Once movements reference a stocking place, deleting the yard
-- behind it must fail loudly rather than quietly taking the stock history with it.
alter table only "public"."inventory_location"
  add constraint "inventory_location_location_id_fkey" foreign key ("location_id") references "public"."locations"("id") on delete restrict;

alter table only "public"."inventory_location"
  add constraint "inventory_location_equipment_id_fkey" foreign key ("equipment_id") references "public"."equipment"("id") on delete restrict;

alter table only "public"."inventory_location"
  add constraint "inventory_location_user_id_fkey" foreign key ("user_id") references "public"."users"("id") on delete restrict;

alter table only "public"."inventory_location"
  add constraint "inventory_location_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

-- One stocking place per backing record, so a yard cannot end up with two balances that
-- each hold half its stock.
create unique index if not exists "inventory_location_tenant_location_key"
  on "public"."inventory_location" ("tenant_id", "location_id") where "location_id" is not null;

create unique index if not exists "inventory_location_tenant_equipment_key"
  on "public"."inventory_location" ("tenant_id", "equipment_id") where "equipment_id" is not null;

create unique index if not exists "inventory_location_tenant_user_key"
  on "public"."inventory_location" ("tenant_id", "user_id") where "user_id" is not null;

-- Exactly one transit and one loss per tenant. Two of either would split the very
-- balances that exist to be reconciled.
create unique index if not exists "inventory_location_tenant_virtual_key"
  on "public"."inventory_location" ("tenant_id", "kind") where "kind" in ('transit', 'loss');

create index if not exists "inventory_location_tenant_kind_idx"
  on "public"."inventory_location" ("tenant_id", "kind", "active");

create or replace trigger "inventory_location_set_updated_at"
  before update on "public"."inventory_location"
  for each row execute function "public"."set_updated_at"();

alter table "public"."inventory_location" enable row level security;

create policy "inventory_location_tenant_select" on "public"."inventory_location"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_location_tenant_insert" on "public"."inventory_location"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_location_tenant_update" on "public"."inventory_location"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "inventory_location_tenant_delete" on "public"."inventory_location"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does not grant table access; without this PostgREST answers
-- "permission denied for table" however permissive the policies are.
grant select, insert, update, delete on table "public"."inventory_location" to "authenticated";
grant select, insert, update, delete on table "public"."inventory_location" to "service_role";
