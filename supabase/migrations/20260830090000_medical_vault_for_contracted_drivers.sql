-- Let the medical vault hold a contracted driver's file, not only an employee's.
--
-- WHY. A carrier sent a driver's drug and alcohol test as the collector's full
-- paperwork: the breath alcohol record, and the substance abuse testing authorisation
-- carrying his date of birth, licence number, and the individual result of all thirteen
-- panels. The test date is a compliance fact and belongs on the driver's file where
-- everyone can see it. The results are health information about a named person, and they
-- belong where exactly one person can read them.
--
-- There was nowhere to put the second half. transport_medical_record.driver_id is NOT
-- NULL and references transport_driver -- this company's own employees -- and the driver
-- in question is another company's employee. The choice was the general
-- subcontractor-documents bucket, readable by anyone who can open that carrier's file, or
-- nothing. It was filed as nothing until this.
--
-- THE DOCTRINE THIS SITS AGAINST, stated so the widening is deliberate.
-- 20260826040000 says of this bucket: "This bucket does not hold compliance paperwork.
-- It holds a doctor's account of an injured worker's restrictions." A drug and alcohol
-- test IS compliance paperwork -- it is a prequalification requirement with a tracked
-- expiry -- so on the face of it this does not belong.
--
-- The distinction that resolves it is the one the vault was always really drawing:
-- between a DATE and a RECORD. The D&A certification, its expiry and its reminder stay
-- exactly where they are, on the driver's file, visible to everyone who runs the fleet.
-- What moves here is the paperwork behind it, because what that paperwork contains is a
-- person's body chemistry. Same split as a driver's medical: the licence expiry proves it
-- happened and is public to the company; the examiner's findings are not tracked at all.
--
-- ACCESS NEEDED NO CHANGE, and that is worth recording rather than discovering later.
-- authz.current_user_can_access_medical_vault grants on two branches: the
-- medical_vault_access capability, which does not reference the subject at all, and the
-- worker reading their own file, which matches on transport_driver.user_id. So a vault
-- holder already reaches any subject folder in their own tenant, and the storage policy
-- -- which only requires the path to be {tenant_uuid}/{subject_uuid}/... -- already
-- accepts a contracted driver's id as the second folder. Nothing about that function is
-- touched here. A security definer function is not a place to make an incidental edit.
--
-- One consequence, deliberate: a contracted driver has no user account, so the
-- read-your-own-file branch can never match for them. Their records are reachable by
-- capability holders and by nobody else. That is tighter than for an employee, and it is
-- correct -- the app has no way to authenticate another company's employee as the subject
-- of the file.

-- 1. The subject may be an employee or a contracted driver, and must be exactly one.

alter table "public"."transport_medical_record"
  alter column "driver_id" drop not null;

alter table "public"."transport_medical_record"
  add column if not exists "contracted_driver_id" uuid;

alter table only "public"."transport_medical_record"
  add constraint "transport_medical_record_contracted_driver_fkey"
  foreign key ("contracted_driver_id") references "public"."contracted_driver"("id") on delete cascade;

-- Exactly one, never both and never neither. A row belonging to nobody is unreachable
-- from either driver file and would sit in the vault with no way to find it; a row
-- claiming both would appear on two people's files.
alter table "public"."transport_medical_record"
  add constraint "transport_medical_record_one_subject_check"
  check (("driver_id" is not null) <> ("contracted_driver_id" is not null));

create index if not exists "transport_medical_record_contracted_driver_idx"
  on "public"."transport_medical_record" ("contracted_driver_id")
  where "contracted_driver_id" is not null;

comment on column "public"."transport_medical_record"."contracted_driver_id" is
  'Set when the file is about a hired carrier''s driver rather than an employee. Exactly one of driver_id and this is set. A contracted driver has no user account, so only medical_vault_access holders can ever reach these.';

comment on column "public"."transport_medical_record"."driver_id" is
  'Set when the file is about this company''s own driver. Nullable since 20260830090000: exactly one of this and contracted_driver_id is set.';

-- 2. A drug and alcohol test is its own kind of record.

alter table "public"."transport_medical_record"
  drop constraint if exists "transport_medical_record_record_type_check";

-- Added rather than folded into 'medical' so the vault list can say what a file is
-- without opening it, which is the whole point of a list of documents nobody should open
-- casually.
alter table "public"."transport_medical_record"
  add constraint "transport_medical_record_record_type_check"
  check ("record_type" = any (array[
    'injury'::text,
    'medical'::text,
    'wcb'::text,
    'first_aid'::text,
    'drug_alcohol'::text,
    'other'::text
  ]));

comment on column "public"."transport_medical_record"."record_type" is
  'injury, medical, wcb, first_aid, drug_alcohol or other. drug_alcohol is the collector''s paperwork behind a D&A certification -- the certification and its expiry stay on the driver''s file, only the results live here.';
