-- Cor Pathways: complete database schema.
--
-- This is the whole database in one file. Run it against a brand new Supabase
-- project and you get a working, empty Cor Pathways instance: every table, every
-- row level security policy, the storage buckets, and the signup trigger that
-- builds a company's first tenant, admin user, and starter forms.
--
-- It replaces 93 incremental migrations that could no longer run from scratch
-- (two shared a version number, and one seeded a hard-coded auth user id that
-- does not exist in a new project). Nothing here is a paywall: there is no trial
-- clock, no plan gate, and no subscription write-lock. The per-tenant module
-- toggles (transport_enabled, cor_enabled, and friends) are product
-- configuration and are kept.
--
-- Generated from the historical migrations, then verified by running this file
-- against an empty database.

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);


-- pgcrypto supplies crypt()/gen_salt(). Supabase's base image installs it into
-- the extensions schema; declared here so this file also works on a plain Postgres.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "authz";


ALTER SCHEMA "authz" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."app_access_level" AS ENUM (
    'no_access',
    'app_access',
    'admin_access',
    'super_admin_access'
);


ALTER TYPE "public"."app_access_level" OWNER TO "postgres";


CREATE TYPE "public"."power_level" AS ENUM (
    'consultant',
    'super_admin',
    'admin',
    'manager',
    'supervisor',
    'worker'
);


ALTER TYPE "public"."power_level" OWNER TO "postgres";


CREATE TYPE "public"."reach_type" AS ENUM (
    'all_locations',
    'specific_locations'
);


ALTER TYPE "public"."reach_type" OWNER TO "postgres";


CREATE TYPE "public"."tenant_subscription_status" AS ENUM (
    'trial',
    'active',
    'past_due',
    'cancelled',
    'expired'
);


ALTER TYPE "public"."tenant_subscription_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "authz"."can_access_medical_vault_path"("object_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'storage'
    AS $_$
  select case
    when (storage.foldername(object_name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and (storage.foldername(object_name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then authz.current_user_can_access_medical_vault(
      (storage.foldername(object_name))[1]::uuid,
      (storage.foldername(object_name))[2]::uuid
    )
    else false
  end;
$_$;


ALTER FUNCTION "authz"."can_access_medical_vault_path"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "authz"."can_access_storage_tenant_path"("object_name" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'storage', 'pg_temp'
    AS $_$
  select case
    when coalesce((storage.foldername(object_name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.is_tenant_member((storage.foldername(object_name))[1]::uuid)
        or authz.is_consultant_allowed((storage.foldername(object_name))[1]::uuid)
    else false
  end;
$_$;


ALTER FUNCTION "authz"."can_access_storage_tenant_path"("object_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "authz"."current_user_can_access_medical_vault"("target_tenant_id" "uuid", "target_driver_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.users u
    left join public.permission_profiles p on p.id = u.permission_profile_id
    where u.id = auth.uid()
      and u.active = true
      and u.tenant_id = target_tenant_id
      and (
        u.power_level = 'super_admin'
        or coalesce((p.capabilities ->> 'medical_vault_access')::boolean, false)
        or exists (
          select 1
          from public.transport_driver d
          where d.id = target_driver_id
            and d.tenant_id = target_tenant_id
            and d.user_id = u.id
        )
      )
  );
$$;


ALTER FUNCTION "authz"."current_user_can_access_medical_vault"("target_tenant_id" "uuid", "target_driver_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "authz"."current_user_power_level"() RETURNS "public"."power_level"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select u.power_level
  from public.users u
  where u.id = auth.uid()
    and u.active = true
  limit 1;
$$;


ALTER FUNCTION "authz"."current_user_power_level"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "authz"."current_user_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select u.tenant_id
  from public.users u
  where u.id = auth.uid()
    and u.active = true
  limit 1;
$$;


ALTER FUNCTION "authz"."current_user_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "authz"."handle_new_core_pathways_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'authz'
    AS $$
declare
  new_tenant_id uuid;
  admin_profile_id uuid;
  company_name text;
  full_name text;
  email_domain text;
  base_slug text;
  tenant_slug text;
begin
  if new.email is null then
    return new;
  end if;

  if exists (select 1 from public.users u where u.id = new.id)
    or exists (select 1 from public.consultants c where c.id = new.id) then
    return new;
  end if;

  company_name := nullif(btrim(new.raw_user_meta_data->>'company_name'), '');
  full_name := nullif(btrim(new.raw_user_meta_data->>'full_name'), '');

  if company_name is null then
    email_domain := split_part(new.email, '@', 2);
    company_name := case
      when email_domain <> '' then initcap(replace(split_part(email_domain, '.', 1), '-', ' '))
      else 'New Company'
    end;
  end if;

  if full_name is null then
    full_name := initcap(replace(split_part(new.email, '@', 1), '.', ' '));
  end if;

  base_slug := trim(both '-' from regexp_replace(lower(company_name), '[^a-z0-9]+', '-', 'g'));
  if base_slug = '' then
    base_slug := 'tenant';
  end if;

  -- Disambiguate the slug with the head of the user id, then guarantee uniqueness.
  -- The id head alone is not enough: any two ids sharing their first 8 hex
  -- characters produce the same slug, the unique index rejects the insert, and the
  -- exception propagates out of the trigger and fails the whole signup. Rare with
  -- random uuids, certain with sequential fixture ids.
  tenant_slug := base_slug || '-' || left(replace(new.id::text, '-', ''), 8);
  while exists (select 1 from public.tenants t where t.slug = tenant_slug) loop
    tenant_slug := base_slug || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);
  end loop;

  insert into public.tenants (name, slug, document_control_enabled)
  values (company_name, tenant_slug, false)
  returning id into new_tenant_id;

  insert into public.permission_profiles (
    tenant_id, name, power_ceiling, capabilities, is_default
  )
  values (
    new_tenant_id,
    'App Admin',
    'admin',
    '{"forms":true,"workers":true,"locations":true,"settings":true}'::jsonb,
    true
  )
  returning id into admin_profile_id;

  insert into public.permission_profiles (
    tenant_id, name, power_ceiling, capabilities, is_default
  )
  values
    (new_tenant_id, 'App Supervisor', 'supervisor', '{"forms":true,"follow_ups":true,"locations":true}'::jsonb, false),
    (new_tenant_id, 'Worker Solo', 'worker', '{"team_forms":false,"assigned_forms":true}'::jsonb, false),
    (new_tenant_id, 'Worker Team', 'worker', '{"team_forms":true,"assigned_forms":true}'::jsonb, false);

  insert into public.users (
    id, tenant_id, email, full_name, power_level, reach_type,
    permission_profile_id, app_access, offline_sync_days
  )
  values (
    new.id, new_tenant_id, lower(new.email), full_name, 'super_admin',
    'all_locations', admin_profile_id, 'super_admin_access', 30
  );

  insert into public.company_settings (tenant_id, company_name, timezone)
  values (new_tenant_id, company_name, 'America/Vancouver');

  insert into public.print_settings (tenant_id, header_option, logo_placement)
  values (new_tenant_id, 'company_info_only', 'left');

  perform public.seed_managed_lists_for_tenant(new_tenant_id, new.id);
  perform public.seed_starter_forms_for_tenant(new_tenant_id, new.id);
  perform public.seed_orientation_forms_for_tenant(new_tenant_id, new.id);

  return new;
end;
$$;


ALTER FUNCTION "authz"."handle_new_core_pathways_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "authz"."is_active_consultant"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.consultants c
    where c.id = auth.uid()
      and c.active = true
  );
$$;


ALTER FUNCTION "authz"."is_active_consultant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "authz"."is_consultant_allowed"("target_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select authz.is_active_consultant()
    and (
      exists (
        select 1
        from public.tenants t
        where t.id = target_tenant_id
          and t.consultant_access_revoked = false
      )
      or exists (
        select 1
        from public.consultant_access ca
        where ca.tenant_id = target_tenant_id
          and ca.consultant_id = (select auth.uid())
          and ca.allowed = true
          and ca.override_condition in ('court_order', 'ministry_order', 'ninety_day_dormancy')
          and (ca.override_expires_at is null or ca.override_expires_at > now())
      )
    );
$$;


ALTER FUNCTION "authz"."is_consultant_allowed"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "authz"."is_tenant_member"("target_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select target_tenant_id = authz.current_user_tenant_id();
$$;


ALTER FUNCTION "authz"."is_tenant_member"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."applied_migration_names"() RETURNS SETOF "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_temp'
    AS $$
  select name
  from supabase_migrations.schema_migrations
  where name is not null
$$;


ALTER FUNCTION "public"."applied_migration_names"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."change_order_child_tenant_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.change_order c where c.id = new.change_order_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Change order child row must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."change_order_child_tenant_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."change_order_project_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.co_project p where p.id = new.project_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'Change order project must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."change_order_project_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_power_level"() RETURNS "public"."power_level"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select u.power_level
  from public.users u
  where u.id = auth.uid()
    and u.active = true
  limit 1;
$$;


ALTER FUNCTION "public"."current_user_power_level"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_user_tenant_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select u.tenant_id
  from public.users u
  where u.id = auth.uid()
    and u.active = true
  limit 1;
$$;


ALTER FUNCTION "public"."current_user_tenant_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dti_inspection_equipment_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.equipment e where e.id = new.equipment_id and e.tenant_id = new.tenant_id
  ) then
    raise exception 'Daily inspection vehicle must belong to the same tenant.';
  end if;

  if new.trailer_equipment_id is not null and not exists (
    select 1 from public.equipment e where e.id = new.trailer_equipment_id and e.tenant_id = new.tenant_id
  ) then
    raise exception 'Daily inspection trailer must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."dti_inspection_equipment_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."dti_inspection_item_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.dti_inspection i where i.id = new.inspection_id and i.tenant_id = new.tenant_id
  ) then
    raise exception 'Daily inspection item must belong to the same tenant as its inspection.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."dti_inspection_item_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eld_driver_link_driver_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.transport_driver d where d.id = new.driver_id and d.tenant_id = new.tenant_id
  ) then
    raise exception 'ELD driver link must reference a driver in the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."eld_driver_link_driver_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."eld_vehicle_link_equipment_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.equipment e where e.id = new.equipment_id and e.tenant_id = new.tenant_id
  ) then
    raise exception 'ELD vehicle link must reference equipment in the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."eld_vehicle_link_equipment_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_equipment_rules"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.status = 'down' then
    new.location_id = null;
  end if;

  if new.assigned_to is not null and not exists (
    select 1
    from public.users u
    where u.id = new.assigned_to
      and u.tenant_id = new.tenant_id
  ) then
    raise exception 'Equipment assignee must belong to the same tenant.';
  end if;

  if new.location_id is not null and not exists (
    select 1
    from public.locations l
    where l.id = new.location_id
      and l.tenant_id = new.tenant_id
  ) then
    raise exception 'Equipment location must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_equipment_rules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."equipment_child_tenant_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  row_data jsonb := to_jsonb(new);
  source_submission_id uuid;
  performed_by uuid;
  linked_submission_id uuid;
begin
  if not exists (
    select 1
    from public.equipment e
    where e.id = new.equipment_id
      and e.tenant_id = new.tenant_id
  ) then
    raise exception 'Equipment child row must belong to the same tenant as its equipment.';
  end if;

  if TG_TABLE_NAME = 'equipment_meter_log' then
    source_submission_id := nullif(row_data->>'source_submission_id', '')::uuid;

    if source_submission_id is not null and not exists (
      select 1
      from public.submissions s
      where s.id = source_submission_id
        and s.tenant_id = new.tenant_id
    ) then
      raise exception 'Equipment meter source submission must belong to the same tenant.';
    end if;
  end if;

  if TG_TABLE_NAME = 'equipment_maintenance_log' then
    performed_by := nullif(row_data->>'performed_by', '')::uuid;

    if performed_by is not null and not exists (
      select 1
      from public.users u
      where u.id = performed_by
        and u.tenant_id = new.tenant_id
    ) then
      raise exception 'Equipment maintenance performer must belong to the same tenant.';
    end if;
  end if;

  if TG_TABLE_NAME = 'equipment_submission_link' then
    linked_submission_id := nullif(row_data->>'submission_id', '')::uuid;

    if linked_submission_id is null or not exists (
      select 1
      from public.submissions s
      where s.id = linked_submission_id
        and s.tenant_id = new.tenant_id
    ) then
      raise exception 'Equipment submission link must belong to the same tenant.';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."equipment_child_tenant_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."field_ticket_project_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.co_project p where p.id = new.project_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'Field ticket project must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."field_ticket_project_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."gc_rfi_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.co_project p where p.id = new.project_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'RFI project must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."gc_rfi_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_managed_list_items_tree"("p_tenant_id" "uuid", "p_list_id" "uuid") RETURNS TABLE("id" "uuid", "tenant_id" "uuid", "list_id" "uuid", "parent_id" "uuid", "label" "text", "sort_order" integer, "active" boolean, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "depth" integer, "path" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  with recursive tree as (
    select
      item.id,
      item.tenant_id,
      item.list_id,
      item.parent_id,
      item.label,
      item.sort_order,
      item.active,
      item.created_at,
      item.updated_at,
      1 as depth,
      concat(lpad(item.sort_order::text, 10, '0'), ':', lower(item.label), ':', item.id::text) as path
    from public.list_items item
    where item.tenant_id = p_tenant_id
      and item.list_id = p_list_id
      and item.parent_id is null

    union all

    select
      child.id,
      child.tenant_id,
      child.list_id,
      child.parent_id,
      child.label,
      child.sort_order,
      child.active,
      child.created_at,
      child.updated_at,
      tree.depth + 1 as depth,
      concat(tree.path, '/', lpad(child.sort_order::text, 10, '0'), ':', lower(child.label), ':', child.id::text) as path
    from public.list_items child
    join tree on tree.id = child.parent_id
    where child.tenant_id = p_tenant_id
      and child.list_id = p_list_id
  )
  select *
  from tree
  order by path;
$$;


ALTER FUNCTION "public"."get_managed_list_items_tree"("p_tenant_id" "uuid", "p_list_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_consultant"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.consultants c
    where c.id = auth.uid()
      and c.active = true
  );
$$;


ALTER FUNCTION "public"."is_active_consultant"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_consultant_allowed"("target_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_active_consultant()
    and exists (
      select 1
      from public.tenants t
      where t.id = target_tenant_id
        and t.consultant_access_revoked = false
    );
$$;


ALTER FUNCTION "public"."is_consultant_allowed"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_tenant_member"("target_tenant_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.tenant_id = target_tenant_id
      and u.active = true
  );
$$;


ALTER FUNCTION "public"."is_tenant_member"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_inspection_forms_to_equipment_for_tenant"("target_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  r record;
  v_section uuid;
begin
  for r in
    select id, code from public.forms
    where tenant_id = target_tenant_id and code in ('TT-TRIP', 'PRE-TRIP')
  loop
    -- Skip if the form already has an equipment_select field.
    if exists (
      select 1 from public.form_items i
      where i.form_id = r.id and i.field_type = 'equipment_select'
    ) then
      continue;
    end if;

    -- Add it to the first section, at the top.
    select id into v_section from public.form_sections where form_id = r.id order by sort_order limit 1;
    if v_section is null then
      continue;
    end if;

    insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings)
    values (target_tenant_id, r.id, v_section, 'Vehicle (unit)', 'equipment_select', true, false, 50, '{}'::jsonb);
  end loop;
end;
$$;


ALTER FUNCTION "public"."link_inspection_forms_to_equipment_for_tenant"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_equipment_current_meter"("target_equipment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  update public.equipment e
  set current_meter = (
    select ml.value
    from public.equipment_meter_log ml
    where ml.equipment_id = target_equipment_id
    order by ml.recorded_at desc, ml.created_at desc
    limit 1
  )
  where e.id = target_equipment_id;
end;
$$;


ALTER FUNCTION "public"."refresh_equipment_current_meter"("target_equipment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_equipment_current_meter_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if TG_OP = 'DELETE' then
    perform public.refresh_equipment_current_meter(old.equipment_id);
    return old;
  end if;

  perform public.refresh_equipment_current_meter(new.equipment_id);

  if TG_OP = 'UPDATE' and old.equipment_id <> new.equipment_id then
    perform public.refresh_equipment_current_meter(old.equipment_id);
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."refresh_equipment_current_meter_trigger"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."require_inspection_meter_for_tenant"("target_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  update public.form_items i
     set settings = coalesce(i.settings, '{}'::jsonb) || jsonb_build_object('requireMeter', true)
    from public.forms f
   where i.form_id = f.id
     and i.tenant_id = target_tenant_id
     and f.tenant_id = target_tenant_id
     and f.code in ('TT-TRIP', 'PRE-TRIP')
     and i.field_type = 'equipment_select'
     and coalesce((i.settings ->> 'requireMeter')::boolean, false) is distinct from true;
end;
$$;


ALTER FUNCTION "public"."require_inspection_meter_for_tenant"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_cor_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_form_id uuid;
  v_section_id uuid;
begin
  -- Idempotent: skip if the hazard report already exists.
  if exists (select 1 from public.forms where tenant_id = target_tenant_id and code = 'HAZ-RPT') then
    return;
  end if;

  ---------------------------------------------------------------------------
  -- Hazard Report (Element 2)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Hazard Report', 'HAZ-RPT', 'published', 'Report an unsafe condition or hazard so it can be classified and corrected. Class A and B hazards are reported in writing.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Hazard', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Identified by', 'worker_select', true, false, 200, '{"workerPickerScope":"current_worker"}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Location of hazard', 'short_text', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hazard description', 'long_text', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Class A is potential for permanent disability or death; Class B is serious injury or major damage; Class C is minor injury or damage.', 'text_info', false, false, 450, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hazard class (A, B, or C)', 'short_text', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Photo of the hazard', 'photo', false, true, 600, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Corrective Action', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Corrective action assigned to', 'short_text', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Target date', 'date', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Corrective action taken', 'long_text', false, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date completed', 'date', false, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Reviewed by', 'signature', false, false, 500, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Worker Competency Assessment (Element 5)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Worker Competency Assessment', 'COMP-ASSESS', 'published', 'Confirm a worker is competent at a task before they perform it unsupervised.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Worker and Task', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Worker being assessed', 'worker_select', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Position', 'short_text', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Task being assessed', 'short_text', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Assessment', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Knows the hazards of the task', 'yes_no_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Follows the safe work procedure', 'yes_no_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Uses the correct PPE', 'yes_no_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Operates the equipment correctly', 'yes_no_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Knows the emergency response', 'yes_no_na', true, true, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Completes the required records and logs', 'yes_no_na', true, true, 600, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Result', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Competent to perform unsupervised', 'yes_no_na', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Training or supervision plan if not yet competent', 'long_text', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Assessor signature', 'signature', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Worker signature', 'signature', false, false, 400, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Contractor Pre-Qualification (Element 6)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Contractor Pre-Qualification', 'CONT-PREQUAL', 'published', 'Confirm a contractor has adequate health and safety coverage before they work on a company site.', target_user_id, true, false, true, false)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Contractor', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Contractor name', 'short_text', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Contact person', 'short_text', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Phone and email', 'short_text', false, false, 300, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Coverage', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'WCB account number', 'short_text', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'WCB account in good standing', 'yes_no_na', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Holds COR or SECOR', 'yes_no_na', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'COR or SECOR certificate number', 'short_text', false, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'COR or SECOR expiry date', 'date', false, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Insurance broker', 'short_text', false, false, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'General liability amount', 'short_text', false, false, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Insurance expiry date', 'date', false, false, 800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Has a written safety program', 'yes_no_na', false, false, 900, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Decision', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Approved to work on our sites', 'yes_no_na', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Reviewed by', 'signature', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 300, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Contractor Orientation (Element 6)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Contractor Orientation', 'CONT-ORIENT', 'published', 'Orient a contractor or self-employed person to the site-specific hazards and rules before they start work.', target_user_id, true, false, true, false)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Contractor', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Contractor or worker name', 'short_text', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Company', 'short_text', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Site', 'short_text', false, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Reviewed', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Site-specific hazards', 'checkbox', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Our health and safety rules and expectations', 'checkbox', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Required PPE', 'checkbox', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hazard and incident reporting to our supervisor', 'checkbox', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Emergency response: muster point, exits, first aid', 'checkbox', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Areas the contractor may and may not enter', 'checkbox', true, false, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Sign-in and sign-out process', 'checkbox', true, false, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Pre-qualification confirmed on file', 'checkbox', true, false, 800, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Sign-off', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Contractor signature', 'signature', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Company representative signature', 'signature', true, false, 200, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Emergency Drill Record (Element 8)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Emergency Drill Record', 'DRILL', 'published', 'Record an emergency drill: what was tested, what worked, and what to improve.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Drill', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Drill type (fire, evacuation, spill, medical, missing worker)', 'short_text', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Location', 'short_text', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Run by', 'worker_select', false, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Participants', 'workers_select', false, false, 500, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Outcome', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'What happened (time to muster, headcount, communication)', 'long_text', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'What worked well', 'long_text', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'What to improve', 'long_text', false, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Recorded by', 'signature', true, false, 400, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Health and Safety Recommendation (Element 4)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Health and Safety Recommendation', 'HS-REC', 'published', 'A written recommendation from the committee or representative to management, with the management response tracked to closure.', target_user_id, true, false, true, false)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Recommendation', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Date raised', 'date', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Raised by', 'worker_select', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hazard or issue', 'short_text', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Recommendation and the reason', 'long_text', true, false, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Management Response', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Response date', 'date', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Accepted, partly accepted, or not accepted', 'short_text', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Action to be taken', 'long_text', false, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Assigned to', 'short_text', false, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Target date', 'date', false, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date completed', 'date', false, false, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Manager signature', 'signature', false, false, 700, '{}'::jsonb);
end;
$$;


ALTER FUNCTION "public"."seed_cor_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_cor_gap_closers_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_form_id uuid;
  v_section_id uuid;
begin
  if exists (select 1 from public.forms where tenant_id = target_tenant_id and code = 'SAFETY-ACCT') then
    return;
  end if;

  -- Safety Accountability Evaluation (element 1, question 1.8)
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Safety Accountability Evaluation', 'SAFETY-ACCT', 'published', 'Evaluate a worker or supervisor on their individual health and safety accountabilities.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Worker', 100) returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Worker being evaluated', 'worker_select', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Position', 'short_text', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Evaluated by', 'short_text', true, false, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Safety Accountabilities', 200) returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Follows safe work procedures and rules', 'yes_no_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Uses the required PPE', 'yes_no_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Reports hazards, near misses, and incidents', 'yes_no_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Participates in hazard assessments, inspections, and meetings', 'yes_no_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Completes the required inspections and records', 'yes_no_na', true, true, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Supervisors: supervises safely and corrects unsafe acts', 'yes_no_na', false, true, 600, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Result', 300) returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Comments and development plan', 'long_text', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Evaluator signature', 'signature', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Worker signature', 'signature', false, false, 300, '{}'::jsonb);

  -- Training certification types for designated leads and managers (2.8, 4.5, 5.4, 7.3, 9.6).
  insert into public.certification_types (tenant_id, name, expires) values
    (target_tenant_id, 'Hazard Assessment Training', false),
    (target_tenant_id, 'Committee or HS Representative Training', false),
    (target_tenant_id, 'Supervisor and Manager Safety Training', false),
    (target_tenant_id, 'Inspection Training', false),
    (target_tenant_id, 'Incident Investigation Training', false)
  on conflict (tenant_id, name) do nothing;
end;
$$;


ALTER FUNCTION "public"."seed_cor_gap_closers_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_cor_inspection_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_form_id uuid;
  v_section_id uuid;
begin
  if exists (select 1 from public.forms where tenant_id = target_tenant_id and code = 'SHOP-YARD-INSP') then
    return;
  end if;

  ---------------------------------------------------------------------------
  -- Shop and Yard Inspection (Element 7)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Shop and Yard Inspection', 'SHOP-YARD-INSP', 'published', 'Routine documented inspection of the shop and yard for hazards, with deficiencies tracked to closure.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Inspection', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Inspected by', 'worker_select', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Area inspected (shop or yard)', 'short_text', true, false, 300, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Shop and Yard Items', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Housekeeping, walkways and exits clear', 'pass_fail_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Floors and surfaces free of slip and trip hazards', 'pass_fail_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Fire extinguishers present, charged, and accessible', 'pass_fail_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'First aid kit stocked and accessible', 'pass_fail_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Emergency exits clear and signed', 'pass_fail_na', true, true, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Lighting adequate', 'pass_fail_na', true, true, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Electrical: no damaged cords, panels accessible', 'pass_fail_na', true, true, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hand and power tools in good condition, guards in place', 'pass_fail_na', true, true, 800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hoist, jacks, and lifting equipment inspected', 'pass_fail_na', true, true, 900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'PPE available and in good condition', 'pass_fail_na', true, true, 1000, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hazardous materials labelled, SDS available, stored correctly', 'pass_fail_na', true, true, 1100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Compressed gas cylinders secured', 'pass_fail_na', true, true, 1200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Spill kit available where needed', 'pass_fail_na', true, true, 1300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Welding and cutting area safe', 'pass_fail_na', false, true, 1400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Yard surface, access, and lighting safe', 'pass_fail_na', true, true, 1500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Vehicles and equipment parked safely', 'pass_fail_na', true, true, 1600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Signage and postings current', 'pass_fail_na', false, true, 1700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Photo of any issue', 'photo', false, true, 1800, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Deficiencies', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Deficiencies found and corrective actions (assign owner and date)', 'long_text', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Inspected by', 'signature', true, false, 200, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Declaration of Commitment to Transportation Safety (Element 1 / NSC)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Declaration of Commitment to Transportation Safety', 'DECL-COMMIT', 'published', 'Senior management declaration of commitment to the NSC safety and maintenance program, with the designated safety officer.', target_user_id, false, false, true, false)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Declaration', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'This declaration must include the individuals named on the vehicle registration. For a corporate or organization registration, it must include the owners, managers, or directors.', 'text_info', false, false, 50, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'We are committed to ensuring all employees are aware of and follow transportation safety laws as outlined in this safety and maintenance program, and to ensuring the designated safety officer has the resources to implement it.', 'checkbox', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'We acknowledge an audit may be conducted at any time, and that deficiencies may result in disciplinary action, administrative penalties, and a downgraded Safety Fitness Rating.', 'checkbox', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'We certify the information disclosed is true and accurate, and understand false or misleading information may result in suspension or cancellation of the Safety Fitness Certificate or vehicle registration, and possible penalties.', 'checkbox', true, false, 300, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Authorized Representative', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Name', 'short_text', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Position in company', 'short_text', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Phone', 'short_text', false, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Email', 'short_text', false, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Signature', 'signature', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 600, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Designated Safety Officer', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'The person responsible for maintaining and implementing this safety and maintenance program.', 'text_info', false, false, 50, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Name', 'short_text', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Position in company', 'short_text', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Phone', 'short_text', false, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Email', 'short_text', false, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 500, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Truck and Trailer Trip Inspection (Element 7 / NSC Standard 13)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Truck and Trailer Trip Inspection', 'TT-TRIP', 'published', 'NSC Schedule 1 daily trip inspection for a truck and trailer. Mark each item Pass if inspected and serviceable, Fail if it requires repair.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Inspection Details', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'NSC number', 'short_text', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date of inspection', 'date', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Time of inspection', 'time', false, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Location of inspection', 'short_text', false, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Odometer reading', 'number', false, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Vehicle plate or unit number', 'short_text', true, false, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Trailer plate or unit number', 'short_text', false, false, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Driver', 'worker_select', true, false, 800, '{"workerPickerScope":"current_worker"}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Items Inspected', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Air brake system', 'pass_fail_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Cab components and doors', 'pass_fail_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Cargo securement', 'pass_fail_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Coupling devices', 'pass_fail_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Dangerous goods', 'pass_fail_na', false, true, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Driver controls', 'pass_fail_na', true, true, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Driver seat and seatbelts', 'pass_fail_na', true, true, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Electric brake system', 'pass_fail_na', false, true, 800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Emergency equipment and safety devices', 'pass_fail_na', true, true, 900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Engine fluid levels', 'pass_fail_na', true, true, 1000, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Engine components', 'pass_fail_na', true, true, 1100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Exhaust system', 'pass_fail_na', true, true, 1200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Frame and cargo body', 'pass_fail_na', true, true, 1300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Fuel system', 'pass_fail_na', true, true, 1400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Glass and mirrors', 'pass_fail_na', true, true, 1500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Heater and defroster', 'pass_fail_na', true, true, 1600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Horn', 'pass_fail_na', true, true, 1700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hydraulic brake system', 'pass_fail_na', false, true, 1800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Inspection decals', 'pass_fail_na', true, true, 1900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Lights and reflectors', 'pass_fail_na', true, true, 2000, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Mudflaps and fenders', 'pass_fail_na', true, true, 2100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Spare fuses, bulbs, and lights', 'pass_fail_na', false, true, 2200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Steering', 'pass_fail_na', true, true, 2300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Suspension system', 'pass_fail_na', true, true, 2400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Tires', 'pass_fail_na', true, true, 2500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Tire chains and hanger', 'pass_fail_na', false, true, 2600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Tools', 'pass_fail_na', false, true, 2700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Unit documents', 'pass_fail_na', true, true, 2800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Wheels, hubs, and fasteners', 'pass_fail_na', true, true, 2900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Windshield wipers and washer', 'pass_fail_na', true, true, 3000, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Defects and Certification', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'No defects found', 'yes_no_na', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Details of defects detected', 'long_text', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Defects observed during operation (after the initial inspection)', 'long_text', false, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'I certify the above defects have been repaired, or do not affect safe operation and minor defects will be addressed before next use.', 'checkbox', false, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Driver signature', 'signature', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Person inspecting signature (if different from driver)', 'signature', false, false, 600, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Scheduled Vehicle Maintenance intervals (Element 7 / NSC)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Scheduled Vehicle Maintenance', 'SCHED-MAINT', 'published', 'The maintenance inspection intervals for the fleet, per Alberta AR 211/2006, AR 121/2009 Schedule 2, and NSC Standard 13. Fill in only the vehicle types registered to the company.', target_user_id, false, false, true, false)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Daily Trip Inspection', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Trucks, tractors, and trailers: every 24 hours. Complete a written Daily Trip Inspection if required, report all defects, and document all repairs.', 'text_info', false, false, 100, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Lubrication Interval (oil changes and greasing)', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Trucks interval (km, time, or hours)', 'short_text', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Tractors interval (km, time, or hours)', 'short_text', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Trailers interval (km, time, or hours)', 'short_text', false, false, 300, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Scheduled Maintenance Inspection', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Trucks interval (km, time, or hours)', 'short_text', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Tractors interval (km, time, or hours)', 'short_text', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Trailers interval (km, time, or hours)', 'short_text', false, false, 300, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'CVIP Inspection and Sign-off', 400)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'All types (truck, tractor, trailer): annually, every 12 months before the next CVIP expires, completed by a certified CVIP station.', 'text_info', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Authorized by', 'signature', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 300, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Driver Evaluation road test (Element 5 / NSC)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Driver Evaluation', 'DRIVER-EVAL', 'published', 'Road test evaluation of a commercial driver. Rate each action Pass (good), Fail (needs improvement), or N/A (not observed).', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Driver', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Driver being evaluated', 'worker_select', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Current class of operator licence (1 to 5)', 'short_text', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Rate each action below: Pass is good, Fail is needs improvement, N/A is not observed.', 'text_info', false, false, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'A. Controls', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Knowledge and use of equipment', 'pass_fail_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Steering control and hand position', 'pass_fail_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Use of gears', 'pass_fail_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Use of clutch', 'pass_fail_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Use of brake and park brake', 'pass_fail_na', true, true, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Use of accelerator', 'pass_fail_na', true, true, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Signals (timing and cancelling)', 'pass_fail_na', true, true, 700, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'B. Parking, Starting, Backing', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Sets brake and gear', 'pass_fail_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Observation when backing and starting', 'pass_fail_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Judgment of vehicle, wheels, and angle', 'pass_fail_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Does not roll back', 'pass_fail_na', true, true, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'C. Lane Driving, Changing, Position', 400)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Checks mirrors', 'pass_fail_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Checks blind spots', 'pass_fail_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Road position and lane keeping', 'pass_fail_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Following and stopping distance', 'pass_fail_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Lane changes (timing and signal)', 'pass_fail_na', true, true, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Observes signs and conditions', 'pass_fail_na', true, true, 600, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'D. Intersections, Turns, Railway Crossings', 500)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Stops correctly at crosswalks, intersections, stop lines', 'pass_fail_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Observes conditions in time', 'pass_fail_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Left turns (lane and position)', 'pass_fail_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Right turns (lane and position)', 'pass_fail_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Speed on approach (not too fast or slow)', 'pass_fail_na', true, true, 500, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'E to H. Lights, Right of Way, Speed, Backing', 600)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Traffic lights and signs: anticipates and observes', 'pass_fail_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Judgment on green, amber, red, stop, yield', 'pass_fail_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Right of way: not uncertain or aggressive', 'pass_fail_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Speed appropriate for conditions', 'pass_fail_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Backup and turnaround: observation and judgment', 'pass_fail_na', true, true, 500, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'J. General Driver Knowledge', 700)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Hours of Service', 'pass_fail_na', true, true, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Trip inspections', 'pass_fail_na', true, true, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Cargo securement', 'pass_fail_na', true, true, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Weights and dimensions', 'pass_fail_na', true, true, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Result', 800)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Authorized to drive', 'yes_no_na', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Comments', 'long_text', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Driver signature', 'signature', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Safety officer signature', 'signature', true, false, 400, '{}'::jsonb);
end;
$$;


ALTER FUNCTION "public"."seed_cor_inspection_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_managed_lists_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  days_list_id uuid;
  vehicle_type_list_id uuid;
  vehicle_list_id uuid;
  risk_list_id uuid;
  hazard_list_id uuid;
  v_parent_id uuid;
  parent_label text;
  parent_sort integer;
  child_labels text[] := array[
    'A - Probable (immediately or soon)',
    'B - Reasonably Probable (eventually)',
    'C - Remote (could at some point)',
    'D - Extremely Remote (not likely)'
  ];
  child_label text;
  child_index integer;
begin
  insert into public.lists (tenant_id, name, include_other, created_by)
  values (target_tenant_id, 'Days of Week', true, target_user_id)
  on conflict (tenant_id, lower(name)) do update set include_other = excluded.include_other
  returning id into days_list_id;

  insert into public.list_items (tenant_id, list_id, label, sort_order)
  select target_tenant_id, days_list_id, seed.label, seed.sort_order
  from (values
    ('Mon', 100),
    ('Tue', 200),
    ('Wed', 300),
    ('Thu', 400),
    ('Fri', 500),
    ('Sat', 600),
    ('Sun', 700)
  ) as seed(label, sort_order)
  where not exists (
    select 1 from public.list_items item
    where item.tenant_id = target_tenant_id
      and item.list_id = days_list_id
      and item.parent_id is null
      and item.label = seed.label
  );

  insert into public.lists (tenant_id, name, include_other, created_by)
  values (target_tenant_id, 'Vehicle Type', true, target_user_id)
  on conflict (tenant_id, lower(name)) do update set include_other = excluded.include_other
  returning id into vehicle_type_list_id;

  insert into public.list_items (tenant_id, list_id, label, sort_order)
  select target_tenant_id, vehicle_type_list_id, seed.label, seed.sort_order
  from (values
    ('Service Truck', 100),
    ('Truck w/ Picker Crane', 200),
    ('Forklift', 300),
    ('Telehandler', 400)
  ) as seed(label, sort_order)
  where not exists (
    select 1 from public.list_items item
    where item.tenant_id = target_tenant_id
      and item.list_id = vehicle_type_list_id
      and item.parent_id is null
      and item.label = seed.label
  );

  insert into public.lists (tenant_id, name, include_other, created_by)
  values (target_tenant_id, 'vehicle list', true, target_user_id)
  on conflict (tenant_id, lower(name)) do update set include_other = excluded.include_other
  returning id into vehicle_list_id;

  insert into public.list_items (tenant_id, list_id, label, sort_order)
  select target_tenant_id, vehicle_list_id, seed.label, seed.sort_order
  from (values
    ('2024 Chev Silverado 2500 LP AZ30893', 100),
    ('2020 Ford 550 Dump Truck LP BE55409', 200),
    ('2017 K-Trailer Dump Trailer LP N78047', 300),
    ('2015 Well Cargo LP M4717S', 400)
  ) as seed(label, sort_order)
  where not exists (
    select 1 from public.list_items item
    where item.tenant_id = target_tenant_id
      and item.list_id = vehicle_list_id
      and item.parent_id is null
      and item.label = seed.label
  );

  insert into public.lists (tenant_id, name, include_other, created_by)
  values (target_tenant_id, 'Risk (Severity + Probability)', false, target_user_id)
  on conflict (tenant_id, lower(name)) do update set include_other = excluded.include_other
  returning id into risk_list_id;

  for parent_label, parent_sort in
    select * from (values
      ('1 - Immediate Danger (death, disaster)', 100),
      ('2 - Serious (major injury or damage)', 200),
      ('3 - Minor (non-serious injury or damage)', 300),
      ('4 - Negligible (first aid or less)', 400)
    ) as parents(label, sort_order)
  loop
    insert into public.list_items (tenant_id, list_id, label, sort_order)
    select target_tenant_id, risk_list_id, parent_label, parent_sort
    where not exists (
      select 1 from public.list_items item
      where item.tenant_id = target_tenant_id
        and item.list_id = risk_list_id
        and item.parent_id is null
        and item.label = parent_label
    )
    returning id into v_parent_id;

    if v_parent_id is null then
      select id into v_parent_id
      from public.list_items
      where tenant_id = target_tenant_id
        and list_id = risk_list_id
        and label = parent_label
      limit 1;
    end if;

    child_index := 1;
    foreach child_label in array child_labels loop
      insert into public.list_items (tenant_id, list_id, parent_id, label, sort_order)
      select target_tenant_id, risk_list_id, v_parent_id, child_label, child_index * 100
      where not exists (
        select 1 from public.list_items item
        where item.tenant_id = target_tenant_id
          and item.list_id = risk_list_id
          and item.parent_id = v_parent_id
          and item.label = child_label
      );
      child_index := child_index + 1;
    end loop;

    v_parent_id := null;
  end loop;

  -- New: Common Hazards list for the JHA starter form.
  insert into public.lists (tenant_id, name, include_other, created_by)
  values (target_tenant_id, 'Common Hazards', true, target_user_id)
  on conflict (tenant_id, lower(name)) do update set include_other = excluded.include_other
  returning id into hazard_list_id;

  insert into public.list_items (tenant_id, list_id, label, sort_order)
  select target_tenant_id, hazard_list_id, seed.label, seed.sort_order
  from (values
    ('Slip / Trip / Fall', 100),
    ('Working at Heights', 200),
    ('Electrical', 300),
    ('Confined Space', 400),
    ('Hot Work', 500),
    ('Pinch Point / Crush', 600),
    ('Manual Lifting', 700),
    ('Noise', 800),
    ('Hazardous Materials', 900),
    ('Mobile Equipment / Vehicle', 1000)
  ) as seed(label, sort_order)
  where not exists (
    select 1 from public.list_items item
    where item.tenant_id = target_tenant_id
      and item.list_id = hazard_list_id
      and item.parent_id is null
      and item.label = seed.label
  );
end;
$$;


ALTER FUNCTION "public"."seed_managed_lists_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_orientation_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_form_id uuid;
  v_section_id uuid;
begin
  -- Idempotent: skip if the general orientation form already exists.
  if exists (select 1 from public.forms where tenant_id = target_tenant_id and code = 'ORIENTATION') then
    return;
  end if;

  ---------------------------------------------------------------------------
  -- New Worker Orientation (every worker)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'New Worker Orientation', 'ORIENTATION', 'published', 'Health and safety orientation for every new hire, with employee and trainer sign-off.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Employee Information', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Employee being oriented', 'worker_select', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Position', 'short_text', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Start date', 'date', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Orientation date', 'date', true, false, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Worker Health & Safety Rights', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Reviewed the three worker rights and how OHS is enforced.', 'text_info', false, false, 50, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Right to know', 'checkbox', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Right to participate', 'checkbox', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Right to refuse dangerous work', 'checkbox', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Rules of enforcement (accountability and progressive discipline)', 'checkbox', true, false, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Hazards & Procedures', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'High-risk hazards (site specific)', 'checkbox', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hazard reporting procedures', 'checkbox', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Incident reporting procedures', 'checkbox', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Emergency response procedures', 'checkbox', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'WHMIS / hazardous products', 'checkbox', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Personal protective equipment (PPE)', 'checkbox', true, false, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'General safety rules', 'checkbox', true, false, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Working alone', 'checkbox', true, false, 800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Violence and harassment', 'checkbox', true, false, 900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Fitness for duty / drug & alcohol policy', 'checkbox', true, false, 1000, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'First aid / medical aid', 'checkbox', true, false, 1100, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Policies & Accountability', 400)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'New Employee Safety Handbook provided', 'checkbox', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Buddy assigned for general questions', 'checkbox', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Relevant legislation', 'checkbox', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Key procedures reviewed', 'checkbox', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Job responsibilities', 'checkbox', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Time and leave reporting', 'checkbox', false, false, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Overtime', 'checkbox', false, false, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Performance reviews', 'checkbox', false, false, 800, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Facility Tour', 500)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Introductions to staff and key personnel', 'checkbox', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Lunchroom / kitchen / coffee room', 'checkbox', false, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Muster point', 'checkbox', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Emergency exits and supplies', 'checkbox', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'First aid station', 'checkbox', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Parking', 'checkbox', false, false, 600, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Position Information', 600)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Initial job assignments and training plan', 'checkbox', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Job description, expectations and standards', 'checkbox', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Job schedule and hours', 'checkbox', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Payroll timing and time cards', 'checkbox', false, false, 400, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Acknowledgment & Sign-off', 700)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'By signing below, the employee acknowledges they received and understand the orientation above and will comply with the company safety program.', 'text_info', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Employee signature', 'signature', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Trainer / supervisor signature', 'signature', true, false, 300, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- Driver Orientation (NSC) — drivers only
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Driver Orientation (NSC)', 'DRIVER-ORIENT', 'published', 'Additional NSC training orientation for commercial drivers, with sign-off. Assign to drivers only.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Driver Information', 100)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Driver being oriented', 'worker_select', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Orientation date', 'date', true, false, 200, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'NSC Driver Training', 200)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'NSC drivers for an Alberta carrier must be trained in these topics.', 'text_info', false, false, 50, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hours of Service (logs / ELD use)', 'checkbox', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Daily trip / pre-trip inspection (Schedule 1, NSC Standard 13)', 'checkbox', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Defect reporting and out-of-service criteria', 'checkbox', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Cargo securement (NSC Standard 10)', 'checkbox', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Weights and dimensions', 'checkbox', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Transportation of Dangerous Goods (TDG) — if applicable', 'checkbox', false, false, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Fatigue management and distracted driving', 'checkbox', true, false, 700, '{}'::jsonb);

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Acknowledgment & Sign-off', 300)
  returning id into v_section_id;
  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'By signing below, the driver acknowledges they received and understand the NSC training above and will comply with it.', 'text_info', false, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Driver signature', 'signature', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Trainer / supervisor signature', 'signature', true, false, 300, '{}'::jsonb);
end;
$$;


ALTER FUNCTION "public"."seed_orientation_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_starter_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_vehicle_type_list_id uuid;
  v_risk_list_id uuid;
  v_hazard_list_id uuid;
  v_form_id uuid;
  v_section_id uuid;
  v_skip boolean;
begin
  -- Only seed if the tenant has no forms yet (idempotent on re-runs).
  select exists (select 1 from public.forms where tenant_id = target_tenant_id) into v_skip;
  if v_skip then
    return;
  end if;

  select id into v_vehicle_type_list_id from public.lists where tenant_id = target_tenant_id and lower(name) = 'vehicle type' limit 1;
  select id into v_risk_list_id from public.lists where tenant_id = target_tenant_id and lower(name) = 'risk (severity + probability)' limit 1;
  select id into v_hazard_list_id from public.lists where tenant_id = target_tenant_id and lower(name) = 'common hazards' limit 1;

  ---------------------------------------------------------------------------
  -- 1. Daily Pre-Trip Vehicle Inspection
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Daily Pre-Trip Vehicle Inspection', 'PRE-TRIP', 'published', 'Walkaround vehicle check before driving for the day.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Pre-Trip Inspection', 100)
  returning id into v_section_id;

  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Driver completing this inspection', 'worker_select', true, false, 100, '{"workerPickerScope":"current_worker"}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Vehicle type', 'dropdown_select_one', true, false, 300,
      case when v_vehicle_type_list_id is not null then jsonb_build_object('list_id', v_vehicle_type_list_id, 'list_name', 'Vehicle Type') else '{}'::jsonb end),
    (target_tenant_id, v_form_id, v_section_id, 'Odometer reading (km)', 'number', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Lights and signals working', 'pass_fail_na', true, true, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Tires and wheels (tread, pressure, lug nuts)', 'pass_fail_na', true, true, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Brakes feel firm and stop straight', 'pass_fail_na', true, true, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Mirrors and windshield clear and intact', 'pass_fail_na', true, true, 800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Fluids checked (oil, coolant, washer)', 'pass_fail_na', true, true, 900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Safety equipment present (first aid, fire extinguisher, triangles)', 'yes_no_na', true, true, 1000, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Photo of any issue', 'photo', false, true, 1100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Notes', 'long_text', false, false, 1200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Driver signature', 'signature', true, false, 1300, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- 2. Monthly Office Inspection
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Monthly Office Inspection', 'OFFICE-INSP', 'published', 'Monthly walkaround of office and warehouse work areas.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Office Inspection', 100)
  returning id into v_section_id;

  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Inspector', 'worker_select', true, false, 100, '{"workerPickerScope":"current_worker"}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Area / floor inspected', 'short_text', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Lighting adequate', 'pass_fail_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Fire extinguishers in place and tagged', 'pass_fail_na', true, true, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Emergency exits clear and unlocked', 'pass_fail_na', true, true, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'First aid kit stocked and accessible', 'pass_fail_na', true, true, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Floors clean and free of trip hazards', 'pass_fail_na', true, true, 800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Electrical cords in good condition (no fraying, no overloaded outlets)', 'pass_fail_na', true, true, 900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Ergonomic concerns observed', 'yes_no_na', true, true, 1000, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Photo of any issue', 'photo', false, true, 1100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Notes', 'long_text', false, false, 1200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Inspector signature', 'signature', true, false, 1300, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- 3. Job Hazard Assessment (JHA / FLHA)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Job Hazard Assessment', 'JHA', 'published', 'Identify hazards and controls before starting a task.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Hazard Assessment', 100)
  returning id into v_section_id;

  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Lead worker', 'worker_select', true, false, 100, '{"workerPickerScope":"current_worker"}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Workers on this task', 'workers_select', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Location', 'short_text', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Task description', 'long_text', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Hazards present', 'dropdown_select_multiple', true, false, 600,
      case when v_hazard_list_id is not null then jsonb_build_object('list_id', v_hazard_list_id, 'list_name', 'Common Hazards') else '{}'::jsonb end),
    (target_tenant_id, v_form_id, v_section_id, 'Risk rating', 'dropdown_select_one', true, false, 700,
      case when v_risk_list_id is not null then jsonb_build_object('list_id', v_risk_list_id, 'list_name', 'Risk (Severity + Probability)') else '{}'::jsonb end),
    (target_tenant_id, v_form_id, v_section_id, 'Controls in place to manage hazards', 'long_text', true, true, 800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'PPE required', 'long_text', true, false, 900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Photo of the work area', 'photo', false, false, 1000, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Lead worker signature', 'signature', true, false, 1100, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- 4. Toolbox Talk Sign-Off
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Toolbox Talk Sign-Off', 'TBT', 'published', 'Record of weekly toolbox safety meeting.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Toolbox Talk', 100)
  returning id into v_section_id;

  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Topic', 'short_text', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Presented by', 'worker_select', true, false, 300, '{"workerPickerScope":"current_worker"}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Workers in attendance', 'workers_select', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Key points discussed', 'long_text', true, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Questions or concerns raised', 'long_text', false, true, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Photo of meeting (optional)', 'photo', false, false, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Presenter signature', 'signature', true, false, 800, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- 5. Incident / Near Miss Report
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Incident or Near Miss Report', 'INC-RPT', 'published', 'Capture any incident, injury, or near miss that occurred on site.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Incident Details', 100)
  returning id into v_section_id;

  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Reported by', 'worker_select', true, false, 100, '{"workerPickerScope":"current_worker"}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date of incident', 'date', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Time of incident', 'time', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Location', 'short_text', true, false, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Workers involved', 'workers_select', false, false, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Witnesses', 'long_text', false, false, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Description of what happened', 'long_text', true, false, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Was anyone injured?', 'yes_no_na', true, true, 800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Was the worker transported to hospital?', 'yes_no_na', true, true, 900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'First aid administered?', 'yes_no_na', true, false, 1000, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Immediate corrective action taken', 'long_text', false, true, 1100, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Photo of scene', 'photo', false, false, 1200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Reporter signature', 'signature', true, false, 1300, '{}'::jsonb);

  ---------------------------------------------------------------------------
  -- 6. Equipment Inspection (generic)
  ---------------------------------------------------------------------------
  insert into public.forms (tenant_id, name, code, status, description, created_by, app_menu_visible, is_private, allow_duplicates, use_item_data_in_analytics)
  values (target_tenant_id, 'Equipment Inspection', 'EQ-CHECK', 'published', 'Pre-use inspection for any equipment, tool, or harness.', target_user_id, true, false, true, true)
  returning id into v_form_id;

  insert into public.form_sections (tenant_id, form_id, title, sort_order)
  values (target_tenant_id, v_form_id, 'Equipment Check', 100)
  returning id into v_section_id;

  insert into public.form_items (tenant_id, form_id, section_id, label, field_type, required, flaggable, sort_order, settings) values
    (target_tenant_id, v_form_id, v_section_id, 'Inspector', 'worker_select', true, false, 100, '{"workerPickerScope":"current_worker"}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Date', 'date', true, false, 200, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Equipment being inspected', 'equipment_select', true, false, 300, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Visible damage or wear?', 'yes_no_na', true, true, 400, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'All safety features functional', 'pass_fail_na', true, true, 500, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Clean and free of debris', 'pass_fail_na', true, true, 600, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Stored or staged correctly', 'pass_fail_na', true, true, 700, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Photo of any issue', 'photo', false, true, 800, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Notes', 'long_text', false, false, 900, '{}'::jsonb),
    (target_tenant_id, v_form_id, v_section_id, 'Inspector signature', 'signature', true, false, 1000, '{}'::jsonb);
end;
$$;


ALTER FUNCTION "public"."seed_starter_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tag_cor_forms_for_tenant"("target_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  update public.forms f
  set cor_element = m.element, cor_tracked = true
  from (values
    ('SAFETY-ACCT', 1), ('DECL-COMMIT', 1),
    ('HAZ-RPT', 2), ('JHA', 2),
    ('HS-REC', 4),
    ('ORIENTATION', 5), ('DRIVER-ORIENT', 5), ('COMP-ASSESS', 5), ('DRIVER-EVAL', 5),
    ('CONT-PREQUAL', 6), ('CONT-ORIENT', 6),
    ('OFFICE-INSP', 7), ('SHOP-YARD-INSP', 7), ('PRE-TRIP', 7), ('TT-TRIP', 7), ('EQ-CHECK', 7), ('SCHED-MAINT', 7),
    ('DRILL', 8),
    ('INC-RPT', 9),
    ('TBT', 10)
  ) as m(code, element)
  where f.tenant_id = target_tenant_id and f.code = m.code and f.cor_element is null;
end;
$$;


ALTER FUNCTION "public"."tag_cor_forms_for_tenant"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."tag_inspection_defect_severity_for_tenant"("target_tenant_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
begin
  update public.form_items i
  set settings = jsonb_set(
    coalesce(i.settings, '{}'::jsonb),
    '{defect_severity}',
    to_jsonb(
      case
        when i.label ilike any (array[
          '%brake%', '%steering%', '%tires%', '%wheel%', '%suspension%',
          '%coupling%', '%frame%', '%cargo securement%', '%fuel%',
          '%dangerous goods%', '%seatbelt%', '%exhaust%', '%safety feature%'
        ]) then 'major'
        else 'minor'
      end
    ),
    true
  )
  from public.forms f
  where i.form_id = f.id
    and f.tenant_id = target_tenant_id
    and f.code in ('TT-TRIP', 'PRE-TRIP', 'EQ-CHECK')
    and i.field_type = 'pass_fail_na';
end;
$$;


ALTER FUNCTION "public"."tag_inspection_defect_severity_for_tenant"("target_tenant_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_checklist_template_item_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_checklist_template t where t.id = new.template_id and t.tenant_id = new.tenant_id
  ) then
    raise exception 'Checklist item must belong to the same tenant as its template.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_checklist_template_item_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_customer_equipment_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_customer c where c.id = new.customer_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Customer equipment must belong to the same tenant as its customer.';
  end if;

  if new.service_address_id is not null and not exists (
    select 1 from public.trade_service_address a where a.id = new.service_address_id and a.tenant_id = new.tenant_id
  ) then
    raise exception 'Customer equipment service address must belong to the same tenant.';
  end if;

  if new.work_order_id is not null and not exists (
    select 1 from public.trade_work_order w where w.id = new.work_order_id and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Customer equipment work order must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_customer_equipment_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_invoice_line_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_invoice i where i.id = new.invoice_id and i.tenant_id = new.tenant_id
  ) then
    raise exception 'Invoice line must belong to the same tenant as its invoice.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_invoice_line_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_invoice_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_customer c where c.id = new.customer_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Invoice customer must belong to the same tenant.';
  end if;

  if new.work_order_id is not null and not exists (
    select 1 from public.trade_work_order w where w.id = new.work_order_id and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Invoice work order must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_invoice_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_service_address_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_customer c where c.id = new.customer_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Trade service address must belong to the same tenant as its customer.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_service_address_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_service_agreement_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_customer c where c.id = new.customer_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Service agreement customer must belong to the same tenant.';
  end if;

  if new.service_address_id is not null and not exists (
    select 1 from public.trade_service_address a
    where a.id = new.service_address_id
      and a.tenant_id = new.tenant_id
      and a.customer_id = new.customer_id
  ) then
    raise exception 'Service agreement address must belong to the same customer.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_service_agreement_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_work_order_field_log_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_work_order w where w.id = new.work_order_id and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Work order field log must belong to the same tenant as its work order.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_work_order_field_log_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_work_order_line_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_work_order w where w.id = new.work_order_id and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Work order line must belong to the same tenant as its work order.';
  end if;

  if new.price_book_item_id is not null and not exists (
    select 1 from public.trade_price_book_item p where p.id = new.price_book_item_id and p.tenant_id = new.tenant_id
  ) then
    raise exception 'Work order line price book item must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_work_order_line_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_work_order_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_customer c where c.id = new.customer_id and c.tenant_id = new.tenant_id
  ) then
    raise exception 'Work order customer must belong to the same tenant.';
  end if;

  if new.service_address_id is not null and not exists (
    select 1 from public.trade_service_address a
    where a.id = new.service_address_id
      and a.tenant_id = new.tenant_id
      and a.customer_id = new.customer_id
  ) then
    raise exception 'Work order service address must belong to the same customer.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_work_order_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_work_order_material_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_work_order w where w.id = new.work_order_id and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Work order material must belong to the same tenant as its work order.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_work_order_material_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_work_order_note_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_work_order w where w.id = new.work_order_id and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Work order note must belong to the same tenant as its work order.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_work_order_note_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_work_order_task_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_work_order w where w.id = new.work_order_id and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Work order task must belong to the same tenant as its work order.';
  end if;

  if new.source_template_id is not null and not exists (
    select 1 from public.trade_checklist_template t where t.id = new.source_template_id and t.tenant_id = new.tenant_id
  ) then
    raise exception 'Work order task template must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_work_order_task_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trade_work_order_time_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.trade_work_order w where w.id = new.work_order_id and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Work order time entry must belong to the same tenant as its work order.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."trade_work_order_time_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transport_document_subject_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.scope = 'driver' then
    if new.subject_id is null or not exists (
      select 1 from public.transport_driver d where d.id = new.subject_id and d.tenant_id = new.tenant_id
    ) then
      raise exception 'Driver-scoped transport document must reference a driver in the same tenant.';
    end if;
  elsif new.scope = 'vehicle' then
    if new.subject_id is null or not exists (
      select 1 from public.equipment e where e.id = new.subject_id and e.tenant_id = new.tenant_id
    ) then
      raise exception 'Vehicle-scoped transport document must reference equipment in the same tenant.';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."transport_document_subject_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transport_driver_user_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if new.user_id is not null and not exists (
    select 1 from public.users u where u.id = new.user_id and u.tenant_id = new.tenant_id
  ) then
    raise exception 'Transport driver user must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."transport_driver_user_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transport_duty_status_driver_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.transport_driver d where d.id = new.driver_id and d.tenant_id = new.tenant_id
  ) then
    raise exception 'Duty-status event driver must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."transport_duty_status_driver_matches"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."transport_medical_record_driver_matches"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  if not exists (
    select 1 from public.transport_driver d where d.id = new.driver_id and d.tenant_id = new.tenant_id
  ) then
    raise exception 'Medical record driver must belong to the same tenant.';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."transport_medical_record_driver_matches"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."auto_share_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "name" "text" NOT NULL,
    "recipient_type" "text" NOT NULL,
    "email" "text",
    "phone" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."auto_share_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."certification_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "expires" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."certification_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."certifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "worker_profile_id" "uuid" NOT NULL,
    "certification_type_id" "uuid",
    "name" "text" NOT NULL,
    "issued_on" "date",
    "expires_on" "date",
    "attachment_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."certifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_order" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "number" integer NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "origin" "text" DEFAULT 'field_condition'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "schedule_impact_days" integer DEFAULT 0 NOT NULL,
    "total_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_signer_name" "text",
    CONSTRAINT "change_order_origin_check" CHECK (("origin" = ANY (ARRAY['owner_request'::"text", 'field_condition'::"text", 'design_clarification'::"text", 'rfi'::"text", 'other'::"text"]))),
    CONSTRAINT "change_order_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'submitted'::"text", 'approved'::"text", 'rejected'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."change_order" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_order_approval" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "change_order_id" "uuid" NOT NULL,
    "decision" "text" NOT NULL,
    "decided_by" "uuid",
    "decided_by_name" "text",
    "signer_name" "text",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "change_order_approval_decision_check" CHECK (("decision" = ANY (ARRAY['submitted'::"text", 'approved'::"text", 'rejected'::"text", 'reopened'::"text", 'voided'::"text"])))
);


ALTER TABLE "public"."change_order_approval" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_order_attachment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "change_order_id" "uuid" NOT NULL,
    "file_name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "content_type" "text",
    "file_size" bigint,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."change_order_attachment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_order_line" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "change_order_id" "uuid" NOT NULL,
    "category" "text" DEFAULT 'labor'::"text" NOT NULL,
    "description" "text" NOT NULL,
    "quantity" numeric(14,3) DEFAULT 1 NOT NULL,
    "unit" "text",
    "unit_cost" numeric(14,2) DEFAULT 0 NOT NULL,
    "amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "change_order_line_category_check" CHECK (("category" = ANY (ARRAY['labor'::"text", 'material'::"text", 'equipment'::"text", 'subcontractor'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."change_order_line" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."change_order_markup" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "change_order_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "percent" numeric(7,3),
    "amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."change_order_markup" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."co_project" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "client_name" "text",
    "contract_number" "text",
    "original_contract_value" numeric(14,2) DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "co_project_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."co_project" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."company_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "company_name" "text" NOT NULL,
    "address" "text",
    "phone" "text",
    "timezone" "text" DEFAULT 'America/Vancouver'::"text" NOT NULL,
    "logo_path" "text",
    "company_id" "text",
    "integrations" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "dcn_company_prefix" "text",
    "dcn_include_source_code" boolean DEFAULT true NOT NULL,
    "dcn_include_revision" boolean DEFAULT false NOT NULL,
    "dcn_sequence_padding" integer DEFAULT 4 NOT NULL,
    "dcn_include_year" boolean DEFAULT false NOT NULL,
    "maintenance_contact_user_id" "uuid"
);


ALTER TABLE "public"."company_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."consultant_access" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "consultant_id" "uuid",
    "allowed" boolean DEFAULT true NOT NULL,
    "override_reason" "text",
    "override_condition" "text",
    "override_expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "consultant_access_override_condition_check" CHECK ((("override_condition" IS NULL) OR ("override_condition" = ANY (ARRAY['court_order'::"text", 'ministry_order'::"text", 'ninety_day_dormancy'::"text"]))))
);


ALTER TABLE "public"."consultant_access" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."consultant_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid",
    "consultant_id" "uuid",
    "action" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."consultant_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."consultants" (
    "id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."consultants" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_control_register" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "document_type" "text" NOT NULL,
    "source_table" "text" NOT NULL,
    "source_id" "uuid" NOT NULL,
    "dcn" "text" NOT NULL,
    "version" "text" DEFAULT '1.0'::"text" NOT NULL,
    "revision_notes" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approval_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "approved_by" "uuid",
    "approved_at" timestamp with time zone,
    "revision_of_id" "uuid"
);


ALTER TABLE "public"."document_control_register" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dti_inspection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "trailer_equipment_id" "uuid",
    "driver_user_id" "uuid",
    "province" "text" NOT NULL,
    "schedule_no" smallint DEFAULT 1 NOT NULL,
    "inspection_type" "text" DEFAULT 'pre'::"text" NOT NULL,
    "odometer" numeric(12,1),
    "location" "text",
    "overall_result" "text" NOT NULL,
    "out_of_service" boolean DEFAULT false NOT NULL,
    "out_of_service_cleared_at" timestamp with time zone,
    "out_of_service_cleared_by" "uuid",
    "signature_name" "text",
    "notes" "text",
    "source" "text" DEFAULT 'admin'::"text" NOT NULL,
    "completed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "valid_until" timestamp with time zone NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dti_inspection_inspection_type_check" CHECK (("inspection_type" = ANY (ARRAY['pre'::"text", 'post'::"text"]))),
    CONSTRAINT "dti_inspection_overall_result_check" CHECK (("overall_result" = ANY (ARRAY['clean'::"text", 'minor'::"text", 'major'::"text"]))),
    CONSTRAINT "dti_inspection_province_check" CHECK (("province" = ANY (ARRAY['BC'::"text", 'AB'::"text", 'ON'::"text"]))),
    CONSTRAINT "dti_inspection_schedule_no_check" CHECK (("schedule_no" = ANY (ARRAY[1, 2, 3]))),
    CONSTRAINT "dti_inspection_source_check" CHECK (("source" = ANY (ARRAY['admin'::"text", 'worker'::"text", 'offline'::"text", 'import'::"text"])))
);


ALTER TABLE "public"."dti_inspection" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dti_inspection_item" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "inspection_id" "uuid" NOT NULL,
    "item_no" smallint NOT NULL,
    "item_label" "text" NOT NULL,
    "status" "text" NOT NULL,
    "note" "text",
    "photo_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dti_inspection_item_status_check" CHECK (("status" = ANY (ARRAY['pass'::"text", 'minor'::"text", 'major'::"text"])))
);


ALTER TABLE "public"."dti_inspection_item" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eld_connection" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "status" "text" DEFAULT 'needs_setup'::"text" NOT NULL,
    "external_account_id" "text",
    "last_synced_at" timestamp with time zone,
    "last_error" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eld_connection_provider_check" CHECK (("provider" = ANY (ARRAY['motive'::"text", 'samsara'::"text", 'geotab'::"text", 'isaac'::"text"]))),
    CONSTRAINT "eld_connection_status_check" CHECK (("status" = ANY (ARRAY['needs_setup'::"text", 'connected'::"text", 'error'::"text", 'disconnected'::"text"])))
);


ALTER TABLE "public"."eld_connection" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eld_connection_secret" (
    "connection_id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "access_token" "text",
    "refresh_token" "text",
    "token_expires_at" timestamp with time zone,
    "api_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."eld_connection_secret" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eld_device" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "external_vehicle_id" "text" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "identifier" "text",
    "model" "text",
    "firmware" "text",
    "status" "text",
    "last_seen_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eld_device_provider_check" CHECK (("provider" = ANY (ARRAY['motive'::"text", 'samsara'::"text", 'geotab'::"text", 'isaac'::"text"])))
);


ALTER TABLE "public"."eld_device" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eld_driver_event" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "equipment_id" "uuid",
    "event_type" "text" NOT NULL,
    "external_event_id" "text",
    "occurred_at" timestamp with time zone NOT NULL,
    "severity" "text",
    "value" numeric,
    "label" "text",
    "description" "text",
    "location" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eld_driver_event_event_type_check" CHECK (("event_type" = ANY (ARRAY['speeding'::"text", 'harsh_brake'::"text", 'harsh_accel'::"text", 'collision'::"text", 'other'::"text"]))),
    CONSTRAINT "eld_driver_event_provider_check" CHECK (("provider" = ANY (ARRAY['motive'::"text", 'samsara'::"text", 'geotab'::"text", 'isaac'::"text"])))
);


ALTER TABLE "public"."eld_driver_event" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eld_driver_link" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "external_driver_id" "text" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eld_driver_link_provider_check" CHECK (("provider" = ANY (ARRAY['motive'::"text", 'samsara'::"text", 'geotab'::"text", 'isaac'::"text"])))
);


ALTER TABLE "public"."eld_driver_link" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eld_driver_performance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "external_driver_id" "text" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "period_start" "date",
    "period_end" "date",
    "score" numeric,
    "total_events" integer,
    "speeding_count" integer,
    "harsh_brake_count" integer,
    "harsh_accel_count" integer,
    "distance" numeric,
    "drive_time_minutes" integer,
    "reported_at" timestamp with time zone,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eld_driver_performance_provider_check" CHECK (("provider" = ANY (ARRAY['motive'::"text", 'samsara'::"text", 'geotab'::"text", 'isaac'::"text"])))
);


ALTER TABLE "public"."eld_driver_performance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eld_driver_profile" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "external_driver_id" "text" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "email" "text",
    "phone" "text",
    "role" "text",
    "status" "text",
    "manager_name" "text",
    "manager_email" "text",
    "reported_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eld_driver_profile_provider_check" CHECK (("provider" = ANY (ARRAY['motive'::"text", 'samsara'::"text", 'geotab'::"text", 'isaac'::"text"])))
);


ALTER TABLE "public"."eld_driver_profile" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eld_vehicle_event" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "external_event_id" "text",
    "code" "text",
    "label" "text",
    "description" "text",
    "severity" "text",
    "occurred_at" timestamp with time zone NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eld_vehicle_event_event_type_check" CHECK (("event_type" = ANY (ARRAY['disconnect'::"text", 'fault_code'::"text"]))),
    CONSTRAINT "eld_vehicle_event_provider_check" CHECK (("provider" = ANY (ARRAY['motive'::"text", 'samsara'::"text", 'geotab'::"text", 'isaac'::"text"])))
);


ALTER TABLE "public"."eld_vehicle_event" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."eld_vehicle_link" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "external_vehicle_id" "text" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "eld_vehicle_link_provider_check" CHECK (("provider" = ANY (ARRAY['motive'::"text", 'samsara'::"text", 'geotab'::"text", 'isaac'::"text"])))
);


ALTER TABLE "public"."eld_vehicle_link" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "unit_number" "text" NOT NULL,
    "name" "text",
    "category" "text" DEFAULT 'other'::"text" NOT NULL,
    "make" "text",
    "model" "text",
    "year" integer,
    "vin_or_serial" "text",
    "license_plate" "text",
    "tracking_mode" "text" NOT NULL,
    "current_meter" numeric,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "assigned_to" "uuid",
    "location_id" "uuid",
    "purchase_date" "date",
    "notes" "text",
    "photo_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_commercial" boolean DEFAULT false NOT NULL,
    CONSTRAINT "equipment_category_check" CHECK (("category" = ANY (ARRAY['vehicle'::"text", 'mobile_equipment'::"text", 'trailer'::"text", 'generator'::"text", 'compressor'::"text", 'light_tower'::"text", 'tool'::"text", 'other'::"text"]))),
    CONSTRAINT "equipment_check" CHECK ((("status" <> 'down'::"text") OR ("location_id" IS NULL))),
    CONSTRAINT "equipment_current_meter_check" CHECK ((("current_meter" IS NULL) OR ("current_meter" >= (0)::numeric))),
    CONSTRAINT "equipment_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'down'::"text", 'retired'::"text", 'sold'::"text"]))),
    CONSTRAINT "equipment_tracking_mode_check" CHECK (("tracking_mode" = ANY (ARRAY['mileage'::"text", 'hours'::"text"]))),
    CONSTRAINT "equipment_year_check" CHECK ((("year" IS NULL) OR (("year" >= 1900) AND ("year" <= 2200))))
);


ALTER TABLE "public"."equipment" OWNER TO "postgres";


COMMENT ON COLUMN "public"."equipment"."is_commercial" IS 'When true, the unit is a commercial/NSC-regulated vehicle and must carry the required compliance documents (registration, insurance, maintenance record).';



CREATE TABLE IF NOT EXISTS "public"."equipment_document" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "doc_type" "text" DEFAULT 'other'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "issued_date" "date",
    "expiry_date" "date" NOT NULL,
    "reminder_lead_days" integer DEFAULT 30 NOT NULL,
    "attachment_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "equipment_document_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['registration'::"text", 'insurance'::"text", 'cvip'::"text", 'permit'::"text", 'certification'::"text", 'other'::"text"]))),
    CONSTRAINT "equipment_document_reminder_lead_days_check" CHECK (("reminder_lead_days" >= 0))
);


ALTER TABLE "public"."equipment_document" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment_maintenance_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'other'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "performed_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "meter_at_service" numeric,
    "cost" numeric,
    "vendor" "text",
    "performed_by" "uuid",
    "attachment_ids" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "equipment_maintenance_log_cost_check" CHECK ((("cost" IS NULL) OR ("cost" >= (0)::numeric))),
    CONSTRAINT "equipment_maintenance_log_meter_at_service_check" CHECK ((("meter_at_service" IS NULL) OR ("meter_at_service" >= (0)::numeric))),
    CONSTRAINT "equipment_maintenance_log_type_check" CHECK (("type" = ANY (ARRAY['oil_change'::"text", 'repair'::"text", 'inspection_service'::"text", 'tire'::"text", 'scheduled_service'::"text", 'unscheduled_repair'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."equipment_maintenance_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment_meter_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "value" numeric NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "recorded_by" "uuid",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_submission_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "equipment_meter_log_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'inspection'::"text", 'maintenance'::"text", 'eld'::"text"]))),
    CONSTRAINT "equipment_meter_log_value_check" CHECK (("value" >= (0)::numeric))
);


ALTER TABLE "public"."equipment_meter_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment_scheduled_service" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "service_type" "text" DEFAULT 'other'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "interval_mode" "text" NOT NULL,
    "due_date" "date",
    "due_meter" numeric,
    "recurrence_value" integer,
    "recurrence_unit" "text",
    "last_completed_at" "date",
    "last_completed_meter" numeric,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "window_start_meter" numeric,
    "warn_meter" numeric,
    "date_lead_days" integer,
    "meter_lead" numeric,
    CONSTRAINT "equipment_scheduled_service_check" CHECK (((("interval_mode" = 'by_date'::"text") AND ("due_date" IS NOT NULL)) OR (("interval_mode" = 'by_meter'::"text") AND ("due_meter" IS NOT NULL)) OR (("interval_mode" = 'both'::"text") AND (("due_date" IS NOT NULL) OR ("due_meter" IS NOT NULL))))),
    CONSTRAINT "equipment_scheduled_service_date_lead_days_check" CHECK ((("date_lead_days" IS NULL) OR ("date_lead_days" >= 0))),
    CONSTRAINT "equipment_scheduled_service_due_meter_check" CHECK ((("due_meter" IS NULL) OR ("due_meter" >= (0)::numeric))),
    CONSTRAINT "equipment_scheduled_service_interval_mode_check" CHECK (("interval_mode" = ANY (ARRAY['by_date'::"text", 'by_meter'::"text", 'both'::"text"]))),
    CONSTRAINT "equipment_scheduled_service_last_completed_meter_check" CHECK ((("last_completed_meter" IS NULL) OR ("last_completed_meter" >= (0)::numeric))),
    CONSTRAINT "equipment_scheduled_service_meter_lead_check" CHECK ((("meter_lead" IS NULL) OR ("meter_lead" >= (0)::numeric))),
    CONSTRAINT "equipment_scheduled_service_recurrence_unit_check" CHECK ((("recurrence_unit" IS NULL) OR ("recurrence_unit" = ANY (ARRAY['meter'::"text", 'days'::"text", 'months'::"text"])))),
    CONSTRAINT "equipment_scheduled_service_recurrence_value_check" CHECK ((("recurrence_value" IS NULL) OR ("recurrence_value" > 0))),
    CONSTRAINT "equipment_scheduled_service_service_type_check" CHECK (("service_type" = ANY (ARRAY['oil_change'::"text", 'inspection'::"text", 'certification'::"text", 'registration'::"text", 'scheduled_maintenance'::"text", 'other'::"text"]))),
    CONSTRAINT "equipment_scheduled_service_warn_meter_check" CHECK ((("warn_meter" IS NULL) OR ("warn_meter" >= (0)::numeric))),
    CONSTRAINT "equipment_scheduled_service_window_order" CHECK (((("window_start_meter" IS NULL) OR ("warn_meter" IS NULL) OR ("window_start_meter" <= "warn_meter")) AND (("warn_meter" IS NULL) OR ("due_meter" IS NULL) OR ("warn_meter" <= "due_meter")) AND (("window_start_meter" IS NULL) OR ("due_meter" IS NULL) OR ("window_start_meter" <= "due_meter")))),
    CONSTRAINT "equipment_scheduled_service_window_start_meter_check" CHECK ((("window_start_meter" IS NULL) OR ("window_start_meter" >= (0)::numeric)))
);


ALTER TABLE "public"."equipment_scheduled_service" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment_submission_link" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "equipment_id" "uuid" NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "form_type" "text",
    "linked_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "link_source" "text" DEFAULT 'auto'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "action_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "equipment_submission_link_link_source_check" CHECK (("link_source" = ANY (ARRAY['auto'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."equipment_submission_link" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."field_ticket" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "estimated_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "photo_path" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "change_order_id" "uuid",
    "submitted_by" "uuid",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "field_ticket_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'promoted'::"text", 'dismissed'::"text"])))
);


ALTER TABLE "public"."field_ticket" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."follow_ups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "parent_submission_id" "uuid",
    "form_item_id" "uuid",
    "assigned_to" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "photo_path" "text",
    "signoff_by" "uuid",
    "signoff_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "due_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "equipment_id" "uuid"
);


ALTER TABLE "public"."follow_ups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "section_id" "uuid" NOT NULL,
    "field_type" "text" NOT NULL,
    "label" "text" NOT NULL,
    "helper_text" "text",
    "required" boolean DEFAULT false NOT NULL,
    "flaggable" boolean DEFAULT true NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."form_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."form_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "collapsible" boolean DEFAULT false NOT NULL,
    "repeatable" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."form_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."forms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "description" "text",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "is_private" boolean DEFAULT false NOT NULL,
    "app_menu_visible" boolean DEFAULT true NOT NULL,
    "allow_duplicates" boolean DEFAULT true NOT NULL,
    "use_item_data_in_analytics" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "import_detected_text" "text",
    "import_detected_fields" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "cor_element" smallint,
    "cor_tracked" boolean DEFAULT false NOT NULL,
    "cor_element_key" "text",
    CONSTRAINT "forms_cor_element_key_check" CHECK ((("cor_element_key" IS NULL) OR ("cor_element_key" = ANY ('{management_commitment,senior_management_leadership,hazard_assessment,hazard_control,committees_reps,training,other_parties,inspections,preventative_maintenance,emergency_response,first_aid,investigations,program_administration,company_rules,ppe,legislation}'::"text"[])))),
    CONSTRAINT "forms_cor_element_range" CHECK ((("cor_element" IS NULL) OR (("cor_element" >= 1) AND ("cor_element" <= 10))))
);


ALTER TABLE "public"."forms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."gc_rfi" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "number" integer NOT NULL,
    "subject" "text" NOT NULL,
    "question" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "answer" "text",
    "due_on" "date",
    "created_by" "uuid",
    "answered_by" "uuid",
    "answered_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "gc_rfi_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'answered'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."gc_rfi" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."list_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "list_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "parent_id" "uuid"
);


ALTER TABLE "public"."list_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lists" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "include_other" boolean DEFAULT true NOT NULL,
    "used_in_forms_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_by" "uuid"
);


ALTER TABLE "public"."lists" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "visibility_rule" "text" DEFAULT 'only_workers_assigned'::"text" NOT NULL,
    "start_date" "date",
    "default_for_new_workers" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "channel" "text" DEFAULT 'in_app'::"text" NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "submission_id" "uuid",
    "recipient_name" "text",
    "recipient_contact" "text",
    "recipient_type" "text",
    "delivery_status" "text" DEFAULT 'delivered'::"text" NOT NULL,
    "delivery_error" "text",
    "delivered_at" timestamp with time zone,
    "delivery_attempts" integer DEFAULT 0 NOT NULL,
    "last_delivery_attempt_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    CONSTRAINT "notifications_delivery_attempts_check" CHECK (("delivery_attempts" >= 0)),
    CONSTRAINT "notifications_delivery_status_check" CHECK (("delivery_status" = ANY (ARRAY['queued'::"text", 'delivered'::"text", 'skipped'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."permission_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "power_ceiling" "public"."power_level" NOT NULL,
    "capabilities" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."permission_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."print_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "header_option" "text" DEFAULT 'company_info_only'::"text" NOT NULL,
    "logo_placement" "text" DEFAULT 'left'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "footer_note" "text" DEFAULT 'Printed documents are uncontrolled unless issued through document control.'::"text" NOT NULL,
    "prepared_by_label" "text" DEFAULT 'Prepared by'::"text" NOT NULL,
    "show_printed_at" boolean DEFAULT true NOT NULL,
    CONSTRAINT "print_settings_header_option_check" CHECK (("header_option" = ANY (ARRAY['company_info_only'::"text", 'company_info_and_logo'::"text", 'logo_only'::"text"]))),
    CONSTRAINT "print_settings_logo_placement_check" CHECK (("logo_placement" = ANY (ARRAY['left'::"text", 'right'::"text"])))
);


ALTER TABLE "public"."print_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resource_sections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."resource_sections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "section_id" "uuid",
    "name" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text",
    "dcn" "text",
    "version" "text" DEFAULT '1.0'::"text" NOT NULL,
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "search_text" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "body_text" "text",
    "cor_element" smallint,
    "cor_tracked" boolean DEFAULT false NOT NULL,
    "review_date" "date",
    "review_interval_months" smallint,
    "reminder_lead_days" integer DEFAULT 30 NOT NULL,
    "cor_element_key" "text",
    CONSTRAINT "resources_cor_element_key_check" CHECK ((("cor_element_key" IS NULL) OR ("cor_element_key" = ANY ('{management_commitment,senior_management_leadership,hazard_assessment,hazard_control,committees_reps,training,other_parties,inspections,preventative_maintenance,emergency_response,first_aid,investigations,program_administration,company_rules,ppe,legislation}'::"text"[])))),
    CONSTRAINT "resources_cor_element_range" CHECK ((("cor_element" IS NULL) OR (("cor_element" >= 1) AND ("cor_element" <= 10)))),
    CONSTRAINT "resources_reminder_lead_range" CHECK ((("reminder_lead_days" >= 0) AND ("reminder_lead_days" <= 365))),
    CONSTRAINT "resources_review_interval_range" CHECK ((("review_interval_months" IS NULL) OR (("review_interval_months" >= 1) AND ("review_interval_months" <= 120))))
);


ALTER TABLE "public"."resources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scheduled_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "schedule_id" "uuid" NOT NULL,
    "assigned_to" "uuid",
    "due_at" timestamp with time zone NOT NULL,
    "completed_submission_id" "uuid",
    "status" "text" DEFAULT 'due'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."scheduled_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "form_id" "uuid",
    "location_id" "uuid",
    "assignee_id" "uuid",
    "recurrence_rule" "text" NOT NULL,
    "next_due_at" timestamp with time zone,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."signatures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "signer_user_id" "uuid",
    "signer_name" "text" NOT NULL,
    "signature_path" "text" NOT NULL,
    "signed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."signatures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "form_item_id" "uuid",
    "storage_path" "text",
    "local_dexie_id" "text",
    "caption" "text",
    "captured_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."submission_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submission_values" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "submission_id" "uuid" NOT NULL,
    "form_item_id" "uuid" NOT NULL,
    "value" "jsonb" DEFAULT 'null'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."submission_values" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "form_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "submitted_by" "uuid",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "source_device_id" "text",
    "signed_device_id" "text",
    "sync_state" "text" DEFAULT 'synced'::"text" NOT NULL,
    "submitted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenant_audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "actor_user_id" "uuid",
    "actor_role" "text",
    "action" "text" NOT NULL,
    "entity_table" "text",
    "entity_id" "uuid",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "tenant_audit_log_action_check" CHECK (("length"(TRIM(BOTH FROM "action")) > 0))
);


ALTER TABLE "public"."tenant_audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."tenants" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "consultant_access_revoked" boolean DEFAULT false NOT NULL,
    "document_control_enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "subscription_status" "public"."tenant_subscription_status" DEFAULT 'active'::"public"."tenant_subscription_status" NOT NULL,
    "trial_ends_at" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "transport_enabled" boolean DEFAULT false NOT NULL,
    "safety_fitness_cert_number" "text",
    "safety_fitness_expires_on" "date",
    "cor_enabled" boolean DEFAULT true NOT NULL,
    "plan" "text" DEFAULT 'core'::"text" NOT NULL,
    "change_orders_enabled" boolean DEFAULT false NOT NULL,
    "daily_inspection_enabled" boolean DEFAULT false NOT NULL,
    "country" "text" DEFAULT 'CA'::"text" NOT NULL,
    "emr_rate" numeric(5,2),
    "emr_year" integer,
    "trades_enabled" boolean DEFAULT false NOT NULL,
    "gc_enabled" boolean DEFAULT false NOT NULL,
    "default_labor_rate" numeric(12,2) DEFAULT 0 NOT NULL,
    "cor_certifying_partner" "text" DEFAULT 'amta'::"text" NOT NULL,
    "standalone_modules" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    CONSTRAINT "tenants_cor_certifying_partner_check" CHECK (("cor_certifying_partner" = ANY (ARRAY['aasp'::"text", 'acsa'::"text", 'amta'::"text", 'mhsa'::"text", 'amhsa'::"text", 'energy_safety'::"text", 'food_processors'::"text", 'forest_products'::"text", 'continuing_care'::"text", 'ihsa'::"text"]))),
    CONSTRAINT "tenants_country_check" CHECK (("country" = ANY (ARRAY['CA'::"text", 'US'::"text"]))),
    CONSTRAINT "tenants_plan_check" CHECK (("plan" = ANY (ARRAY['core'::"text", 'operations'::"text", 'pro'::"text", 'carrier'::"text", 'standalone'::"text"])))
);


ALTER TABLE "public"."tenants" OWNER TO "postgres";


COMMENT ON COLUMN "public"."tenants"."plan" IS 'Billing tier that gates features once the trial ends: standalone, core, operations, pro, or carrier.';



COMMENT ON COLUMN "public"."tenants"."daily_inspection_enabled" IS 'Standalone Daily Trip Inspection (NSC/CVOR DVIR) module on/off. Independent of transport_enabled.';



COMMENT ON COLUMN "public"."tenants"."country" IS 'Tenant country for region-aware compliance and terminology: CA (COR/WCB) or US (OSHA/EMR). Default CA leaves existing tenants unchanged.';



COMMENT ON COLUMN "public"."tenants"."emr_rate" IS 'Experience Modification Rate (US safety metric), e.g. 0.85. Null when unset. Shown on the US OSHA safety home.';



COMMENT ON COLUMN "public"."tenants"."emr_year" IS 'Policy year the emr_rate applies to, e.g. 2026. Null when unset.';



COMMENT ON COLUMN "public"."tenants"."trades_enabled" IS 'Trades / Field Service module on/off (dispatch, price book, service agreements). Pro-tier, default off.';



COMMENT ON COLUMN "public"."tenants"."gc_enabled" IS 'General Contractor / Construction Projects module on/off (project workspace built on co_project). Pro-tier, default off.';



COMMENT ON COLUMN "public"."tenants"."default_labor_rate" IS 'Default hourly labour cost used for trades job costing (revenue minus labour). 0 until set.';



COMMENT ON COLUMN "public"."tenants"."standalone_modules" IS 'Feature keys unlocked for a tenant on the standalone ($10) plan, e.g. {daily_inspection}. Ignored for other plans.';



CREATE TABLE IF NOT EXISTS "public"."trade_checklist_template" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "work_type" "text",
    "active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trade_checklist_template_work_type_check" CHECK (("work_type" = ANY (ARRAY['service_call'::"text", 'project'::"text"])))
);


ALTER TABLE "public"."trade_checklist_template" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_checklist_template_item" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "template_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trade_checklist_template_item" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_customer" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "contact_name" "text",
    "email" "text",
    "phone" "text",
    "billing_address" "text",
    "notes" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trade_customer_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."trade_customer" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_customer_equipment" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "service_address_id" "uuid",
    "work_order_id" "uuid",
    "equipment_type" "text",
    "make" "text",
    "model" "text",
    "serial" "text",
    "location_note" "text",
    "installed_on" "date",
    "notes" "text",
    "photo_path" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "condition" "text",
    "needs_follow_up" boolean DEFAULT false NOT NULL,
    "follow_up_note" "text",
    CONSTRAINT "trade_customer_equipment_condition_check" CHECK (("condition" = ANY (ARRAY['good'::"text", 'monitor'::"text", 'needs_replacement'::"text"]))),
    CONSTRAINT "trade_customer_equipment_has_value" CHECK ((("equipment_type" IS NOT NULL) OR ("make" IS NOT NULL) OR ("model" IS NOT NULL) OR ("serial" IS NOT NULL) OR ("photo_path" IS NOT NULL)))
);


ALTER TABLE "public"."trade_customer_equipment" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_invoice" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "work_order_id" "uuid",
    "invoice_number" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_rate" numeric(6,3) DEFAULT 0 NOT NULL,
    "tax_amount" numeric(14,2) DEFAULT 0 NOT NULL,
    "total" numeric(14,2) DEFAULT 0 NOT NULL,
    "issued_on" "date",
    "due_on" "date",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trade_invoice_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'paid'::"text", 'void'::"text"])))
);


ALTER TABLE "public"."trade_invoice" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_invoice_line" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "invoice_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "quantity" numeric(12,2) DEFAULT 1 NOT NULL,
    "unit_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "line_total" numeric(14,2) GENERATED ALWAYS AS ("round"(("quantity" * "unit_price"), 2)) STORED,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trade_invoice_line" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_price_book_item" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "code" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "tier" "text" DEFAULT 'standard'::"text" NOT NULL,
    "unit" "text",
    "unit_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trade_price_book_item_tier_check" CHECK (("tier" = ANY (ARRAY['good'::"text", 'better'::"text", 'best'::"text", 'standard'::"text"])))
);


ALTER TABLE "public"."trade_price_book_item" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_service_address" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "label" "text",
    "line1" "text" NOT NULL,
    "line2" "text",
    "city" "text",
    "region" "text",
    "postal_code" "text",
    "is_primary" boolean DEFAULT false NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trade_service_address" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_service_agreement" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "service_address_id" "uuid",
    "name" "text" NOT NULL,
    "billing_amount" numeric(12,2) DEFAULT 0 NOT NULL,
    "billing_interval" "text" DEFAULT 'monthly'::"text" NOT NULL,
    "visits_per_year" integer DEFAULT 0 NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "start_on" "date",
    "next_visit_on" "date",
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trade_service_agreement_billing_interval_check" CHECK (("billing_interval" = ANY (ARRAY['monthly'::"text", 'quarterly'::"text", 'annual'::"text"]))),
    CONSTRAINT "trade_service_agreement_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'paused'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."trade_service_agreement" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_work_order" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "customer_id" "uuid" NOT NULL,
    "service_address_id" "uuid",
    "title" "text" NOT NULL,
    "work_type" "text" DEFAULT 'service_call'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "assigned_user_id" "uuid",
    "scheduled_start" timestamp with time zone,
    "scheduled_end" timestamp with time zone,
    "description" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "signed_off_name" "text",
    "signed_off_signature_path" "text",
    "signed_off_at" timestamp with time zone,
    CONSTRAINT "trade_work_order_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'scheduled'::"text", 'in_progress'::"text", 'completed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "trade_work_order_work_type_check" CHECK (("work_type" = ANY (ARRAY['service_call'::"text", 'project'::"text"])))
);


ALTER TABLE "public"."trade_work_order" OWNER TO "postgres";


COMMENT ON COLUMN "public"."trade_work_order"."signed_off_signature_path" IS 'Storage path (tenant-documents bucket) of the customer sign-off signature PNG, captured at completion. Null when unsigned.';



CREATE TABLE IF NOT EXISTS "public"."trade_work_order_field_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "work_order_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "entry_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "hours" numeric(8,2),
    "travel_km" numeric(10,2),
    "travel_minutes" integer,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trade_work_order_field_log_has_value" CHECK ((("hours" IS NOT NULL) OR ("travel_km" IS NOT NULL) OR ("travel_minutes" IS NOT NULL) OR ("note" IS NOT NULL)))
);


ALTER TABLE "public"."trade_work_order_field_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_work_order_line" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "work_order_id" "uuid" NOT NULL,
    "price_book_item_id" "uuid",
    "name" "text" NOT NULL,
    "quantity" numeric(12,2) DEFAULT 1 NOT NULL,
    "unit_price" numeric(12,2) DEFAULT 0 NOT NULL,
    "line_total" numeric(14,2) GENERATED ALWAYS AS ("round"(("quantity" * "unit_price"), 2)) STORED,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trade_work_order_line" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_work_order_material" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "work_order_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "entry_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "name" "text" NOT NULL,
    "quantity" numeric(12,2) DEFAULT 1 NOT NULL,
    "unit" "text",
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trade_work_order_material" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_work_order_note" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "work_order_id" "uuid" NOT NULL,
    "author_user_id" "uuid",
    "note" "text",
    "photo_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "trade_work_order_note_has_content" CHECK ((("note" IS NOT NULL) OR ("photo_path" IS NOT NULL)))
);


ALTER TABLE "public"."trade_work_order_note" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_work_order_task" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "work_order_id" "uuid" NOT NULL,
    "source_template_id" "uuid",
    "label" "text" NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    "done" boolean DEFAULT false NOT NULL,
    "done_by" "uuid",
    "done_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trade_work_order_task" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."trade_work_order_time" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "work_order_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."trade_work_order_time" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_document" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "registry_key" "text" NOT NULL,
    "slot_key" "text" NOT NULL,
    "scope" "text" NOT NULL,
    "subject_id" "uuid",
    "title" "text" NOT NULL,
    "storage_path" "text",
    "attachment_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "issued_date" "date",
    "expiry_date" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transport_document_scope_check" CHECK (("scope" = ANY (ARRAY['company'::"text", 'driver'::"text", 'vehicle'::"text", 'incident'::"text", 'shipment'::"text"]))),
    CONSTRAINT "transport_document_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."transport_document" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_driver" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid",
    "full_name" "text" NOT NULL,
    "license_number" "text",
    "license_class" "text",
    "license_expiry" "date",
    "hired_on" "date",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "hos_cycle" "text" DEFAULT 'cycle_1'::"text" NOT NULL,
    "hos_regime" "text" DEFAULT 'federal'::"text" NOT NULL,
    CONSTRAINT "transport_driver_hos_cycle_check" CHECK (("hos_cycle" = ANY (ARRAY['cycle_1'::"text", 'cycle_2'::"text"]))),
    CONSTRAINT "transport_driver_hos_regime_check" CHECK (("hos_regime" = ANY (ARRAY['federal'::"text", 'provincial_ab'::"text"]))),
    CONSTRAINT "transport_driver_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'inactive'::"text"])))
);


ALTER TABLE "public"."transport_driver" OWNER TO "postgres";


COMMENT ON COLUMN "public"."transport_driver"."hos_regime" IS 'Hours of Service ruleset: federal (interprovincial) or provincial_ab (Alberta intraprovincial).';



CREATE TABLE IF NOT EXISTS "public"."transport_duty_status_event" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "started_at" timestamp with time zone NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "location" "text",
    "remark" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transport_duty_status_event_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'eld'::"text", 'edit'::"text", 'time_record'::"text", 'ocr'::"text"]))),
    CONSTRAINT "transport_duty_status_event_status_check" CHECK (("status" = ANY (ARRAY['off_duty'::"text", 'sleeper_berth'::"text", 'driving'::"text", 'on_duty'::"text"])))
);


ALTER TABLE "public"."transport_duty_status_event" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."transport_medical_record" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "record_type" "text" DEFAULT 'other'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "storage_path" "text",
    "occurred_on" "date",
    "notes" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_by" "uuid",
    "deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "transport_medical_record_record_type_check" CHECK (("record_type" = ANY (ARRAY['injury'::"text", 'medical'::"text", 'wcb'::"text", 'first_aid'::"text", 'other'::"text"]))),
    CONSTRAINT "transport_medical_record_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."transport_medical_record" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_locations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "full_name" "text" NOT NULL,
    "power_level" "public"."power_level" NOT NULL,
    "reach_type" "public"."reach_type" DEFAULT 'specific_locations'::"public"."reach_type" NOT NULL,
    "permission_profile_id" "uuid",
    "app_access" "public"."app_access_level" DEFAULT 'app_access'::"public"."app_access_level" NOT NULL,
    "offline_sync_days" integer DEFAULT 30 NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "users_offline_sync_days_check" CHECK ((("offline_sync_days" >= 0) AND ("offline_sync_days" <= 365)))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."visitors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "organization" "text",
    "visit_reason" "text" NOT NULL,
    "signed_in_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "signed_out_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."visitors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."worker_profiles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "photo_path" "text",
    "title" "text",
    "phone" "text",
    "employee_number" "text",
    "hired_on" "date",
    "emergency_contacts" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."worker_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."worker_time_cards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "worker_user_id" "uuid" NOT NULL,
    "location_id" "uuid" NOT NULL,
    "note" "text",
    "clocked_in_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "clocked_out_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "worker_time_cards_clock_order_check" CHECK ((("clocked_out_at" IS NULL) OR ("clocked_out_at" >= "clocked_in_at")))
);


ALTER TABLE "public"."worker_time_cards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_conditions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "workflow_step_id" "uuid" NOT NULL,
    "source_form_id" "uuid",
    "source_item_id" "uuid",
    "comparator" "text" NOT NULL,
    "expected_value" "jsonb" DEFAULT 'null'::"jsonb" NOT NULL,
    "next_step_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workflow_conditions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_run_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "workflow_run_id" "uuid" NOT NULL,
    "workflow_step_id" "uuid" NOT NULL,
    "assigned_to" "uuid",
    "submission_id" "uuid",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "due_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workflow_run_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "location_id" "uuid",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "started_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone
);


ALTER TABLE "public"."workflow_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_steps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "form_id" "uuid",
    "assignee_type" "text" DEFAULT 'role'::"text" NOT NULL,
    "assignee_user_id" "uuid",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workflow_steps" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "tenant_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workflows" OWNER TO "postgres";


ALTER TABLE ONLY "public"."auto_share_recipients"
    ADD CONSTRAINT "auto_share_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certification_types"
    ADD CONSTRAINT "certification_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."certification_types"
    ADD CONSTRAINT "certification_types_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."certifications"
    ADD CONSTRAINT "certifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."change_order_approval"
    ADD CONSTRAINT "change_order_approval_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."change_order_attachment"
    ADD CONSTRAINT "change_order_attachment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."change_order_line"
    ADD CONSTRAINT "change_order_line_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."change_order_markup"
    ADD CONSTRAINT "change_order_markup_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."change_order"
    ADD CONSTRAINT "change_order_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."co_project"
    ADD CONSTRAINT "co_project_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_settings"
    ADD CONSTRAINT "company_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."company_settings"
    ADD CONSTRAINT "company_settings_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."consultant_access"
    ADD CONSTRAINT "consultant_access_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consultant_audit_log"
    ADD CONSTRAINT "consultant_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."consultants"
    ADD CONSTRAINT "consultants_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."consultants"
    ADD CONSTRAINT "consultants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_control_register"
    ADD CONSTRAINT "document_control_register_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_control_register"
    ADD CONSTRAINT "document_control_register_tenant_id_dcn_version_key" UNIQUE ("tenant_id", "dcn", "version");



ALTER TABLE ONLY "public"."dti_inspection_item"
    ADD CONSTRAINT "dti_inspection_item_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."dti_inspection"
    ADD CONSTRAINT "dti_inspection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eld_connection"
    ADD CONSTRAINT "eld_connection_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eld_connection_secret"
    ADD CONSTRAINT "eld_connection_secret_pkey" PRIMARY KEY ("connection_id");



ALTER TABLE ONLY "public"."eld_connection"
    ADD CONSTRAINT "eld_connection_tenant_id_provider_key" UNIQUE ("tenant_id", "provider");



ALTER TABLE ONLY "public"."eld_device"
    ADD CONSTRAINT "eld_device_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eld_device"
    ADD CONSTRAINT "eld_device_tenant_id_provider_external_vehicle_id_key" UNIQUE ("tenant_id", "provider", "external_vehicle_id");



ALTER TABLE ONLY "public"."eld_driver_event"
    ADD CONSTRAINT "eld_driver_event_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eld_driver_link"
    ADD CONSTRAINT "eld_driver_link_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eld_driver_link"
    ADD CONSTRAINT "eld_driver_link_tenant_id_provider_external_driver_id_key" UNIQUE ("tenant_id", "provider", "external_driver_id");



ALTER TABLE ONLY "public"."eld_driver_performance"
    ADD CONSTRAINT "eld_driver_performance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eld_driver_performance"
    ADD CONSTRAINT "eld_driver_performance_tenant_id_provider_driver_id_key" UNIQUE ("tenant_id", "provider", "driver_id");



ALTER TABLE ONLY "public"."eld_driver_profile"
    ADD CONSTRAINT "eld_driver_profile_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eld_driver_profile"
    ADD CONSTRAINT "eld_driver_profile_tenant_id_provider_driver_id_key" UNIQUE ("tenant_id", "provider", "driver_id");



ALTER TABLE ONLY "public"."eld_vehicle_event"
    ADD CONSTRAINT "eld_vehicle_event_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eld_vehicle_link"
    ADD CONSTRAINT "eld_vehicle_link_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."eld_vehicle_link"
    ADD CONSTRAINT "eld_vehicle_link_tenant_id_provider_external_vehicle_id_key" UNIQUE ("tenant_id", "provider", "external_vehicle_id");



ALTER TABLE ONLY "public"."equipment_document"
    ADD CONSTRAINT "equipment_document_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_maintenance_log"
    ADD CONSTRAINT "equipment_maintenance_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_meter_log"
    ADD CONSTRAINT "equipment_meter_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_scheduled_service"
    ADD CONSTRAINT "equipment_scheduled_service_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_submission_link"
    ADD CONSTRAINT "equipment_submission_link_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_submission_link"
    ADD CONSTRAINT "equipment_submission_link_tenant_id_equipment_id_submission_key" UNIQUE ("tenant_id", "equipment_id", "submission_id");



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_tenant_id_unit_number_key" UNIQUE ("tenant_id", "unit_number");



ALTER TABLE ONLY "public"."field_ticket"
    ADD CONSTRAINT "field_ticket_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_items"
    ADD CONSTRAINT "form_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."form_sections"
    ADD CONSTRAINT "form_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forms"
    ADD CONSTRAINT "forms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."forms"
    ADD CONSTRAINT "forms_tenant_id_code_key" UNIQUE ("tenant_id", "code");



ALTER TABLE ONLY "public"."gc_rfi"
    ADD CONSTRAINT "gc_rfi_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."list_items"
    ADD CONSTRAINT "list_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lists"
    ADD CONSTRAINT "lists_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lists"
    ADD CONSTRAINT "lists_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_tenant_id_code_key" UNIQUE ("tenant_id", "code");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_profiles"
    ADD CONSTRAINT "permission_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."permission_profiles"
    ADD CONSTRAINT "permission_profiles_tenant_id_name_key" UNIQUE ("tenant_id", "name");



ALTER TABLE ONLY "public"."print_settings"
    ADD CONSTRAINT "print_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."print_settings"
    ADD CONSTRAINT "print_settings_tenant_id_key" UNIQUE ("tenant_id");



ALTER TABLE ONLY "public"."resource_sections"
    ADD CONSTRAINT "resource_sections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scheduled_tasks"
    ADD CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."signatures"
    ADD CONSTRAINT "signatures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_photos"
    ADD CONSTRAINT "submission_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submission_values"
    ADD CONSTRAINT "submission_values_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenant_audit_log"
    ADD CONSTRAINT "tenant_audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."tenants"
    ADD CONSTRAINT "tenants_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."trade_checklist_template_item"
    ADD CONSTRAINT "trade_checklist_template_item_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_checklist_template"
    ADD CONSTRAINT "trade_checklist_template_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_customer_equipment"
    ADD CONSTRAINT "trade_customer_equipment_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_customer"
    ADD CONSTRAINT "trade_customer_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_invoice_line"
    ADD CONSTRAINT "trade_invoice_line_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_invoice"
    ADD CONSTRAINT "trade_invoice_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_price_book_item"
    ADD CONSTRAINT "trade_price_book_item_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_service_address"
    ADD CONSTRAINT "trade_service_address_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_service_agreement"
    ADD CONSTRAINT "trade_service_agreement_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_work_order_field_log"
    ADD CONSTRAINT "trade_work_order_field_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_work_order_line"
    ADD CONSTRAINT "trade_work_order_line_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_work_order_material"
    ADD CONSTRAINT "trade_work_order_material_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_work_order_note"
    ADD CONSTRAINT "trade_work_order_note_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_work_order"
    ADD CONSTRAINT "trade_work_order_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_work_order_task"
    ADD CONSTRAINT "trade_work_order_task_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."trade_work_order_time"
    ADD CONSTRAINT "trade_work_order_time_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_document"
    ADD CONSTRAINT "transport_document_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_driver"
    ADD CONSTRAINT "transport_driver_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_duty_status_event"
    ADD CONSTRAINT "transport_duty_status_event_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transport_medical_record"
    ADD CONSTRAINT "transport_medical_record_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_tenant_id_user_id_location_id_key" UNIQUE ("tenant_id", "user_id", "location_id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_tenant_id_email_key" UNIQUE ("tenant_id", "email");



ALTER TABLE ONLY "public"."visitors"
    ADD CONSTRAINT "visitors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."worker_profiles"
    ADD CONSTRAINT "worker_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."worker_profiles"
    ADD CONSTRAINT "worker_profiles_tenant_id_user_id_key" UNIQUE ("tenant_id", "user_id");



ALTER TABLE ONLY "public"."worker_time_cards"
    ADD CONSTRAINT "worker_time_cards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_conditions"
    ADD CONSTRAINT "workflow_conditions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_run_steps"
    ADD CONSTRAINT "workflow_run_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_pkey" PRIMARY KEY ("id");



CREATE INDEX "change_order_approval_co_idx" ON "public"."change_order_approval" USING "btree" ("change_order_id", "created_at");



CREATE INDEX "change_order_attachment_co_idx" ON "public"."change_order_attachment" USING "btree" ("change_order_id", "created_at");



CREATE INDEX "change_order_line_co_idx" ON "public"."change_order_line" USING "btree" ("change_order_id", "sort_order");



CREATE INDEX "change_order_markup_co_idx" ON "public"."change_order_markup" USING "btree" ("change_order_id", "sort_order");



CREATE UNIQUE INDEX "change_order_project_number_key" ON "public"."change_order" USING "btree" ("project_id", "number");



CREATE INDEX "change_order_tenant_project_idx" ON "public"."change_order" USING "btree" ("tenant_id", "project_id");



CREATE INDEX "change_order_tenant_status_idx" ON "public"."change_order" USING "btree" ("tenant_id", "status");



CREATE INDEX "co_project_tenant_status_idx" ON "public"."co_project" USING "btree" ("tenant_id", "status");



CREATE INDEX "document_control_register_revision_idx" ON "public"."document_control_register" USING "btree" ("tenant_id", "revision_of_id");



CREATE INDEX "document_control_register_tenant_approval_idx" ON "public"."document_control_register" USING "btree" ("tenant_id", "approval_status");



CREATE INDEX "dti_inspection_item_inspection_idx" ON "public"."dti_inspection_item" USING "btree" ("inspection_id");



CREATE INDEX "dti_inspection_out_of_service_idx" ON "public"."dti_inspection" USING "btree" ("tenant_id", "equipment_id") WHERE ("out_of_service" AND ("out_of_service_cleared_at" IS NULL));



CREATE INDEX "dti_inspection_tenant_equipment_idx" ON "public"."dti_inspection" USING "btree" ("tenant_id", "equipment_id", "completed_at" DESC);



CREATE INDEX "dti_inspection_tenant_result_idx" ON "public"."dti_inspection" USING "btree" ("tenant_id", "overall_result");



CREATE INDEX "dti_inspection_tenant_valid_idx" ON "public"."dti_inspection" USING "btree" ("tenant_id", "valid_until");



CREATE INDEX "eld_connection_tenant_idx" ON "public"."eld_connection" USING "btree" ("tenant_id");



CREATE INDEX "eld_device_equipment_idx" ON "public"."eld_device" USING "btree" ("equipment_id");



CREATE INDEX "eld_driver_event_driver_idx" ON "public"."eld_driver_event" USING "btree" ("driver_id", "event_type", "occurred_at" DESC);



CREATE INDEX "eld_driver_link_tenant_provider_idx" ON "public"."eld_driver_link" USING "btree" ("tenant_id", "provider", "external_driver_id");



CREATE INDEX "eld_driver_performance_driver_idx" ON "public"."eld_driver_performance" USING "btree" ("driver_id");



CREATE INDEX "eld_driver_profile_driver_idx" ON "public"."eld_driver_profile" USING "btree" ("driver_id");



CREATE INDEX "eld_vehicle_event_equipment_idx" ON "public"."eld_vehicle_event" USING "btree" ("equipment_id", "event_type", "occurred_at" DESC);



CREATE INDEX "eld_vehicle_link_equipment_idx" ON "public"."eld_vehicle_link" USING "btree" ("equipment_id");



CREATE INDEX "eld_vehicle_link_tenant_provider_idx" ON "public"."eld_vehicle_link" USING "btree" ("tenant_id", "provider", "external_vehicle_id");



CREATE INDEX "equipment_document_expiry_idx" ON "public"."equipment_document" USING "btree" ("tenant_id", "is_active", "expiry_date");



CREATE INDEX "equipment_maintenance_equipment_date_idx" ON "public"."equipment_maintenance_log" USING "btree" ("tenant_id", "equipment_id", "performed_at" DESC);



CREATE INDEX "equipment_meter_log_equipment_recorded_idx" ON "public"."equipment_meter_log" USING "btree" ("tenant_id", "equipment_id", "recorded_at" DESC);



CREATE INDEX "equipment_scheduled_service_due_date_idx" ON "public"."equipment_scheduled_service" USING "btree" ("tenant_id", "is_active", "due_date");



CREATE INDEX "equipment_scheduled_service_due_meter_idx" ON "public"."equipment_scheduled_service" USING "btree" ("tenant_id", "is_active", "due_meter");



CREATE INDEX "equipment_submission_link_submission_idx" ON "public"."equipment_submission_link" USING "btree" ("tenant_id", "submission_id");



CREATE INDEX "equipment_tenant_category_idx" ON "public"."equipment" USING "btree" ("tenant_id", "category");



CREATE INDEX "equipment_tenant_location_idx" ON "public"."equipment" USING "btree" ("tenant_id", "location_id");



CREATE INDEX "equipment_tenant_status_idx" ON "public"."equipment" USING "btree" ("tenant_id", "status");



CREATE INDEX "field_ticket_submitted_by_idx" ON "public"."field_ticket" USING "btree" ("tenant_id", "submitted_by");



CREATE INDEX "field_ticket_tenant_status_idx" ON "public"."field_ticket" USING "btree" ("tenant_id", "status", "created_at");



CREATE INDEX "follow_ups_equipment_id_idx" ON "public"."follow_ups" USING "btree" ("equipment_id");



CREATE INDEX "follow_ups_tenant_status_due_idx" ON "public"."follow_ups" USING "btree" ("tenant_id", "status", "due_at");



CREATE INDEX "forms_cor_element_idx" ON "public"."forms" USING "btree" ("tenant_id", "cor_element") WHERE "cor_tracked";



CREATE INDEX "forms_tenant_id_idx" ON "public"."forms" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "gc_rfi_project_number_key" ON "public"."gc_rfi" USING "btree" ("project_id", "number");



CREATE INDEX "gc_rfi_tenant_project_idx" ON "public"."gc_rfi" USING "btree" ("tenant_id", "project_id");



CREATE INDEX "gc_rfi_tenant_status_idx" ON "public"."gc_rfi" USING "btree" ("tenant_id", "status");



CREATE INDEX "list_items_list_parent_sort_idx" ON "public"."list_items" USING "btree" ("list_id", "parent_id", "sort_order");



CREATE INDEX "list_items_parent_id_idx" ON "public"."list_items" USING "btree" ("parent_id");



CREATE UNIQUE INDEX "lists_tenant_lower_name_idx" ON "public"."lists" USING "btree" ("tenant_id", "lower"("name"));



CREATE INDEX "locations_tenant_id_idx" ON "public"."locations" USING "btree" ("tenant_id");



CREATE INDEX "notifications_tenant_id_delivery_status_idx" ON "public"."notifications" USING "btree" ("tenant_id", "delivery_status", "created_at" DESC);



CREATE INDEX "notifications_tenant_id_last_delivery_attempt_idx" ON "public"."notifications" USING "btree" ("tenant_id", "last_delivery_attempt_at" DESC) WHERE ("last_delivery_attempt_at" IS NOT NULL);



CREATE INDEX "notifications_tenant_id_submission_id_idx" ON "public"."notifications" USING "btree" ("tenant_id", "submission_id", "created_at" DESC);



CREATE INDEX "notifications_tenant_id_user_id_idx" ON "public"."notifications" USING "btree" ("tenant_id", "user_id");



CREATE INDEX "resources_cor_element_idx" ON "public"."resources" USING "btree" ("tenant_id", "cor_element") WHERE "cor_tracked";



CREATE INDEX "resources_review_date_idx" ON "public"."resources" USING "btree" ("tenant_id", "review_date") WHERE ("review_date" IS NOT NULL);



CREATE INDEX "resources_tenant_search_text_idx" ON "public"."resources" USING "btree" ("tenant_id");



CREATE INDEX "resources_tenant_section_sort_idx" ON "public"."resources" USING "btree" ("tenant_id", "section_id", "sort_order", "name");



CREATE INDEX "submissions_tenant_id_idx" ON "public"."submissions" USING "btree" ("tenant_id");



CREATE INDEX "tenant_audit_log_actor_created_idx" ON "public"."tenant_audit_log" USING "btree" ("actor_user_id", "created_at" DESC) WHERE ("actor_user_id" IS NOT NULL);



CREATE INDEX "tenant_audit_log_tenant_action_created_idx" ON "public"."tenant_audit_log" USING "btree" ("tenant_id", "action", "created_at" DESC);



CREATE INDEX "tenant_audit_log_tenant_created_idx" ON "public"."tenant_audit_log" USING "btree" ("tenant_id", "created_at" DESC);



CREATE INDEX "tenants_slug_idx" ON "public"."tenants" USING "btree" ("slug");



CREATE INDEX "trade_checklist_template_item_tpl_idx" ON "public"."trade_checklist_template_item" USING "btree" ("tenant_id", "template_id", "position");



CREATE INDEX "trade_checklist_template_tenant_idx" ON "public"."trade_checklist_template" USING "btree" ("tenant_id", "active", "name");



CREATE INDEX "trade_customer_equipment_follow_up_idx" ON "public"."trade_customer_equipment" USING "btree" ("tenant_id", "needs_follow_up") WHERE "needs_follow_up";



CREATE INDEX "trade_customer_equipment_tenant_customer_idx" ON "public"."trade_customer_equipment" USING "btree" ("tenant_id", "customer_id", "created_at" DESC);



CREATE INDEX "trade_customer_equipment_tenant_wo_idx" ON "public"."trade_customer_equipment" USING "btree" ("tenant_id", "work_order_id");



CREATE INDEX "trade_customer_tenant_status_idx" ON "public"."trade_customer" USING "btree" ("tenant_id", "status", "name");



CREATE INDEX "trade_invoice_line_invoice_idx" ON "public"."trade_invoice_line" USING "btree" ("invoice_id");



CREATE UNIQUE INDEX "trade_invoice_number_idx" ON "public"."trade_invoice" USING "btree" ("tenant_id", "invoice_number");



CREATE INDEX "trade_invoice_tenant_customer_idx" ON "public"."trade_invoice" USING "btree" ("tenant_id", "customer_id");



CREATE INDEX "trade_invoice_tenant_status_idx" ON "public"."trade_invoice" USING "btree" ("tenant_id", "status", "created_at" DESC);



CREATE INDEX "trade_price_book_item_tenant_idx" ON "public"."trade_price_book_item" USING "btree" ("tenant_id", "active", "category", "name");



CREATE INDEX "trade_service_address_tenant_customer_idx" ON "public"."trade_service_address" USING "btree" ("tenant_id", "customer_id");



CREATE INDEX "trade_service_agreement_tenant_customer_idx" ON "public"."trade_service_agreement" USING "btree" ("tenant_id", "customer_id");



CREATE INDEX "trade_service_agreement_tenant_status_idx" ON "public"."trade_service_agreement" USING "btree" ("tenant_id", "status", "next_visit_on");



CREATE INDEX "trade_work_order_assignee_idx" ON "public"."trade_work_order" USING "btree" ("tenant_id", "assigned_user_id", "scheduled_start") WHERE ("status" = ANY (ARRAY['open'::"text", 'scheduled'::"text", 'in_progress'::"text"]));



CREATE INDEX "trade_work_order_field_log_tenant_wo_idx" ON "public"."trade_work_order_field_log" USING "btree" ("tenant_id", "work_order_id", "entry_date" DESC);



CREATE INDEX "trade_work_order_line_tenant_wo_idx" ON "public"."trade_work_order_line" USING "btree" ("tenant_id", "work_order_id");



CREATE INDEX "trade_work_order_line_wo_idx" ON "public"."trade_work_order_line" USING "btree" ("work_order_id");



CREATE INDEX "trade_work_order_material_tenant_wo_idx" ON "public"."trade_work_order_material" USING "btree" ("tenant_id", "work_order_id", "entry_date" DESC);



CREATE INDEX "trade_work_order_note_tenant_wo_idx" ON "public"."trade_work_order_note" USING "btree" ("tenant_id", "work_order_id", "created_at" DESC);



CREATE INDEX "trade_work_order_note_wo_idx" ON "public"."trade_work_order_note" USING "btree" ("work_order_id");



CREATE INDEX "trade_work_order_task_tenant_wo_idx" ON "public"."trade_work_order_task" USING "btree" ("tenant_id", "work_order_id", "position");



CREATE INDEX "trade_work_order_tenant_customer_idx" ON "public"."trade_work_order" USING "btree" ("tenant_id", "customer_id");



CREATE INDEX "trade_work_order_tenant_status_idx" ON "public"."trade_work_order" USING "btree" ("tenant_id", "status", "scheduled_start");



CREATE INDEX "trade_work_order_time_open_idx" ON "public"."trade_work_order_time" USING "btree" ("tenant_id", "user_id") WHERE ("ended_at" IS NULL);



CREATE INDEX "trade_work_order_time_tenant_wo_idx" ON "public"."trade_work_order_time" USING "btree" ("tenant_id", "work_order_id", "started_at" DESC);



CREATE INDEX "transport_document_tenant_expiry_idx" ON "public"."transport_document" USING "btree" ("tenant_id", "status", "expiry_date");



CREATE INDEX "transport_document_tenant_registry_slot_idx" ON "public"."transport_document" USING "btree" ("tenant_id", "registry_key", "slot_key");



CREATE INDEX "transport_document_tenant_scope_subject_idx" ON "public"."transport_document" USING "btree" ("tenant_id", "scope", "subject_id");



CREATE INDEX "transport_driver_tenant_license_expiry_idx" ON "public"."transport_driver" USING "btree" ("tenant_id", "license_expiry");



CREATE INDEX "transport_driver_tenant_status_idx" ON "public"."transport_driver" USING "btree" ("tenant_id", "status");



CREATE INDEX "transport_duty_status_event_driver_time_idx" ON "public"."transport_duty_status_event" USING "btree" ("tenant_id", "driver_id", "started_at");



CREATE INDEX "transport_medical_record_tenant_driver_idx" ON "public"."transport_medical_record" USING "btree" ("tenant_id", "driver_id", "status");



CREATE INDEX "users_tenant_id_idx" ON "public"."users" USING "btree" ("tenant_id");



CREATE UNIQUE INDEX "worker_time_cards_one_open_per_worker_idx" ON "public"."worker_time_cards" USING "btree" ("tenant_id", "worker_user_id") WHERE ("clocked_out_at" IS NULL);



CREATE INDEX "worker_time_cards_tenant_location_open_idx" ON "public"."worker_time_cards" USING "btree" ("tenant_id", "location_id", "clocked_in_at") WHERE ("clocked_out_at" IS NULL);



CREATE INDEX "worker_time_cards_tenant_worker_idx" ON "public"."worker_time_cards" USING "btree" ("tenant_id", "worker_user_id", "clocked_in_at" DESC);



CREATE OR REPLACE TRIGGER "auto_share_recipients_set_updated_at" BEFORE UPDATE ON "public"."auto_share_recipients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "certification_types_set_updated_at" BEFORE UPDATE ON "public"."certification_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "certifications_set_updated_at" BEFORE UPDATE ON "public"."certifications" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "change_order_approval_set_updated_at" BEFORE UPDATE ON "public"."change_order_approval" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "change_order_approval_tenant_match" BEFORE INSERT OR UPDATE ON "public"."change_order_approval" FOR EACH ROW EXECUTE FUNCTION "public"."change_order_child_tenant_matches"();



CREATE OR REPLACE TRIGGER "change_order_attachment_set_updated_at" BEFORE UPDATE ON "public"."change_order_attachment" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "change_order_attachment_tenant_match" BEFORE INSERT OR UPDATE ON "public"."change_order_attachment" FOR EACH ROW EXECUTE FUNCTION "public"."change_order_child_tenant_matches"();



CREATE OR REPLACE TRIGGER "change_order_line_set_updated_at" BEFORE UPDATE ON "public"."change_order_line" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "change_order_line_tenant_match" BEFORE INSERT OR UPDATE ON "public"."change_order_line" FOR EACH ROW EXECUTE FUNCTION "public"."change_order_child_tenant_matches"();



CREATE OR REPLACE TRIGGER "change_order_markup_set_updated_at" BEFORE UPDATE ON "public"."change_order_markup" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "change_order_markup_tenant_match" BEFORE INSERT OR UPDATE ON "public"."change_order_markup" FOR EACH ROW EXECUTE FUNCTION "public"."change_order_child_tenant_matches"();



CREATE OR REPLACE TRIGGER "change_order_project_match" BEFORE INSERT OR UPDATE ON "public"."change_order" FOR EACH ROW EXECUTE FUNCTION "public"."change_order_project_matches"();



CREATE OR REPLACE TRIGGER "change_order_set_updated_at" BEFORE UPDATE ON "public"."change_order" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "co_project_set_updated_at" BEFORE UPDATE ON "public"."co_project" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "company_settings_set_updated_at" BEFORE UPDATE ON "public"."company_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "consultants_set_updated_at" BEFORE UPDATE ON "public"."consultants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "document_control_register_set_updated_at" BEFORE UPDATE ON "public"."document_control_register" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "dti_inspection_equipment_match" BEFORE INSERT OR UPDATE ON "public"."dti_inspection" FOR EACH ROW EXECUTE FUNCTION "public"."dti_inspection_equipment_matches"();



CREATE OR REPLACE TRIGGER "dti_inspection_item_match" BEFORE INSERT OR UPDATE ON "public"."dti_inspection_item" FOR EACH ROW EXECUTE FUNCTION "public"."dti_inspection_item_matches"();



CREATE OR REPLACE TRIGGER "dti_inspection_set_updated_at" BEFORE UPDATE ON "public"."dti_inspection" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "eld_connection_secret_set_updated_at" BEFORE UPDATE ON "public"."eld_connection_secret" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "eld_connection_set_updated_at" BEFORE UPDATE ON "public"."eld_connection" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "eld_device_equipment_match" BEFORE INSERT OR UPDATE ON "public"."eld_device" FOR EACH ROW EXECUTE FUNCTION "public"."eld_vehicle_link_equipment_matches"();



CREATE OR REPLACE TRIGGER "eld_device_set_updated_at" BEFORE UPDATE ON "public"."eld_device" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "eld_driver_event_driver_match" BEFORE INSERT OR UPDATE ON "public"."eld_driver_event" FOR EACH ROW EXECUTE FUNCTION "public"."eld_driver_link_driver_matches"();



CREATE OR REPLACE TRIGGER "eld_driver_event_set_updated_at" BEFORE UPDATE ON "public"."eld_driver_event" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "eld_driver_link_driver_match" BEFORE INSERT OR UPDATE ON "public"."eld_driver_link" FOR EACH ROW EXECUTE FUNCTION "public"."eld_driver_link_driver_matches"();



CREATE OR REPLACE TRIGGER "eld_driver_link_set_updated_at" BEFORE UPDATE ON "public"."eld_driver_link" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "eld_driver_performance_driver_match" BEFORE INSERT OR UPDATE ON "public"."eld_driver_performance" FOR EACH ROW EXECUTE FUNCTION "public"."eld_driver_link_driver_matches"();



CREATE OR REPLACE TRIGGER "eld_driver_performance_set_updated_at" BEFORE UPDATE ON "public"."eld_driver_performance" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "eld_driver_profile_driver_match" BEFORE INSERT OR UPDATE ON "public"."eld_driver_profile" FOR EACH ROW EXECUTE FUNCTION "public"."eld_driver_link_driver_matches"();



CREATE OR REPLACE TRIGGER "eld_driver_profile_set_updated_at" BEFORE UPDATE ON "public"."eld_driver_profile" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "eld_vehicle_event_equipment_match" BEFORE INSERT OR UPDATE ON "public"."eld_vehicle_event" FOR EACH ROW EXECUTE FUNCTION "public"."eld_vehicle_link_equipment_matches"();



CREATE OR REPLACE TRIGGER "eld_vehicle_event_set_updated_at" BEFORE UPDATE ON "public"."eld_vehicle_event" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "eld_vehicle_link_equipment_match" BEFORE INSERT OR UPDATE ON "public"."eld_vehicle_link" FOR EACH ROW EXECUTE FUNCTION "public"."eld_vehicle_link_equipment_matches"();



CREATE OR REPLACE TRIGGER "eld_vehicle_link_set_updated_at" BEFORE UPDATE ON "public"."eld_vehicle_link" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "equipment_document_set_updated_at" BEFORE UPDATE ON "public"."equipment_document" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "equipment_document_tenant_match" BEFORE INSERT OR UPDATE ON "public"."equipment_document" FOR EACH ROW EXECUTE FUNCTION "public"."equipment_child_tenant_matches"();



CREATE OR REPLACE TRIGGER "equipment_enforce_rules" BEFORE INSERT OR UPDATE ON "public"."equipment" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_equipment_rules"();



CREATE OR REPLACE TRIGGER "equipment_maintenance_log_set_updated_at" BEFORE UPDATE ON "public"."equipment_maintenance_log" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "equipment_maintenance_log_tenant_match" BEFORE INSERT OR UPDATE ON "public"."equipment_maintenance_log" FOR EACH ROW EXECUTE FUNCTION "public"."equipment_child_tenant_matches"();



CREATE OR REPLACE TRIGGER "equipment_meter_log_refresh_current_meter_delete" AFTER DELETE ON "public"."equipment_meter_log" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_equipment_current_meter_trigger"();



CREATE OR REPLACE TRIGGER "equipment_meter_log_refresh_current_meter_insert" AFTER INSERT ON "public"."equipment_meter_log" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_equipment_current_meter_trigger"();



CREATE OR REPLACE TRIGGER "equipment_meter_log_refresh_current_meter_update" AFTER UPDATE ON "public"."equipment_meter_log" FOR EACH ROW EXECUTE FUNCTION "public"."refresh_equipment_current_meter_trigger"();



CREATE OR REPLACE TRIGGER "equipment_meter_log_set_updated_at" BEFORE UPDATE ON "public"."equipment_meter_log" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "equipment_meter_log_tenant_match" BEFORE INSERT OR UPDATE ON "public"."equipment_meter_log" FOR EACH ROW EXECUTE FUNCTION "public"."equipment_child_tenant_matches"();



CREATE OR REPLACE TRIGGER "equipment_scheduled_service_set_updated_at" BEFORE UPDATE ON "public"."equipment_scheduled_service" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "equipment_scheduled_service_tenant_match" BEFORE INSERT OR UPDATE ON "public"."equipment_scheduled_service" FOR EACH ROW EXECUTE FUNCTION "public"."equipment_child_tenant_matches"();



CREATE OR REPLACE TRIGGER "equipment_set_updated_at" BEFORE UPDATE ON "public"."equipment" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "equipment_submission_link_set_updated_at" BEFORE UPDATE ON "public"."equipment_submission_link" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "equipment_submission_link_tenant_match" BEFORE INSERT OR UPDATE ON "public"."equipment_submission_link" FOR EACH ROW EXECUTE FUNCTION "public"."equipment_child_tenant_matches"();



CREATE OR REPLACE TRIGGER "field_ticket_project_match" BEFORE INSERT OR UPDATE ON "public"."field_ticket" FOR EACH ROW EXECUTE FUNCTION "public"."field_ticket_project_matches"();



CREATE OR REPLACE TRIGGER "field_ticket_set_updated_at" BEFORE UPDATE ON "public"."field_ticket" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "follow_ups_set_updated_at" BEFORE UPDATE ON "public"."follow_ups" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "form_items_set_updated_at" BEFORE UPDATE ON "public"."form_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "form_sections_set_updated_at" BEFORE UPDATE ON "public"."form_sections" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "forms_set_updated_at" BEFORE UPDATE ON "public"."forms" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "gc_rfi_match" BEFORE INSERT OR UPDATE ON "public"."gc_rfi" FOR EACH ROW EXECUTE FUNCTION "public"."gc_rfi_matches"();



CREATE OR REPLACE TRIGGER "gc_rfi_set_updated_at" BEFORE UPDATE ON "public"."gc_rfi" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "list_items_set_updated_at" BEFORE UPDATE ON "public"."list_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "lists_set_updated_at" BEFORE UPDATE ON "public"."lists" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "locations_set_updated_at" BEFORE UPDATE ON "public"."locations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "permission_profiles_set_updated_at" BEFORE UPDATE ON "public"."permission_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "print_settings_set_updated_at" BEFORE UPDATE ON "public"."print_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "resource_sections_set_updated_at" BEFORE UPDATE ON "public"."resource_sections" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "resources_set_updated_at" BEFORE UPDATE ON "public"."resources" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "scheduled_tasks_set_updated_at" BEFORE UPDATE ON "public"."scheduled_tasks" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "schedules_set_updated_at" BEFORE UPDATE ON "public"."schedules" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "submission_photos_set_updated_at" BEFORE UPDATE ON "public"."submission_photos" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "submission_values_set_updated_at" BEFORE UPDATE ON "public"."submission_values" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "submissions_set_updated_at" BEFORE UPDATE ON "public"."submissions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "tenants_set_updated_at" BEFORE UPDATE ON "public"."tenants" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trade_checklist_template_item_match" BEFORE INSERT OR UPDATE ON "public"."trade_checklist_template_item" FOR EACH ROW EXECUTE FUNCTION "public"."trade_checklist_template_item_matches"();



CREATE OR REPLACE TRIGGER "trade_checklist_template_set_updated_at" BEFORE UPDATE ON "public"."trade_checklist_template" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trade_customer_equipment_match" BEFORE INSERT OR UPDATE ON "public"."trade_customer_equipment" FOR EACH ROW EXECUTE FUNCTION "public"."trade_customer_equipment_matches"();



CREATE OR REPLACE TRIGGER "trade_customer_equipment_set_updated_at" BEFORE UPDATE ON "public"."trade_customer_equipment" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trade_customer_set_updated_at" BEFORE UPDATE ON "public"."trade_customer" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trade_invoice_line_match" BEFORE INSERT OR UPDATE ON "public"."trade_invoice_line" FOR EACH ROW EXECUTE FUNCTION "public"."trade_invoice_line_matches"();



CREATE OR REPLACE TRIGGER "trade_invoice_match" BEFORE INSERT OR UPDATE ON "public"."trade_invoice" FOR EACH ROW EXECUTE FUNCTION "public"."trade_invoice_matches"();



CREATE OR REPLACE TRIGGER "trade_invoice_set_updated_at" BEFORE UPDATE ON "public"."trade_invoice" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trade_price_book_item_set_updated_at" BEFORE UPDATE ON "public"."trade_price_book_item" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trade_service_address_match" BEFORE INSERT OR UPDATE ON "public"."trade_service_address" FOR EACH ROW EXECUTE FUNCTION "public"."trade_service_address_matches"();



CREATE OR REPLACE TRIGGER "trade_service_address_set_updated_at" BEFORE UPDATE ON "public"."trade_service_address" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trade_service_agreement_match" BEFORE INSERT OR UPDATE ON "public"."trade_service_agreement" FOR EACH ROW EXECUTE FUNCTION "public"."trade_service_agreement_matches"();



CREATE OR REPLACE TRIGGER "trade_service_agreement_set_updated_at" BEFORE UPDATE ON "public"."trade_service_agreement" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trade_work_order_field_log_match" BEFORE INSERT OR UPDATE ON "public"."trade_work_order_field_log" FOR EACH ROW EXECUTE FUNCTION "public"."trade_work_order_field_log_matches"();



CREATE OR REPLACE TRIGGER "trade_work_order_line_match" BEFORE INSERT OR UPDATE ON "public"."trade_work_order_line" FOR EACH ROW EXECUTE FUNCTION "public"."trade_work_order_line_matches"();



CREATE OR REPLACE TRIGGER "trade_work_order_match" BEFORE INSERT OR UPDATE ON "public"."trade_work_order" FOR EACH ROW EXECUTE FUNCTION "public"."trade_work_order_matches"();



CREATE OR REPLACE TRIGGER "trade_work_order_material_match" BEFORE INSERT OR UPDATE ON "public"."trade_work_order_material" FOR EACH ROW EXECUTE FUNCTION "public"."trade_work_order_material_matches"();



CREATE OR REPLACE TRIGGER "trade_work_order_note_match" BEFORE INSERT OR UPDATE ON "public"."trade_work_order_note" FOR EACH ROW EXECUTE FUNCTION "public"."trade_work_order_note_matches"();



CREATE OR REPLACE TRIGGER "trade_work_order_set_updated_at" BEFORE UPDATE ON "public"."trade_work_order" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trade_work_order_task_match" BEFORE INSERT OR UPDATE ON "public"."trade_work_order_task" FOR EACH ROW EXECUTE FUNCTION "public"."trade_work_order_task_matches"();



CREATE OR REPLACE TRIGGER "trade_work_order_time_match" BEFORE INSERT OR UPDATE ON "public"."trade_work_order_time" FOR EACH ROW EXECUTE FUNCTION "public"."trade_work_order_time_matches"();



CREATE OR REPLACE TRIGGER "transport_document_set_updated_at" BEFORE UPDATE ON "public"."transport_document" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "transport_document_subject_match" BEFORE INSERT OR UPDATE ON "public"."transport_document" FOR EACH ROW EXECUTE FUNCTION "public"."transport_document_subject_matches"();



CREATE OR REPLACE TRIGGER "transport_driver_set_updated_at" BEFORE UPDATE ON "public"."transport_driver" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "transport_driver_user_match" BEFORE INSERT OR UPDATE ON "public"."transport_driver" FOR EACH ROW EXECUTE FUNCTION "public"."transport_driver_user_matches"();



CREATE OR REPLACE TRIGGER "transport_duty_status_driver_match" BEFORE INSERT OR UPDATE ON "public"."transport_duty_status_event" FOR EACH ROW EXECUTE FUNCTION "public"."transport_duty_status_driver_matches"();



CREATE OR REPLACE TRIGGER "transport_duty_status_event_set_updated_at" BEFORE UPDATE ON "public"."transport_duty_status_event" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "transport_medical_record_driver_match" BEFORE INSERT OR UPDATE ON "public"."transport_medical_record" FOR EACH ROW EXECUTE FUNCTION "public"."transport_medical_record_driver_matches"();



CREATE OR REPLACE TRIGGER "transport_medical_record_set_updated_at" BEFORE UPDATE ON "public"."transport_medical_record" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "users_set_updated_at" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "visitors_set_updated_at" BEFORE UPDATE ON "public"."visitors" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "worker_profiles_set_updated_at" BEFORE UPDATE ON "public"."worker_profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "worker_time_cards_set_updated_at" BEFORE UPDATE ON "public"."worker_time_cards" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workflow_conditions_set_updated_at" BEFORE UPDATE ON "public"."workflow_conditions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workflow_run_steps_set_updated_at" BEFORE UPDATE ON "public"."workflow_run_steps" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workflow_steps_set_updated_at" BEFORE UPDATE ON "public"."workflow_steps" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "workflows_set_updated_at" BEFORE UPDATE ON "public"."workflows" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."auto_share_recipients"
    ADD CONSTRAINT "auto_share_recipients_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."auto_share_recipients"
    ADD CONSTRAINT "auto_share_recipients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."certification_types"
    ADD CONSTRAINT "certification_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."certifications"
    ADD CONSTRAINT "certifications_certification_type_id_fkey" FOREIGN KEY ("certification_type_id") REFERENCES "public"."certification_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."certifications"
    ADD CONSTRAINT "certifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."certifications"
    ADD CONSTRAINT "certifications_worker_profile_id_fkey" FOREIGN KEY ("worker_profile_id") REFERENCES "public"."worker_profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order_approval"
    ADD CONSTRAINT "change_order_approval_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order_approval"
    ADD CONSTRAINT "change_order_approval_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."change_order_approval"
    ADD CONSTRAINT "change_order_approval_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order"
    ADD CONSTRAINT "change_order_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."change_order_attachment"
    ADD CONSTRAINT "change_order_attachment_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order_attachment"
    ADD CONSTRAINT "change_order_attachment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order_attachment"
    ADD CONSTRAINT "change_order_attachment_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."change_order"
    ADD CONSTRAINT "change_order_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."change_order_line"
    ADD CONSTRAINT "change_order_line_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order_line"
    ADD CONSTRAINT "change_order_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order_markup"
    ADD CONSTRAINT "change_order_markup_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order_markup"
    ADD CONSTRAINT "change_order_markup_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order"
    ADD CONSTRAINT "change_order_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."co_project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."change_order"
    ADD CONSTRAINT "change_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."co_project"
    ADD CONSTRAINT "co_project_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."co_project"
    ADD CONSTRAINT "co_project_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."company_settings"
    ADD CONSTRAINT "company_settings_maintenance_contact_user_id_fkey" FOREIGN KEY ("maintenance_contact_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."company_settings"
    ADD CONSTRAINT "company_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."consultant_access"
    ADD CONSTRAINT "consultant_access_consultant_id_fkey" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."consultant_access"
    ADD CONSTRAINT "consultant_access_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."consultant_audit_log"
    ADD CONSTRAINT "consultant_audit_log_consultant_id_fkey" FOREIGN KEY ("consultant_id") REFERENCES "public"."consultants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."consultant_audit_log"
    ADD CONSTRAINT "consultant_audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."consultants"
    ADD CONSTRAINT "consultants_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_control_register"
    ADD CONSTRAINT "document_control_register_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_control_register"
    ADD CONSTRAINT "document_control_register_revision_of_id_fkey" FOREIGN KEY ("revision_of_id") REFERENCES "public"."document_control_register"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."document_control_register"
    ADD CONSTRAINT "document_control_register_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dti_inspection"
    ADD CONSTRAINT "dti_inspection_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dti_inspection"
    ADD CONSTRAINT "dti_inspection_driver_user_id_fkey" FOREIGN KEY ("driver_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dti_inspection"
    ADD CONSTRAINT "dti_inspection_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dti_inspection_item"
    ADD CONSTRAINT "dti_inspection_item_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "public"."dti_inspection"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dti_inspection_item"
    ADD CONSTRAINT "dti_inspection_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dti_inspection"
    ADD CONSTRAINT "dti_inspection_out_of_service_cleared_by_fkey" FOREIGN KEY ("out_of_service_cleared_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."dti_inspection"
    ADD CONSTRAINT "dti_inspection_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dti_inspection"
    ADD CONSTRAINT "dti_inspection_trailer_equipment_id_fkey" FOREIGN KEY ("trailer_equipment_id") REFERENCES "public"."equipment"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."eld_connection"
    ADD CONSTRAINT "eld_connection_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."eld_connection_secret"
    ADD CONSTRAINT "eld_connection_secret_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."eld_connection"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_connection_secret"
    ADD CONSTRAINT "eld_connection_secret_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_connection"
    ADD CONSTRAINT "eld_connection_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_device"
    ADD CONSTRAINT "eld_device_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_device"
    ADD CONSTRAINT "eld_device_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_driver_event"
    ADD CONSTRAINT "eld_driver_event_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."transport_driver"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_driver_event"
    ADD CONSTRAINT "eld_driver_event_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."eld_driver_event"
    ADD CONSTRAINT "eld_driver_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_driver_link"
    ADD CONSTRAINT "eld_driver_link_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."transport_driver"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_driver_link"
    ADD CONSTRAINT "eld_driver_link_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_driver_performance"
    ADD CONSTRAINT "eld_driver_performance_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."transport_driver"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_driver_performance"
    ADD CONSTRAINT "eld_driver_performance_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_driver_profile"
    ADD CONSTRAINT "eld_driver_profile_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."transport_driver"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_driver_profile"
    ADD CONSTRAINT "eld_driver_profile_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_vehicle_event"
    ADD CONSTRAINT "eld_vehicle_event_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_vehicle_event"
    ADD CONSTRAINT "eld_vehicle_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_vehicle_link"
    ADD CONSTRAINT "eld_vehicle_link_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."eld_vehicle_link"
    ADD CONSTRAINT "eld_vehicle_link_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_document"
    ADD CONSTRAINT "equipment_document_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_document"
    ADD CONSTRAINT "equipment_document_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_document"
    ADD CONSTRAINT "equipment_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_maintenance_log"
    ADD CONSTRAINT "equipment_maintenance_log_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_maintenance_log"
    ADD CONSTRAINT "equipment_maintenance_log_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_maintenance_log"
    ADD CONSTRAINT "equipment_maintenance_log_performed_by_fkey" FOREIGN KEY ("performed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_maintenance_log"
    ADD CONSTRAINT "equipment_maintenance_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_meter_log"
    ADD CONSTRAINT "equipment_meter_log_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_meter_log"
    ADD CONSTRAINT "equipment_meter_log_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_meter_log"
    ADD CONSTRAINT "equipment_meter_log_source_submission_id_fkey" FOREIGN KEY ("source_submission_id") REFERENCES "public"."submissions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_meter_log"
    ADD CONSTRAINT "equipment_meter_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_scheduled_service"
    ADD CONSTRAINT "equipment_scheduled_service_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_scheduled_service"
    ADD CONSTRAINT "equipment_scheduled_service_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_scheduled_service"
    ADD CONSTRAINT "equipment_scheduled_service_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_submission_link"
    ADD CONSTRAINT "equipment_submission_link_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."equipment_submission_link"
    ADD CONSTRAINT "equipment_submission_link_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_submission_link"
    ADD CONSTRAINT "equipment_submission_link_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment_submission_link"
    ADD CONSTRAINT "equipment_submission_link_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."equipment"
    ADD CONSTRAINT "equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."field_ticket"
    ADD CONSTRAINT "field_ticket_change_order_id_fkey" FOREIGN KEY ("change_order_id") REFERENCES "public"."change_order"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."field_ticket"
    ADD CONSTRAINT "field_ticket_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."co_project"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."field_ticket"
    ADD CONSTRAINT "field_ticket_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."field_ticket"
    ADD CONSTRAINT "field_ticket_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."field_ticket"
    ADD CONSTRAINT "field_ticket_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_equipment_id_fkey" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_form_item_id_fkey" FOREIGN KEY ("form_item_id") REFERENCES "public"."form_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_parent_submission_id_fkey" FOREIGN KEY ("parent_submission_id") REFERENCES "public"."submissions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_signoff_by_fkey" FOREIGN KEY ("signoff_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."follow_ups"
    ADD CONSTRAINT "follow_ups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_items"
    ADD CONSTRAINT "form_items_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_items"
    ADD CONSTRAINT "form_items_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."form_sections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_items"
    ADD CONSTRAINT "form_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_sections"
    ADD CONSTRAINT "form_sections_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."form_sections"
    ADD CONSTRAINT "form_sections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."forms"
    ADD CONSTRAINT "forms_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."forms"
    ADD CONSTRAINT "forms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gc_rfi"
    ADD CONSTRAINT "gc_rfi_answered_by_fkey" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."gc_rfi"
    ADD CONSTRAINT "gc_rfi_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."gc_rfi"
    ADD CONSTRAINT "gc_rfi_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."co_project"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."gc_rfi"
    ADD CONSTRAINT "gc_rfi_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_items"
    ADD CONSTRAINT "list_items_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_items"
    ADD CONSTRAINT "list_items_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."list_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."list_items"
    ADD CONSTRAINT "list_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lists"
    ADD CONSTRAINT "lists_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."lists"
    ADD CONSTRAINT "lists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."permission_profiles"
    ADD CONSTRAINT "permission_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."print_settings"
    ADD CONSTRAINT "print_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resource_sections"
    ADD CONSTRAINT "resource_sections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "public"."resource_sections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scheduled_tasks"
    ADD CONSTRAINT "scheduled_tasks_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scheduled_tasks"
    ADD CONSTRAINT "scheduled_tasks_completed_submission_id_fkey" FOREIGN KEY ("completed_submission_id") REFERENCES "public"."submissions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."scheduled_tasks"
    ADD CONSTRAINT "scheduled_tasks_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedules"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scheduled_tasks"
    ADD CONSTRAINT "scheduled_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."signatures"
    ADD CONSTRAINT "signatures_signer_user_id_fkey" FOREIGN KEY ("signer_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."signatures"
    ADD CONSTRAINT "signatures_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."signatures"
    ADD CONSTRAINT "signatures_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_photos"
    ADD CONSTRAINT "submission_photos_form_item_id_fkey" FOREIGN KEY ("form_item_id") REFERENCES "public"."form_items"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submission_photos"
    ADD CONSTRAINT "submission_photos_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_photos"
    ADD CONSTRAINT "submission_photos_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_values"
    ADD CONSTRAINT "submission_values_form_item_id_fkey" FOREIGN KEY ("form_item_id") REFERENCES "public"."form_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."submission_values"
    ADD CONSTRAINT "submission_values_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submission_values"
    ADD CONSTRAINT "submission_values_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_submitted_by_fkey" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."submissions"
    ADD CONSTRAINT "submissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."tenant_audit_log"
    ADD CONSTRAINT "tenant_audit_log_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."tenant_audit_log"
    ADD CONSTRAINT "tenant_audit_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_checklist_template"
    ADD CONSTRAINT "trade_checklist_template_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_checklist_template_item"
    ADD CONSTRAINT "trade_checklist_template_item_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."trade_checklist_template"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_checklist_template_item"
    ADD CONSTRAINT "trade_checklist_template_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_checklist_template"
    ADD CONSTRAINT "trade_checklist_template_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_customer"
    ADD CONSTRAINT "trade_customer_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_customer_equipment"
    ADD CONSTRAINT "trade_customer_equipment_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_customer_equipment"
    ADD CONSTRAINT "trade_customer_equipment_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."trade_customer"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_customer_equipment"
    ADD CONSTRAINT "trade_customer_equipment_service_address_id_fkey" FOREIGN KEY ("service_address_id") REFERENCES "public"."trade_service_address"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_customer_equipment"
    ADD CONSTRAINT "trade_customer_equipment_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_customer_equipment"
    ADD CONSTRAINT "trade_customer_equipment_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."trade_work_order"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_customer"
    ADD CONSTRAINT "trade_customer_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_invoice"
    ADD CONSTRAINT "trade_invoice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_invoice"
    ADD CONSTRAINT "trade_invoice_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."trade_customer"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_invoice_line"
    ADD CONSTRAINT "trade_invoice_line_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "public"."trade_invoice"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_invoice_line"
    ADD CONSTRAINT "trade_invoice_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_invoice"
    ADD CONSTRAINT "trade_invoice_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_invoice"
    ADD CONSTRAINT "trade_invoice_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."trade_work_order"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_price_book_item"
    ADD CONSTRAINT "trade_price_book_item_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_price_book_item"
    ADD CONSTRAINT "trade_price_book_item_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_service_address"
    ADD CONSTRAINT "trade_service_address_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."trade_customer"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_service_address"
    ADD CONSTRAINT "trade_service_address_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_service_agreement"
    ADD CONSTRAINT "trade_service_agreement_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_service_agreement"
    ADD CONSTRAINT "trade_service_agreement_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."trade_customer"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_service_agreement"
    ADD CONSTRAINT "trade_service_agreement_service_address_id_fkey" FOREIGN KEY ("service_address_id") REFERENCES "public"."trade_service_address"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_service_agreement"
    ADD CONSTRAINT "trade_service_agreement_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order"
    ADD CONSTRAINT "trade_work_order_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order"
    ADD CONSTRAINT "trade_work_order_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order"
    ADD CONSTRAINT "trade_work_order_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "public"."trade_customer"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_field_log"
    ADD CONSTRAINT "trade_work_order_field_log_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_field_log"
    ADD CONSTRAINT "trade_work_order_field_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_field_log"
    ADD CONSTRAINT "trade_work_order_field_log_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."trade_work_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_line"
    ADD CONSTRAINT "trade_work_order_line_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_line"
    ADD CONSTRAINT "trade_work_order_line_price_book_item_id_fkey" FOREIGN KEY ("price_book_item_id") REFERENCES "public"."trade_price_book_item"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_line"
    ADD CONSTRAINT "trade_work_order_line_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_line"
    ADD CONSTRAINT "trade_work_order_line_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."trade_work_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_material"
    ADD CONSTRAINT "trade_work_order_material_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_material"
    ADD CONSTRAINT "trade_work_order_material_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_material"
    ADD CONSTRAINT "trade_work_order_material_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."trade_work_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_note"
    ADD CONSTRAINT "trade_work_order_note_author_user_id_fkey" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_note"
    ADD CONSTRAINT "trade_work_order_note_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_note"
    ADD CONSTRAINT "trade_work_order_note_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."trade_work_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order"
    ADD CONSTRAINT "trade_work_order_service_address_id_fkey" FOREIGN KEY ("service_address_id") REFERENCES "public"."trade_service_address"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_task"
    ADD CONSTRAINT "trade_work_order_task_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_task"
    ADD CONSTRAINT "trade_work_order_task_done_by_fkey" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_task"
    ADD CONSTRAINT "trade_work_order_task_source_template_id_fkey" FOREIGN KEY ("source_template_id") REFERENCES "public"."trade_checklist_template"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_task"
    ADD CONSTRAINT "trade_work_order_task_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_task"
    ADD CONSTRAINT "trade_work_order_task_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."trade_work_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order"
    ADD CONSTRAINT "trade_work_order_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_time"
    ADD CONSTRAINT "trade_work_order_time_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."trade_work_order_time"
    ADD CONSTRAINT "trade_work_order_time_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."trade_work_order_time"
    ADD CONSTRAINT "trade_work_order_time_work_order_id_fkey" FOREIGN KEY ("work_order_id") REFERENCES "public"."trade_work_order"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_document"
    ADD CONSTRAINT "transport_document_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_document"
    ADD CONSTRAINT "transport_document_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_driver"
    ADD CONSTRAINT "transport_driver_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_driver"
    ADD CONSTRAINT "transport_driver_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_driver"
    ADD CONSTRAINT "transport_driver_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_duty_status_event"
    ADD CONSTRAINT "transport_duty_status_event_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_duty_status_event"
    ADD CONSTRAINT "transport_duty_status_event_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."transport_driver"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_duty_status_event"
    ADD CONSTRAINT "transport_duty_status_event_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_medical_record"
    ADD CONSTRAINT "transport_medical_record_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transport_medical_record"
    ADD CONSTRAINT "transport_medical_record_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."transport_driver"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transport_medical_record"
    ADD CONSTRAINT "transport_medical_record_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_locations"
    ADD CONSTRAINT "user_locations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_permission_profile_id_fkey" FOREIGN KEY ("permission_profile_id") REFERENCES "public"."permission_profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visitors"
    ADD CONSTRAINT "visitors_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."visitors"
    ADD CONSTRAINT "visitors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worker_profiles"
    ADD CONSTRAINT "worker_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worker_profiles"
    ADD CONSTRAINT "worker_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worker_time_cards"
    ADD CONSTRAINT "worker_time_cards_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."worker_time_cards"
    ADD CONSTRAINT "worker_time_cards_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."worker_time_cards"
    ADD CONSTRAINT "worker_time_cards_worker_user_id_fkey" FOREIGN KEY ("worker_user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_conditions"
    ADD CONSTRAINT "workflow_conditions_next_step_id_fkey" FOREIGN KEY ("next_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workflow_conditions"
    ADD CONSTRAINT "workflow_conditions_source_form_id_fkey" FOREIGN KEY ("source_form_id") REFERENCES "public"."forms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."workflow_conditions"
    ADD CONSTRAINT "workflow_conditions_source_item_id_fkey" FOREIGN KEY ("source_item_id") REFERENCES "public"."form_items"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."workflow_conditions"
    ADD CONSTRAINT "workflow_conditions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_conditions"
    ADD CONSTRAINT "workflow_conditions_workflow_step_id_fkey" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_run_steps"
    ADD CONSTRAINT "workflow_run_steps_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workflow_run_steps"
    ADD CONSTRAINT "workflow_run_steps_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workflow_run_steps"
    ADD CONSTRAINT "workflow_run_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_run_steps"
    ADD CONSTRAINT "workflow_run_steps_workflow_run_id_fkey" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_run_steps"
    ADD CONSTRAINT "workflow_run_steps_workflow_step_id_fkey" FOREIGN KEY ("workflow_step_id") REFERENCES "public"."workflow_steps"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_runs"
    ADD CONSTRAINT "workflow_runs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_assignee_user_id_fkey" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_steps"
    ADD CONSTRAINT "workflow_steps_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE CASCADE;



ALTER TABLE "public"."auto_share_recipients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auto_share_recipients_tenant_delete" ON "public"."auto_share_recipients" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "auto_share_recipients_tenant_insert" ON "public"."auto_share_recipients" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "auto_share_recipients_tenant_select" ON "public"."auto_share_recipients" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "auto_share_recipients_tenant_update" ON "public"."auto_share_recipients" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."certification_types" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "certification_types_tenant_delete" ON "public"."certification_types" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "certification_types_tenant_insert" ON "public"."certification_types" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "certification_types_tenant_select" ON "public"."certification_types" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "certification_types_tenant_update" ON "public"."certification_types" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."certifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "certifications_tenant_delete" ON "public"."certifications" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "certifications_tenant_insert" ON "public"."certifications" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "certifications_tenant_select" ON "public"."certifications" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "certifications_tenant_update" ON "public"."certifications" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."change_order" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."change_order_approval" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "change_order_approval_tenant_delete" ON "public"."change_order_approval" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_approval_tenant_insert" ON "public"."change_order_approval" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_approval_tenant_select" ON "public"."change_order_approval" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_approval_tenant_update" ON "public"."change_order_approval" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."change_order_attachment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "change_order_attachment_tenant_delete" ON "public"."change_order_attachment" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_attachment_tenant_insert" ON "public"."change_order_attachment" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_attachment_tenant_select" ON "public"."change_order_attachment" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_attachment_tenant_update" ON "public"."change_order_attachment" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."change_order_line" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "change_order_line_tenant_delete" ON "public"."change_order_line" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_line_tenant_insert" ON "public"."change_order_line" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_line_tenant_select" ON "public"."change_order_line" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_line_tenant_update" ON "public"."change_order_line" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."change_order_markup" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "change_order_markup_tenant_delete" ON "public"."change_order_markup" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_markup_tenant_insert" ON "public"."change_order_markup" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_markup_tenant_select" ON "public"."change_order_markup" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_markup_tenant_update" ON "public"."change_order_markup" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_tenant_delete" ON "public"."change_order" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_tenant_insert" ON "public"."change_order" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_tenant_select" ON "public"."change_order" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "change_order_tenant_update" ON "public"."change_order" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."co_project" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "co_project_tenant_delete" ON "public"."co_project" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "co_project_tenant_insert" ON "public"."co_project" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "co_project_tenant_select" ON "public"."co_project" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "co_project_tenant_update" ON "public"."co_project" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."company_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "company_settings_tenant_delete" ON "public"."company_settings" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "company_settings_tenant_insert" ON "public"."company_settings" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "company_settings_tenant_select" ON "public"."company_settings" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "company_settings_tenant_update" ON "public"."company_settings" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."consultant_access" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "consultant_access_insert_consultant" ON "public"."consultant_access" FOR INSERT WITH CHECK ("authz"."is_active_consultant"());



CREATE POLICY "consultant_access_select_tenant_or_consultant" ON "public"."consultant_access" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_active_consultant"()));



CREATE POLICY "consultant_audit_insert_consultant" ON "public"."consultant_audit_log" FOR INSERT WITH CHECK ("authz"."is_active_consultant"());



ALTER TABLE "public"."consultant_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "consultant_audit_select_tenant_or_consultant" ON "public"."consultant_audit_log" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_active_consultant"()));



ALTER TABLE "public"."consultants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "consultants_select_self" ON "public"."consultants" FOR SELECT USING (("id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."document_control_register" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "document_control_register_tenant_delete" ON "public"."document_control_register" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "document_control_register_tenant_insert" ON "public"."document_control_register" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "document_control_register_tenant_select" ON "public"."document_control_register" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "document_control_register_tenant_update" ON "public"."document_control_register" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."dti_inspection" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."dti_inspection_item" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "dti_inspection_item_tenant_delete" ON "public"."dti_inspection_item" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "dti_inspection_item_tenant_insert" ON "public"."dti_inspection_item" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "dti_inspection_item_tenant_select" ON "public"."dti_inspection_item" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "dti_inspection_item_tenant_update" ON "public"."dti_inspection_item" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "dti_inspection_tenant_delete" ON "public"."dti_inspection" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "dti_inspection_tenant_insert" ON "public"."dti_inspection" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "dti_inspection_tenant_select" ON "public"."dti_inspection" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "dti_inspection_tenant_update" ON "public"."dti_inspection" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."eld_connection" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."eld_connection_secret" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eld_connection_tenant_delete" ON "public"."eld_connection" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_connection_tenant_insert" ON "public"."eld_connection" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_connection_tenant_select" ON "public"."eld_connection" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_connection_tenant_update" ON "public"."eld_connection" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."eld_device" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eld_device_tenant_delete" ON "public"."eld_device" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_device_tenant_insert" ON "public"."eld_device" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_device_tenant_select" ON "public"."eld_device" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_device_tenant_update" ON "public"."eld_device" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."eld_driver_event" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eld_driver_event_tenant_delete" ON "public"."eld_driver_event" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_event_tenant_insert" ON "public"."eld_driver_event" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_event_tenant_select" ON "public"."eld_driver_event" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_event_tenant_update" ON "public"."eld_driver_event" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."eld_driver_link" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eld_driver_link_tenant_delete" ON "public"."eld_driver_link" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_link_tenant_insert" ON "public"."eld_driver_link" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_link_tenant_select" ON "public"."eld_driver_link" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_link_tenant_update" ON "public"."eld_driver_link" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."eld_driver_performance" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eld_driver_performance_tenant_delete" ON "public"."eld_driver_performance" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_performance_tenant_insert" ON "public"."eld_driver_performance" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_performance_tenant_select" ON "public"."eld_driver_performance" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_performance_tenant_update" ON "public"."eld_driver_performance" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."eld_driver_profile" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eld_driver_profile_tenant_delete" ON "public"."eld_driver_profile" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_profile_tenant_insert" ON "public"."eld_driver_profile" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_profile_tenant_select" ON "public"."eld_driver_profile" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_driver_profile_tenant_update" ON "public"."eld_driver_profile" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."eld_vehicle_event" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eld_vehicle_event_tenant_delete" ON "public"."eld_vehicle_event" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_vehicle_event_tenant_insert" ON "public"."eld_vehicle_event" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_vehicle_event_tenant_select" ON "public"."eld_vehicle_event" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_vehicle_event_tenant_update" ON "public"."eld_vehicle_event" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."eld_vehicle_link" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "eld_vehicle_link_tenant_delete" ON "public"."eld_vehicle_link" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_vehicle_link_tenant_insert" ON "public"."eld_vehicle_link" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_vehicle_link_tenant_select" ON "public"."eld_vehicle_link" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "eld_vehicle_link_tenant_update" ON "public"."eld_vehicle_link" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."equipment" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment_document" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "equipment_document_tenant_delete" ON "public"."equipment_document" FOR DELETE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_document_tenant_insert" ON "public"."equipment_document" FOR INSERT TO "authenticated" WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_document_tenant_select" ON "public"."equipment_document" FOR SELECT TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_document_tenant_update" ON "public"."equipment_document" FOR UPDATE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."equipment_maintenance_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "equipment_maintenance_log_tenant_delete" ON "public"."equipment_maintenance_log" FOR DELETE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_maintenance_log_tenant_insert" ON "public"."equipment_maintenance_log" FOR INSERT TO "authenticated" WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_maintenance_log_tenant_select" ON "public"."equipment_maintenance_log" FOR SELECT TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_maintenance_log_tenant_update" ON "public"."equipment_maintenance_log" FOR UPDATE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."equipment_meter_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "equipment_meter_log_tenant_delete" ON "public"."equipment_meter_log" FOR DELETE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_meter_log_tenant_insert" ON "public"."equipment_meter_log" FOR INSERT TO "authenticated" WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_meter_log_tenant_select" ON "public"."equipment_meter_log" FOR SELECT TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_meter_log_tenant_update" ON "public"."equipment_meter_log" FOR UPDATE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."equipment_scheduled_service" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "equipment_scheduled_service_tenant_delete" ON "public"."equipment_scheduled_service" FOR DELETE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_scheduled_service_tenant_insert" ON "public"."equipment_scheduled_service" FOR INSERT TO "authenticated" WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_scheduled_service_tenant_select" ON "public"."equipment_scheduled_service" FOR SELECT TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_scheduled_service_tenant_update" ON "public"."equipment_scheduled_service" FOR UPDATE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."equipment_submission_link" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "equipment_submission_link_tenant_delete" ON "public"."equipment_submission_link" FOR DELETE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_submission_link_tenant_insert" ON "public"."equipment_submission_link" FOR INSERT TO "authenticated" WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_submission_link_tenant_select" ON "public"."equipment_submission_link" FOR SELECT TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_submission_link_tenant_update" ON "public"."equipment_submission_link" FOR UPDATE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_tenant_delete" ON "public"."equipment" FOR DELETE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_tenant_insert" ON "public"."equipment" FOR INSERT TO "authenticated" WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_tenant_select" ON "public"."equipment" FOR SELECT TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "equipment_tenant_update" ON "public"."equipment" FOR UPDATE TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."field_ticket" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "field_ticket_tenant_delete" ON "public"."field_ticket" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "field_ticket_tenant_insert" ON "public"."field_ticket" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "field_ticket_tenant_select" ON "public"."field_ticket" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "field_ticket_tenant_update" ON "public"."field_ticket" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."follow_ups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "follow_ups_tenant_delete" ON "public"."follow_ups" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "follow_ups_tenant_insert" ON "public"."follow_ups" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "follow_ups_tenant_select" ON "public"."follow_ups" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "follow_ups_tenant_update" ON "public"."follow_ups" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."form_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_items_tenant_delete" ON "public"."form_items" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "form_items_tenant_insert" ON "public"."form_items" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "form_items_tenant_select" ON "public"."form_items" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "form_items_tenant_update" ON "public"."form_items" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."form_sections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "form_sections_tenant_delete" ON "public"."form_sections" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "form_sections_tenant_insert" ON "public"."form_sections" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "form_sections_tenant_select" ON "public"."form_sections" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "form_sections_tenant_update" ON "public"."form_sections" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."forms" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "forms_tenant_delete" ON "public"."forms" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "forms_tenant_insert" ON "public"."forms" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "forms_tenant_select" ON "public"."forms" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "forms_tenant_update" ON "public"."forms" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."gc_rfi" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "gc_rfi_tenant_delete" ON "public"."gc_rfi" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "gc_rfi_tenant_insert" ON "public"."gc_rfi" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "gc_rfi_tenant_select" ON "public"."gc_rfi" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "gc_rfi_tenant_update" ON "public"."gc_rfi" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."list_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "list_items_tenant_delete" ON "public"."list_items" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "list_items_tenant_insert" ON "public"."list_items" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "list_items_tenant_select" ON "public"."list_items" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "list_items_tenant_update" ON "public"."list_items" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."lists" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lists_tenant_delete" ON "public"."lists" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "lists_tenant_insert" ON "public"."lists" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "lists_tenant_select" ON "public"."lists" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "lists_tenant_update" ON "public"."lists" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_tenant_delete" ON "public"."locations" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "locations_tenant_insert" ON "public"."locations" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "locations_tenant_select" ON "public"."locations" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "locations_tenant_update" ON "public"."locations" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_tenant_delete" ON "public"."notifications" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "notifications_tenant_insert" ON "public"."notifications" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "notifications_tenant_select" ON "public"."notifications" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "notifications_tenant_update" ON "public"."notifications" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."permission_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "permission_profiles_tenant_delete" ON "public"."permission_profiles" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "permission_profiles_tenant_insert" ON "public"."permission_profiles" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "permission_profiles_tenant_select" ON "public"."permission_profiles" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "permission_profiles_tenant_update" ON "public"."permission_profiles" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."print_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "print_settings_tenant_delete" ON "public"."print_settings" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "print_settings_tenant_insert" ON "public"."print_settings" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "print_settings_tenant_select" ON "public"."print_settings" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "print_settings_tenant_update" ON "public"."print_settings" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."resource_sections" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "resource_sections_tenant_delete" ON "public"."resource_sections" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "resource_sections_tenant_insert" ON "public"."resource_sections" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "resource_sections_tenant_select" ON "public"."resource_sections" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "resource_sections_tenant_update" ON "public"."resource_sections" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."resources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "resources_tenant_delete" ON "public"."resources" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "resources_tenant_insert" ON "public"."resources" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "resources_tenant_select" ON "public"."resources" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "resources_tenant_update" ON "public"."resources" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."scheduled_tasks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scheduled_tasks_tenant_delete" ON "public"."scheduled_tasks" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "scheduled_tasks_tenant_insert" ON "public"."scheduled_tasks" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "scheduled_tasks_tenant_select" ON "public"."scheduled_tasks" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "scheduled_tasks_tenant_update" ON "public"."scheduled_tasks" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."schedules" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "schedules_tenant_delete" ON "public"."schedules" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "schedules_tenant_insert" ON "public"."schedules" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "schedules_tenant_select" ON "public"."schedules" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "schedules_tenant_update" ON "public"."schedules" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."signatures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "signatures_tenant_delete" ON "public"."signatures" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "signatures_tenant_insert" ON "public"."signatures" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "signatures_tenant_select" ON "public"."signatures" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "signatures_tenant_update" ON "public"."signatures" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."submission_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "submission_photos_tenant_delete" ON "public"."submission_photos" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "submission_photos_tenant_insert" ON "public"."submission_photos" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "submission_photos_tenant_select" ON "public"."submission_photos" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "submission_photos_tenant_update" ON "public"."submission_photos" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."submission_values" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "submission_values_tenant_delete" ON "public"."submission_values" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "submission_values_tenant_insert" ON "public"."submission_values" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "submission_values_tenant_select" ON "public"."submission_values" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "submission_values_tenant_update" ON "public"."submission_values" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."submissions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "submissions_tenant_delete" ON "public"."submissions" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "submissions_tenant_insert" ON "public"."submissions" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "submissions_tenant_select" ON "public"."submissions" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "submissions_tenant_update" ON "public"."submissions" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."tenant_audit_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenant_audit_select_tenant_admins" ON "public"."tenant_audit_log" FOR SELECT USING ((("tenant_id" = "authz"."current_user_tenant_id"()) AND ("authz"."current_user_power_level"() = ANY (ARRAY['super_admin'::"public"."power_level", 'admin'::"public"."power_level"]))));



ALTER TABLE "public"."tenants" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "tenants_select_self_or_consultant" ON "public"."tenants" FOR SELECT USING ((("id" = "authz"."current_user_tenant_id"()) OR "authz"."is_consultant_allowed"("id")));



CREATE POLICY "tenants_update_self_super_admin" ON "public"."tenants" FOR UPDATE USING ((("id" = "authz"."current_user_tenant_id"()) AND ("authz"."current_user_power_level"() = 'super_admin'::"public"."power_level"))) WITH CHECK ((("id" = "authz"."current_user_tenant_id"()) AND ("authz"."current_user_power_level"() = 'super_admin'::"public"."power_level")));



ALTER TABLE "public"."trade_checklist_template" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trade_checklist_template_item" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_checklist_template_item_tenant_delete" ON "public"."trade_checklist_template_item" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_checklist_template_item_tenant_insert" ON "public"."trade_checklist_template_item" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_checklist_template_item_tenant_select" ON "public"."trade_checklist_template_item" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_checklist_template_item_tenant_update" ON "public"."trade_checklist_template_item" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_checklist_template_tenant_delete" ON "public"."trade_checklist_template" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_checklist_template_tenant_insert" ON "public"."trade_checklist_template" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_checklist_template_tenant_select" ON "public"."trade_checklist_template" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_checklist_template_tenant_update" ON "public"."trade_checklist_template" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_customer" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trade_customer_equipment" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_customer_equipment_tenant_delete" ON "public"."trade_customer_equipment" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_customer_equipment_tenant_insert" ON "public"."trade_customer_equipment" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_customer_equipment_tenant_select" ON "public"."trade_customer_equipment" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_customer_equipment_tenant_update" ON "public"."trade_customer_equipment" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_customer_tenant_delete" ON "public"."trade_customer" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_customer_tenant_insert" ON "public"."trade_customer" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_customer_tenant_select" ON "public"."trade_customer" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_customer_tenant_update" ON "public"."trade_customer" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_invoice" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trade_invoice_line" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_invoice_line_tenant_delete" ON "public"."trade_invoice_line" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_invoice_line_tenant_insert" ON "public"."trade_invoice_line" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_invoice_line_tenant_select" ON "public"."trade_invoice_line" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_invoice_line_tenant_update" ON "public"."trade_invoice_line" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_invoice_tenant_delete" ON "public"."trade_invoice" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_invoice_tenant_insert" ON "public"."trade_invoice" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_invoice_tenant_select" ON "public"."trade_invoice" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_invoice_tenant_update" ON "public"."trade_invoice" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_price_book_item" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_price_book_item_tenant_delete" ON "public"."trade_price_book_item" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_price_book_item_tenant_insert" ON "public"."trade_price_book_item" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_price_book_item_tenant_select" ON "public"."trade_price_book_item" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_price_book_item_tenant_update" ON "public"."trade_price_book_item" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_service_address" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_service_address_tenant_delete" ON "public"."trade_service_address" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_service_address_tenant_insert" ON "public"."trade_service_address" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_service_address_tenant_select" ON "public"."trade_service_address" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_service_address_tenant_update" ON "public"."trade_service_address" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_service_agreement" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_service_agreement_tenant_delete" ON "public"."trade_service_agreement" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_service_agreement_tenant_insert" ON "public"."trade_service_agreement" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_service_agreement_tenant_select" ON "public"."trade_service_agreement" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_service_agreement_tenant_update" ON "public"."trade_service_agreement" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_work_order" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."trade_work_order_field_log" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_work_order_field_log_tenant_delete" ON "public"."trade_work_order_field_log" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_field_log_tenant_insert" ON "public"."trade_work_order_field_log" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_field_log_tenant_select" ON "public"."trade_work_order_field_log" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_field_log_tenant_update" ON "public"."trade_work_order_field_log" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_work_order_line" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_work_order_line_tenant_delete" ON "public"."trade_work_order_line" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_line_tenant_insert" ON "public"."trade_work_order_line" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_line_tenant_select" ON "public"."trade_work_order_line" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_line_tenant_update" ON "public"."trade_work_order_line" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_work_order_material" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_work_order_material_tenant_delete" ON "public"."trade_work_order_material" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_material_tenant_insert" ON "public"."trade_work_order_material" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_material_tenant_select" ON "public"."trade_work_order_material" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_material_tenant_update" ON "public"."trade_work_order_material" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_work_order_note" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_work_order_note_tenant_delete" ON "public"."trade_work_order_note" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_note_tenant_insert" ON "public"."trade_work_order_note" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_note_tenant_select" ON "public"."trade_work_order_note" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_note_tenant_update" ON "public"."trade_work_order_note" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_work_order_task" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_work_order_task_tenant_delete" ON "public"."trade_work_order_task" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_task_tenant_insert" ON "public"."trade_work_order_task" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_task_tenant_select" ON "public"."trade_work_order_task" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_task_tenant_update" ON "public"."trade_work_order_task" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_tenant_delete" ON "public"."trade_work_order" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_tenant_insert" ON "public"."trade_work_order" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_tenant_select" ON "public"."trade_work_order" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_tenant_update" ON "public"."trade_work_order" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."trade_work_order_time" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trade_work_order_time_tenant_delete" ON "public"."trade_work_order_time" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_time_tenant_insert" ON "public"."trade_work_order_time" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_time_tenant_select" ON "public"."trade_work_order_time" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "trade_work_order_time_tenant_update" ON "public"."trade_work_order_time" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."transport_document" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_document_tenant_delete" ON "public"."transport_document" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "transport_document_tenant_insert" ON "public"."transport_document" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "transport_document_tenant_select" ON "public"."transport_document" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "transport_document_tenant_update" ON "public"."transport_document" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."transport_driver" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_driver_tenant_delete" ON "public"."transport_driver" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "transport_driver_tenant_insert" ON "public"."transport_driver" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "transport_driver_tenant_select" ON "public"."transport_driver" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "transport_driver_tenant_update" ON "public"."transport_driver" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."transport_duty_status_event" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_duty_status_event_tenant_delete" ON "public"."transport_duty_status_event" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "transport_duty_status_event_tenant_insert" ON "public"."transport_duty_status_event" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "transport_duty_status_event_tenant_select" ON "public"."transport_duty_status_event" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "transport_duty_status_event_tenant_update" ON "public"."transport_duty_status_event" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."transport_medical_record" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transport_medical_record_delete" ON "public"."transport_medical_record" FOR DELETE USING ("authz"."current_user_can_access_medical_vault"("tenant_id", "driver_id"));



CREATE POLICY "transport_medical_record_insert" ON "public"."transport_medical_record" FOR INSERT WITH CHECK ("authz"."current_user_can_access_medical_vault"("tenant_id", "driver_id"));



CREATE POLICY "transport_medical_record_select" ON "public"."transport_medical_record" FOR SELECT USING ("authz"."current_user_can_access_medical_vault"("tenant_id", "driver_id"));



CREATE POLICY "transport_medical_record_update" ON "public"."transport_medical_record" FOR UPDATE USING ("authz"."current_user_can_access_medical_vault"("tenant_id", "driver_id")) WITH CHECK ("authz"."current_user_can_access_medical_vault"("tenant_id", "driver_id"));



ALTER TABLE "public"."user_locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_locations_tenant_delete" ON "public"."user_locations" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "user_locations_tenant_insert" ON "public"."user_locations" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "user_locations_tenant_select" ON "public"."user_locations" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "user_locations_tenant_update" ON "public"."user_locations" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_tenant_delete" ON "public"."users" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "users_tenant_insert" ON "public"."users" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "users_tenant_select" ON "public"."users" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "users_tenant_update" ON "public"."users" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."visitors" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "visitors_tenant_delete" ON "public"."visitors" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "visitors_tenant_insert" ON "public"."visitors" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "visitors_tenant_select" ON "public"."visitors" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "visitors_tenant_update" ON "public"."visitors" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."worker_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "worker_profiles_tenant_delete" ON "public"."worker_profiles" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "worker_profiles_tenant_insert" ON "public"."worker_profiles" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "worker_profiles_tenant_select" ON "public"."worker_profiles" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "worker_profiles_tenant_update" ON "public"."worker_profiles" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."worker_time_cards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "worker_time_cards_tenant_select" ON "public"."worker_time_cards" FOR SELECT TO "authenticated" USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "worker_time_cards_worker_insert" ON "public"."worker_time_cards" FOR INSERT TO "authenticated" WITH CHECK ((("auth"."uid"() = "worker_user_id") AND "authz"."is_tenant_member"("tenant_id")));



CREATE POLICY "worker_time_cards_worker_update" ON "public"."worker_time_cards" FOR UPDATE TO "authenticated" USING ((("auth"."uid"() = "worker_user_id") AND "authz"."is_tenant_member"("tenant_id"))) WITH CHECK ((("auth"."uid"() = "worker_user_id") AND "authz"."is_tenant_member"("tenant_id")));



ALTER TABLE "public"."workflow_conditions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workflow_conditions_tenant_delete" ON "public"."workflow_conditions" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_conditions_tenant_insert" ON "public"."workflow_conditions" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_conditions_tenant_select" ON "public"."workflow_conditions" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_conditions_tenant_update" ON "public"."workflow_conditions" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."workflow_run_steps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workflow_run_steps_tenant_delete" ON "public"."workflow_run_steps" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_run_steps_tenant_insert" ON "public"."workflow_run_steps" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_run_steps_tenant_select" ON "public"."workflow_run_steps" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_run_steps_tenant_update" ON "public"."workflow_run_steps" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."workflow_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workflow_runs_tenant_delete" ON "public"."workflow_runs" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_runs_tenant_insert" ON "public"."workflow_runs" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_runs_tenant_select" ON "public"."workflow_runs" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_runs_tenant_update" ON "public"."workflow_runs" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."workflow_steps" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workflow_steps_tenant_delete" ON "public"."workflow_steps" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_steps_tenant_insert" ON "public"."workflow_steps" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_steps_tenant_select" ON "public"."workflow_steps" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflow_steps_tenant_update" ON "public"."workflow_steps" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



ALTER TABLE "public"."workflows" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workflows_tenant_delete" ON "public"."workflows" FOR DELETE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflows_tenant_insert" ON "public"."workflows" FOR INSERT WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflows_tenant_select" ON "public"."workflows" FOR SELECT USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



CREATE POLICY "workflows_tenant_update" ON "public"."workflows" FOR UPDATE USING (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id"))) WITH CHECK (("authz"."is_tenant_member"("tenant_id") OR "authz"."is_consultant_allowed"("tenant_id")));



GRANT USAGE ON SCHEMA "authz" TO "authenticated";
GRANT USAGE ON SCHEMA "authz" TO "service_role";
GRANT USAGE ON SCHEMA "authz" TO "supabase_auth_admin";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "authz"."can_access_medical_vault_path"("object_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "authz"."can_access_medical_vault_path"("object_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "authz"."can_access_storage_tenant_path"("object_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "authz"."can_access_storage_tenant_path"("object_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "authz"."can_access_storage_tenant_path"("object_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "authz"."current_user_can_access_medical_vault"("target_tenant_id" "uuid", "target_driver_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "authz"."current_user_can_access_medical_vault"("target_tenant_id" "uuid", "target_driver_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "authz"."current_user_power_level"() FROM PUBLIC;
GRANT ALL ON FUNCTION "authz"."current_user_power_level"() TO "authenticated";
GRANT ALL ON FUNCTION "authz"."current_user_power_level"() TO "service_role";



REVOKE ALL ON FUNCTION "authz"."current_user_tenant_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "authz"."current_user_tenant_id"() TO "authenticated";
GRANT ALL ON FUNCTION "authz"."current_user_tenant_id"() TO "service_role";



REVOKE ALL ON FUNCTION "authz"."handle_new_core_pathways_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "authz"."handle_new_core_pathways_user"() TO "supabase_auth_admin";



REVOKE ALL ON FUNCTION "authz"."is_active_consultant"() FROM PUBLIC;
GRANT ALL ON FUNCTION "authz"."is_active_consultant"() TO "authenticated";
GRANT ALL ON FUNCTION "authz"."is_active_consultant"() TO "service_role";



REVOKE ALL ON FUNCTION "authz"."is_consultant_allowed"("target_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "authz"."is_consultant_allowed"("target_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "authz"."is_consultant_allowed"("target_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "authz"."is_tenant_member"("target_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "authz"."is_tenant_member"("target_tenant_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "authz"."is_tenant_member"("target_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."applied_migration_names"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."applied_migration_names"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."applied_migration_names"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_power_level"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_power_level"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_tenant_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_tenant_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_managed_list_items_tree"("p_tenant_id" "uuid", "p_list_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_managed_list_items_tree"("p_tenant_id" "uuid", "p_list_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_active_consultant"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_active_consultant"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_consultant_allowed"("target_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_consultant_allowed"("target_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_tenant_member"("target_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_tenant_member"("target_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."link_inspection_forms_to_equipment_for_tenant"("target_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."link_inspection_forms_to_equipment_for_tenant"("target_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."require_inspection_meter_for_tenant"("target_tenant_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_cor_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_cor_gap_closers_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_cor_inspection_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_managed_lists_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_orientation_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_starter_forms_for_tenant"("target_tenant_id" "uuid", "target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."tag_cor_forms_for_tenant"("target_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tag_cor_forms_for_tenant"("target_tenant_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."tag_inspection_defect_severity_for_tenant"("target_tenant_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."tag_inspection_defect_severity_for_tenant"("target_tenant_id" "uuid") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."auto_share_recipients" TO "anon";
GRANT ALL ON TABLE "public"."auto_share_recipients" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."auto_share_recipients" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."certification_types" TO "anon";
GRANT ALL ON TABLE "public"."certification_types" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."certification_types" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."certifications" TO "anon";
GRANT ALL ON TABLE "public"."certifications" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."certifications" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_approval" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_approval" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_approval" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_attachment" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_attachment" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_attachment" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_line" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_line" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_line" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_markup" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_markup" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."change_order_markup" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."co_project" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."co_project" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."co_project" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."company_settings" TO "anon";
GRANT ALL ON TABLE "public"."company_settings" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."company_settings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."consultant_access" TO "anon";
GRANT ALL ON TABLE "public"."consultant_access" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."consultant_access" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."consultant_audit_log" TO "anon";
GRANT ALL ON TABLE "public"."consultant_audit_log" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."consultant_audit_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."consultants" TO "anon";
GRANT ALL ON TABLE "public"."consultants" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."consultants" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."document_control_register" TO "anon";
GRANT ALL ON TABLE "public"."document_control_register" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."document_control_register" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."dti_inspection" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."dti_inspection" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."dti_inspection" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."dti_inspection_item" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."dti_inspection_item" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."dti_inspection_item" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_connection" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_connection" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_connection" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_connection_secret" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_connection_secret" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_connection_secret" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_device" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_device" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_device" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_event" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_event" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_event" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_link" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_link" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_link" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_performance" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_performance" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_performance" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_profile" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_profile" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_driver_profile" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_vehicle_event" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_vehicle_event" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_vehicle_event" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_vehicle_link" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_vehicle_link" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."eld_vehicle_link" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_document" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_document" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_document" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_maintenance_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_maintenance_log" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_maintenance_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_meter_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_meter_log" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_meter_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_scheduled_service" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_scheduled_service" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_scheduled_service" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_submission_link" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_submission_link" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."equipment_submission_link" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."field_ticket" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."field_ticket" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."field_ticket" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."follow_ups" TO "anon";
GRANT ALL ON TABLE "public"."follow_ups" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."follow_ups" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."form_items" TO "anon";
GRANT ALL ON TABLE "public"."form_items" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."form_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."form_sections" TO "anon";
GRANT ALL ON TABLE "public"."form_sections" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."form_sections" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."forms" TO "anon";
GRANT ALL ON TABLE "public"."forms" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."forms" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."gc_rfi" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."gc_rfi" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."gc_rfi" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."list_items" TO "anon";
GRANT ALL ON TABLE "public"."list_items" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."list_items" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."lists" TO "anon";
GRANT ALL ON TABLE "public"."lists" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."lists" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."locations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."notifications" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."permission_profiles" TO "anon";
GRANT ALL ON TABLE "public"."permission_profiles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."permission_profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."print_settings" TO "anon";
GRANT ALL ON TABLE "public"."print_settings" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."print_settings" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."resource_sections" TO "anon";
GRANT ALL ON TABLE "public"."resource_sections" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."resource_sections" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."resources" TO "anon";
GRANT ALL ON TABLE "public"."resources" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."resources" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."scheduled_tasks" TO "anon";
GRANT ALL ON TABLE "public"."scheduled_tasks" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."scheduled_tasks" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."schedules" TO "anon";
GRANT ALL ON TABLE "public"."schedules" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."schedules" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."signatures" TO "anon";
GRANT ALL ON TABLE "public"."signatures" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."signatures" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."submission_photos" TO "anon";
GRANT ALL ON TABLE "public"."submission_photos" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."submission_photos" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."submission_values" TO "anon";
GRANT ALL ON TABLE "public"."submission_values" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."submission_values" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."submissions" TO "anon";
GRANT ALL ON TABLE "public"."submissions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."submissions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."tenant_audit_log" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."tenant_audit_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."tenants" TO "anon";
GRANT ALL ON TABLE "public"."tenants" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."tenants" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_checklist_template" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_checklist_template" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_checklist_template" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_checklist_template_item" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_checklist_template_item" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_checklist_template_item" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_customer" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_customer" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_customer" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_customer_equipment" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_customer_equipment" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_customer_equipment" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_invoice" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_invoice" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_invoice" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_invoice_line" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_invoice_line" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_invoice_line" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_price_book_item" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_price_book_item" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_price_book_item" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_service_address" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_service_address" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_service_address" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_service_agreement" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_service_agreement" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_service_agreement" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_field_log" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_field_log" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_field_log" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_line" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_line" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_line" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_material" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_material" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_material" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_note" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_note" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_note" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_task" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_task" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_task" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_time" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_time" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."trade_work_order_time" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_document" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_document" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_document" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_driver" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_driver" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_driver" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_duty_status_event" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_duty_status_event" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_duty_status_event" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_medical_record" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_medical_record" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."transport_medical_record" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."user_locations" TO "anon";
GRANT ALL ON TABLE "public"."user_locations" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."user_locations" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."users" TO "anon";
GRANT ALL ON TABLE "public"."users" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."users" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."visitors" TO "anon";
GRANT ALL ON TABLE "public"."visitors" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."visitors" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."worker_profiles" TO "anon";
GRANT ALL ON TABLE "public"."worker_profiles" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."worker_profiles" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."worker_time_cards" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,UPDATE ON TABLE "public"."worker_time_cards" TO "authenticated";
GRANT ALL ON TABLE "public"."worker_time_cards" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflow_conditions" TO "anon";
GRANT ALL ON TABLE "public"."workflow_conditions" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflow_conditions" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflow_run_steps" TO "anon";
GRANT ALL ON TABLE "public"."workflow_run_steps" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflow_run_steps" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflow_runs" TO "anon";
GRANT ALL ON TABLE "public"."workflow_runs" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflow_runs" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflow_steps" TO "anon";
GRANT ALL ON TABLE "public"."workflow_steps" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflow_steps" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflows" TO "anon";
GRANT ALL ON TABLE "public"."workflows" TO "authenticated";
GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLE "public"."workflows" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT UPDATE ON SEQUENCES  TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS  TO "postgres";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES  TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLES  TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLES  TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT REFERENCES,TRIGGER,TRUNCATE ON TABLES  TO "service_role";

--
-- Objects outside the public and authz schemas: the signup trigger on auth.users
-- and the storage buckets and their policies. A schema-scoped dump does not carry
-- these, so they are declared explicitly. Without them, signup silently does
-- nothing and every file upload is rejected.
--

CREATE TRIGGER on_auth_user_created_core_pathways AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION authz.handle_new_core_pathways_user();
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('medical-vault', 'medical-vault', 'f', null, null) on conflict (id) do nothing;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('tenant-documents', 'tenant-documents', 'f', 52428800, '{application/pdf,image/heic,image/heif,image/png,image/jpeg,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document}'::text[]) on conflict (id) do nothing;
create policy medical_vault_delete on storage.objects for DELETE to authenticated using (((bucket_id = 'medical-vault'::text) AND authz.can_access_medical_vault_path(name)));
create policy medical_vault_insert on storage.objects for INSERT to authenticated with check (((bucket_id = 'medical-vault'::text) AND authz.can_access_medical_vault_path(name)));
create policy medical_vault_select on storage.objects for SELECT to authenticated using (((bucket_id = 'medical-vault'::text) AND authz.can_access_medical_vault_path(name)));
create policy medical_vault_update on storage.objects for UPDATE to authenticated using (((bucket_id = 'medical-vault'::text) AND authz.can_access_medical_vault_path(name))) with check (((bucket_id = 'medical-vault'::text) AND authz.can_access_medical_vault_path(name)));
create policy tenant_documents_delete on storage.objects for DELETE to authenticated using (((bucket_id = 'tenant-documents'::text) AND authz.can_access_storage_tenant_path(name)));
create policy tenant_documents_insert on storage.objects for INSERT to authenticated with check (((bucket_id = 'tenant-documents'::text) AND authz.can_access_storage_tenant_path(name)));
create policy tenant_documents_select on storage.objects for SELECT to authenticated using (((bucket_id = 'tenant-documents'::text) AND authz.can_access_storage_tenant_path(name)));
create policy tenant_documents_update on storage.objects for UPDATE to authenticated using (((bucket_id = 'tenant-documents'::text) AND authz.can_access_storage_tenant_path(name))) with check (((bucket_id = 'tenant-documents'::text) AND authz.can_access_storage_tenant_path(name)));


--
-- Table privileges.
--
-- Row level security decides which ROWS a user sees. It cannot grant access to a
-- table in the first place: without a table privilege, PostgREST returns
-- "permission denied for table x" no matter how permissive the policies are.
--
-- The old 0001_foundation.sql said:
--
--   grant select, insert, update, delete on all tables in schema public to authenticated;
--
-- "on all tables" is a one-time grant over the tables that exist at that instant,
-- not a standing rule. Every table added by a later migration silently missed it,
-- because ALTER DEFAULT PRIVILEGES is keyed to the creating role and no default
-- exists for postgres in this schema. By the end that was 45 of 83 tables,
-- including all of change orders, daily trip inspections, and ELD, unreadable even
-- by service_role. Granting explicitly here, then restating the deliberate
-- restrictions, then setting a default so new tables cannot regress the same way.
--
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "authenticated";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO "service_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO "authenticated", "service_role";

-- Deliberate restrictions, reapplied after the blanket grant above.
-- tenant_audit_log is append-only from the app's point of view: readable, never
-- edited or erased by a user. worker_time_cards may be corrected but not deleted.
REVOKE INSERT, UPDATE, DELETE ON TABLE "public"."tenant_audit_log" FROM "authenticated";
REVOKE ALL ON TABLE "public"."tenant_audit_log" FROM "anon";
REVOKE DELETE ON TABLE "public"."worker_time_cards" FROM "authenticated";

-- The standing rule the original grant should have been. Any table created later
-- by postgres in this schema now gets the same privileges automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  GRANT USAGE, SELECT ON SEQUENCES TO "authenticated", "service_role";

--
-- pg_dump blanks search_path at the top of this file for its own name resolution
-- and never restores it. Anything running afterwards in the same session (notably
-- seed.sql) would inherit the empty path and fail to resolve unqualified
-- functions such as gen_salt(). Restore the Supabase default.
--
SELECT pg_catalog.set_config('search_path', 'public, extensions', false);
