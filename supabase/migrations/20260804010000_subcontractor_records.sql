-- Subcontractor carrier module, slice 1b: the hired carriers and their paperwork.
--
-- Two tables and a storage bucket. No portal login yet: in this slice the hiring
-- company files on the subcontractor's behalf, because most of these certificates are
-- already sitting in somebody's inbox. That order is deliberate. It puts the module to
-- work immediately and proves the document model before an external principal is ever
-- given a login, which is the genuinely risky part and gets its own slice.
--
-- Why new tables rather than reusing equipment and equipment_document. A hired
-- carrier's paperwork must never appear in the hiring company's own fleet list,
-- inspection assignments, scheduled service, meter history, trip inspections, or ELD
-- links, and none of those readers filter on anything that would exclude it. With no
-- single chokepoint doing the filtering, the safe move is a separate table pointed at
-- from the module, not an extra category of row in a widely read one.
--
-- What IS reused is the definition side: the slot list, the 30-day warning lead, and
-- the due/overdue banding all come from src/lib/subcontractor-requirements.ts, which
-- calls straight through to the equipment document status helper. One implementation of
-- "due soon" for the whole app.

create table if not exists "public"."subcontractor" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "legal_name" text not null,
  "operating_name" text,
  "contact_name" text,
  "contact_email" text,
  "contact_phone" text,
  "nsc_number" text,
  "wcb_account_number" text,

  -- The broker, not the subcontractor, is who actually issues a renewed certificate.
  -- When a sub goes quiet twenty days before expiry this is the fastest way to the
  -- document, and it saves more chasing than any reminder email.
  "broker_name" text,
  "broker_email" text,
  "broker_phone" text,

  -- Read off the carrier profile by whoever reviews it. The profile PDF is the evidence;
  -- these two are the part anyone actually makes a decision on, and keeping them as
  -- columns is what lets the list be sorted by risk instead of by company name.
  "safety_rating" text,
  "monitoring_status" text,

  -- Per-subcontractor refresh cadence for the two documents that carry no expiry of
  -- their own. Defaults match the code constants; a tenant-wide default arrives with the
  -- settings table in a later slice.
  "carrier_profile_interval_months" integer default 6 not null,
  "rate_statement_interval_months" integer default 12 not null,

  "notes" text,
  "active" boolean default true not null,
  "created_by" uuid,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "subcontractor_safety_rating_check"
    check ("safety_rating" is null or "safety_rating" = any (array['satisfactory'::text, 'conditional'::text, 'unsatisfactory'::text, 'unrated'::text])),
  constraint "subcontractor_monitoring_status_check"
    check ("monitoring_status" is null or "monitoring_status" = any (array['none'::text, 'monitoring'::text, 'intervention'::text])),

  -- Bounded so a typo cannot push a renewal decades out and silently retire the slot.
  constraint "subcontractor_carrier_profile_interval_check"
    check ("carrier_profile_interval_months" >= 1 and "carrier_profile_interval_months" <= 60),
  constraint "subcontractor_rate_statement_interval_check"
    check ("rate_statement_interval_months" >= 1 and "rate_statement_interval_months" <= 60)
);

alter table "public"."subcontractor" owner to "postgres";

comment on table "public"."subcontractor" is
  'An independent carrier hired to run work the company cannot cover itself. Holds the relationship and the standing facts; the documents live in subcontractor_document.';

comment on column "public"."subcontractor"."safety_rating" is
  'Safety rating read off the most recent carrier profile at review time. The profile is the evidence; this is the decision-relevant part of it.';

comment on column "public"."subcontractor"."deleted_at" is
  'Soft delete. A subcontractor referenced by filed documents must never vanish, or the due diligence record stops explaining itself.';

create table if not exists "public"."subcontractor_document" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "subcontractor_id" uuid not null,

  -- Which requirement this satisfies. Deliberately unconstrained text, matching
  -- transport_document.slot_key: the slot list is owned by code, and a check constraint
  -- here would be a second copy of it that has to be migrated in lockstep. Writes are
  -- validated against isSubcontractorSlotKey before they get here.
  "slot_key" text not null,

  "title" text,
  "storage_path" text,
  "document_number" text,
  "insurer" text,
  "coverage_amount" numeric(14,2),
  "deductible_amount" numeric(14,2),
  "additional_insured" boolean,
  "issued_date" date,
  "expiry_date" date,

  -- The one date everything downstream reads: the screen, the sort order, and the
  -- reminder job. Derived on write rather than at read time, so "what falls due next" is
  -- a plain ordered query and the job can never disagree with the screen about the date.
  -- Null is legitimate, for a slot that is never chased (a signed agreement).
  "due_date" date,

  "reminder_lead_days" integer default 30 not null,

  -- Slot-specific extras that do not deserve a column each: safety rating and monitoring
  -- status off a carrier profile, the two WCB rates off a rate statement. Which keys
  -- apply is declared per slot in code, so this stays a small bag of captured values
  -- rather than an open-ended blob.
  "fields" jsonb default '{}'::jsonb not null,

  "review_status" text default 'pending'::text not null,
  "reviewed_by" uuid,
  "reviewed_at" timestamp with time zone,
  "rejection_reason" text,

  -- A renewal is filed as a new row pointing back at the one it replaces, never as an
  -- overwrite. After an incident the company has to be able to show what it held and
  -- when, not only what it holds today.
  "superseded_by_id" uuid,

  "created_by" uuid,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "subcontractor_document_review_status_check"
    check ("review_status" = any (array['pending'::text, 'approved'::text, 'rejected'::text])),

  -- A rejection without a reason is not actionable: the subcontractor is told no and has
  -- no idea what to fix. Tie the two together here so no code path can skip it.
  constraint "subcontractor_document_rejection_reason_check"
    check ("review_status" <> 'rejected'::text or "rejection_reason" is not null),

  constraint "subcontractor_document_coverage_amount_check"
    check ("coverage_amount" is null or "coverage_amount" >= 0),
  constraint "subcontractor_document_deductible_amount_check"
    check ("deductible_amount" is null or "deductible_amount" >= 0),
  constraint "subcontractor_document_reminder_lead_days_check"
    check ("reminder_lead_days" >= 0)
);

alter table "public"."subcontractor_document" owner to "postgres";

comment on table "public"."subcontractor_document" is
  'One filed document against one requirement slot for one hired carrier. Insert-and-supersede, never overwrite, so the history of what was held and when survives.';

comment on column "public"."subcontractor_document"."due_date" is
  'When this falls due. Derived on write: the printed expiry for expiry-mode slots, issue date plus the interval for the carrier profile and WCB rate statement, null for slots that are never chased.';

comment on column "public"."subcontractor_document"."storage_path" is
  'Path in the subcontractor-documents bucket. Several rows may share one path: a broker certificate often covers auto, general liability, and cargo on a single PDF, and each coverage carries its own limit and expiry.';

alter table only "public"."subcontractor"
  add constraint "subcontractor_pkey" primary key ("id");

alter table only "public"."subcontractor_document"
  add constraint "subcontractor_document_pkey" primary key ("id");

alter table only "public"."subcontractor"
  add constraint "subcontractor_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."subcontractor"
  add constraint "subcontractor_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."subcontractor_document"
  add constraint "subcontractor_document_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."subcontractor_document"
  add constraint "subcontractor_document_subcontractor_id_fkey" foreign key ("subcontractor_id") references "public"."subcontractor"("id") on delete cascade;

alter table only "public"."subcontractor_document"
  add constraint "subcontractor_document_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."subcontractor_document"
  add constraint "subcontractor_document_reviewed_by_fkey" foreign key ("reviewed_by") references "public"."users"("id") on delete set null;

-- Clearing a superseding row leaves the older one intact and simply un-superseded,
-- rather than deleting history as a side effect.
alter table only "public"."subcontractor_document"
  add constraint "subcontractor_document_superseded_by_id_fkey" foreign key ("superseded_by_id") references "public"."subcontractor_document"("id") on delete set null;

-- Two companies in different tenants may share a legal name; two in the same tenant may
-- not. Case-insensitive, because "Redwater Hauling" and "redwater hauling" are the same
-- company to everyone except a database.
create unique index if not exists "subcontractor_tenant_legal_name_key"
  on "public"."subcontractor" ("tenant_id", lower("legal_name"))
  where "deleted_at" is null;

create index if not exists "subcontractor_tenant_active_name_idx"
  on "public"."subcontractor" ("tenant_id", "active", "legal_name");

create index if not exists "subcontractor_document_subcontractor_slot_idx"
  on "public"."subcontractor_document" ("subcontractor_id", "slot_key")
  where "deleted_at" is null;

-- The reminder job and the "what falls due next" sort both read exactly this.
create index if not exists "subcontractor_document_tenant_due_date_idx"
  on "public"."subcontractor_document" ("tenant_id", "due_date")
  where "deleted_at" is null and "due_date" is not null;

create or replace trigger "subcontractor_set_updated_at"
  before update on "public"."subcontractor"
  for each row execute function "public"."set_updated_at"();

create or replace trigger "subcontractor_document_set_updated_at"
  before update on "public"."subcontractor_document"
  for each row execute function "public"."set_updated_at"();

-- Row level security. Same shape as every other tenant-scoped table: members of the
-- tenant, plus a consultant the tenant has allowed in. The subcontractor's own portal
-- principal does not exist yet and gets its own policies, and its own review, in the
-- slice that introduces it.
alter table "public"."subcontractor" enable row level security;
alter table "public"."subcontractor_document" enable row level security;

create policy "subcontractor_tenant_select" on "public"."subcontractor"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_tenant_insert" on "public"."subcontractor"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_tenant_update" on "public"."subcontractor"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_tenant_delete" on "public"."subcontractor"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_document_tenant_select" on "public"."subcontractor_document"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_document_tenant_insert" on "public"."subcontractor_document"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_document_tenant_update" on "public"."subcontractor_document"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_document_tenant_delete" on "public"."subcontractor_document"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does NOT grant table access. Without an explicit privilege,
-- PostgREST answers "permission denied for table" however permissive the policies are.
grant select, insert, update, delete on table "public"."subcontractor" to "authenticated";
grant select, insert, update, delete on table "public"."subcontractor" to "service_role";
grant select, insert, update, delete on table "public"."subcontractor_document" to "authenticated";
grant select, insert, update, delete on table "public"."subcontractor_document" to "service_role";

-- Storage. A separate bucket rather than a folder inside tenant-documents, because the
-- next slice hands a login to people who work for another company entirely. Keeping
-- their uploads in their own bucket means the grant that lets them write can never be
-- widened by accident into the bucket holding the hiring company's own confidential
-- material.
--
-- Same size cap and MIME allowlist as tenant-documents: certificates arrive as PDFs and
-- phone photographs, and nothing else needs to be accepted.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'subcontractor-documents',
  'subcontractor-documents',
  false,
  52428800,
  '{application/pdf,image/heic,image/heif,image/png,image/jpeg,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document}'::text[]
)
on conflict (id) do nothing;

-- Paths are {tenant_id}/{subcontractor_id}/{upload_id}/{filename}. Tenant first is not
-- cosmetic: can_access_storage_tenant_path reads the first folder as the tenant, and so
-- does the restrictive policy that blocks writes into demo tenants, so both apply here
-- without a line of new code.
create policy "subcontractor_documents_select" on "storage"."objects"
  for select to "authenticated"
  using ((("bucket_id" = 'subcontractor-documents'::text) and "authz"."can_access_storage_tenant_path"("name")));

create policy "subcontractor_documents_insert" on "storage"."objects"
  for insert to "authenticated"
  with check ((("bucket_id" = 'subcontractor-documents'::text) and "authz"."can_access_storage_tenant_path"("name")));

create policy "subcontractor_documents_update" on "storage"."objects"
  for update to "authenticated"
  using ((("bucket_id" = 'subcontractor-documents'::text) and "authz"."can_access_storage_tenant_path"("name")))
  with check ((("bucket_id" = 'subcontractor-documents'::text) and "authz"."can_access_storage_tenant_path"("name")));

create policy "subcontractor_documents_delete" on "storage"."objects"
  for delete to "authenticated"
  using ((("bucket_id" = 'subcontractor-documents'::text) and "authz"."can_access_storage_tenant_path"("name")));
