-- Carrier profiles print two ratings the original list had no room for.
--
-- "Satisfactory Unaudited" is what every province issues a carrier it has never audited,
-- and it is the rating on most small carriers' profiles. Folding it into "satisfactory"
-- would claim an audit that never happened. "Excellent" is Alberta's top rating.
--
-- Found 2026-09-24 when the app started reading ratings off uploaded profiles: all three
-- in the first drop said Satisfactory Unaudited or Satisfactory, and the old constraint
-- would have rejected the first.

alter table "public"."subcontractor"
  drop constraint if exists "subcontractor_safety_rating_check";

alter table "public"."subcontractor"
  add constraint "subcontractor_safety_rating_check"
  check (
    "safety_rating" is null
    or "safety_rating" = any (
      array['excellent'::text, 'satisfactory'::text, 'satisfactory_unaudited'::text, 'conditional'::text, 'unsatisfactory'::text, 'unrated'::text]
    )
  );
