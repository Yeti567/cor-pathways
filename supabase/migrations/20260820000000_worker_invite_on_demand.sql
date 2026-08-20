-- Entering a worker and inviting a worker become two separate acts.
--
-- WHAT WAS WRONG:
--
-- Creating a worker sent the invitation in the same breath. Both paths did it --
-- the Add Worker form and the CSV import -- because `inviteWorkerByEmail` was the
-- thing that created the auth account, so there was no way to have the account
-- without also having the email land in somebody's inbox that minute.
--
-- On a roster load that is backwards. The office enters sixty drivers on a Tuesday
-- and sixty invitations go out on Tuesday, to people who were told nothing, are not
-- at a computer, and in most cases are mid-shift. The links expire in 24 hours. By
-- the time anyone tells the drivers to expect an email, every link in every inbox
-- is dead, and the only signal the office gets is silence. That is not a delivery
-- problem to debug; it is the wrong moment to send.
--
-- THE RULE NOW:
--
--   Entering a worker creates their account and sends nothing. The company sends
--   invitations when the people are actually ready to receive them.
--
-- WHY TWO COLUMNS AND NOT A LOOKUP:
--
-- `auth.users` cannot answer the question the admin screen has to ask. A worker who
-- was entered and never emailed and a worker who was emailed and ignored it look
-- identical there: both have `email_confirmed_at` null. `invited_at` does not help
-- either -- it is stamped by `generateLink` type `invite`, which is no longer how
-- these accounts are made, and never by a magic link. So the application has to
-- record the send itself.
--
-- `invite_accepted_at` is maintained by trigger rather than by the app. The moment
-- of acceptance belongs to GoTrue, which stamps `email_confirmed_at` during
-- `verifyOtp`; no application code is reliably running at that instant, and asking
-- the worker's own session to update their row would need an RLS hole to write it
-- through. A trigger on the column that already changes is exact and needs neither.
--
-- Keeping both columns on `public.users` is what lets the workers list render
-- status under plain RLS, with no service-role call on a page render.

alter table "public"."users"
  add column if not exists "invite_sent_at" timestamp with time zone,
  add column if not exists "invite_accepted_at" timestamp with time zone;

comment on column "public"."users"."invite_sent_at" is
  'When an invitation email was last sent to this worker. Null means entered but never invited, which is the normal state for a freshly loaded roster.';

comment on column "public"."users"."invite_accepted_at" is
  'When this worker confirmed their email and set up their account. Maintained by trigger from auth.users.email_confirmed_at.';

-- Backfill, so nobody already using the app appears as "Not invited".
--
-- Anyone who has confirmed is both sent and accepted. Anyone carrying an
-- `invited_at` was sent one under the old create-and-send behaviour. `confirmed_at`
-- is a generated column in newer GoTrue and is not written to here; only
-- `email_confirmed_at` is read.
update "public"."users" u
set
  "invite_sent_at" = coalesce(a."invited_at", a."email_confirmed_at", a."created_at"),
  "invite_accepted_at" = a."email_confirmed_at"
from "auth"."users" a
where
  a."id" = u."id"
  and u."invite_sent_at" is null
  and (a."invited_at" is not null or a."email_confirmed_at" is not null);

create or replace function "authz"."sync_worker_invite_accepted"() returns "trigger"
    language "plpgsql" security definer
    set "search_path" to 'public', 'authz'
    as $$
begin
  update public.users
  set invite_accepted_at = new.email_confirmed_at
  where id = new.id
    and invite_accepted_at is null;

  return new;
end;
$$;

alter function "authz"."sync_worker_invite_accepted"() owner to "postgres";

drop trigger if exists "on_auth_user_confirmed_sync_invite" on "auth"."users";

create trigger "on_auth_user_confirmed_sync_invite"
  after update of "email_confirmed_at" on "auth"."users"
  for each row
  when (old."email_confirmed_at" is null and new."email_confirmed_at" is not null)
  execute function "authz"."sync_worker_invite_accepted"();
