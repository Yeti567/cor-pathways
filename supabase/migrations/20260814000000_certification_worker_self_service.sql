-- Let a worker keep their OWN ticket current, and nobody else's.
--
-- The app is about to grow a worker-facing renewal: an expired ticket goes red,
-- the worker photographs the new card on their phone, and the record turns green
-- by itself. That is a worker performing an UPDATE on certifications, so the
-- database has to be able to tell "my ticket" from "someone else's".
--
-- Today it cannot. Every policy on this table is tenant-wide, which means any
-- authenticated member of the tenant can update or delete any colleague's
-- certification, straight over PostgREST with the session token the browser
-- already holds. Nothing in the app offers that, but the app is not the only way
-- in, and a compliance record that a coworker can silently rewrite is not a
-- compliance record. So this closes the existing hole and grants the narrow new
-- permission in the same breath, rather than building the feature on top of it.
--
-- SELECT is deliberately left alone. Narrowing who may read a colleague's ticket
-- is a product decision (a supervisor with no admin access still has a crew to
-- keep current) and guessing at it here would break real screens. It is worth
-- deciding separately.

-- Who may manage anyone's certifications. Mirrors canUseAdminPanel in
-- src/lib/access-control.ts exactly; if that test changes, change this with it,
-- or the admin panel and the database will disagree about who is an admin.
create or replace function "authz"."can_manage_certifications"() returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.active = true
      and (
        u.app_access in ('admin_access', 'super_admin_access')
        or u.power_level in ('super_admin', 'consultant')
      )
  );
$$;

alter function "authz"."can_manage_certifications"() owner to "postgres";

-- SECURITY DEFINER functions are executable by PUBLIC unless revoked, which on
-- Supabase can mean anon reaching them over PostgREST. Revoke first, then grant.
revoke all on function "authz"."can_manage_certifications"() from public;
grant all on function "authz"."can_manage_certifications"() to "authenticated";
grant all on function "authz"."can_manage_certifications"() to "service_role";

-- Whether this worker profile is the caller's own. Tenant is checked here too,
-- so the function is safe to use on its own rather than only alongside a tenant
-- test.
create or replace function "authz"."owns_worker_profile"("target_worker_profile_id" "uuid") returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select exists (
    select 1
    from public.worker_profiles wp
    join public.users u on u.id = wp.user_id
    where wp.id = target_worker_profile_id
      and wp.user_id = auth.uid()
      and u.active = true
      and wp.tenant_id = authz.current_user_tenant_id()
  );
$$;

alter function "authz"."owns_worker_profile"("target_worker_profile_id" "uuid") owner to "postgres";

revoke all on function "authz"."owns_worker_profile"("target_worker_profile_id" "uuid") from public;
grant all on function "authz"."owns_worker_profile"("target_worker_profile_id" "uuid") to "authenticated";
grant all on function "authz"."owns_worker_profile"("target_worker_profile_id" "uuid") to "service_role";

-- A worker may file a ticket against their own profile, which is the existing
-- upload flow, and no longer against a colleague's.
drop policy if exists "certifications_tenant_insert" on "public"."certifications";
create policy "certifications_tenant_insert" on "public"."certifications"
  for insert with check (
    (
      "authz"."is_tenant_member"("tenant_id")
      and (
        "authz"."can_manage_certifications"()
        or "authz"."owns_worker_profile"("worker_profile_id")
      )
    )
    or "authz"."is_consultant_allowed"("tenant_id")
  );

-- The renewal itself. USING decides which rows may be touched and WITH CHECK
-- decides what they may become, and both are needed: without WITH CHECK a worker
-- could take their own ticket and reassign it onto someone else's profile.
drop policy if exists "certifications_tenant_update" on "public"."certifications";
create policy "certifications_tenant_update" on "public"."certifications"
  for update using (
    (
      "authz"."is_tenant_member"("tenant_id")
      and (
        "authz"."can_manage_certifications"()
        or "authz"."owns_worker_profile"("worker_profile_id")
      )
    )
    or "authz"."is_consultant_allowed"("tenant_id")
  ) with check (
    (
      "authz"."is_tenant_member"("tenant_id")
      and (
        "authz"."can_manage_certifications"()
        or "authz"."owns_worker_profile"("worker_profile_id")
      )
    )
    or "authz"."is_consultant_allowed"("tenant_id")
  );

-- Deleting a compliance record stays an administrative act. A worker renews a
-- ticket, they do not remove the evidence that it lapsed.
drop policy if exists "certifications_tenant_delete" on "public"."certifications";
create policy "certifications_tenant_delete" on "public"."certifications"
  for delete using (
    ("authz"."is_tenant_member"("tenant_id") and "authz"."can_manage_certifications"())
    or "authz"."is_consultant_allowed"("tenant_id")
  );
