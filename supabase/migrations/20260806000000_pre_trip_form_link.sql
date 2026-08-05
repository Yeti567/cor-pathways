-- The pre-trip is a form, so the compliance record is derived from a submission.
--
-- The Daily Trip Inspection module no longer has its own capture screen: drivers
-- fill the pre-trip form in the worker app like any other form, and the module
-- reads those submissions back into dti_inspection so the fleet validity board,
-- the out-of-service hold, and the printed report keep working.
--
-- submission_id is the link. It is unique per tenant so reconciling the same
-- submission twice cannot produce two inspections for one pre-trip, which would
-- double-count the fleet board and leave a phantom out-of-service hold.

alter table "public"."dti_inspection"
  add column if not exists "submission_id" "uuid";

alter table "public"."dti_inspection"
  drop constraint if exists "dti_inspection_submission_id_fkey";

-- A deleted submission takes its derived inspection with it: the inspection is a
-- read of the submission, not an independent record, and keeping an orphan would
-- assert a unit was inspected with nothing left to show an auditor.
alter table "public"."dti_inspection"
  add constraint "dti_inspection_submission_id_fkey"
  foreign key ("submission_id") references "public"."submissions"("id") on delete cascade;

create unique index if not exists "dti_inspection_tenant_submission_idx"
  on "public"."dti_inspection" ("tenant_id", "submission_id")
  where "submission_id" is not null;

-- 'form' joins admin/worker/offline/import as a source, so a report can tell a
-- derived inspection from one keyed in before this change.
alter table "public"."dti_inspection"
  drop constraint if exists "dti_inspection_source_check";

alter table "public"."dti_inspection"
  add constraint "dti_inspection_source_check"
  check (("source" = any (array['admin'::"text", 'worker'::"text", 'offline'::"text", 'import'::"text", 'form'::"text"])));

comment on column "public"."dti_inspection"."submission_id" is
  'The pre-trip form submission this inspection was derived from. Null for inspections keyed in before capture moved to forms.';
