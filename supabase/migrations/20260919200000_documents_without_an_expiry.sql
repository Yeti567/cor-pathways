-- Let an equipment document have no expiry date.
--
-- Some paperwork simply never goes out of date. An Alberta trailer registration is
-- CONTINUOUS. A manufacturer's certificate of compliance is a statement about how the
-- unit was built. There is nothing to renew, so there is no date to chase - the only
-- question worth asking is whether the document is on file.
--
-- Until now expiry_date was NOT NULL, so the only way to record one of these was to
-- invent a date far enough away that nobody would notice. 2050-12-31 became the
-- convention. It works until someone reads a trailer's file and sees "expires 31 Dec
-- 2050" against its plate, which is not true and not useful.
--
-- After this migration a NULL expiry means "this does not expire". The application
-- reads such a record as current when a file is attached and as a gap when one is not,
-- which is the whole of what these documents need.

ALTER TABLE "public"."equipment_document"
  ALTER COLUMN "expiry_date" DROP NOT NULL;

-- Retire the sentinel. Only rows that carry the exact placeholder date are touched, and
-- only for the two kinds of document it was ever used for, so a genuine 2050 expiry - if
-- one is ever typed in - is left alone.
--
-- To reverse: UPDATE the same rows back to '2050-12-31' where expiry_date IS NULL and
-- action_metadata->>'expiry_retired_at' is set, then restore the NOT NULL constraint.
UPDATE "public"."equipment_document"
SET
  "expiry_date" = NULL,
  "action_metadata" = COALESCE("action_metadata", '{}'::jsonb)
    || jsonb_build_object(
         'expiry_retired_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'),
         'expiry_retired_from', '2050-12-31',
         'expiry_retired_reason', 'this document does not expire'
       ),
  "updated_at" = now()
WHERE "expiry_date" = DATE '2050-12-31'
  AND "doc_type" IN ('registration', 'other')
  AND "deleted_at" IS NULL;

-- The reminder queries filter on expiry_date, and a NULL never satisfies <=, so a
-- document without an expiry drops out of every reminder sweep on its own. The index
-- stays useful for the rows that do have one.
COMMENT ON COLUMN "public"."equipment_document"."expiry_date" IS
  'NULL means the document does not expire: it is proven by the attached file alone, '
  'and no reminder is ever raised for it.';

COMMENT ON COLUMN "public"."certification_types"."expires" IS
  'FALSE means a ticket of this type never goes out of date. The worker needs the card '
  'on file and nothing more - no expiry is asked for and no reminder is raised.';
