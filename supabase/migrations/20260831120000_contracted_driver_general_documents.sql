-- A contracted driver's file holds paperwork that is not a licence, an abstract or a CSO.
--
-- contracted_driver_document was built for the three identity documents, each of which
-- pairs with a date column on contracted_driver. A carrier pack carries more than that: a
-- hiring form, a photo of a gate fob, a competency card from a client whose course this
-- tenant does not track, a resume. Until now those had nowhere to go, so they stayed in a
-- zip file on somebody's disk and the app could not show that they existed.
--
-- The four types added here deliberately have NO driver column behind them. They are
-- filed and listed and nothing else: no status reads them, no reminder is raised from
-- them, and they cannot make a driver look compliant. That is the same rule the three
-- identity types already follow -- the driver row stays authoritative -- and it matters
-- more here, because these documents carry no authority at all.
--
--   personnel_file   the carrier's own hiring paperwork: employee information forms,
--                    resumes, references. Often carries a SIN or a date of birth, so it
--                    is filed only when the client asks for it to be.
--   site_access      what gets a driver through a gate: a fob photo, an access card, a
--                    badge. The PIN or fob NUMBER stays on the certification record where
--                    it can be read back; this is the picture behind it.
--   training_record  a course certificate with no matching certification type in this
--                    tenant. Filed so the paper exists, with no date driving anything.
--   other            everything else. Named, so nobody has to invent a type that lies.

alter table public.contracted_driver_document
  drop constraint if exists contracted_driver_document_doc_type_check;

alter table public.contracted_driver_document
  add constraint contracted_driver_document_doc_type_check
  check (
    doc_type = any (
      array[
        'license'::text,
        'abstract'::text,
        'cso'::text,
        'personnel_file'::text,
        'site_access'::text,
        'training_record'::text,
        'other'::text
      ]
    )
  );

comment on column public.contracted_driver_document.doc_type is
  'license, abstract and cso pair with a date column on contracted_driver and are shown '
  'beside it. personnel_file, site_access, training_record and other pair with nothing: '
  'they are listed on the driver file and no status, tone or reminder may read them.';
