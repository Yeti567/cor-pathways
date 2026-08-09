-- Per-unit certification tracking, slice 1: a tenant-owned list of vehicle
-- certification types, and a pointer from an equipment document to the type it
-- records.
--
-- Why this exists. A unit already carries documents in equipment_document, and
-- that row already knows how to expire and warn (expiry_date + reminder_lead_days,
-- read by the one due/overdue helper the whole app shares). What it could not do
-- was say WHICH certification a "certification" document is: a picker inspection, a
-- CSA B620 tank inspection, a pressure test. doc_type is a fixed six-value enum and
-- was never meant to grow per tenant. So the type list moves into its own
-- tenant-scoped table (mirroring the worker certification_types table), and an
-- equipment_document points at one of its rows when doc_type = 'certification'.
--
-- What is deliberately NOT here. No per-type reminder lead and no per-category
-- applicability: the product decision is one 30-day warning for every type, shown on
-- every unit. Those can be added as columns later without touching this shape.

create table if not exists "public"."equipment_certification_types" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "name" text not null,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null
);

alter table "public"."equipment_certification_types" owner to "postgres";

comment on table "public"."equipment_certification_types" is
  'A tenant-owned list of vehicle certification types (CVIP, picker inspection, CSA B620 tank, pressure test, fire extinguisher). Pointed at from equipment_document.certification_type_id. Mirrors certification_types, which does the same job for workers.';

alter table only "public"."equipment_certification_types"
  add constraint "equipment_certification_types_pkey" primary key ("id");

alter table only "public"."equipment_certification_types"
  add constraint "equipment_certification_types_tenant_id_fkey"
  foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- One list per tenant, case-insensitive: "Pressure test" and "pressure test" are the
-- same certification to everyone except a database.
create unique index if not exists "equipment_certification_types_tenant_name_key"
  on "public"."equipment_certification_types" ("tenant_id", lower("name"));

create index if not exists "equipment_certification_types_tenant_name_idx"
  on "public"."equipment_certification_types" ("tenant_id", "name");

create or replace trigger "equipment_certification_types_set_updated_at"
  before update on "public"."equipment_certification_types"
  for each row execute function "public"."set_updated_at"();

-- Row level security. Same shape as every other tenant-scoped table: members of the
-- tenant, plus a consultant the tenant has allowed in.
alter table "public"."equipment_certification_types" enable row level security;

create policy "equipment_certification_types_tenant_select" on "public"."equipment_certification_types"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "equipment_certification_types_tenant_insert" on "public"."equipment_certification_types"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "equipment_certification_types_tenant_update" on "public"."equipment_certification_types"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "equipment_certification_types_tenant_delete" on "public"."equipment_certification_types"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does NOT grant table access. Without an explicit privilege,
-- PostgREST answers "permission denied for table" however permissive the policies are.
grant select, insert, update, delete on table "public"."equipment_certification_types" to "authenticated";
grant select, insert, update, delete on table "public"."equipment_certification_types" to "service_role";

-- The pointer from a filed document to the certification type it records. Nullable,
-- because most equipment_document rows are registrations, insurance slips, and permits
-- that are not one of these certifications. On delete set null: removing a type from
-- the list must not delete the units' filed certificates, exactly as deleting a worker
-- certification_type leaves the worker's certifications standing.
alter table "public"."equipment_document"
  add column if not exists "certification_type_id" uuid;

alter table only "public"."equipment_document"
  add constraint "equipment_document_certification_type_id_fkey"
  foreign key ("certification_type_id")
  references "public"."equipment_certification_types"("id") on delete set null;

create index if not exists "equipment_document_certification_type_id_idx"
  on "public"."equipment_document" ("certification_type_id")
  where "certification_type_id" is not null;

-- Seed every existing tenant with the standard Western Canadian commercial-vehicle
-- certification list. New tenants are seeded lazily in application code the first time
-- the list is read, so a tenant created after this migration is not left empty.
-- on conflict do nothing keeps this migration safe to re-run and harmless if a tenant
-- has already added one of these names by hand.
insert into "public"."equipment_certification_types" ("tenant_id", "name")
select "t"."id", "d"."name"
from "public"."tenants" "t"
cross join (values
  ('CVIP inspection'),
  ('Crane / picker inspection'),
  ('Tank inspection (CSA B620)'),
  ('Pressure test (hydrostatic / pneumatic)'),
  ('Fire extinguisher inspection')
) as "d"("name")
on conflict do nothing;
