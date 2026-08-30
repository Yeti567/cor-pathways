-- Contracted drivers: somewhere to file the licence, the abstract and the CSO.
--
-- THE GAP THIS CLOSES. A driver's licence, their commercial abstract and their Common
-- Safety Orientation are columns on contracted_driver, not rows in
-- contracted_driver_certification. That was the right call -- every driver has exactly
-- one licence, and the sheets treat them as identity rather than as paperwork -- but a
-- column holds a date and nothing else. So when the first batch of ticket scans arrived
-- (2026-08-26) seven documents had nowhere to go: three CSOs, three licences and an
-- abstract. Their dates were already in the app and correct; what could not be held was
-- the paper that proves them. A licence and an abstract are the two documents an auditor
-- asks for first, so that is the wrong pair to be unable to file.
--
-- WHY A TABLE AND NOT THREE COLUMNS. Three `*_attachment_path` columns on
-- contracted_driver would be smaller and would have closed the gap. They would also have
-- kept exactly one scan per driver per kind, and these documents come in series: an
-- abstract is pulled annually, and a licence is renewed every five years. Overwriting
-- last year's abstract with this year's destroys the record an auditor asks for when they
-- want to see that the carrier has been pulling them. This client's standing instruction
-- is to load history, not just what is current, and the ticket list on the same screen
-- already keeps superseded records dimmed rather than deleting them. One row per filed
-- document is what lets these behave the same way.
--
-- THE DRIVER COLUMN REMAINS THE SOURCE OF TRUTH, and this is the important part.
-- contracted_driver.license_expiry, .abstract_issued, .abstract_expiry and .cso_completed
-- are what the roster light, the reminder job and the site qualification grid all read.
-- Nothing here changes that. A row in this table is EVIDENCE, not the fact: it carries
-- the dates as printed on the document so the two can be compared, and a disagreement
-- can be shown rather than silently resolved. Do not point any status calculation at this
-- table. Two sources of truth for one date is precisely how the terminal badge records
-- ended up split from their expiries.
--
-- That comparison is not decoration. The abstract filed for one driver by this migration
-- states a licence expiry ten days later than the carrier's sheet recorded, and the app
-- had been carrying the sheet's version since the contracted load.

-- 1. The filed document.

create table if not exists "public"."contracted_driver_document" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "contracted_driver_id" uuid not null,

  -- Deliberately a small closed list, unlike contracted_equipment_document.doc_type.
  -- Anything that is not one of these three is a ticket, an orientation or a badge, and
  -- those already have a home in contracted_driver_certification with a real type list
  -- behind them. This table exists only for the identity documents that are columns on
  -- the driver.
  "doc_type" text not null,

  -- What the reader sees in the list. The licence province and class, or which year's
  -- abstract this is: enough to tell two filed documents of one kind apart without
  -- opening them.
  "title" text not null,

  -- The dates AS PRINTED ON THE DOCUMENT, which is not necessarily what the driver row
  -- says. Both nullable: a CSO carries no expiry at all (the certificate prints "EXPIRES:
  -- N/A"), and an abstract has an issue date but never an expiry -- it does not lapse, it
  -- goes stale. Never invent a date to fill one of these.
  "issued_date" date,
  "expiry_date" date,

  -- NOT NULL, and that is the difference from every other document table here. A row in
  -- contracted_equipment_document can exist to record that a certificate is due with
  -- nothing attached yet. This table has no such job: the dates already live on the
  -- driver row, so a row here with no scan would carry no information at all. A row
  -- exists because a document exists.
  "attachment_path" text not null,

  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "contracted_driver_document_doc_type_check"
    check ("doc_type" = any (array['license'::text, 'abstract'::text, 'cso'::text]))
);

alter table "public"."contracted_driver_document" owner to "postgres";

comment on table "public"."contracted_driver_document" is
  'The scan behind a contracted driver''s licence, abstract or CSO. Evidence only: the authoritative dates stay on contracted_driver, and every status calculation must keep reading them. Several rows of one doc_type are history, not duplicates.';

comment on column "public"."contracted_driver_document"."doc_type" is
  'license, abstract or cso. Only the three identity documents that are columns on contracted_driver; tickets, orientations and badges belong in contracted_driver_certification.';

comment on column "public"."contracted_driver_document"."attachment_path" is
  'Not null on purpose. The dates are already on the driver row, so a row here with nothing attached would say nothing. A row exists because there is a document.';

comment on column "public"."contracted_driver_document"."expiry_date" is
  'As printed on the document, for comparison against the driver row -- never as the value a status is computed from. Null where the document genuinely carries no expiry: a CSO prints N/A, and an abstract goes stale rather than lapsing.';

-- 2. Keys, constraints and indexes.

alter table only "public"."contracted_driver_document"
  add constraint "contracted_driver_document_pkey" primary key ("id");

alter table only "public"."contracted_driver_document"
  add constraint "contracted_driver_document_tenant_id_fkey"
  foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- Cascade, matching contracted_driver_certification: the driver row is the thing these
-- describe, and a deleted driver's licence scan is not evidence of anything.
alter table only "public"."contracted_driver_document"
  add constraint "contracted_driver_document_driver_fkey"
  foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete cascade;

alter table only "public"."contracted_driver_document"
  add constraint "contracted_driver_document_created_by_fkey"
  foreign key ("created_by") references "public"."users"("id") on delete set null;

-- The driver file reads every document for one driver at once, newest of each kind first.
create index if not exists "contracted_driver_document_driver_idx"
  on "public"."contracted_driver_document" ("contracted_driver_id", "doc_type");

-- Deliberately NO unique index on (driver, doc_type). Several rows of one kind is the
-- history this table was added to keep.

create or replace trigger "contracted_driver_document_set_updated_at"
  before update on "public"."contracted_driver_document"
  for each row execute function "public"."set_updated_at"();

-- 3. Row level security. Same shape as contracted_driver_certification.

alter table "public"."contracted_driver_document" enable row level security;

create policy "contracted_driver_document_tenant_select" on "public"."contracted_driver_document"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_document_tenant_insert" on "public"."contracted_driver_document"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_document_tenant_update" on "public"."contracted_driver_document"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_document_tenant_delete" on "public"."contracted_driver_document"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does NOT grant table access. Without an explicit privilege,
-- PostgREST answers "permission denied for table" however permissive the policies are.
grant select, insert, update, delete on table "public"."contracted_driver_document" to "authenticated";
grant select, insert, update, delete on table "public"."contracted_driver_document" to "service_role";

-- Storage: the same bucket and layout the ticket scans already use,
-- {tenant_id}/{subcontractor_id}/contracted-drivers/{driver_id}/{upload_id}/{filename}.
-- Nothing to create here.
