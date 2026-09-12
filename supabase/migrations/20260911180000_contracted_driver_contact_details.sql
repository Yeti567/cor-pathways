-- Contact details on a contracted driver.
--
-- WHY THIS EXISTS. A carrier sent through a list of their drivers' email addresses and
-- phone numbers and there was nowhere to put a single one of them. contracted_driver
-- carried a name, a carrier, a unit, licence and abstract dates and a CSO flag -- every
-- field an auditor asks for, and no field a human being can be reached at. So the answer
-- to "the trailer this driver is on has an inspection due Friday, tell him" was to go
-- and find the carrier and hope they pass it on.
--
-- THIS IS NOT A LOGIN, AND MUST NEVER BECOME ONE. The obvious misreading of an email
-- column on a person is "this is how we invite them into the app". It is not. A
-- contracted driver works for a subcontractor, not for the tenant; the account that
-- gets them into the portal is subcontractor_user, which is a separate table with a
-- separate lifecycle and which sends mail the moment a row appears. Nothing in this
-- migration touches auth, and nothing reading these columns may create an account or
-- send a message without the recipient already expecting it -- these addresses arrived
-- on an internal spreadsheet and the people on it have not been told the app exists.
--
-- NOT UNIQUE, DELIBERATELY. Several carriers run a single office mailbox for every
-- driver on their books, and one drop had nine drivers at one carrier sharing the
-- company admin address. A unique index would reject the second driver and the load
-- would fail on real, correct data. Duplicates here are a fact about how small carriers
-- operate, not a data-quality problem to design out.
--
-- NULLABLE, DELIBERATELY. On the list that prompted this, 13 of 94 drivers had no
-- address and 14 had no number. Empty means "nobody has told us", which is a different
-- and more honest thing than an empty string, and it is what the dashboard should be
-- able to count so the gap is visible rather than papered over.

alter table public.contracted_driver
  add column if not exists email text,
  add column if not exists phone text;

-- Shape, not validity. A real check that an address deliverable is a round trip through
-- a mail server, and anything stricter than this rejects legitimate oddities -- plus
-- signs, apostrophes, long new gTLDs -- that turn up in a real fleet's contact list. All
-- this guards is the failure that is actually expensive: a whole name, a phone number or
-- a line of notes landing in the email column during a bulk load, where it would sit
-- looking like a contact nobody can reach. Storage is trimmed and lower-cased by the
-- caller; the length bound is what stops a pasted paragraph.
alter table public.contracted_driver
  drop constraint if exists contracted_driver_email_check;

alter table public.contracted_driver
  add constraint contracted_driver_email_check
  check (
    email is null
    or (email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email) <= 320)
  );

alter table public.contracted_driver
  drop constraint if exists contracted_driver_phone_check;

alter table public.contracted_driver
  add constraint contracted_driver_phone_check
  check (phone is null or length(phone) between 7 and 32);

comment on column public.contracted_driver.email is
  'Contact address for this driver, as supplied by their carrier. Contact detail only -- this is NOT a login and NOT a mailing list: an account into the portal is a subcontractor_user row, and nothing may send to this address unless the recipient is already expecting it. Not unique; carriers routinely share one office mailbox across several drivers. Null means nobody has told us yet.';

comment on column public.contracted_driver.phone is
  'Contact number for this driver, as supplied by their carrier, stored exactly as they wrote it. Null means nobody has told us yet.';
