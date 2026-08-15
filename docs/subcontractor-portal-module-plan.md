# Subcontractor carrier portal, module plan

Status: PLANNED
Date: 2026-08-04

## Context

A 200-truck Alberta carrier uses subcontract carriers to cover smaller towns where it has no terminal. Roughly 20 to 25 subs active at any time. The subs are independent carriers with their own authority and their own blanket fleet policies, not leased-on owner-operators.

What the prime wants: the subs upload their insurance certificates, carrier profile, and WCB paperwork into a portal, with expiry dates recorded, and the system warns before anything lapses.

Two consequences of the scale worth stating up front. Blanket fleet insurance means there is nothing to track per truck, so there is no unit-level record in this module at all. And 25 subs times eight documents is about 200 rows, so nothing here needs bulk import, pagination, or automation for its own sake. The portal has to be simple, because the person filing at a small-town carrier is not going to fight with it.

---

## What Alberta actually requires, and what this is instead

Researched before designing, because the original ask was "just what Alberta Transportation requires."

Alberta Transportation has no subcontractor document regime. Its duties run to the holder of the Safety Fitness Certificate. Because these subs hold their own SFC, they are responsible for their own compliance, and Alberta imposes nothing on the prime for them.

That does not make this pointless. It makes it due diligence rather than regulation. The real drivers are the prime's insurer, its customer contracts, WCB liability for uncovered subcontractors, and civil negligent-hiring exposure if a sub has a bad crash. All legitimate reasons to build it.

The practical rule: do not label any of this as an Alberta Transportation requirement in the UI or the marketing. Call it the prime's due diligence file on hired carriers.

Two related corrections of fact:

- There is no Alberta rule requiring a carrier profile every six months. Alberta encourages carriers to pull their own profile at least quarterly, and an NSC facility audit expects one dated within 30 days of the audit. Six months is the prime's own policy, which is fine. It ships as a configurable interval defaulting to six months.
- If any sub ever is a leased-on owner-operator running under the prime's SFC, that sub's trucks are the prime's own fleet in Alberta's eyes, their events land on the prime's carrier profile, and they have no separate carrier profile to upload. Out of scope here, noted so it does not get modelled wrong later.

Sources: [Carrier profiles and monitoring](https://www.alberta.ca/carrier-profiles-and-monitoring), [Commercial carrier certificates and operating status](https://www.alberta.ca/safety-fitness-certificate), [AR 314/2002](https://www.canlii.org/en/ab/laws/regu/alta-reg-314-2002/latest/alta-reg-314-2002.html), [WCB Alberta, coverage for contractors and subcontractors](https://www.wcb.ab.ca/insurance-and-premiums/types-of-coverage/coverage-for-contractors-and-subcontractors.html)

---

## The document list

### Confirmed by the customer

| Slot | Due date mode | Extra fields | Warn |
| --- | --- | --- | --- |
| Fleet insurance (commercial auto) | expiry on document | policy number, coverage limit, insurer, additional insured yes/no | 30 days |
| General liability insurance | expiry on document | policy number, coverage limit, insurer, additional insured yes/no | 30 days |
| Cargo insurance | expiry on document | policy number, coverage limit, insurer, deductible | 30 days |
| Carrier profile | interval, default 6 months from issue | safety rating, monitoring status | 30 days |
| WCB clearance certificate | expiry on document | WCB account number | 30 days |
| WCB rate statement | interval, default 12 months from issue | industry rate, employer rate, variance | 30 days |

### Recommended additions

These are the ones I would attach. Each is cheap, and each answers a question the prime will otherwise end up asking by phone.

**1. Safety rating and monitoring status, entered by the reviewer when the carrier profile is approved.** This is the most valuable item on the page. A carrier profile PDF filed and never opened proves nothing. Capturing rating (satisfactory, conditional, unsatisfactory) and whether the carrier is under monitoring or intervention turns the six-month refresh into an actual signal, and it lets the dashboard sort subs by risk instead of by filename. Two dropdowns at review time.

**2. A minimum required limit per insurance slot, set by the prime.** The customer already asked to capture the coverage value. Capturing it without checking it wastes the field. If the prime sets "fleet insurance minimum 2,000,000" once, the system flags a sub carrying 1,000,000 as deficient the moment it is uploaded, instead of during a claim.

**3. Prime named as additional insured or certificate holder, yes or no.** On fleet and general liability. This is the single most common gap on a subcontractor certificate of insurance, and it is the one that actually voids the protection the prime thinks it has.

**4. NSC or SFC number, plus a copy of the certificate.** One field and one upload. It is the proof the sub is legally allowed to operate, and it is the key you need to look anything up later.

**5. Insurance broker name, email, and phone.** Renewal certificates come from the broker, not the sub. When a sub goes quiet 20 days before expiry, the prime emails the broker and has the certificate the same day. This one field will save more chasing than any automated reminder.

**6. Signed carrier or hauling agreement on file.** No expiry, or annual if they prefer. It is the document that allocates liability between the two companies, and it is the first thing an insurer asks for after an incident.

### Offered, default off

WCB account number is already captured above. Beyond that: operating jurisdictions (matters only if subs cross into BC, Saskatchewan, or the US), GST and business number (accounting, not safety), and a per-sub note field for anything odd. Turn on if wanted.

### Deliberately not included

Safety program, COR elements, driver qualification files, per-truck registration and CVIP, prequalification scoring. All previously ruled out.

### One usability detail

A broker often issues a single certificate of insurance covering auto, general liability, and cargo on one PDF. The upload must let one file satisfy several slots without the sub uploading the same PDF three times, and without three copies landing in storage. Attach one file, tick which slots it covers.

---

## Design

### Two due-date modes

Four slots carry an expiry printed on the document. Two (carrier profile, WCB rate statement) have no expiry and are instead due a set interval after their issue date. The status engine supports both: `due_mode` of `expiry` or `interval`, with `interval_months` when the latter. Everything downstream, warning, overdue, and dashboard sorting, is identical after the due date is derived.

The 30-day warning reuses the `reminder_lead_days` pattern already on `equipment_document`, which defaults to 30. Per-slot, so the prime can widen it on the slow ones.

### Reuse definitions, separate the rows

Expiry and warning logic reuses `getEquipmentDocumentStatus` from [src/lib/equipment.ts](src/lib/equipment.ts). The slot list lives in a new `src/lib/subcontractor-requirements.ts` as code constants, not a database-backed requirement builder, because there are six to twelve slots and they are the same for every sub. Per-tenant configuration is limited to which optional slots are on, the minimum limits, and the two intervals.

Rows go in new tables. A subcontract carrier's paperwork must not appear anywhere in the prime's own fleet, equipment, or transport screens, and none of those readers filter today. Consistent with the rule already established here: no filtering chokepoint means a separate table.

### Tables

- `subcontractor`: tenant_id, legal_name, operating_name, contact_name, contact_email, contact_phone, nsc_number, wcb_account_number, broker_name, broker_email, broker_phone, safety_rating, monitoring_status, status, carrier_profile_interval_months (6), rate_statement_interval_months (12), notes, timestamps, deleted_at.
- `subcontractor_document`: tenant_id, subcontractor_id, slot_key, storage_path, document_number, insurer, coverage_amount, issued_date, expiry_date, due_date (derived and stored so queries stay simple), reminder_lead_days, fields_json, review_status (`pending`, `approved`, `rejected`), reviewed_by, reviewed_at, rejection_reason, superseded_by_id, timestamps.
- `subcontractor_requirement_setting`: tenant_id, slot_key, enabled, minimum_coverage_amount, reminder_lead_days, interval_months. Small, one row per slot per tenant, only for the handful of things the prime can tune. Arrives with the status engine in slice 2; until then the code constants are the defaults.

The shared certificate of insurance is handled without a join table. One broker PDF becomes one document row per slot, all pointing at the same storage path, because the three coverages on that certificate genuinely carry their own limits and often their own expiry dates. A join table would have forced them to share one. The upload form offers "reuse a file already uploaded for this carrier" instead, and the file is only deleted from storage once the last row referencing it is gone.
- `subcontractor_user`, `subcontractor_user_access`, `subcontractor_audit_log`: the portal identity, mirroring the existing `consultants`, `consultant_access`, and `consultant_audit_log` pattern exactly.

Renewals insert a new document row and point `superseded_by_id` at the old one rather than overwriting. If there is ever an incident, the prime needs to show what it held and when, not just what it holds now.

Storage: new `subcontractor-documents` bucket, paths `{tenant_id}/{subcontractor_id}/{document_id}/{filename}`. Portal users never touch `tenant-documents`.

### Status

Per sub: compliant, expiring, or non-compliant. A sub is non-compliant if any enabled required slot has no approved document, the document is past due, or the coverage amount is below the tenant's minimum. Expiring if anything falls inside its warning window. Same shape as the existing equipment compliance rollup.

---

## Slices

**1. Toggle, subcontractor records, admin-side filing.** `subcontractors_enabled` on `tenants`, default false, ninth toggle. Tables, storage bucket, slot constants, and `/admin/subcontractors` with list and detail. The prime can add subs and upload documents itself. Immediately useful, since most of these certificates are already in somebody's inbox, and it proves the document model before any external login exists.

**2. Status engine and dashboard.** Both due-date modes, minimum-limit checking, per-sub rollup, and a list sorted by what expires next. This is the screen the prime will actually live in.

**3. Portal login.** `subcontractor_user`, `subcontractor_user_access`, `subcontractor_audit_log`, magic-link invite, the `/sub` route group, and a fourth branch in `getCurrentUserContext`. This is the first external principal that writes rows in the database, so it comes with a full RLS pass, route guards, an audit of every existing policy for grants on `authenticated` alone, and a security review before merge.

**4. Portal submission and review.** The sub sees a short checklist, uploads files with expiry dates and coverage amounts, and ticks which slots a shared certificate covers. The prime approves or rejects with a reason, and enters safety rating and monitoring status when approving a carrier profile. Every action logged.

**5. Reminders.** `subcontractor-reminders.ts` on the existing cron, alongside the four reminder modules already there. Warnings to the sub, the broker where present, and the prime's chosen owner at the slot's lead time. Lapse flips the sub to non-compliant.

**6. Export.** One sub's full document pack as a single PDF, for an insurer, a customer, or an auditor. Small, and it is what makes the file worth having kept.

---

## Risks

- **External principal in a shared database.** The risk is not the new tables, it is an existing RLS policy that assumes authenticated means tenant user. Slice 3 handles it, with a security review.
- **Sub adoption.** Magic link, no password, no fee, six to eight items. If a sub still will not log in, slice 1 lets the prime file on their behalf and the module still works.
- **Compliance overclaim.** Never present this as an Alberta Transportation requirement.
- **Scope drift back toward prequalification.** Scoring, financial review, and bid management are a different product. The list above is the list.
