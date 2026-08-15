-- Actually revoke anon's execute, rather than believing we already did.
--
-- 20260805000000 was supposed to lock these down and reported success on every
-- database it ran against. On Crude Master's it changed nothing: the advisor
-- still listed eight SECURITY DEFINER functions in the public schema as callable
-- by `anon`, and `proacl` confirmed it.
--
-- THE TRAP, and it is worth remembering because it will happen again:
--
--   REVOKE ... FROM PUBLIC does NOT remove an explicit grant to anon.
--
-- Supabase grants EXECUTE on public-schema functions to `anon` and
-- `authenticated` explicitly. PUBLIC is a different grantee. Revoking from
-- PUBLIC therefore leaves `anon=X/postgres` sitting in proacl untouched, the
-- statement succeeds, and the hole stays open while the migration ledger says it
-- was closed. Always name the roles, and always verify against proacl rather
-- than against the migration having run.
--
-- Three of these were the ones that mattered. tag_cor_forms_for_tenant,
-- link_inspection_forms_to_equipment_for_tenant and
-- tag_inspection_defect_severity_for_tenant are SECURITY DEFINER, take a tenant
-- id, and WRITE. Callable by anon means callable by anyone holding the anon key,
-- which ships in every browser bundle, against any tenant id they care to guess.
-- That is an unauthenticated cross-tenant write.
--
-- Idempotent, so it is safe on a database already cleaned by hand.

-- Maintenance routines. No client role should ever reach these; they run from
-- the server with the service role or from a migration.
revoke all on function "public"."tag_cor_forms_for_tenant"("uuid") from "anon", "authenticated";
revoke all on function "public"."link_inspection_forms_to_equipment_for_tenant"("uuid") from "anon", "authenticated";
revoke all on function "public"."tag_inspection_defect_severity_for_tenant"("uuid") from "anon", "authenticated";

-- Auth helpers. RLS evaluates these as the signed-in user, so `authenticated`
-- keeps EXECUTE and must not be revoked or every policy using them breaks. A
-- signed-out visitor has no tenant and no power level, so `anon` has no business
-- calling them and gains nothing legitimate by it.
revoke all on function "public"."current_user_power_level"() from "anon";
revoke all on function "public"."current_user_tenant_id"() from "anon";
revoke all on function "public"."is_active_consultant"() from "anon";
revoke all on function "public"."is_consultant_allowed"("uuid") from "anon";
revoke all on function "public"."is_tenant_member"("uuid") from "anon";
