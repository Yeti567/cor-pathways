-- Fix the demo upload block.
--
-- The first cut wrote the tenant check as a subquery over public.tenants, and inside that
-- subquery the unqualified `name` in storage.foldername(name) bound to tenants.name (the
-- company name) instead of the storage object's path. So it parsed folders out of "Worksite
-- Demo", found none, and never matched: uploads into a demo tenant went through.
--
-- The reliable fix is to move the check into a function that takes the object name as a
-- named argument, so there is no column in scope to shadow it. SECURITY DEFINER so the
-- demo_mode lookup does not depend on the caller's own row security, only on the path.

create or replace function "authz"."is_demo_tenant_path"("object_name" "text") returns boolean
    language "sql" stable security definer
    set "search_path" to 'public', 'pg_temp'
    as $$
  select case
    when coalesce(("storage"."foldername"("object_name"))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (
        select 1 from "public"."tenants" t
        where t.id = ("storage"."foldername"("object_name"))[1]::uuid
          and t.demo_mode
      )
    else false
  end;
$$;

alter function "authz"."is_demo_tenant_path"("text") owner to "postgres";
revoke all on function "authz"."is_demo_tenant_path"("text") from "public";
grant execute on function "authz"."is_demo_tenant_path"("text") to "authenticated", "service_role";

-- Replace the shadow-bugged policies with ones that call the function. At the policy's top
-- level, `name` is unambiguously storage.objects.name, so nothing shadows it.
drop policy if exists "demo_mode_blocks_storage_insert" on "storage"."objects";
drop policy if exists "demo_mode_blocks_storage_update" on "storage"."objects";

create policy "demo_mode_blocks_storage_insert" on "storage"."objects"
  as restrictive for insert to "authenticated"
  with check (not "authz"."is_demo_tenant_path"("name"));

create policy "demo_mode_blocks_storage_update" on "storage"."objects"
  as restrictive for update to "authenticated"
  using (not "authz"."is_demo_tenant_path"("name"))
  with check (not "authz"."is_demo_tenant_path"("name"));
