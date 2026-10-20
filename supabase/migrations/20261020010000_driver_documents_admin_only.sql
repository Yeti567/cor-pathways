-- Driver files are the office's, at the database and not only on screen.
--
-- WHY. Licences, abstracts, the DQ file, contracted drivers' scans and the carriers'
-- own paperwork can only be added or opened from admin pages. But every policy behind
-- those pages was tenant-wide: any signed-in employee of the company could read,
-- change or delete any driver's file straight over PostgREST with the session token
-- their browser already holds, and download the scans from storage the same way.
-- Nothing in the worker app offers that. The app is not the only way in.
--
-- WHAT. "Admin" is authz.can_manage_certifications(), which mirrors canUseAdminPanel
-- in src/lib/access-control.ts, plus consultants allowed into the tenant. Changed:
--
--   transport_document               admin only
--   transport_driver                 admin only, except that a driver may still READ
--                                    their own row (the Hours of Service panel and the
--                                    duty-status trigger read it as the worker). The
--                                    medical-vault test is reused for that because it
--                                    already means "admin, vault holder, or the driver
--                                    themselves".
--   contracted_driver and its
--   certification, document and
--   observation tables               admin only
--   storage tenant-documents under
--   {tenant}/transport/...           admin only (a restrictive policy; the DQ and
--                                    company transport scans live there)
--   storage subcontractor-documents  admin only for company users. Carrier portal users
--                                    reach their own folder through their own policies
--                                    (20260806000000, 20260807000000), left as they are.
--
-- Deliberately NOT changed: worker_profiles (an employee creates their own on first
-- ticket upload, and the crew directory shows coworkers' titles), certifications
-- (20260814000000 already narrowed writes), and the rest of tenant-documents (forms,
-- photos, signatures, the safety manual and equipment files are written and read by
-- employees). The service role bypasses all of this, so loaders, cron and ELD sync
-- are unaffected.

-- One expression for "may manage this tenant's driver files", so the eighteen
-- policies below cannot drift apart.
create or replace function "authz"."can_manage_driver_files"("target_tenant_id" "uuid") returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select ("authz"."is_tenant_member"(target_tenant_id) and "authz"."can_manage_certifications"())
      or "authz"."is_consultant_allowed"(target_tenant_id);
$$;

alter function "authz"."can_manage_driver_files"("target_tenant_id" "uuid") owner to "postgres";

revoke all on function "authz"."can_manage_driver_files"("target_tenant_id" "uuid") from public;
grant all on function "authz"."can_manage_driver_files"("target_tenant_id" "uuid") to "authenticated";
grant all on function "authz"."can_manage_driver_files"("target_tenant_id" "uuid") to "service_role";

-- transport_document -----------------------------------------------------------

drop policy if exists "transport_document_tenant_select" on "public"."transport_document";
create policy "transport_document_tenant_select" on "public"."transport_document"
  for select using ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "transport_document_tenant_insert" on "public"."transport_document";
create policy "transport_document_tenant_insert" on "public"."transport_document"
  for insert with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "transport_document_tenant_update" on "public"."transport_document";
create policy "transport_document_tenant_update" on "public"."transport_document"
  for update using ("authz"."can_manage_driver_files"("tenant_id"))
  with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "transport_document_tenant_delete" on "public"."transport_document";
create policy "transport_document_tenant_delete" on "public"."transport_document"
  for delete using ("authz"."can_manage_driver_files"("tenant_id"));

-- transport_driver -------------------------------------------------------------

drop policy if exists "transport_driver_tenant_select" on "public"."transport_driver";
create policy "transport_driver_tenant_select" on "public"."transport_driver"
  for select using (
    "authz"."can_manage_driver_files"("tenant_id")
    or "authz"."current_user_can_access_medical_vault"("tenant_id", "id")
  );

drop policy if exists "transport_driver_tenant_insert" on "public"."transport_driver";
create policy "transport_driver_tenant_insert" on "public"."transport_driver"
  for insert with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "transport_driver_tenant_update" on "public"."transport_driver";
create policy "transport_driver_tenant_update" on "public"."transport_driver"
  for update using ("authz"."can_manage_driver_files"("tenant_id"))
  with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "transport_driver_tenant_delete" on "public"."transport_driver";
create policy "transport_driver_tenant_delete" on "public"."transport_driver"
  for delete using ("authz"."can_manage_driver_files"("tenant_id"));

-- contracted drivers -----------------------------------------------------------

drop policy if exists "contracted_driver_tenant_select" on "public"."contracted_driver";
create policy "contracted_driver_tenant_select" on "public"."contracted_driver"
  for select to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_tenant_insert" on "public"."contracted_driver";
create policy "contracted_driver_tenant_insert" on "public"."contracted_driver"
  for insert to "authenticated" with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_tenant_update" on "public"."contracted_driver";
create policy "contracted_driver_tenant_update" on "public"."contracted_driver"
  for update to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"))
  with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_tenant_delete" on "public"."contracted_driver";
create policy "contracted_driver_tenant_delete" on "public"."contracted_driver"
  for delete to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_certification_tenant_select" on "public"."contracted_driver_certification";
create policy "contracted_driver_certification_tenant_select" on "public"."contracted_driver_certification"
  for select to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_certification_tenant_insert" on "public"."contracted_driver_certification";
create policy "contracted_driver_certification_tenant_insert" on "public"."contracted_driver_certification"
  for insert to "authenticated" with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_certification_tenant_update" on "public"."contracted_driver_certification";
create policy "contracted_driver_certification_tenant_update" on "public"."contracted_driver_certification"
  for update to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"))
  with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_certification_tenant_delete" on "public"."contracted_driver_certification";
create policy "contracted_driver_certification_tenant_delete" on "public"."contracted_driver_certification"
  for delete to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_document_tenant_select" on "public"."contracted_driver_document";
create policy "contracted_driver_document_tenant_select" on "public"."contracted_driver_document"
  for select to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_document_tenant_insert" on "public"."contracted_driver_document";
create policy "contracted_driver_document_tenant_insert" on "public"."contracted_driver_document"
  for insert to "authenticated" with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_document_tenant_update" on "public"."contracted_driver_document";
create policy "contracted_driver_document_tenant_update" on "public"."contracted_driver_document"
  for update to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"))
  with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_document_tenant_delete" on "public"."contracted_driver_document";
create policy "contracted_driver_document_tenant_delete" on "public"."contracted_driver_document"
  for delete to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_observation_tenant_select" on "public"."contracted_driver_observation";
create policy "contracted_driver_observation_tenant_select" on "public"."contracted_driver_observation"
  for select to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_observation_tenant_insert" on "public"."contracted_driver_observation";
create policy "contracted_driver_observation_tenant_insert" on "public"."contracted_driver_observation"
  for insert to "authenticated" with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_observation_tenant_update" on "public"."contracted_driver_observation";
create policy "contracted_driver_observation_tenant_update" on "public"."contracted_driver_observation"
  for update to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"))
  with check ("authz"."can_manage_driver_files"("tenant_id"));

drop policy if exists "contracted_driver_observation_tenant_delete" on "public"."contracted_driver_observation";
create policy "contracted_driver_observation_tenant_delete" on "public"."contracted_driver_observation"
  for delete to "authenticated" using ("authz"."can_manage_driver_files"("tenant_id"));

-- storage ----------------------------------------------------------------------

-- Restrictive, so it narrows the existing tenant_documents_* policies for this one
-- prefix and leaves every other folder in the bucket exactly as it was. The tenant
-- itself is still checked by those permissive policies.
drop policy if exists "tenant_documents_transport_admin_only" on "storage"."objects";
create policy "tenant_documents_transport_admin_only" on "storage"."objects"
  as restrictive for all to "authenticated"
  using (
    "bucket_id" <> 'tenant-documents'::text
    or coalesce((storage.foldername("name"))[2], '') <> 'transport'
    or "authz"."can_manage_certifications"()
    or "authz"."is_active_consultant"()
  )
  with check (
    "bucket_id" <> 'tenant-documents'::text
    or coalesce((storage.foldername("name"))[2], '') <> 'transport'
    or "authz"."can_manage_certifications"()
    or "authz"."is_active_consultant"()
  );

-- The company-side policies on the carrier bucket. Carrier portal users have
-- their own policies, which are permissive alternatives and are not touched.
drop policy if exists "subcontractor_documents_select" on "storage"."objects";
create policy "subcontractor_documents_select" on "storage"."objects"
  for select to "authenticated"
  using (
    "bucket_id" = 'subcontractor-documents'::text
    and "authz"."can_access_storage_tenant_path"("name")
    and ("authz"."can_manage_certifications"() or "authz"."is_active_consultant"())
  );

drop policy if exists "subcontractor_documents_insert" on "storage"."objects";
create policy "subcontractor_documents_insert" on "storage"."objects"
  for insert to "authenticated"
  with check (
    "bucket_id" = 'subcontractor-documents'::text
    and "authz"."can_access_storage_tenant_path"("name")
    and ("authz"."can_manage_certifications"() or "authz"."is_active_consultant"())
  );

drop policy if exists "subcontractor_documents_update" on "storage"."objects";
create policy "subcontractor_documents_update" on "storage"."objects"
  for update to "authenticated"
  using (
    "bucket_id" = 'subcontractor-documents'::text
    and "authz"."can_access_storage_tenant_path"("name")
    and ("authz"."can_manage_certifications"() or "authz"."is_active_consultant"())
  )
  with check (
    "bucket_id" = 'subcontractor-documents'::text
    and "authz"."can_access_storage_tenant_path"("name")
    and ("authz"."can_manage_certifications"() or "authz"."is_active_consultant"())
  );

drop policy if exists "subcontractor_documents_delete" on "storage"."objects";
create policy "subcontractor_documents_delete" on "storage"."objects"
  for delete to "authenticated"
  using (
    "bucket_id" = 'subcontractor-documents'::text
    and "authz"."can_access_storage_tenant_path"("name")
    and ("authz"."can_manage_certifications"() or "authz"."is_active_consultant"())
  );
