-- An administrator checks every ticket a worker uploads or renews themselves.
--
-- WHY. Since 20260814000000 a worker can photograph a new card on their phone and
-- the ticket turns green on its own. That is the point of it, and it stays: a
-- driver whose First Aid lapsed yesterday should not read as non-compliant for a
-- week while the office gets round to it. But nobody in the office ever saw those
-- changes. A typo in an expiry date, a photo of the wrong card, or a date pushed
-- out three years on a card that says one, all counted as good evidence from the
-- moment they were saved. The client asked to be told so a person can look at the
-- card and confirm the record says what it says.
--
-- WHAT. A worker's change still takes effect immediately, and is now marked
-- 'awaiting_check' with enough of the old record kept beside it to undo it:
--
--   review_status    null           nothing to check (an admin entered it, or it
--                                   was loaded, or a check has been finished)
--                    awaiting_check a worker added or changed it since the last check
--                    verified       an administrator looked at the card and agreed
--   review_kind      new | renewal  whether Reject should remove the ticket or put
--                                   the old card and dates back
--   review_previous_*               the card and dates as they stood before the
--                                   worker's first unchecked change
--
-- WHY A TRIGGER. The flag is set by the database, not by the server action. A
-- worker holds a session token that can UPDATE their own ticket straight over
-- PostgREST, and a flag the action sets is a flag that a direct request leaves
-- off, or sets to 'verified' itself. The trigger applies to every write by a
-- signed-in person who cannot manage certifications, whichever way it arrives.
-- Writes with no signed-in user (the service role: loaders, intake, cron) and
-- writes by administrators are left exactly as sent, which is also how the
-- Verify and Reject actions clear the flag.
--
-- Two unchecked renewals in a row keep the FIRST set of previous values. The
-- record to go back to is the one an administrator last accepted, not the
-- worker's own first attempt.

alter table "public"."certifications"
  add column if not exists "review_status" text,
  add column if not exists "review_kind" text,
  add column if not exists "review_submitted_at" timestamp with time zone,
  add column if not exists "review_submitted_by" uuid,
  add column if not exists "review_previous_attachment_path" text,
  add column if not exists "review_previous_issued_on" date,
  add column if not exists "review_previous_expires_on" date,
  add column if not exists "reviewed_at" timestamp with time zone,
  add column if not exists "reviewed_by" uuid;

alter table "public"."certifications"
  drop constraint if exists "certifications_review_status_check";
alter table "public"."certifications"
  add constraint "certifications_review_status_check"
  check ("review_status" is null or "review_status" = any (array['awaiting_check'::text, 'verified'::text]));

alter table "public"."certifications"
  drop constraint if exists "certifications_review_kind_check";
alter table "public"."certifications"
  add constraint "certifications_review_kind_check"
  check ("review_kind" is null or "review_kind" = any (array['new'::text, 'renewal'::text]));

alter table "public"."certifications"
  drop constraint if exists "certifications_review_submitted_by_fkey";
alter table "public"."certifications"
  add constraint "certifications_review_submitted_by_fkey"
  foreign key ("review_submitted_by") references "public"."users"("id") on delete set null;

alter table "public"."certifications"
  drop constraint if exists "certifications_reviewed_by_fkey";
alter table "public"."certifications"
  add constraint "certifications_reviewed_by_fkey"
  foreign key ("reviewed_by") references "public"."users"("id") on delete set null;

-- The Needs Checking list and the menu count read only the unchecked rows.
create index if not exists "certifications_awaiting_check_idx"
  on "public"."certifications" ("tenant_id", "review_submitted_at")
  where "review_status" = 'awaiting_check';

create or replace function "public"."certifications_flag_worker_change"() returns trigger
    language "plpgsql"
    set "search_path" to 'public'
    as $$
begin
  if auth.uid() is null
     or authz.can_manage_certifications()
     or authz.is_consultant_allowed(new.tenant_id) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.review_kind := 'new';
    new.review_previous_attachment_path := null;
    new.review_previous_issued_on := null;
    new.review_previous_expires_on := null;
  elsif old.review_status is distinct from 'awaiting_check' then
    new.review_kind := 'renewal';
    new.review_previous_attachment_path := old.attachment_path;
    new.review_previous_issued_on := old.issued_on;
    new.review_previous_expires_on := old.expires_on;
  else
    new.review_kind := old.review_kind;
    new.review_previous_attachment_path := old.review_previous_attachment_path;
    new.review_previous_issued_on := old.review_previous_issued_on;
    new.review_previous_expires_on := old.review_previous_expires_on;
  end if;

  new.review_status := 'awaiting_check';
  new.review_submitted_at := now();
  new.review_submitted_by := auth.uid();
  new.reviewed_at := null;
  new.reviewed_by := null;

  return new;
end;
$$;

alter function "public"."certifications_flag_worker_change"() owner to "postgres";

revoke all on function "public"."certifications_flag_worker_change"() from public;

drop trigger if exists "certifications_flag_worker_change" on "public"."certifications";
create trigger "certifications_flag_worker_change"
  before insert or update on "public"."certifications"
  for each row execute function "public"."certifications_flag_worker_change"();
