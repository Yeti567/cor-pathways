-- Subcontractor carrier module, slice 2: what this company demands.
--
-- The slot list stays in code, because it is the same eight documents for every
-- company. What differs is the bar: one carrier requires two million in auto liability
-- and another requires five, one wants sixty days of warning and another wants thirty,
-- one does not haul freight and has no use for a cargo policy at all. That is what this
-- table holds, and nothing else.
--
-- Every override column is nullable and null means "use the code default". A tenant row
-- therefore records only the deviations, so the defaults can be improved later without
-- having to distinguish a value somebody chose from a value that was copied in at seed
-- time and never looked at again.

create table if not exists "public"."subcontractor_requirement_setting" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "slot_key" text not null,

  -- Off means the slot disappears: not collected, not shown, not counted. Distinct from
  -- required=false, which still collects the document and still shows it on file, but
  -- stops a missing one from making the carrier non-compliant.
  "enabled" boolean default true not null,
  "required" boolean default true not null,

  -- The bar the coverage limit has to clear. Capturing a limit without checking it is
  -- the sort of field that gets filled in for two years and then discovered, during a
  -- claim, to have been below what the contract required the whole time.
  "minimum_coverage_amount" numeric(14,2),

  "reminder_lead_days" integer,
  "interval_months" integer,

  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,

  constraint "subcontractor_requirement_setting_minimum_coverage_check"
    check ("minimum_coverage_amount" is null or "minimum_coverage_amount" >= 0),
  constraint "subcontractor_requirement_setting_reminder_lead_days_check"
    check ("reminder_lead_days" is null or ("reminder_lead_days" >= 0 and "reminder_lead_days" <= 365)),
  constraint "subcontractor_requirement_setting_interval_months_check"
    check ("interval_months" is null or ("interval_months" >= 1 and "interval_months" <= 60))
);

alter table "public"."subcontractor_requirement_setting" owner to "postgres";

comment on table "public"."subcontractor_requirement_setting" is
  'Per-tenant overrides for one requirement slot. Null in an override column means fall back to the code default in src/lib/subcontractor-requirements.ts.';

comment on column "public"."subcontractor_requirement_setting"."enabled" is
  'False removes the slot entirely. Use required=false instead to keep collecting a document without letting a missing one fail the carrier.';

comment on column "public"."subcontractor_requirement_setting"."minimum_coverage_amount" is
  'Coverage limit the filed certificate must meet or exceed. A document below it is a deficiency even though it is on file and unexpired.';

alter table only "public"."subcontractor_requirement_setting"
  add constraint "subcontractor_requirement_setting_pkey" primary key ("id");

alter table only "public"."subcontractor_requirement_setting"
  add constraint "subcontractor_requirement_setting_tenant_id_fkey" foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- One row per slot per tenant. This is also what lets the settings screen upsert on
-- (tenant_id, slot_key) instead of reading first and branching.
create unique index if not exists "subcontractor_requirement_setting_tenant_slot_key"
  on "public"."subcontractor_requirement_setting" ("tenant_id", "slot_key");

create or replace trigger "subcontractor_requirement_setting_set_updated_at"
  before update on "public"."subcontractor_requirement_setting"
  for each row execute function "public"."set_updated_at"();

alter table "public"."subcontractor_requirement_setting" enable row level security;

create policy "subcontractor_requirement_setting_tenant_select" on "public"."subcontractor_requirement_setting"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_requirement_setting_tenant_insert" on "public"."subcontractor_requirement_setting"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_requirement_setting_tenant_update" on "public"."subcontractor_requirement_setting"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "subcontractor_requirement_setting_tenant_delete" on "public"."subcontractor_requirement_setting"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

grant select, insert, update, delete on table "public"."subcontractor_requirement_setting" to "authenticated";
grant select, insert, update, delete on table "public"."subcontractor_requirement_setting" to "service_role";

-- The two per-carrier interval columns shipped in slice 1 as NOT NULL DEFAULT 6 and 12.
-- Now that the same setting exists tenant-wide, that default would win every comparison
-- and quietly make the tenant-wide value unreachable. Nullable instead, so the
-- precedence is legible: this carrier's exception, else this company's policy, else the
-- code default. Safe to alter in place because no rows exist yet.
alter table "public"."subcontractor"
  alter column "carrier_profile_interval_months" drop not null,
  alter column "carrier_profile_interval_months" drop default,
  alter column "rate_statement_interval_months" drop not null,
  alter column "rate_statement_interval_months" drop default;

update "public"."subcontractor"
   set "carrier_profile_interval_months" = null,
       "rate_statement_interval_months" = null;

comment on column "public"."subcontractor"."carrier_profile_interval_months" is
  'Per-carrier exception to the refresh cadence. Null, the normal case, means use the tenant setting and then the code default.';

comment on column "public"."subcontractor"."rate_statement_interval_months" is
  'Per-carrier exception to the refresh cadence. Null, the normal case, means use the tenant setting and then the code default.';
