-- Every company that drives to somebody else's site has a site orientation ticket.
--
-- A driver pulling into a fuel terminal, a battery, a plant or a lease is oriented
-- by the company that owns the site, and gets a card with an expiry on it. It is a
-- real ticket that really lapses, and it is not H2S Alive or First Aid: there are
-- hundreds of possible sites and no fixed list of them anywhere.
--
-- Modelling one certification_type per site would be wrong. The types list is the
-- thing an administrator ticks as mandatory, and filling it with hundreds of
-- one-off company names would make it unusable and the mandatory count meaningless.
--
-- So there is ONE type, "Site Orientation", and the specific site goes in the
-- certification's own name. That already works: createWorkerCertification prefers
-- the typed-in name over the type's name, so picking Site Orientation and typing
-- "Redwater Terminal" stores the specific site while keeping every orientation
-- grouped under one heading.
--
-- It is seeded as NOT mandatory on purpose. Which sites a given driver needs is a
-- function of where that company hauls, so no deployment can be told in advance
-- that a missing orientation is a compliance gap. Tracking the expiry is the value;
-- declaring it required is the customer's call.
--
-- expires = true, because orientations lapse and get redone.

create or replace function "public"."seed_starter_certification_types_for_tenant"(
  "target_tenant_id" "uuid",
  "target_user_id" "uuid" default null::"uuid"
) returns "void"
    language "plpgsql" security definer
    set "search_path" to 'public', 'pg_temp'
    as $$
begin
  insert into public.certification_types (tenant_id, name, expires, is_mandatory)
  values (target_tenant_id, 'Site Orientation', true, false)
  on conflict (tenant_id, name) do nothing;
end;
$$;

alter function "public"."seed_starter_certification_types_for_tenant"("uuid", "uuid") owner to "postgres";

-- Same lockdown as every other seed function: the signup trigger calls it as the
-- definer, and nothing reachable over PostgREST may call it directly.
-- Naming the roles matters; `revoke from public` leaves Supabase's own grants to
-- anon and authenticated in place.
revoke all on function "public"."seed_starter_certification_types_for_tenant"("uuid", "uuid")
  from "public", "anon", "authenticated";
grant execute on function "public"."seed_starter_certification_types_for_tenant"("uuid", "uuid")
  to "service_role";

-- Give it to every tenant that already exists, not just the ones created from here
-- on. Adding a non-mandatory type cannot change anybody's compliance numbers, and a
-- customer who does not want it can delete it.
insert into public.certification_types (tenant_id, name, expires, is_mandatory)
select t.id, 'Site Orientation', true, false
  from public.tenants t
on conflict (tenant_id, name) do nothing;

-- The signup trigger, reproduced from 20260817000000 with one line added, so a
-- brand new deployment starts with the type already there. Everything else in this
-- function is unchanged; see that migration for why the password branch is the
-- thing that decides whether a company gets founded.

create or replace function "authz"."handle_new_core_pathways_user"() returns "trigger"
    language "plpgsql" security definer
    set "search_path" to 'public', 'authz'
    as $$
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

  -- Rule 1. No password of their own choosing means this is not somebody signing
  -- themselves up: it is an invitation, a magic link, or an OAuth first login. An
  -- invitation is a join, not a founding, so the inviting action owns provisioning
  -- this person into the company that invited them. The other two create nothing
  -- and reach nothing. See the note above on why this is the password and not
  -- `invited_at`, which is still NULL at this point.
  if coalesce(new.encrypted_password, '') = '' then
    return new;
  end if;

  -- Rule 2. Un-invited, and the deployment already belongs to somebody. Refusing
  -- here aborts the insert, so no half-made auth account is left behind for
  -- somebody to wonder about later.
  if exists (select 1 from public.tenants) then
    raise exception 'Signing yourself up is closed on this deployment. Ask an administrator to invite you.'
      using errcode = '42501';
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
  perform public.seed_starter_certification_types_for_tenant(new_tenant_id, new.id);

  return new;
end;
$$;
