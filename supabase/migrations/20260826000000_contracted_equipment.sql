-- Contracted Equipment: the tractors that hired carriers run for this company.
--
-- WHY THIS EXISTS, given that src/lib/subcontractor-requirements.ts says the opposite.
-- That file's header says an owner-operator leased on under the hiring company's own
-- certificate belongs in Equipment, not in a subcontractor record, and that stays true.
-- These are not those. Every company on this client's contractor sheet holds its own
-- Safety Fitness Certificate, its own carrier profile, its own WCB account and its own
-- CRA business number, which makes each one an independent carrier running under its
-- own authority. What is unusual is how far this client's due diligence goes: most
-- hiring companies collect insurance and WCB and stop, and this one tracks every
-- contracted tractor's plate, registration, CVIP and hose certificates the same way it
-- tracks its own fleet. So the subcontractor module keeps the company layer it already
-- models, and this migration adds the per-unit layer it deliberately left out.
--
-- WHY NEW TABLES rather than a subcontractor_id column on equipment. Same argument the
-- subcontractor records migration made, and it is stronger here: this company's own COR
-- numbers must stay this company's own. buildFleetComplianceSummary,
-- buildFleetRenewalWindows, buildEquipmentDashboardCounts, the fleet charts, the data
-- quality scanner, trip inspection unit pickers, scheduled service, meter history and
-- the Samsara import all read public.equipment, and not one of them filters on anything
-- that would exclude a contracted unit. Every one would need a correctness-critical
-- exclusion, and a single missed filter would overstate or understate this company's own
-- compliance to an auditor. A separate table cannot be forgotten.
--
-- WHAT IS REUSED is the definition side, exactly as the subcontractor module reuses it:
-- the certification type list is public.equipment_certification_types, the same list the
-- fleet's own unit certifications point at, so "Product hose" means one thing across the
-- whole app and a tenant maintains one list rather than two that drift.

-- 1. The company standing fact the contractor sheet carries and subcontractor lacks.

alter table "public"."subcontractor"
  add column if not exists "cra_business_number" text;

comment on column "public"."subcontractor"."cra_business_number" is
  'Nine digit CRA business number. A standing fact about the company rather than a document that expires, so it is a column and not a slot.';

-- 2. The unit.

create table if not exists "public"."contracted_equipment" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,

  -- Which hired carrier owns it. Not nullable: a contracted unit with no company behind
  -- it has no insurance, no WCB and nobody to chase, which is the whole point of the
  -- record. If a unit ever needs to exist without a company it belongs in Equipment.
  "subcontractor_id" uuid not null,

  -- The hiring company assigns these and everything on their sheets keys off them,
  -- including which driver is in which truck. Tenant-unique, not company-unique, so the
  -- join from a driver's unit number can never land on two trucks.
  "unit_number" text not null,

  -- Only tractors are loaded in the first phase, but the column stays: trailers are a
  -- later phase, not a never.
  "category" text default 'vehicle'::text not null,

  "year" integer,
  "make" text,
  -- Their sheet keeps make and colour in one cell ("Truck Make & Color") because the
  -- colour is how a unit is identified at a gate. Stored as it is written rather than
  -- split into a colour column nobody would fill in separately.
  "model_or_colour" text,
  "vin_or_serial" text,
  "license_plate" text,
  "registration_province" text,

  -- The person, as distinct from the company. Their sheet carries both, and on a one
  -- truck operation they differ only in that one is a numbered company.
  "owner_name" text,

  "status" text default 'active'::text not null,
  "photo_ids" text[] default '{}'::text[] not null,
  "notes" text,
  "created_by" uuid,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "contracted_equipment_category_check"
    check ("category" = any (array['vehicle'::text, 'trailer'::text])),
  constraint "contracted_equipment_status_check"
    check ("status" = any (array['active'::text, 'inactive'::text, 'terminated'::text]))
);

alter table "public"."contracted_equipment" owner to "postgres";

comment on table "public"."contracted_equipment" is
  'A unit belonging to a hired carrier that this company tracks to its own fleet standard. Deliberately not a row in public.equipment: the fleet tables feed this company''s own COR numbers and must stay this company''s own.';

comment on column "public"."contracted_equipment"."deleted_at" is
  'Soft delete. A unit referenced by filed certificates must never vanish, or the due diligence record stops explaining itself.';

-- 3. The unit's paperwork.

create table if not exists "public"."contracted_equipment_document" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "contracted_equipment_id" uuid not null,

  -- Same vocabulary as equipment_document.doc_type, so one reader understands both and
  -- the status helpers can be shared rather than reimplemented.
  "doc_type" text not null,

  -- Set when doc_type is 'certification'. Points at the SAME tenant list the fleet's own
  -- units use, which is what keeps "Product hose" meaning one thing in both sections.
  "certification_type_id" uuid,

  "title" text not null,
  "issued_date" date,

  -- NULLABLE, and that is the deliberate difference from equipment_document.
  --
  -- equipment_document.expiry_date is not null, and the fleet load lost 52 real
  -- certificates to it: tank thickness tests, whose type is defined with no interval at
  -- all, and fire extinguishers carrying a serial but no printed expiry. The app's own
  -- type definitions therefore describe records its storage could not hold. Null here
  -- means "no expiry is tracked for this one", and the status helpers read it as on file
  -- when a scan is attached rather than as expired. Never invent an expiry to satisfy a
  -- column.
  "expiry_date" date,

  "reminder_lead_days" integer default 30 not null,
  "attachment_ids" text[] default '{}'::text[] not null,
  "is_active" boolean default true not null,
  "created_by" uuid,
  "deleted_at" timestamp with time zone,
  "action_metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "contracted_equipment_document_doc_type_check"
    check ("doc_type" = any (array['registration'::text, 'insurance'::text, 'cvip'::text, 'permit'::text, 'certification'::text, 'other'::text]))
);

alter table "public"."contracted_equipment_document" owner to "postgres";

comment on table "public"."contracted_equipment_document" is
  'One filed document against one contracted unit. Several rows may share a certification type: a tractor carries a primary and a spare product hose, and two fire extinguishers of different sizes, each with its own expiry.';

comment on column "public"."contracted_equipment_document"."expiry_date" is
  'Null means no expiry is tracked for this document, not that it is overdue. Deliberately nullable where equipment_document.expiry_date is not: that constraint silently rejected 52 real certificates during the fleet load.';

comment on column "public"."contracted_equipment_document"."title" is
  'What distinguishes two certificates of one type on one unit. A spare product hose and the primary, or a 20 lb and a 10 lb extinguisher, collapse into a single overwritten row without it.';

-- 4. Which certifications each unit is held to.

create table if not exists "public"."contracted_equipment_certification_requirement" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "contracted_equipment_id" uuid not null,
  "certification_type_id" uuid not null,
  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null
);

alter table "public"."contracted_equipment_certification_requirement" owner to "postgres";

comment on table "public"."contracted_equipment_certification_requirement" is
  'Which certifications each contracted unit is held to. Mirrors equipment_certification_requirement, including the rule that a unit with rows here is held to exactly those and a unit with none falls back to the types marked applies_by_default.';

-- 5. Keys, constraints and indexes.

alter table only "public"."contracted_equipment"
  add constraint "contracted_equipment_pkey" primary key ("id");

alter table only "public"."contracted_equipment_document"
  add constraint "contracted_equipment_document_pkey" primary key ("id");

alter table only "public"."contracted_equipment_certification_requirement"
  add constraint "contracted_equipment_certification_requirement_pkey" primary key ("id");

alter table only "public"."contracted_equipment"
  add constraint "contracted_equipment_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- Restrict, not cascade. Deleting a company must not silently take its trucks and their
-- certificate history with it; the subcontractor row soft deletes instead.
alter table only "public"."contracted_equipment"
  add constraint "contracted_equipment_subcontractor_id_fkey" foreign key ("subcontractor_id") references "public"."subcontractor"("id") on delete restrict;

alter table only "public"."contracted_equipment"
  add constraint "contracted_equipment_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."contracted_equipment_document"
  add constraint "contracted_equipment_document_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."contracted_equipment_document"
  add constraint "contracted_equipment_document_unit_fkey" foreign key ("contracted_equipment_id") references "public"."contracted_equipment"("id") on delete cascade;

-- On delete set null, matching equipment_document: removing a type from the tenant list
-- must not delete the units' filed certificates.
alter table only "public"."contracted_equipment_document"
  add constraint "contracted_equipment_document_certification_type_id_fkey" foreign key ("certification_type_id") references "public"."equipment_certification_types"("id") on delete set null;

alter table only "public"."contracted_equipment_document"
  add constraint "contracted_equipment_document_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."contracted_equipment_certification_requirement"
  add constraint "contracted_equipment_certification_requirement_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."contracted_equipment_certification_requirement"
  add constraint "contracted_equipment_certification_requirement_unit_fkey" foreign key ("contracted_equipment_id") references "public"."contracted_equipment"("id") on delete cascade;

alter table only "public"."contracted_equipment_certification_requirement"
  add constraint "contracted_equipment_certification_requirement_type_fkey" foreign key ("certification_type_id") references "public"."equipment_certification_types"("id") on delete cascade;

-- One unit number per tenant. Case insensitive, because "7710a" and "7710A" are the same
-- truck to everyone except a database, and their sheets are hand-typed.
create unique index if not exists "contracted_equipment_tenant_unit_number_key"
  on "public"."contracted_equipment" ("tenant_id", lower("unit_number"))
  where "deleted_at" is null;

-- A unit is held to a given certification once.
create unique index if not exists "contracted_equipment_certification_requirement_unique"
  on "public"."contracted_equipment_certification_requirement" ("contracted_equipment_id", "certification_type_id");

create index if not exists "contracted_equipment_tenant_company_idx"
  on "public"."contracted_equipment" ("tenant_id", "subcontractor_id", "unit_number")
  where "deleted_at" is null;

create index if not exists "contracted_equipment_document_unit_type_idx"
  on "public"."contracted_equipment_document" ("contracted_equipment_id", "doc_type")
  where "deleted_at" is null;

-- The reminder job and the "what falls due next" sort both read exactly this.
create index if not exists "contracted_equipment_document_tenant_expiry_idx"
  on "public"."contracted_equipment_document" ("tenant_id", "expiry_date")
  where "deleted_at" is null and "expiry_date" is not null;

create index if not exists "contracted_equipment_document_certification_type_idx"
  on "public"."contracted_equipment_document" ("certification_type_id")
  where "certification_type_id" is not null;

create or replace trigger "contracted_equipment_set_updated_at"
  before update on "public"."contracted_equipment"
  for each row execute function "public"."set_updated_at"();

create or replace trigger "contracted_equipment_document_set_updated_at"
  before update on "public"."contracted_equipment_document"
  for each row execute function "public"."set_updated_at"();

create or replace trigger "contracted_equipment_certification_requirement_set_updated_at"
  before update on "public"."contracted_equipment_certification_requirement"
  for each row execute function "public"."set_updated_at"();

-- 6. Row level security. Same shape as every other tenant scoped table: members of the
-- tenant, plus a consultant the tenant has allowed in. The carrier's own portal
-- principal is deliberately not given access here; that is its own slice and its own
-- review, and nothing outside this company gets a login in this phase.

alter table "public"."contracted_equipment" enable row level security;
alter table "public"."contracted_equipment_document" enable row level security;
alter table "public"."contracted_equipment_certification_requirement" enable row level security;

create policy "contracted_equipment_tenant_select" on "public"."contracted_equipment"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_tenant_insert" on "public"."contracted_equipment"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_tenant_update" on "public"."contracted_equipment"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_tenant_delete" on "public"."contracted_equipment"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_document_tenant_select" on "public"."contracted_equipment_document"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_document_tenant_insert" on "public"."contracted_equipment_document"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_document_tenant_update" on "public"."contracted_equipment_document"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_document_tenant_delete" on "public"."contracted_equipment_document"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_requirement_tenant_select" on "public"."contracted_equipment_certification_requirement"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_requirement_tenant_insert" on "public"."contracted_equipment_certification_requirement"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_requirement_tenant_update" on "public"."contracted_equipment_certification_requirement"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_equipment_requirement_tenant_delete" on "public"."contracted_equipment_certification_requirement"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does NOT grant table access. Without an explicit privilege,
-- PostgREST answers "permission denied for table" however permissive the policies are.
grant select, insert, update, delete on table "public"."contracted_equipment" to "authenticated";
grant select, insert, update, delete on table "public"."contracted_equipment" to "service_role";
grant select, insert, update, delete on table "public"."contracted_equipment_document" to "authenticated";
grant select, insert, update, delete on table "public"."contracted_equipment_document" to "service_role";
grant select, insert, update, delete on table "public"."contracted_equipment_certification_requirement" to "authenticated";
grant select, insert, update, delete on table "public"."contracted_equipment_certification_requirement" to "service_role";

-- 7. Storage.
--
-- No new bucket. These scans are another company's paperwork, which is exactly what
-- subcontractor-documents already holds, and keeping them out of tenant-documents means
-- they can never be caught by a grant widened for this company's own confidential
-- material.
--
-- Paths are {tenant_id}/{subcontractor_id}/contracted-equipment/{unit_id}/{upload_id}/{filename}.
-- The subcontractor id sits second on purpose. Tenant members are already covered by the
-- existing bucket policies, which read the first folder as the tenant. If the carrier
-- portal is ever switched on, can_access_subcontractor_storage_path reads the second
-- folder as the carrier and matches it against that login's granted access, so a carrier
-- could reach its own units and never another carrier's. Until then the portal policies
-- simply never match, which fails closed.
--
-- Nothing to create here: the bucket and both sets of policies already exist.

-- 8. Two certification types the contractor tractor sheet needs.
--
-- Both applies_by_default false. A type added default-on becomes expected on every unit
-- that has no tick list of its own, which would put an instant gap on this company's own
-- 160 fleet units for an inspection their trailers do not carry.
--
-- The sheet's "Load Hose" is NOT a new type. On a tractor the hose is the product hose,
-- so it files against the existing "Product hose" type; the sheet's spare load hose is a
-- second certificate of that same type, told apart by its title. There is no lead or
-- vent line hose on a tractor.
--
-- Guarded on the tenant already having a list, so this never creates one for a tenant
-- that has not rendered the page yet; that tenant is seeded lazily in application code.
insert into "public"."equipment_certification_types" ("tenant_id", "name", "applies_by_default", "default_interval_days", "notes")
select "t"."id", "d"."name", false, "d"."interval_days", "d"."notes"
from "public"."tenants" "t"
cross join (values
  ('Belly hose certification', 365,
   'Annual. Contracted tractors carrying a belly hose.'),
  ('Bypass valve system', 365,
   'Annual. Bypass valve equipped units.')
) as "d"("name", "interval_days", "notes")
where exists (
  select 1 from "public"."equipment_certification_types" "e" where "e"."tenant_id" = "t"."id"
)
on conflict do nothing;
