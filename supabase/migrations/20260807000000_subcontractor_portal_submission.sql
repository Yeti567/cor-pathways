-- Subcontractor carrier module, slice 4: letting the carrier file.
--
-- Slice 3 gave an outside company a login that could only read. This gives it a pen, so
-- the whole migration is about bounding what that pen can write.
--
-- The rule that matters most is that a carrier cannot mark its own paperwork accepted.
-- Everything else here follows from taking that seriously: the insert policy pins
-- review_status to 'pending' and forces every reviewer column to null, so there is no
-- code path, no crafted request, and no future bug in an action that lets a carrier
-- arrive at approved. Approval is a separate statement, run by staff, gated by a policy
-- the carrier fails.
--
-- Second rule: a carrier may correct how to reach it, and nothing else. Row level
-- security decides which rows are writable, not which columns, and public.subcontractor
-- holds the safety rating and the legal name alongside the phone number. A policy alone
-- would let a carrier rate itself satisfactory. Hence the trigger below, which is the
-- column-level half of the same idea.

-- Who filed it. created_by points at public.users and is therefore null for anything a
-- carrier sends, which would leave "who uploaded this" unanswerable for exactly the
-- submissions where it matters most.
alter table "public"."subcontractor_document"
  add column if not exists "submitted_by_subcontractor_user" uuid;

alter table "public"."subcontractor_document"
  drop constraint if exists "subcontractor_document_submitted_by_fkey";

alter table "public"."subcontractor_document"
  add constraint "subcontractor_document_submitted_by_fkey"
  foreign key ("submitted_by_subcontractor_user") references "public"."subcontractor_user"("id") on delete set null;

comment on column "public"."subcontractor_document"."submitted_by_subcontractor_user" is
  'The carrier contact who uploaded this, when it arrived through the portal. Null for anything the hiring company filed itself, which is what created_by records instead.';

-- --------------------------------------------------------------------------
-- Filing.
-- --------------------------------------------------------------------------

-- Insert only. No update and no delete policy for the portal principal at all: a carrier
-- that uploads the wrong file uploads the right one, and the hiring company rejects the
-- mistake. That keeps the first release of external write access to a single verb.
create policy "subcontractor_document_portal_insert" on "public"."subcontractor_document"
  for insert to "authenticated"
  with check (
    "authz"."subcontractor_user_can_access"("subcontractor_id")
    -- Pins the tenant to the one the carrier is actually engaged by. Without this a
    -- carrier hired by two companies could file against the right carrier id under the
    -- wrong company, and land a document in a tenant that never asked for it.
    and exists (
      select 1
      from "public"."subcontractor_user_access" sua
      where sua."subcontractor_user_id" = (select auth.uid())
        and sua."subcontractor_id" = "subcontractor_document"."subcontractor_id"
        and sua."tenant_id" = "subcontractor_document"."tenant_id"
        and sua."allowed" = true
    )
    -- Arrives for review, never accepted, and never pre-signed by a reviewer who has
    -- not looked at it yet.
    and "review_status" = 'pending'
    and "reviewed_by" is null
    and "reviewed_at" is null
    and "rejection_reason" is null
    -- Superseding retires the certificate the company is currently relying on. That is
    -- a consequence of approval, not of upload, so an unreviewed file cannot cause it.
    and "superseded_by_id" is null
    and "deleted_at" is null
    and "submitted_by_subcontractor_user" = (select auth.uid())
  );

-- Storage, matching. The path check already pins both the tenant and the carrier folder.
create policy "subcontractor_documents_portal_insert" on "storage"."objects"
  for insert to "authenticated"
  with check ((("bucket_id" = 'subcontractor-documents'::text) and "authz"."can_access_subcontractor_storage_path"("name")));

-- --------------------------------------------------------------------------
-- Correcting their own contact details.
-- --------------------------------------------------------------------------

-- The column-level half. Row level security says which rows; this says which columns,
-- and only for the carrier principal. Staff are untouched, and so is the service role,
-- which is what the invite and review actions run as.
create or replace function "public"."enforce_subcontractor_portal_columns"() returns trigger
    language "plpgsql"
    set "search_path" to 'public', 'pg_temp'
    as $$
begin
  if not authz.is_active_subcontractor_user() then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.legal_name is distinct from old.legal_name
     or new.operating_name is distinct from old.operating_name
     or new.nsc_number is distinct from old.nsc_number
     or new.wcb_account_number is distinct from old.wcb_account_number
     -- The rating and monitoring status are read off a carrier profile by whoever
     -- reviews it. A carrier setting its own would make the field worthless.
     or new.safety_rating is distinct from old.safety_rating
     or new.monitoring_status is distinct from old.monitoring_status
     or new.carrier_profile_interval_months is distinct from old.carrier_profile_interval_months
     or new.rate_statement_interval_months is distinct from old.rate_statement_interval_months
     or new.notes is distinct from old.notes
     or new.active is distinct from old.active
     or new.deleted_at is distinct from old.deleted_at
     or new.created_by is distinct from old.created_by
  then
    raise exception 'A carrier may only update its own contact and broker details.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

alter function "public"."enforce_subcontractor_portal_columns"() owner to "postgres";
revoke all on function "public"."enforce_subcontractor_portal_columns"() from public, "anon", "authenticated";

create or replace trigger "subcontractor_enforce_portal_columns"
  before update on "public"."subcontractor"
  for each row execute function "public"."enforce_subcontractor_portal_columns"();

create policy "subcontractor_portal_update" on "public"."subcontractor"
  for update to "authenticated"
  using ("authz"."subcontractor_user_can_access"("id"))
  with check ("authz"."subcontractor_user_can_access"("id"));

grant update on table "public"."subcontractor" to "authenticated";

-- --------------------------------------------------------------------------
-- Reviewing.
-- --------------------------------------------------------------------------

-- Approving and rejecting is staff work and already covered by the tenant update policy
-- from slice 1. Nothing new is granted here; this comment exists so the next reader does
-- not go looking for a portal review policy and conclude one was forgotten.

-- Portal activity has to be reconstructable, and the carrier writes it, so it needs
-- insert. Reading stays staff-only, which is why there is no matching select policy.
create policy "subcontractor_audit_log_portal_insert" on "public"."subcontractor_audit_log"
  for insert to "authenticated"
  with check (
    "authz"."is_active_subcontractor_user"()
    and "subcontractor_user_id" = (select auth.uid())
    and "authz"."subcontractor_user_can_access"("subcontractor_id")
  );

grant insert on table "public"."subcontractor_audit_log" to "authenticated";
grant insert on table "public"."subcontractor_document" to "authenticated";
