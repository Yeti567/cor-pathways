-- Demo mode: a tenant that anyone can look through but nobody can upload into.
--
-- A demo instance is shared and public, so two things must not happen inside it: a visitor
-- must not push files into it (their content would sit there for the next visitor, and it
-- would spend storage and feed the OCR and PDF features that cost money), and it must stay
-- reviewable rather than fillable. Reads, navigation, and toggling are untouched; only the
-- uploads are stopped.
--
-- The block lives at storage, which is the one chokepoint every upload passes through:
-- photos, signatures, documents, logos, tickets, and the PDF importer all write an object
-- under "<tenant_id>/..." in a tenant bucket. A restrictive policy keyed on the tenant's
-- demo_mode flag denies those writes for a demo tenant and leaves every real tenant alone.
-- Keying on the flag rather than a fixed id means it survives the demo being torn down and
-- rebuilt with a new tenant id on each reset.

alter table "public"."tenants"
  add column if not exists "demo_mode" boolean not null default false;

comment on column "public"."tenants"."demo_mode" is
  'A shared public demo tenant. Uploads into its storage folder are blocked so visitors can look but not fill it. Reads and navigation are unaffected.';

-- Restrictive policies AND with the existing per-bucket permissive policies: an upload now
-- succeeds only if it was already allowed AND its tenant folder is not a demo tenant. The
-- subquery reads public.tenants under the caller's own row security; a demo member can see
-- their tenant row, so the demo_mode check resolves, and a real tenant's folder never
-- matches, so real uploads are not touched.
create policy "demo_mode_blocks_storage_insert" on "storage"."objects"
  as restrictive for insert to "authenticated"
  with check (
    not exists (
      select 1
      from "public"."tenants" t
      where t.id::text = (storage.foldername(name))[1]
        and t.demo_mode
    )
  );

create policy "demo_mode_blocks_storage_update" on "storage"."objects"
  as restrictive for update to "authenticated"
  using (
    not exists (
      select 1
      from "public"."tenants" t
      where t.id::text = (storage.foldername(name))[1]
        and t.demo_mode
    )
  );
