-- Document intake: one row per file a client drops in, from upload to filed.
--
-- WHY THIS EXISTS. Onboarding a fleet used to mean the client sorting every registration,
-- CVIP and insurance card into per-unit folders, zipping them, and a person here reading
-- each one and writing a manifest for scripts/file-*.ts. The client got the sorting wrong
-- and the person doing the reading was the bottleneck. The client should hand over a pile;
-- the app reads each file, works out what it is and which unit it belongs to, and files it.
--
-- WHAT THIS TABLE IS. A staging ledger, not a second copy of the document. A file lands
-- here 'queued', is read (by a model) into 'ready' or 'needs_review', and a person files it
-- onto the unit, which moves the object into the unit's own folder and ends the row at
-- 'filed'. Nothing is filed without a person: the document is the proof, and a registration
-- filed on the wrong trailer is worse than one not filed at all.
--
-- WHAT IT IS NOT. It is not where documents live afterwards. equipment_document stays the
-- record of what a unit holds; this row only remembers where the file came from, what was
-- read off it and who approved it. That is also what makes the load verifiable: the batch
-- report is a count over this table.
--
-- Scope of phase one is unit paperwork only. doc_type shares equipment_document's
-- vocabulary, plus the classes the reader must recognise in order to REFUSE them
-- (medical, personal driver papers), which are never extracted and never auto-filed.

create table if not exists "public"."document_intake" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,

  -- One upload session. The client picks 300 files, they share a batch, and the report
  -- ("300 received, 271 filed, 29 need you") is a group by this column.
  "batch_id" uuid not null,
  "uploaded_by" uuid,

  -- Where the browser put the file, inside the tenant-documents bucket. Starts as
  -- {tenant}/intake/{batch}/... and is rewritten to the unit's own folder when filed.
  "storage_path" text not null,
  "original_name" text not null,
  "mime_type" text,
  "size_bytes" bigint,
  -- Lets an identical file dropped twice be recognised instead of filed twice.
  "content_sha256" text,

  "status" text default 'queued'::text not null,
  "attempts" integer default 0 not null,
  -- Set when a worker takes the row. A row stuck in 'reading' past a few minutes is a
  -- crashed worker, and is taken again.
  "claimed_at" timestamp with time zone,

  -- What the reader said this is. Free of equipment_document's check on purpose: the
  -- reader also has to be able to say 'medical' or 'unreadable'.
  "doc_type" text,
  -- Everything read off the document, as returned. Kept so a reviewer sees what the
  -- reader saw, and so a wrong match can be diagnosed without re-reading the file.
  "extraction" jsonb default '{}'::jsonb not null,
  "confidence" numeric(4, 3),

  -- The unit the reader matched it to, or null while unmatched.
  "equipment_id" uuid,
  -- What filing would do: attach to a waiting row, or add a new one, with the dates.
  "proposal" jsonb default '{}'::jsonb not null,
  -- Plain-language reasons a person has to look at this one. Empty when status is 'ready'.
  "review_reasons" text[] default '{}'::text[] not null,
  "error" text,

  "filed_document_id" uuid,
  "filed_at" timestamp with time zone,
  "reviewed_by" uuid,

  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "document_intake_status_check"
    check ("status" = any (array['queued'::text, 'reading'::text, 'ready'::text, 'needs_review'::text, 'filed'::text, 'skipped'::text, 'failed'::text])),
  constraint "document_intake_attempts_check" check ("attempts" >= 0)
);

alter table "public"."document_intake" owner to "postgres";

comment on table "public"."document_intake" is
  'Staging ledger for bulk document onboarding. One row per uploaded file, from queued through read to filed. Not where documents live afterwards: equipment_document is.';

comment on column "public"."document_intake"."status" is
  'queued: waiting to be read. reading: a worker has it. ready: read, matched and confident, awaiting one click. needs_review: read but a person must decide. filed: attached to a unit. skipped: set aside by a person or recognised as a duplicate. failed: could not be read.';

comment on column "public"."document_intake"."extraction" is
  'The structured result of reading the file, as returned. Never trusted blindly: filing re-checks the unit and the dates through the same paths a hand entry uses.';

comment on column "public"."document_intake"."review_reasons" is
  'Why a person has to look at this file, in plain language. Empty for ready rows.';

-- Keys, constraints and indexes.

alter table only "public"."document_intake"
  add constraint "document_intake_pkey" primary key ("id");

alter table only "public"."document_intake"
  add constraint "document_intake_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- Set null, not cascade, on the unit: deleting a unit must not erase the record of what
-- was uploaded for it and what a person decided.
alter table only "public"."document_intake"
  add constraint "document_intake_equipment_id_fkey" foreign key ("equipment_id") references "public"."equipment"("id") on delete set null;

alter table only "public"."document_intake"
  add constraint "document_intake_filed_document_id_fkey" foreign key ("filed_document_id") references "public"."equipment_document"("id") on delete set null;

alter table only "public"."document_intake"
  add constraint "document_intake_uploaded_by_fkey" foreign key ("uploaded_by") references "public"."users"("id") on delete set null;

alter table only "public"."document_intake"
  add constraint "document_intake_reviewed_by_fkey" foreign key ("reviewed_by") references "public"."users"("id") on delete set null;

-- One row per stored object. Registering the same upload twice must not queue it twice.
create unique index if not exists "document_intake_tenant_path_key"
  on "public"."document_intake" ("tenant_id", "storage_path");

-- The worker's claim query and the page's status tabs both read exactly this.
create index if not exists "document_intake_tenant_status_idx"
  on "public"."document_intake" ("tenant_id", "status", "created_at");

create index if not exists "document_intake_tenant_batch_idx"
  on "public"."document_intake" ("tenant_id", "batch_id");

create index if not exists "document_intake_tenant_hash_idx"
  on "public"."document_intake" ("tenant_id", "content_sha256")
  where "content_sha256" is not null;

create or replace trigger "document_intake_set_updated_at"
  before update on "public"."document_intake"
  for each row execute function "public"."set_updated_at"();

-- The matched unit must belong to the same tenant. equipment_child_tenant_matches cannot
-- be reused: it requires a non-null equipment_id, and an unmatched file has none.
create or replace function "public"."document_intake_tenant_matches"() returns trigger
  language plpgsql
  set "search_path" to 'public'
  as $$
begin
  if new.equipment_id is not null and not exists (
    select 1
    from public.equipment e
    where e.id = new.equipment_id
      and e.tenant_id = new.tenant_id
  ) then
    raise exception 'Document intake equipment must belong to the same tenant.';
  end if;

  return new;
end;
$$;

alter function "public"."document_intake_tenant_matches"() owner to "postgres";

revoke all on function "public"."document_intake_tenant_matches"() from public;

create or replace trigger "document_intake_tenant_match"
  before insert or update on "public"."document_intake"
  for each row execute function "public"."document_intake_tenant_matches"();

-- Row level security: members of the tenant, plus a consultant the tenant has allowed in.
-- Same shape as every other tenant scoped table.

alter table "public"."document_intake" enable row level security;

create policy "document_intake_tenant_select" on "public"."document_intake"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "document_intake_tenant_insert" on "public"."document_intake"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "document_intake_tenant_update" on "public"."document_intake"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "document_intake_tenant_delete" on "public"."document_intake"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does NOT grant table access. Without an explicit privilege,
-- PostgREST answers "permission denied for table" however permissive the policies are.
grant select, insert, update, delete on table "public"."document_intake" to "authenticated";
grant select, insert, update, delete on table "public"."document_intake" to "service_role";

-- Storage: no new bucket and no new policy. Files sit in tenant-documents under
-- {tenant_id}/intake/{batch_id}/..., and the existing policies read the first folder as
-- the tenant, so a tenant can only ever reach its own intake files.
