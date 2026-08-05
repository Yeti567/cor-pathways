-- Subcontractor carrier module, slice 3: letting the carrier in.
--
-- This is the first time somebody who works for another company gets a login to this
-- database. Everything before it was one company's staff looking at their own data, and
-- every gate in the schema is built on that assumption: is_tenant_member resolves
-- through public.users, is_consultant_allowed through public.consultants, and a caller
-- who is in neither table fails both. That is what makes this safe to add, and it was
-- checked against every policy in the schema before a line of it was written rather than
-- assumed. Two policies in the whole database do not narrow by tenant, and both gate on
-- is_active_consultant(), which a carrier principal also fails.
--
-- So the default for this new principal is deny, everywhere, and the only access it has
-- is what this migration grants explicitly: their own carrier record, their own filed
-- documents, and the requirement list they are being asked to meet. Nothing else in the
-- hiring company's data is reachable, including the tenants row itself, which is why the
-- portal reads the hiring company's name through a narrow server-side lookup instead of
-- being granted select on a table that also holds billing and safety-rating columns.
--
-- Identity is modelled exactly like consultants: a row keyed on auth.users.id, plus a
-- separate access table. A single subcontractor_id column on the user would have been
-- simpler, but it breaks the moment the same person is legitimately reachable from two
-- directions, and that is not hypothetical. One bookkeeper can serve two small carriers,
-- and more importantly two different CorPathway customers can both hire the same
-- carrier, whose office manager then needs one login that answers to both without either
-- customer seeing the other exists.

create table if not exists "public"."subcontractor_user" (
  "id" uuid not null,
  "email" text not null,
  "full_name" text not null,
  "active" boolean default true not null,
  "last_seen_at" timestamp with time zone,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null
);

alter table "public"."subcontractor_user" owner to "postgres";

comment on table "public"."subcontractor_user" is
  'A person at a hired carrier who can sign in to the carrier portal. Deliberately not a row in public.users: they are not staff, hold no power level, and must never resolve as a tenant member.';

create table if not exists "public"."subcontractor_user_access" (
  "id" uuid default "gen_random_uuid"() not null,
  "subcontractor_user_id" uuid not null,
  "subcontractor_id" uuid not null,
  "tenant_id" uuid not null,
  "allowed" boolean default true not null,
  "invited_by" uuid,
  "invited_at" timestamp with time zone default "now"() not null,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null
);

alter table "public"."subcontractor_user_access" owner to "postgres";

comment on table "public"."subcontractor_user_access" is
  'Which carrier, under which hiring company, one portal login may act for. Revocation flips allowed rather than deleting, so the audit trail of who had access when survives.';

create table if not exists "public"."subcontractor_audit_log" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid,
  "subcontractor_id" uuid,
  "subcontractor_user_id" uuid,
  "action" text not null,
  "metadata" jsonb default '{}'::jsonb not null,
  "created_at" timestamp with time zone default "now"() not null
);

alter table "public"."subcontractor_audit_log" owner to "postgres";

comment on table "public"."subcontractor_audit_log" is
  'Every portal sign-in, view, and upload. An outside company touching this database is exactly the activity that has to be reconstructable afterwards.';

alter table only "public"."subcontractor_user"
  add constraint "subcontractor_user_pkey" primary key ("id");

alter table only "public"."subcontractor_user_access"
  add constraint "subcontractor_user_access_pkey" primary key ("id");

alter table only "public"."subcontractor_audit_log"
  add constraint "subcontractor_audit_log_pkey" primary key ("id");

alter table only "public"."subcontractor_user"
  add constraint "subcontractor_user_id_fkey" foreign key ("id") references "auth"."users"("id") on delete cascade;

create unique index if not exists "subcontractor_user_email_key"
  on "public"."subcontractor_user" (lower("email"));

alter table only "public"."subcontractor_user_access"
  add constraint "subcontractor_user_access_user_fkey" foreign key ("subcontractor_user_id") references "public"."subcontractor_user"("id") on delete cascade;

alter table only "public"."subcontractor_user_access"
  add constraint "subcontractor_user_access_subcontractor_fkey" foreign key ("subcontractor_id") references "public"."subcontractor"("id") on delete cascade;

alter table only "public"."subcontractor_user_access"
  add constraint "subcontractor_user_access_tenant_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."subcontractor_user_access"
  add constraint "subcontractor_user_access_invited_by_fkey" foreign key ("invited_by") references "public"."users"("id") on delete set null;

create unique index if not exists "subcontractor_user_access_user_subcontractor_key"
  on "public"."subcontractor_user_access" ("subcontractor_user_id", "subcontractor_id");

create index if not exists "subcontractor_user_access_subcontractor_idx"
  on "public"."subcontractor_user_access" ("subcontractor_id", "allowed");

create index if not exists "subcontractor_audit_log_tenant_created_idx"
  on "public"."subcontractor_audit_log" ("tenant_id", "created_at" desc);

create or replace trigger "subcontractor_user_set_updated_at"
  before update on "public"."subcontractor_user"
  for each row execute function "public"."set_updated_at"();

create or replace trigger "subcontractor_user_access_set_updated_at"
  before update on "public"."subcontractor_user_access"
  for each row execute function "public"."set_updated_at"();

-- --------------------------------------------------------------------------
-- The gates.
--
-- SECURITY DEFINER so the checks do not depend on the caller's own row security,
-- which would be circular. Granted to authenticated only, never PUBLIC: a function
-- in this schema that PUBLIC can execute is reachable unauthenticated over PostgREST,
-- which is the exact hole closed earlier in this project.
-- --------------------------------------------------------------------------

create or replace function "authz"."is_active_subcontractor_user"() returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select exists (
    select 1
    from public.subcontractor_user su
    where su.id = (select auth.uid())
      and su.active = true
  );
$$;

alter function "authz"."is_active_subcontractor_user"() owner to "postgres";
revoke all on function "authz"."is_active_subcontractor_user"() from public, "anon";
grant execute on function "authz"."is_active_subcontractor_user"() to "authenticated", "service_role";

-- The single question every portal policy asks: may this login act for this carrier?
-- Archiving the carrier, soft-deleting it, or flipping allowed all close the door,
-- because a carrier the hiring company has finished with should not still be reachable.
create or replace function "authz"."subcontractor_user_can_access"("target_subcontractor_id" "uuid") returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select authz.is_active_subcontractor_user()
    and exists (
      select 1
      from public.subcontractor_user_access sua
      join public.subcontractor s on s.id = sua.subcontractor_id
      where sua.subcontractor_user_id = (select auth.uid())
        and sua.subcontractor_id = target_subcontractor_id
        and sua.allowed = true
        and s.deleted_at is null
        and s.active = true
    );
$$;

alter function "authz"."subcontractor_user_can_access"("uuid") owner to "postgres";
revoke all on function "authz"."subcontractor_user_can_access"("uuid") from public, "anon";
grant execute on function "authz"."subcontractor_user_can_access"("uuid") to "authenticated", "service_role";

-- Deliberately narrow, and used on exactly one table: the requirement list. It answers
-- "is this login working for somebody under this hiring company", which is enough to
-- read the bar being set and must never be used to widen access to tenant data at large.
create or replace function "authz"."subcontractor_user_in_tenant"("target_tenant_id" "uuid") returns boolean
    language "sql" stable security definer
    set "search_path" to 'public'
    as $$
  select authz.is_active_subcontractor_user()
    and exists (
      select 1
      from public.subcontractor_user_access sua
      join public.subcontractor s on s.id = sua.subcontractor_id
      where sua.subcontractor_user_id = (select auth.uid())
        and sua.tenant_id = target_tenant_id
        and sua.allowed = true
        and s.deleted_at is null
        and s.active = true
    );
$$;

alter function "authz"."subcontractor_user_in_tenant"("uuid") owner to "postgres";
revoke all on function "authz"."subcontractor_user_in_tenant"("uuid") from public, "anon";
grant execute on function "authz"."subcontractor_user_in_tenant"("uuid") to "authenticated", "service_role";

-- Storage paths are {tenant_id}/{subcontractor_id}/{slot}/{file}. Both leading folders
-- are checked, not just the carrier: a path whose tenant does not match the access row
-- is refused even if the carrier id lines up, so a carrier hired by two companies can
-- never read across from one engagement into the other.
create or replace function "authz"."can_access_subcontractor_storage_path"("object_name" "text") returns boolean
    language "sql" stable security definer
    set "search_path" to 'public', 'storage', 'pg_temp'
    as $_$
  select case
    when coalesce((storage.foldername(object_name))[1], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and coalesce((storage.foldername(object_name))[2], '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then exists (
      select 1
      from public.subcontractor_user_access sua
      join public.subcontractor s on s.id = sua.subcontractor_id
      where sua.subcontractor_user_id = (select auth.uid())
        and sua.subcontractor_id = (storage.foldername(object_name))[2]::uuid
        and sua.tenant_id = (storage.foldername(object_name))[1]::uuid
        and sua.allowed = true
        and s.deleted_at is null
        and s.active = true
    ) and authz.is_active_subcontractor_user()
    else false
  end;
$_$;

alter function "authz"."can_access_subcontractor_storage_path"("text") owner to "postgres";
revoke all on function "authz"."can_access_subcontractor_storage_path"("text") from public, "anon";
grant execute on function "authz"."can_access_subcontractor_storage_path"("text") to "authenticated", "service_role";

-- --------------------------------------------------------------------------
-- Row level security.
-- --------------------------------------------------------------------------

alter table "public"."subcontractor_user" enable row level security;
alter table "public"."subcontractor_user_access" enable row level security;
alter table "public"."subcontractor_audit_log" enable row level security;

-- A portal login may read its own row and nothing else in this table. It may not read
-- the other people at its own carrier, and it may not enumerate anybody.
create policy "subcontractor_user_self_select" on "public"."subcontractor_user"
  for select to "authenticated"
  using ("id" = (select auth.uid()));

-- Staff at a hiring company may see the logins attached to carriers they hire. The
-- membership test goes through the access table, so it is scoped to their own tenant.
create policy "subcontractor_user_tenant_select" on "public"."subcontractor_user"
  for select to "authenticated"
  using (exists (
    select 1
    from public.subcontractor_user_access sua
    where sua.subcontractor_user_id = "subcontractor_user"."id"
      and ("authz"."is_tenant_member"(sua.tenant_id) or "authz"."is_consultant_allowed"(sua.tenant_id))
  ));

-- Creating and revoking logins is staff work, done through the service role in the
-- invite action. No insert or update policy exists for authenticated at all, which
-- means a portal login cannot create a second login or reactivate a revoked one.
create policy "subcontractor_user_access_tenant_select" on "public"."subcontractor_user_access"
  for select to "authenticated"
  using (
    "subcontractor_user_id" = (select auth.uid())
    or "authz"."is_tenant_member"("tenant_id")
    or "authz"."is_consultant_allowed"("tenant_id")
  );

create policy "subcontractor_user_access_tenant_write" on "public"."subcontractor_user_access"
  for all to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_audit_log_tenant_select" on "public"."subcontractor_audit_log"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

grant select on table "public"."subcontractor_user" to "authenticated";
grant select, insert, update, delete on table "public"."subcontractor_user" to "service_role";
grant select, insert, update, delete on table "public"."subcontractor_user_access" to "authenticated";
grant select, insert, update, delete on table "public"."subcontractor_user_access" to "service_role";
grant select on table "public"."subcontractor_audit_log" to "authenticated";
grant select, insert, update, delete on table "public"."subcontractor_audit_log" to "service_role";

-- The carrier reads its own record. Read only in this slice: editing their own contact
-- details and filing documents arrives with the submission screen, so the first release
-- of an external login can be reasoned about as strictly read-only.
create policy "subcontractor_portal_select" on "public"."subcontractor"
  for select to "authenticated"
  using ("authz"."subcontractor_user_can_access"("id"));

create policy "subcontractor_document_portal_select" on "public"."subcontractor_document"
  for select to "authenticated"
  using ("authz"."subcontractor_user_can_access"("subcontractor_id"));

-- The bar they are being asked to meet. Showing a carrier that two million is required
-- is the entire point of publishing a checklist to them.
create policy "subcontractor_requirement_setting_portal_select" on "public"."subcontractor_requirement_setting"
  for select to "authenticated"
  using ("authz"."subcontractor_user_in_tenant"("tenant_id"));

-- Storage: read their own filed documents. No insert, update, or delete policy for the
-- portal principal in this slice.
create policy "subcontractor_documents_portal_select" on "storage"."objects"
  for select to "authenticated"
  using ((("bucket_id" = 'subcontractor-documents'::text) and "authz"."can_access_subcontractor_storage_path"("name")));
