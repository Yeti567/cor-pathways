-- Which workers' compensation jurisdictions a hired carrier actually operates in.
--
-- WHY. Workers' compensation is provincial. A clearance letter proves ONE board's
-- account is in good standing and says nothing about any other, so the single
-- 'wcb_clearance' slot could only ever hold one letter. A carrier running Alberta into
-- BC, Saskatchewan, Manitoba, the Yukon and the NWT holds a separate account and a
-- separate letter in each, and the hiring company's liability for unpaid premiums
-- follows the jurisdiction the work was done in. The gaps were invisible.
--
-- The clearance letters themselves need NO migration: subcontractor_document.slot_key is
-- deliberately free text (validated in code against isSubcontractorSlotKey), so the six
-- new keys 'wcb_clearance_ab' .. 'wcb_clearance_nt' work as they stand. What the database
-- did not have is a place to say WHICH jurisdictions a given carrier is expected to
-- cover, and without that the six slots would apply to everyone.
--
-- WHY PER CARRIER AND NOT PER TENANT. subcontractor_requirement_setting already tunes a
-- slot for the whole company, but that is the wrong grain here: most hired carriers run
-- Alberta only. Requiring all six company-wide would put nearly every carrier into red
-- for coverage they neither need nor can produce, and a board that is always red is a
-- board nobody reads -- the same reasoning that left cargo insurance optional.
--
-- DEFAULT IS EMPTY, AND THAT IS DELIBERATE. An empty list means "nobody has said yet".
-- The 31 letters already on file carry no jurisdiction -- nothing in the row, the title
-- or the sheet records one, and several of these carriers are Saskatchewan corporations
-- holding Alberta coverage or the reverse. Guessing from the company name would assert a
-- fact the data does not support. So while the list is empty the legacy 'wcb_clearance'
-- slot stays required exactly as it is today and nothing about those carriers changes;
-- the moment a list is set, the per-jurisdiction slots take over for that carrier and the
-- untagged letter stops being counted. See resolveSubcontractorSlots.

alter table public.subcontractor
  add column if not exists wcb_jurisdictions text[] not null default '{}'::text[];

-- Codes are Canada Post abbreviations, upper case. Checked here as well as in code
-- because a bad code silently creates a slot that can never be satisfied: the row would
-- be required, no upload form would offer it, and the carrier would sit non-compliant
-- with nothing to click.
--
-- DUPLICATES ARE NOT CHECKED HERE, and cannot be. Postgres forbids a subquery in a CHECK
-- constraint, so the obvious `array_length(...) = array_length(array(select distinct
-- unnest(...)), 1)` is rejected outright with 0A000. Writing an IMMUTABLE helper function
-- just to say "no repeats" would be a lot of machinery for a condition that costs
-- nothing: normaliseWcbJurisdictions filters the canonical code list by a Set on the way
-- in AND on the way out, so a duplicate cannot be written by the app and would be
-- collapsed on read even if one arrived some other way. The length bound is the cheap
-- half of the guard and is legal, so it stays.
alter table public.subcontractor
  drop constraint if exists subcontractor_wcb_jurisdictions_check;

alter table public.subcontractor
  add constraint subcontractor_wcb_jurisdictions_check
  check (
    wcb_jurisdictions <@ array['AB'::text, 'BC'::text, 'SK'::text, 'MB'::text, 'YT'::text, 'NT'::text]
    and coalesce(array_length(wcb_jurisdictions, 1), 0) <= 6
  );

comment on column public.subcontractor.wcb_jurisdictions is
  'Workers compensation jurisdictions this carrier is expected to hold clearance in, as Canada Post codes (AB, BC, SK, MB, YT, NT). Each one makes the matching wcb_clearance_<code> slot required for this carrier and no others. Empty means nobody has said yet, in which case the legacy jurisdiction-less wcb_clearance slot stays required instead.';
