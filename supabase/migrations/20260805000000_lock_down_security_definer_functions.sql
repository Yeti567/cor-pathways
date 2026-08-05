-- Close the SECURITY DEFINER execute grants.
--
-- Seven functions in the public schema were left executable by PUBLIC, which on a
-- Supabase project means the anon role as well as authenticated. Because the public
-- schema is exposed through PostgREST, every one of them was reachable unauthenticated
-- at /rest/v1/rpc/<name>. All seven are SECURITY DEFINER, so they run as postgres and
-- bypass row level security, and every one takes the tenant it should act on as a plain
-- argument with no check that the caller has anything to do with that tenant.
--
-- Concretely, before this migration:
--
--   require_inspection_meter_for_tenant(uuid) updates form_items for whatever tenant id
--   it is handed. An anonymous caller could rewrite any company's inspection form
--   settings.
--
--   The six seed_*_for_tenant(uuid, uuid) functions insert forms, sections, items, and
--   managed lists into whatever tenant id they are handed. An anonymous caller could
--   inject a full set of forms into any tenant that did not already have them. They are
--   idempotent, which caps the repeat damage, but the first call still lands.
--
-- Nothing legitimate needs those grants. The three seed functions that are actually used
-- are called by authz.handle_new_core_pathways_user, which is itself SECURITY DEFINER and
-- therefore runs as postgres, so it never consulted the PUBLIC grant. The other three,
-- and require_inspection_meter_for_tenant, have no caller at all: not the app, not a
-- trigger, not a script. Revoking is the whole fix, and it is reversible.
--
-- Deliberately NOT done here: adding caller checks inside the seed functions. They run
-- inside the signup trigger where there is no authenticated user to check against, so a
-- guard would break account creation to defend a door this migration has already locked.

revoke all on function "public"."require_inspection_meter_for_tenant"("target_tenant_id" "uuid")
  from public, "anon", "authenticated";

revoke all on function "public"."seed_cor_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid")
  from public, "anon", "authenticated";

revoke all on function "public"."seed_cor_gap_closers_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid")
  from public, "anon", "authenticated";

revoke all on function "public"."seed_cor_inspection_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid")
  from public, "anon", "authenticated";

revoke all on function "public"."seed_managed_lists_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid")
  from public, "anon", "authenticated";

revoke all on function "public"."seed_orientation_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid")
  from public, "anon", "authenticated";

revoke all on function "public"."seed_starter_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid")
  from public, "anon", "authenticated";

-- The signup trigger and the server-side jobs are unaffected: the trigger runs as its
-- definer, and everything else reaches these through service_role, which keeps its grant.
grant execute on function "public"."require_inspection_meter_for_tenant"("target_tenant_id" "uuid") to "service_role";
grant execute on function "public"."seed_cor_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") to "service_role";
grant execute on function "public"."seed_cor_gap_closers_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") to "service_role";
grant execute on function "public"."seed_cor_inspection_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") to "service_role";
grant execute on function "public"."seed_managed_lists_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") to "service_role";
grant execute on function "public"."seed_orientation_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") to "service_role";
grant execute on function "public"."seed_starter_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") to "service_role";

-- applied_migration_names() only ever fed the Setup page's production readiness
-- checklist, and every worker in every tenant could call it. It is a small disclosure,
-- but it is one nobody needs: the page now reads the list through the service role, so
-- the grant can go. The page already treats an unavailable list as "verify manually",
-- so nothing breaks if the two halves of this change land out of order.
revoke all on function "public"."applied_migration_names"() from public, "anon", "authenticated";
grant execute on function "public"."applied_migration_names"() to "service_role";

-- Two authz helpers also carried a PUBLIC grant, unlike the seven siblings beside them
-- that are granted to authenticated only. The authz schema is not exposed through
-- PostgREST, so these were not remotely callable and the linter never saw them, but the
-- inconsistency is the kind that gets copied. Both are evaluated inside row level
-- security policies as the authenticated role, which keeps its grant.
revoke all on function "authz"."can_access_medical_vault_path"("object_name" "text") from public, "anon";
grant execute on function "authz"."can_access_medical_vault_path"("object_name" "text") to "authenticated", "service_role";

revoke all on function "authz"."current_user_can_access_medical_vault"("target_tenant_id" "uuid", "target_driver_id" "uuid") from public, "anon";
grant execute on function "authz"."current_user_can_access_medical_vault"("target_tenant_id" "uuid", "target_driver_id" "uuid") to "authenticated", "service_role";

-- eld_connection_secret holds the API credentials for each tenant's ELD provider. Row
-- level security is on with no policies, which is the correct deny-all for a table only
-- the service role should ever touch, and the security linter reporting that as a finding
-- is reading the shape rather than the intent. Adding a policy would be the regression.
--
-- What is worth fixing is the table privileges sitting underneath it. authenticated held
-- full select, insert, update, and delete, blocked only by row level security, and both
-- anon and authenticated held TRUNCATE, which row level security does not govern at all.
-- PostgREST never exposes TRUNCATE so this was not reachable from the internet, but a
-- secrets table should not be one policy change away from being readable. The only code
-- that touches it is the Motive sync, which uses the service role.
revoke all on table "public"."eld_connection_secret" from "anon", "authenticated";
