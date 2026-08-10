# Unit Certification Tracking — Implementation Plan

## Goal

Let each fleet unit (truck or trailer) carry **multiple certifications**, each with:
- a **certification type** picked from a dropdown (CVIP, picker/crane inspection, tank/B620, pressure test, etc.),
- an **expiry date**, and
- an **uploaded file**,

and have the system **warn ~30 days before** each one expires. The experience should mirror
uploading tickets for an employee, but attached to the unit itself.

## Current state (what already exists — this is most of the work, done)

- **Units are `equipment` rows** — category `vehicle` / `trailer`, `is_commercial`, `unit_number`
  (e.g. `T01`). Managed at `src/app/admin/equipment/[equipmentId]/page.tsx`.
- **Per-unit documents live in `equipment_document`**, which already has:
  `doc_type`, `issued_date`, `expiry_date`, `reminder_lead_days` (default **30** — the month-before
  warning), `attachment_ids` (file upload), `is_active`. Status math is in `getEquipmentDocumentStatus`
  (`src/lib/equipment.ts`), and dashboards (`admin/page.tsx`, `equipment/page.tsx`,
  `transport/fleet/page.tsx`) already surface "due soon" documents from these fields.
- **Transport > Vehicle files** (`src/app/admin/transport/vehicle-files/page.tsx`) already shows each
  unit's file status (missing / due soon / expired) and links to the unit's Documents tab to file one.
- **Employee side already has the exact pattern to mirror:** `certification_types` (tenant-managed
  list) + `certifications` (worker record: type + issued/expires + attachment) +
  `sendCertificationExpiryNotifications` (`src/lib/certification-reminders`).

## The gap

The tracked set for a unit is a **fixed registry** — only Registration, Insurance, and CVIP
(`commercialVehicleRequiredDocuments` in `src/lib/equipment.ts`), and `equipment_document.doc_type`
is a fixed enum (registration / insurance / cvip / permit / certification / other). There is **no
structured, user-editable list of vehicle certification types**, so you cannot add a specific
certification (picker inspection, B620 tank, pressure test) with its own type + expiry + file.

## Certification types to seed (from research)

Default dropdown, tenant-editable. Alberta / Saskatchewan commercial trucking:

| Certification | Applies to | Notes |
|---|---|---|
| CVIP (Commercial Vehicle Inspection Program) | vehicle + trailer | Annual safety inspection, mandatory for NSC units. (This is the real term; "CBIP" is not a real vehicle certification.) |
| Crane / picker inspection | vehicle | Annual, for picker/boom trucks |
| Tank inspection — CSA B620 | trailer/tank | External visual, internal visual, leakage; dangerous-goods tanks |
| Pressure test (hydrostatic / pneumatic) | trailer/tank | Periodic re-test interval per CSA B620 |
| Fire extinguisher inspection | vehicle + trailer | Annual |
| Registration | vehicle + trailer | Already tracked |
| Insurance / COI | vehicle + trailer | Already tracked |
| (optional) TDG docs, spill kit, first aid kit | any | If you want them tracked |

The app tracks whatever **expiry date is entered**, so exact intervals are not hardcoded — Blake sets
each unit's date. Final list to be confirmed by Blake (NCSO).

## Recommended design (mirror the employee certification pattern)

1. **New table `equipment_certification_types`** (tenant-scoped): `id, tenant_id, name,
   applies_to (vehicle|trailer|any), default_reminder_days, is_active`. Seeded with the list above.
   Mirrors `certification_types`.
2. **Extend `equipment_document`**: add `certification_type_id uuid null` (FK). Used when
   `doc_type = 'certification'`. The existing registration/insurance/cvip flow is unchanged.
3. **Unit Documents tab:** when the user picks doc type **Certification**, reveal a
   **Certification type dropdown** (from `equipment_certification_types`, filtered by the unit's
   category) plus the existing expiry + file upload — exactly like the employee Upload Ticket flow.
4. **Display:** vehicle-files page and equipment status show each certification by its type name with
   the same current / due-soon / expired badges (reuse `getEquipmentDocumentStatus`); include
   certifications in the "gaps / renewing soon" counts.
5. **Reminders:** `reminder_lead_days` already drives due-soon on the dashboards. Add certifications to
   the expiry-notification path (mirror `src/lib/certification-reminders`) so a notification / follow-up
   is created ~30 days out, not just a dashboard card.
6. **Admin:** a small "Vehicle certification types" management page (mirror
   `src/app/admin/certification-types/page.tsx`) to add / rename / disable types.

## Phased implementation

1. **Data** — migration: `equipment_certification_types` + seed defaults; `certification_type_id` on
   `equipment_document`; RLS (tenant isolation); regenerate `src/types/database.ts`.
2. **Types / lib** — cert-type options + coercers in `src/lib/equipment.ts`; extend status/label logic
   to name certifications.
3. **UI (unit Documents tab)** — doc type "Certification" reveals the cert-type dropdown; add / edit /
   renew a certification with expiry + file.
4. **Display** — vehicle-files page shows certifications per unit with status; counts include them.
5. **Reminders** — wire equipment certification expiry into notifications (mirror
   certification-reminders); 30-day default with per-cert override.
6. **Admin** — vehicle certification types management page.
7. **Tests** — Vitest for status logic; a Playwright e2e for add-cert + expiry surfacing.

## Decisions needed from Blake before building

1. Confirm the default certification list above — add/remove any? (Resolved: "CBIP" is not a real vehicle certification; the correct term is CVIP, which the app already uses.)
2. Filter the dropdown by unit type (pickers only on trucks; tank/pressure only on trailers), or show all?
3. Reminder lead time — 30 days for everything, or per-certification (e.g. B620 at 60)?
4. Are certifications **required** (show as a gap if missing) or **optional** (only track what's uploaded)?
5. Who receives the reminder — all admins, or a specific safety contact?

## Sources (research)

- Alberta CVIP (Commercial Vehicle Inspection Program) requirements
- CSA B620 highway tank inspection & periodic pressure testing (Transport Canada)
