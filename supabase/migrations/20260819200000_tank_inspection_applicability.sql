-- Per-unit inspection requirements, and the tank inspections that made them necessary.
--
-- A crude hauler's trailers carry CSA B620 periodic inspections the app had no way to
-- express: PIUC (pressure / internal / upper coupler) on a five year cycle, upper
-- coupler on its own five year cycle, annual external visual and leak, annual internal
-- on insulated tanks, tank thickness, and an annual expiry on every product and vent
-- hose by serial number.
--
-- They could not simply be added to equipment_certification_types, because every type
-- in that list was expected on EVERY fleet unit. Adding eight tank inspections would
-- have marked every tractor and pickup deficient for a pressure test it will never
-- have, and the entire point of the requirement model is to surface real gaps rather
-- than bury them in noise.
--
-- So the expected set moves from "the tenant's whole list" to "the list chosen for
-- this unit". A trailer gets its tank inspections, a tractor gets none of them, and
-- both are picked from the same tenant list rather than inferred from the unit's
-- category or spec. Inferring was the other option and it is worse: the rules for
-- which tank needs which inspection turn on spec, insulation, axle count and what the
-- refinery asks for, so any rule the app invented would be wrong for somebody, and
-- wrong invisibly.

-- 1. The per-unit choice.

create table if not exists "public"."equipment_certification_requirement" (
  "id" "uuid" default "gen_random_uuid"() not null,
  "tenant_id" "uuid" not null,
  "equipment_id" "uuid" not null,
  "certification_type_id" "uuid" not null,
  "created_by" "uuid",
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null
);

alter table only "public"."equipment_certification_requirement"
  add constraint "equipment_certification_requirement_pkey" primary key ("id");

alter table only "public"."equipment_certification_requirement"
  add constraint "equipment_certification_requirement_unique"
  unique ("equipment_id", "certification_type_id");

alter table only "public"."equipment_certification_requirement"
  add constraint "equipment_certification_requirement_tenant_id_fkey"
  foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

alter table only "public"."equipment_certification_requirement"
  add constraint "equipment_certification_requirement_equipment_id_fkey"
  foreign key ("equipment_id") references "public"."equipment"("id") on delete cascade;

-- Cascade, not set null: a requirement pointing at a deleted type is not a
-- requirement any more. The filed certificates keep their own set-null pointer and
-- survive, which is the behaviour deleteEquipmentCertificationType already relies on.
alter table only "public"."equipment_certification_requirement"
  add constraint "equipment_certification_requirement_certification_type_id_fkey"
  foreign key ("certification_type_id") references "public"."equipment_certification_types"("id") on delete cascade;

alter table only "public"."equipment_certification_requirement"
  add constraint "equipment_certification_requirement_created_by_fkey"
  foreign key ("created_by") references "public"."users"("id") on delete set null;

create index if not exists "equipment_certification_requirement_equipment_idx"
  on "public"."equipment_certification_requirement" ("tenant_id", "equipment_id");

create index if not exists "equipment_certification_requirement_type_idx"
  on "public"."equipment_certification_requirement" ("certification_type_id");

create trigger "equipment_certification_requirement_set_updated_at"
  before update on "public"."equipment_certification_requirement"
  for each row execute function "public"."set_updated_at"();

create trigger "equipment_certification_requirement_tenant_match"
  before insert or update on "public"."equipment_certification_requirement"
  for each row execute function "public"."equipment_child_tenant_matches"();

alter table "public"."equipment_certification_requirement" enable row level security;

create policy "equipment_certification_requirement_select"
  on "public"."equipment_certification_requirement" for select
  using ("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id"));

create policy "equipment_certification_requirement_insert"
  on "public"."equipment_certification_requirement" for insert
  with check ("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id"));

create policy "equipment_certification_requirement_update"
  on "public"."equipment_certification_requirement" for update
  using ("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id"))
  with check ("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id"));

create policy "equipment_certification_requirement_delete"
  on "public"."equipment_certification_requirement" for delete
  using ("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id"));

grant all on table "public"."equipment_certification_requirement" to "anon";
grant all on table "public"."equipment_certification_requirement" to "authenticated";
grant all on table "public"."equipment_certification_requirement" to "service_role";

comment on table "public"."equipment_certification_requirement" is
  'Which certifications each unit is held to. A unit with no rows here is held to the types marked applies_by_default.';

-- 2. Which types a newly added unit starts with ticked.

alter table "public"."equipment_certification_types"
  add column if not exists "applies_by_default" boolean default true not null;

alter table "public"."equipment_certification_types"
  add column if not exists "default_interval_days" integer;

alter table "public"."equipment_certification_types"
  add column if not exists "notes" "text";

do $$
begin
  if not exists (
    select 1 from "pg_constraint" where "conname" = 'equipment_certification_types_interval_check'
  ) then
    alter table "public"."equipment_certification_types"
      add constraint "equipment_certification_types_interval_check"
      check (("default_interval_days" is null) or ("default_interval_days" > 0));
  end if;
end
$$;

comment on column "public"."equipment_certification_types"."applies_by_default" is
  'Whether a unit with no explicit requirement list is held to this type. False for specialised inspections such as tank tests.';

comment on column "public"."equipment_certification_types"."default_interval_days" is
  'Usual days from completion to expiry, for example 365 or 1825. Advisory only: a filed expiry date always wins.';

comment on column "public"."equipment_certification_types"."notes" is
  'Which units this inspection is for, in the fleet''s own words. Shown beside the tick box.';

-- 3. The tank inspections themselves, for tenants that already have a type list.
--
-- applies_by_default is false on every one of them, so seeding these changes nothing
-- until somebody ticks them on a unit. That is the whole safety property: a fleet of
-- tractors that pulls this migration sees eight new options and zero new deficiencies.

insert into "public"."equipment_certification_types"
  ("tenant_id", "name", "applies_by_default", "default_interval_days", "notes")
select "t"."id", "d"."name", false, "d"."interval_days", "d"."notes"
from "public"."tenants" "t"
cross join (values
  ('PIUC - pressure, internal, upper coupler', 1825,
   'Five year TC/MC 406 and 407 non-insulated tank inspection.'),
  ('Upper coupler (UC)', 1825,
   'Five year. Non-insulated 407 and all 406.'),
  ('External visual and leak (VK)', 365,
   'Annual. 406 tri-axle non-insulated, with refinery paperwork.'),
  ('Visual and leak (VK) - 407 annual', 365,
   'Annual. Non-insulated 407.'),
  ('Internal (I) - insulated annual', 365,
   'Annual. Insulated 407 only.'),
  ('Tank thickness (T)', null,
   'Thickness test, recorded with the insulated annual internal.'),
  ('Product hose', 365,
   'Annual, one per hose. File the hose serial number as the title.'),
  ('Load and vent line hose', 365,
   'Annual, one per hose. File the hose serial number as the title.')
) as "d"("name", "interval_days", "notes")
where exists (
  select 1 from "public"."equipment_certification_types" "e" where "e"."tenant_id" = "t"."id"
)
on conflict do nothing;

-- 4. Tank identity, because it is real fleet data and it explains the ticks.
--
-- Deliberately NOT wired into which inspections are expected. It records what the
-- unit is; the tick boxes record what it is held to. Keeping those separate is what
-- lets a safety officer overrule the app instead of arguing with it.

alter table "public"."equipment"
  add column if not exists "tank_spec" "text";

alter table "public"."equipment"
  add column if not exists "is_insulated" boolean;

do $$
begin
  if not exists (
    select 1 from "pg_constraint" where "conname" = 'equipment_tank_spec_check'
  ) then
    alter table "public"."equipment"
      add constraint "equipment_tank_spec_check"
      check (("tank_spec" is null) or ("tank_spec" = any (array['tc406'::"text", 'tc407'::"text"])));
  end if;
end
$$;

comment on column "public"."equipment"."tank_spec" is
  'TC/MC tank specification for tank trailers: tc406, tc407, or null when the unit is not a tank.';

comment on column "public"."equipment"."is_insulated" is
  'Whether a tank is insulated. Null when the unit is not a tank.';

create index if not exists "equipment_tank_spec_idx"
  on "public"."equipment" ("tenant_id", "tank_spec")
  where "tank_spec" is not null;
