-- Contracted drivers: somewhere to file what a client saw them do.
--
-- THE GAP THIS CLOSES. On 2026-08-29 a carrier pack arrived holding nine documents that
-- had nowhere to go at all: seven contractor audit reports from one terminal (PPE, truck
-- unload procedure, measurement procedure, permits and certificates) and two driver
-- evaluation loads. A client's own people watch a contractor's driver work and email the
-- write-up to the hiring company's safety mailbox. Nothing in the app could hold one.
--
-- WHY THEY ARE NOT CERTIFICATIONS. contracted_driver_certification was the obvious place
-- and it is the wrong one, for a reason that would have quietly destroyed the record.
--
-- A certification says "this person is qualified until date X". Its newest record wins:
-- contractedDriverCertificationStatuses deliberately marks every earlier record of the
-- same name as Superseded and strips its colour, because a ticket renewed three times
-- must read as current rather than as two failures. That rule is right for a ticket and
-- exactly backwards for an observation. An observation says "on this day, someone watched
-- this person do this task and wrote down what they saw". It never renews and it is never
-- replaced. Six PPE audits are six separate facts, and a driver with a clean audit in
-- August has not undone the deficiencies written up in May -- he has a history, which is
-- the whole point of keeping them. Filing these as certifications would have dimmed eight
-- of the nine to "Superseded" on arrival.
--
-- They also carry no expiry, so every ageing rule in the app has nothing to work with,
-- and half of them are about a task rather than a qualification.
--
-- TWO TYPES, NOT FIVE. The audit types in one client's pack were PPE, truck unload
-- procedure, measurement procedure, permits and certificates, and driver evaluation load.
-- Putting that list in a check constraint would mean a migration the first time another
-- client writes "journey management" at the top of an email, and this table exists
-- precisely because the app was too rigid about what a document could be. So the
-- constraint holds only the distinction that changes what the app can say:
--
--   evaluation -- a formal assessment that decides what the driver is allowed to do on
--                 the client's site. It sets site_access.
--   audit      -- somebody watched a task and wrote it up. It does not gate access.
--
-- Whatever the client called it goes in title, free text, exactly as they wrote it.
--
-- THIS TABLE NEVER DECIDES THE DRIVER'S COLOUR. Same rule as contracted_driver_document,
-- and it matters more here because the temptation is stronger: an audit that found
-- deficiencies looks like a compliance failure and is not one. It is a record of coaching
-- on a task, usually closed out on the spot, and rolling it into the roster light would
-- turn every honest observation into a red mark against the driver -- which is the
-- fastest way to teach a carrier not to forward them. contractedDriverOverallTone does
-- not read this table and must not be made to.
--
-- What the app CAN now say, and could not before, is where a driver stands at each client
-- site: the newest evaluation per issuing company carries the access level. For the
-- driver in the first batch that is the difference between a March email saying he must
-- redo his training loads and a June evaluation restoring his unlimited access -- a fact
-- the company was holding only in a mailbox.

-- 1. The observation.

create table if not exists "public"."contracted_driver_observation" (
  "id" uuid default "gen_random_uuid"() not null,
  "tenant_id" uuid not null,
  "contracted_driver_id" uuid not null,

  -- See the header. Only the distinction that gates site access is constrained; what the
  -- client actually called it lives in title.
  "observation_type" text not null,

  -- What the client called it: "PPE audit", "Truck unload procedure audit", "Driver
  -- evaluation load". Free text on purpose.
  "title" text not null,

  -- THE DAY THE WORK WAS WATCHED, which is routinely not the day the report arrived.
  -- In the first batch a PPE audit observed on 12 Aug 2026 was emailed on the 14th, and
  -- filing it under the 14th would put the observation on a day the driver may not have
  -- been on site. Not null: an observation with no date is not evidence of anything.
  "observed_on" date not null,

  -- When the write-up came, where it differs. Nullable, and never used for ordering:
  -- the sequence that matters is the order the work happened in.
  "reported_on" date,

  -- Whose site, and whose observation. Nullable because an internal ride-along has no
  -- outside company behind it, but the site standing view can only group the rows that
  -- name one.
  "issuing_company" text,

  -- The person who did the watching, and where. Both as written on the report; these are
  -- what an auditor uses to go back to the source.
  "observer" text,
  "location" text,

  -- clear        -- nothing found, or the evaluation was passed
  -- deficiencies -- something was written up. Not a failure: most are closed on the spot
  -- failed       -- the evaluation was not passed
  "outcome" text not null,

  -- Set by an evaluation only. Null on an audit, because an audit does not grant or
  -- withdraw anything and a value here would imply it did.
  "site_access" text,

  -- The findings and what was done about them, in the client's own words. Text rather
  -- than a structured list: these arrive as prose and flattening them into codes would
  -- lose the part a person actually needs to read.
  "findings" text,
  "action_taken" text,

  -- Nullable, unlike contracted_driver_document.attachment_path. That table holds nothing
  -- but the paper, so a row without it says nothing. This row IS the record -- the app
  -- has no other copy of what was observed -- so it has to be possible to write one down
  -- before the PDF arrives. The driver file marks an observation with no document
  -- attached, the same way a dated ticket with no scan reads as unproven.
  "attachment_path" text,

  "created_by" uuid,
  "created_at" timestamp with time zone default "now"() not null,
  "updated_at" timestamp with time zone default "now"() not null,
  "deleted_at" timestamp with time zone,

  constraint "contracted_driver_observation_type_check"
    check ("observation_type" = any (array['audit'::text, 'evaluation'::text])),

  constraint "contracted_driver_observation_outcome_check"
    check ("outcome" = any (array['clear'::text, 'deficiencies'::text, 'failed'::text])),

  constraint "contracted_driver_observation_site_access_check"
    check (
      "site_access" is null
      or "site_access" = any (array['unlimited'::text, 'limited'::text, 'suspended'::text])
    ),

  -- An audit cannot grant or withdraw site access. Enforced rather than left to the form,
  -- because the site standing view reads site_access and would otherwise report a PPE
  -- audit as the thing that limited a driver.
  constraint "contracted_driver_observation_access_is_an_evaluation_check"
    check ("site_access" is null or "observation_type" = 'evaluation')
);

alter table "public"."contracted_driver_observation" owner to "postgres";

comment on table "public"."contracted_driver_observation" is
  'What a client saw a contracted driver do: audits of a task, and evaluations that decide site access. History, not compliance -- every row stands on its own, a newer one never supersedes an older one, and no status calculation may read this table.';

comment on column "public"."contracted_driver_observation"."observation_type" is
  'audit or evaluation. Only the distinction that gates site access is constrained; what the client called it is in title.';

comment on column "public"."contracted_driver_observation"."observed_on" is
  'The day the work was watched, not the day the report was emailed. Reports routinely arrive days later.';

comment on column "public"."contracted_driver_observation"."outcome" is
  'clear, deficiencies or failed. Deficiencies are written-up coaching, not a compliance failure, and must never colour the driver.';

comment on column "public"."contracted_driver_observation"."site_access" is
  'What an evaluation granted: unlimited, limited or suspended. Null on an audit, and constrained so it cannot be otherwise.';

-- 2. Keys, constraints and indexes.

alter table only "public"."contracted_driver_observation"
  add constraint "contracted_driver_observation_pkey" primary key ("id");

alter table only "public"."contracted_driver_observation"
  add constraint "contracted_driver_observation_tenant_id_fkey"
  foreign key ("tenant_id") references "public"."tenants"("id") on delete cascade;

-- Cascade, matching contracted_driver_certification and contracted_driver_document: an
-- observation of a driver who is gone is not evidence of anything.
alter table only "public"."contracted_driver_observation"
  add constraint "contracted_driver_observation_driver_fkey"
  foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete cascade;

alter table only "public"."contracted_driver_observation"
  add constraint "contracted_driver_observation_created_by_fkey"
  foreign key ("created_by") references "public"."users"("id") on delete set null;

-- The driver file reads one driver's whole history at once, most recent work first.
create index if not exists "contracted_driver_observation_driver_idx"
  on "public"."contracted_driver_observation" ("contracted_driver_id", "observed_on" desc);

-- Site standing is "the newest evaluation per client", so that query is worth an index of
-- its own once a fleet of 119 drivers has a few years of these.
create index if not exists "contracted_driver_observation_standing_idx"
  on "public"."contracted_driver_observation" ("contracted_driver_id", "issuing_company", "observed_on" desc)
  where "observation_type" = 'evaluation' and "deleted_at" is null;

-- Deliberately NO unique constraint. Two audits of the same type on the same day by two
-- observers is a real thing, and de-duplicating history is not this table's job.

create or replace trigger "contracted_driver_observation_set_updated_at"
  before update on "public"."contracted_driver_observation"
  for each row execute function "public"."set_updated_at"();

-- 3. Row level security. Same shape as contracted_driver_certification.

alter table "public"."contracted_driver_observation" enable row level security;

create policy "contracted_driver_observation_tenant_select" on "public"."contracted_driver_observation"
  for select to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_observation_tenant_insert" on "public"."contracted_driver_observation"
  for insert to "authenticated"
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_observation_tenant_update" on "public"."contracted_driver_observation"
  for update to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")))
  with check (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

create policy "contracted_driver_observation_tenant_delete" on "public"."contracted_driver_observation"
  for delete to "authenticated"
  using (("authz"."is_tenant_member"("tenant_id") or "authz"."is_consultant_allowed"("tenant_id")));

-- Row level security does NOT grant table access. Without an explicit privilege,
-- PostgREST answers "permission denied for table" however permissive the policies are.
grant select, insert, update, delete on table "public"."contracted_driver_observation" to "authenticated";
grant select, insert, update, delete on table "public"."contracted_driver_observation" to "service_role";

-- Storage: the same bucket and layout the ticket scans already use,
-- {tenant_id}/{subcontractor_id}/contracted-drivers/{driver_id}/{stamp}-{index}-{filename}.
-- Nothing to create here.
