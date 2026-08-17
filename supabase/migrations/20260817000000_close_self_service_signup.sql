-- One un-invited signup per deployment. Everybody else arrives by invitation.
--
-- WHAT WENT WRONG, because the shape of it matters more than the fix:
--
-- A client's office manager went to their own deployment's login page, filled in
-- the signup form, and got a brand new company inside the client's database, with
-- herself as its Super Admin. She could have typed any company name she liked. The
-- owner could not promote her from the admin panel and could not even see her,
-- because she was not in his tenant at all; she was in her own. Two companies, one
-- database, and no way to tell from inside the app that it had happened.
--
-- Nothing was broken. This is what the code did on purpose: the trigger below built
-- a whole tenant for every new auth user, and the signup form is reachable by
-- anyone who can load the login page.
--
-- WHY THE FORM IS THE WRONG PLACE TO FIX IT:
--
-- The form is not the only door. The anon key ships in every browser bundle, so
-- anyone can POST straight to /auth/v1/signup and skip the application entirely.
-- A check in the server action stops the honest path and nothing else. The rule has
-- to live here, in the trigger, where every door leads.
--
-- THE RULE:
--
--   1. An account that did not choose its own password never founds a company. It
--      gets no tenant and no user row; the server action that sent the invitation
--      provisions it into the inviting company.
--
--   2. An account that DID choose its own password founds a company only if there
--      is no company yet. The first account in a fresh database is the founder.
--      After that, self-service signup is closed forever and the only way in is an
--      invitation.
--
-- WHY THE PASSWORD, AND NOT `invited_at`:
--
-- `invited_at` is the obvious signal and it does not work. Measured on a local
-- database by logging `to_jsonb(new)` from this very trigger: at INSERT time the
-- invited row has `invited_at` NULL, exactly like a self-signup. GoTrue stamps it
-- afterwards, so a check on it here refuses every invitation. That mistake passed a
-- pgTAP test that asserted the assumption, and was caught only by driving the real
-- HTTP endpoints. What differs at INSERT is the password:
--
--     invite      -> encrypted_password empty   (they have not set one yet)
--     self-signup -> encrypted_password present (POST /auth/v1/signup requires one)
--
-- Metadata is no use for this either: `options.data` on a self-signup is whatever
-- the caller typed, so it can claim anything.
--
-- The passwordless branch is safe to let through precisely because it creates
-- nothing: no tenant, no user row, and therefore no reach into anything, because
-- RLS has no membership to grant them. The only branch that can bring a company
-- into existence is the password branch, and that one is shut the moment a company
-- exists.
--
-- Measured over the real endpoints rather than reasoned about, because the two do
-- not agree here. GoTrue's own magic-link signup (POST /auth/v1/otp with
-- create_user) writes a password of its own, so a brand new magic-link account
-- takes the PASSWORD branch and is refused outright. That is another self-signup
-- door closed rather than a flow broken: nothing in this application creates users
-- that way. Both invite paths (worker and carrier portal) create accounts with
-- generateLink type `invite`, and use `magiclink` only for people who already
-- exist, which is a sign-in and fires no trigger at all. An OAuth first login does
-- arrive without a password and takes the passwordless branch, creating nothing.
--
-- One consequence worth stating plainly: the FOUNDING account has to be created
-- with an email and a password. Founding a deployment through OAuth would take the
-- passwordless branch and quietly create nothing.
--
-- This needs no per-deployment configuration, which is the point: there is no flag
-- to forget to set on the next client fork. A fresh database is claimed by its
-- first signup and closed by the same act.
--
-- A SECOND BUG THIS FIXES:
--
-- Invited accounts were also getting a tenant minted, because at the moment the
-- trigger fired there was no public.users row to recognise them by. Verified on a
-- local database: inviting a worker created a full throwaway company, starter forms
-- and all. The worker invite action cleaned it up afterwards by deleting the tenant
-- it found (src/app/admin/actions.ts), but any error between creating the auth user
-- and reaching that line left the junk company behind for good. The carrier portal
-- invite had no such cleanup at all, so every invited carrier contact left behind a
-- tenant AND a staff user row for somebody who does not work for the company.
-- Rule 1 removes the whole problem at the source: no tenant is ever created, so
-- there is nothing to clean up and nothing to leak.

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

  return new;
end;
$$;

alter function "authz"."handle_new_core_pathways_user"() owner to "postgres";

-- Lets the login page render honestly instead of offering a form that will fail.
-- Returns one boolean and nothing else. `anon` genuinely needs it, because the
-- question is asked before anyone has signed in.
--
-- This does tell an anonymous caller whether a deployment has been claimed yet,
-- which is worth being deliberate about rather than pretending otherwise. It is not
-- a secret: anyone can learn the same thing by submitting the form once. The window
-- it describes is real but tiny, and it closes the moment a fresh deployment is
-- claimed, which is the first thing done when standing a client up.
create or replace function "public"."self_signup_available"() returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select not exists (select 1 from public.tenants);
$$;

alter function "public"."self_signup_available"() owner to "postgres";

-- Name the roles. `revoke ... from public` does NOT remove Supabase's explicit
-- grants to anon and authenticated; it succeeds, changes nothing, and leaves the
-- ledger claiming otherwise. See 20260815010000.
revoke all on function "public"."self_signup_available"() from "anon", "authenticated";
grant execute on function "public"."self_signup_available"() to "anon", "authenticated";
