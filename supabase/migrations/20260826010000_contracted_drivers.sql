-- Contracted Drivers: the people who drive for the hired carriers.
--
-- The company layer is the subcontractor record, the unit layer is contracted_equipment,
-- and this is the third: who is actually behind the wheel, and whether their tickets are
-- current. Most hiring companies never hold this, and take the carrier's word that its
-- drivers are qualified. This client does not, so their tickets, their client site
-- orientations and their site access badges are all tracked to the same standard as this
-- company's own employees.
--
-- WHY NOT worker_profiles and certifications, which already do exactly this job.
-- Because certifications.worker_profile_id is not null, worker_profiles.user_id is not
-- null, and public.users is the staff table: a row there carries a power level, an app
-- access level, tenant membership through authz.is_tenant_member, and an invitation
-- email. Putting a contractor's driver in there to reuse the ticket table would make
-- them a member of this company's workspace, and the only ways out are weakening two not
-- null constraints or trusting every future reader of public.users to filter. The
-- subcontractor module already settled this question the same way for portal logins:
-- subcontractor_user is deliberately not a users row.
--
-- WHAT IS REUSED is the type list. certification_types is the tenant's one list of
-- ticket names, and these records point straight at it, so H2S Alive means one thing for
-- an employee and for a contractor's driver and a tenant maintains one list. The
-- category column added below is what keeps seventy odd client site orientations from
-- flooding the employee screens.

-- 1. Categorise the shared certification type list.
--
-- Everything that exists today is a ticket, so the default keeps every current employee
-- screen exactly as it is. The orientations and badges the contractor sheets carry are a
-- different kind of thing: a ticket is a qualification the person holds anywhere, an
-- orientation is permission to be on one client's site, and site access is a badge or a
-- gate PIN. Mixing them would put seventy odd rows into an employee ticket list that
-- means nothing to an employee, and would feed them to the mandatory ticket matcher.

alter table "public"."certification_types"
  add column if not exists "category" text default 'ticket'::text not null;

do $$
begin
  if not exists (
    select 1 from "pg_constraint" where "conname" = 'certification_types_category_check'
  ) then
    alter table "public"."certification_types"
      add constraint "certification_types_category_check"
      check ("category" = any (array['ticket'::text, 'orientation'::text, 'site_access'::text]));
  end if;
end
$$;

comment on column "public"."certification_types"."category" is
  'What kind of record this type holds: ticket is a qualification the person carries anywhere, orientation is one client site''s induction, site_access is a badge or gate PIN. Employee screens read tickets only; everything seeded before this column existed is a ticket.';

create index if not exists "certification_types_tenant_category_idx"
  on "public"."certification_types" ("tenant_id", "category");

-- 2. The driver.

create table if not exists "public"."contracted_driver" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,

  -- Who they drive for. Not nullable: an owner operator with no company behind them has
  -- no insurance and no WCB coverage, and that relationship is the reason the record
  -- exists at all.
  "subcontractor_id" uuid not null,

  "full_name" text not null,

  -- Their sheets put a unit number beside a driver's name, which is how dispatch knows
  -- who is in which truck. Nullable and on delete set null: drivers change trucks, and a
  -- driver between trucks is still a driver.
  "contracted_equipment_id" uuid,

  "license_province" text,
  "license_expiry" date,

  -- Both dates, because carriers disagree about which one they keep: some record when
  -- the abstract expires, some record only when it was last pulled.
  "abstract_issued" date,
  "abstract_expiry" date,

  -- Common Safety Orientation. Carries no expiry, so it records completion.
  "cso_completed" date,

  -- DELIBERATELY ABSENT: emergency contacts and medical conditions.
  --
  -- Their fuel driver sheet carries both, and neither is coming into this database.
  -- These are another company's employees, so this company holds what proves the
  -- contract is safe to run and nothing else. Medical information in particular buys no
  -- compliance answer and turns a safety app into a health record. Dispatch keeps the
  -- emergency contact privately, which is where it was already. Do not add these columns
  -- later without asking.

  "driver_type" text default 'contracted'::text not null,
  "status" text default 'active'::text not null,
  "notes" text,
  "created_by" uuid,
  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "contracted_driver_driver_type_check"
    check ("driver_type" = any (array['contracted'::text, 'casual'::text])),
  constraint "contracted_driver_status_check"
    check ("status" = any (array['active'::text, 'inactive'::text, 'terminated'::text]))
);

alter table "public"."contracted_driver" owner to "postgres";

comment on table "public"."contracted_driver" is
  'A driver employed by a hired carrier, not by this company. Deliberately not a users or worker_profiles row: they hold no power level, get no invitation, and must never resolve as a member of this workspace.';

comment on column "public"."contracted_driver"."driver_type" is
  'Their sheet flags some drivers as casual in a notes column. Kept as a real value so the roster can be filtered by it.';

-- 3. The driver's tickets, orientations and badges.

create table if not exists "public"."contracted_driver_certification" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "contracted_driver_id" uuid not null,

  -- Points at the shared tenant list. Nullable and on delete set null, matching
  -- public.certifications: removing a type from the list must not delete the evidence
  -- that a driver held it.
  "certification_type_id" uuid,

  -- The fallback name, carried the same way public.certifications carries it, so a
  -- record whose type is later deleted still says what it was.
  "name" text not null,

  "issued_on" date,

  -- Nullable, like the unit documents and for the same reason. A Common Safety
  -- Orientation and most policy acknowledgements never expire; storing a made up expiry
  -- to satisfy a constraint would put a false renewal on the board.
  "expires_on" date,

  -- Who issued it. Their sheet has a "TDG & WHMIS COMPANY" column because the training
  -- provider is what a client audit asks about next.
  "issuing_company" text,

  -- The badge number, gate PIN or key fob the orientation and badge sheets carry beside
  -- the date. Free text: it is an identifier to read back, never something to compute on.
  "detail" text,

  "attachment_path" text,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null
);

alter table "public"."contracted_driver_certification" owner to "postgres";

comment on table "public"."contracted_driver_certification" is
  'One ticket, client site orientation, or site access badge held by a contracted driver. What kind it is comes from the certification type''s category, so one list serves all three.';

-- 4. Keys, constraints and indexes.

alter table only "public"."contracted_driver"
  add constraint "contracted_driver_pkey" primary key ("id");

alter table only "public"."contracted_driver_certification"
  add constraint "contracted_driver_certification_pkey" primary key ("id");

alter table only "public"."contracted_driver"
  add constraint "contracted_driver_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- Restrict, matching contracted_equipment: deleting a company must not silently take its
-- drivers and their ticket history with it.
alter table only "public"."contracted_driver"
  add constraint "contracted_driver_subcontractor_id_fkey" foreign key ("subcontractor_id") references "public"."subcontractor"("id") on delete restrict;

alter table only "public"."contracted_driver"
  add constraint "contracted_driver_unit_fkey" foreign key ("contracted_equipment_id") references "public"."contracted_equipment"("id") on delete set null;

alter table only "public"."contracted_driver"
  add constraint "contracted_driver_created_by_fkey" foreign key ("created_by") references "public"."users"("id") on delete set null;

alter table only "public"."contracted_driver_certification"
  add constraint "contracted_driver_certification_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."contracted_driver_certification"
  add constraint "contracted_driver_certification_driver_fkey" foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete cascade;

alter table only "public"."contracted_driver_certification"
  add constraint "contracted_driver_certification_type_fkey" foreign key ("certification_type_id") references "public"."certification_types"("id") on delete set null;

-- One driver of a given name per company. Not tenant wide: two carriers can each employ
-- a John Smith, and on a 125 driver sheet that is a matter of time rather than a
-- hypothetical. Case insensitive, because the sheets are hand typed.
create unique index if not exists "contracted_driver_company_name_key"
  on "public"."contracted_driver" ("subcontractor_id", lower("full_name"))
  where "deleted_at" is null;

create index if not exists "contracted_driver_tenant_company_idx"
  on "public"."contracted_driver" ("tenant_id", "subcontractor_id", "full_name")
  where "deleted_at" is null;

create index if not exists "contracted_driver_tenant_license_expiry_idx"
  on "public"."contracted_driver" ("tenant_id", "license_expiry")
  where "deleted_at" is null and "license_expiry" is not null;

create index if not exists "contracted_driver_certification_driver_idx"
  on "public"."contracted_driver_certification" ("contracted_driver_id", "certification_type_id");

-- The reminder job and the "what falls due next" sort both read exactly this.
create index if not exists "contracted_driver_certification_tenant_expiry_idx"
  on "public"."contracted_driver_certification" ("tenant_id", "expires_on")
  where "expires_on" is not null;

create or replace trigger "contracted_driver_set_updated_at"
  before update on "public"."contracted_driver"
  for each row execute function "public"."set_updated_at"();

create or replace trigger "contracted_driver_certification_set_updated_at"
  before update on "public"."contracted_driver_certification"
  for each row execute function "public"."set_updated_at"();

-- 5. Row level security. Same shape as every other tenant scoped table.

alter table "public"."contracted_driver" enable row level security;
alter table "public"."contracted_driver_certification" enable row level security;

create policy "contracted_driver_tenant_select" on "public"."contracted_driver"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_tenant_insert" on "public"."contracted_driver"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_tenant_update" on "public"."contracted_driver"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_tenant_delete" on "public"."contracted_driver"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_certification_tenant_select" on "public"."contracted_driver_certification"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_certification_tenant_insert" on "public"."contracted_driver_certification"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_certification_tenant_update" on "public"."contracted_driver_certification"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_certification_tenant_delete" on "public"."contracted_driver_certification"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does NOT grant table access. Without an explicit privilege,
-- PostgREST answers "permission denied for table" however permissive the policies are.
grant select, insert, update, delete on table "public"."contracted_driver" to "authenticated";
grant select, insert, update, delete on table "public"."contracted_driver" to "service_role";
grant select, insert, update, delete on table "public"."contracted_driver_certification" to "authenticated";
grant select, insert, update, delete on table "public"."contracted_driver_certification" to "service_role";

-- Storage: same bucket and layout as the contracted units, under
-- {tenant_id}/{subcontractor_id}/contracted-drivers/{driver_id}/{upload_id}/{filename}.
-- See the storage note in 20260826000000_contracted_equipment.sql for why the carrier id
-- sits second. Nothing to create here.
