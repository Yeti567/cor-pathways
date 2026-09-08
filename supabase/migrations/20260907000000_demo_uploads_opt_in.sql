-- Let a demo tenant accept uploads without also unblocking outbound email.
--
-- WHY THIS EXISTS:
--
-- `tenants.demo_mode` was doing two unrelated jobs at once. It blocked every
-- upload into the tenant's storage folder, AND it gated every outbound email
-- (worker invites, carrier invites, password resets, Auto-Share). That was the
-- right pairing when the demo tenant lived inside the PRODUCTION database,
-- beside real client records and on a shared Resend account: the demo was meant
-- to be look-but-do-not-touch.
--
-- The demo now lives on its own deployment, with its own Supabase project, its
-- own storage, and no email credentials at all, and it is wiped weekly. What a
-- visitor is there to do is add things: a unit, a worker, a ticket with the
-- photo of the ticket attached. With uploads blocked, the interesting half of
-- that ends in a raw 403.
--
-- Turning `demo_mode` off would fix uploads and silently unblock email at the
-- same time, which is the one thing that must stay shut: a visitor signs in as
-- a super admin and could invite any address they like. So the two concerns are
-- separated here instead of traded against each other.
--
-- The default is false, so every existing deployment keeps exactly the behaviour
-- it has today. A tenant has to opt in, and only the demo does.

alter table "public"."tenants"
  add column if not exists "demo_uploads_enabled" boolean not null default false;

comment on column "public"."tenants"."demo_uploads_enabled" is
  'Demo tenants only: allow uploads into this tenant''s storage folder. Has no effect unless demo_mode is true. Never turns outbound email back on; that stays gated on demo_mode alone.';

-- The predicate is no longer "is this a demo path" but "does this demo path
-- refuse uploads", so the function is renamed to say what it now decides. The
-- two policies are rebuilt on the new name and the old function is dropped, so
-- nothing is left behind still answering the old question.
create or replace function "authz"."demo_path_blocks_upload"("object_name" "text") returns boolean
    language "sql" stable security definer
    set "search_path" to 'public', 'pg_temp'
    as $$
  select case
    when coalesce(("storage"."foldername"("object_name"))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (
        select 1 from "public"."tenants" t
        where t.id = ("storage"."foldername"("object_name"))[1]::uuid
          and t.demo_mode
          and not t.demo_uploads_enabled
      )
    else false
  end;
$$;

alter function "authz"."demo_path_blocks_upload"("text") owner to "postgres";
revoke all on function "authz"."demo_path_blocks_upload"("text") from "public", "anon", "authenticated";
grant execute on function "authz"."demo_path_blocks_upload"("text") to "authenticated", "service_role";

drop policy if exists "demo_mode_blocks_storage_insert" on "storage"."objects";
drop policy if exists "demo_mode_blocks_storage_update" on "storage"."objects";

create policy "demo_mode_blocks_storage_insert" on "storage"."objects"
  as restrictive for insert to "authenticated"
  with check (not "authz"."demo_path_blocks_upload"("name"));

create policy "demo_mode_blocks_storage_update" on "storage"."objects"
  as restrictive for update to "authenticated"
  using (not "authz"."demo_path_blocks_upload"("name"))
  with check (not "authz"."demo_path_blocks_upload"("name"));

drop function if exists "authz"."is_demo_tenant_path"("text");
