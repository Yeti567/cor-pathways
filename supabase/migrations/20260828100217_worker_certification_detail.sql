-- A site access badge carries a number (gate card, PIN, rack ID) as well as an
-- expiry. contracted_driver_certification already has `detail` for that; the
-- worker side did not, so an employee's badge number had nowhere to live and a
-- credential read differently depending on whether its holder was on staff or
-- on a contractor's roster.
--
-- Additive and nullable, so nothing existing changes.

alter table public.certifications
  add column if not exists detail text;

comment on column public.certifications.detail is
  'Free-text identifier that belongs with the credential, such as a terminal badge or PIN number. Mirrors contracted_driver_certification.detail.';
