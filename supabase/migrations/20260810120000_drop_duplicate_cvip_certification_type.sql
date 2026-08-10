-- Per-unit certification tracking, slice 2: stop reporting CVIP as two separate gaps.
--
-- Migration 20260809011025 seeded every tenant with a "CVIP inspection" certification
-- type. That was a mistake. CVIP already has its own equipment_document.doc_type and
-- its own Transport registry file (registry 7), and certifications are now expected on
-- every fleet unit, so the same annual certificate was about to be reported missing
-- twice on every truck: once as the CVIP registry file, once as a certification.
--
-- Removing the type does not remove anything a tenant filed. The delete is guarded to
-- skip any type a document still points at, so a tenant that already recorded its CVIP
-- against the certification type keeps that certificate and that line. Only the unused
-- seeded row goes. A tenant that genuinely wants a second CVIP line can add one back
-- from the certification types page.

delete from "public"."equipment_certification_types" "t"
where lower("t"."name") = 'cvip inspection'
  and not exists (
    select 1
    from "public"."equipment_document" "d"
    where "d"."certification_type_id" = "t"."id"
  );
