-- Document intake, phase two: people's tickets.
--
-- WHY. A client onboarding brings a filing cabinet of safety tickets (H2S, First Aid,
-- WHMIS, TDG...) for their own staff and for their hired carriers' drivers. Phase one read
-- unit paperwork and matched it to a unit by VIN and plate. A ticket has neither: it has a
-- name, and names are fuzzy ("J. Smith", "John Smith", "Smith, John"). So a ticket is
-- matched to a person and, whenever the match is anything less than certain, a person must
-- confirm it in so many words before it is saved.
--
-- WHAT CHANGES. The same staging ledger carries both kinds of file. `subject` says which;
-- the person a ticket matched sits in one of two columns, because the company's own
-- workers and a carrier's drivers live in different tables. Nothing existing changes:
-- every row so far is a unit file and takes the default.
--
-- filed_record_id is the certification a ticket became. It has no foreign key because it
-- points at one of two tables (certifications, contracted_driver_certification), the same
-- way the audit log records an entity id.

alter table "public"."document_intake"
  add column if not exists "subject" text default 'unit'::text not null,
  add column if not exists "worker_profile_id" uuid,
  add column if not exists "contracted_driver_id" uuid,
  add column if not exists "filed_record_id" uuid;

alter table "public"."document_intake"
  drop constraint if exists "document_intake_subject_check";

alter table "public"."document_intake"
  add constraint "document_intake_subject_check" check ("subject" = any (array['unit'::text, 'ticket'::text]));

-- A ticket belongs to one person at most, never both kinds at once.
alter table "public"."document_intake"
  drop constraint if exists "document_intake_one_person_check";

alter table "public"."document_intake"
  add constraint "document_intake_one_person_check" check (num_nonnulls("worker_profile_id", "contracted_driver_id") <= 1);

-- Set null, not cascade: removing a person must not erase the record of what was uploaded
-- for them and what was decided.
alter table only "public"."document_intake"
  drop constraint if exists "document_intake_worker_profile_id_fkey";

alter table only "public"."document_intake"
  add constraint "document_intake_worker_profile_id_fkey" foreign key ("worker_profile_id") references "public"."worker_profiles"("id") on delete set null;

alter table only "public"."document_intake"
  drop constraint if exists "document_intake_contracted_driver_id_fkey";

alter table only "public"."document_intake"
  add constraint "document_intake_contracted_driver_id_fkey" foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete set null;

comment on column "public"."document_intake"."subject" is
  'unit: vehicle or equipment paperwork, matched to equipment. ticket: a person''s safety ticket, matched to a worker or a contracted driver.';

comment on column "public"."document_intake"."filed_record_id" is
  'For a filed ticket, the certifications or contracted_driver_certification row it became. No foreign key: it points at one of two tables.';

create index if not exists "document_intake_tenant_subject_status_idx"
  on "public"."document_intake" ("tenant_id", "subject", "status", "created_at");

-- The matched unit AND the matched person must belong to the same tenant.
create or replace function "public"."document_intake_tenant_matches"() returns trigger
  language plpgsql
  set "search_path" to 'public'
  as $$
begin
  if new.equipment_id is not null and not exists (
    select 1
    from public.equipment e
    where e.id = new.equipment_id
      and e.tenant_id = new.tenant_id
  ) then
    raise exception 'Document intake equipment must belong to the same tenant.';
  end if;

  if new.worker_profile_id is not null and not exists (
    select 1
    from public.worker_profiles w
    where w.id = new.worker_profile_id
      and w.tenant_id = new.tenant_id
  ) then
    raise exception 'Document intake worker must belong to the same tenant.';
  end if;

  if new.contracted_driver_id is not null and not exists (
    select 1
    from public.contracted_driver d
    where d.id = new.contracted_driver_id
      and d.tenant_id = new.tenant_id
  ) then
    raise exception 'Document intake driver must belong to the same tenant.';
  end if;

  return new;
end;
$$;
