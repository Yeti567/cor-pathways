-- Let a company say which tickets are not optional.
--
-- Until now the app could only report on certifications somebody had already
-- filed. It had no way to know that a worker was MISSING one, because nothing
-- told it which tickets a job requires. So a brand new hire with nothing on file
-- read as having nothing to renew, which is true of the data and useless to the
-- person who has to keep the crew legal.
--
-- Marking a type mandatory is what closes that. It says "everybody on this
-- roster is expected to hold this", so a worker without it reads as a gap rather
-- than as an absence nobody notices.
--
-- Default false, deliberately. Turning this on for every existing type would
-- make every worker in every tenant instantly deficient for tickets their
-- employer may not require, and a compliance screen that lights up red on the day
-- of an upgrade teaches people to ignore it. Each company ticks its own boxes.
--
-- For Western Canadian oilfield and trucking work the usual floor is H2S Alive,
-- Standard First Aid, WHMIS and TDG, with an energy safety orientation on top
-- where the prime contractor asks for one. That is a starting point for the
-- conversation with a client, not a default we impose: the requirement belongs to
-- their operation and their prime contractors, not to us.

alter table "public"."certification_types"
  add column if not exists "is_mandatory" boolean not null default false;

comment on column "public"."certification_types"."is_mandatory" is
  'When true, every active worker is expected to hold this ticket, so a worker without one counts as a gap on the ticket compliance dashboard. Tenant-managed; defaults to false so an upgrade never invents deficiencies.';
