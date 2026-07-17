# QA pass — full app walkthrough (2026-06-04)

Browser-driven QA using the preview (Playwright-style) tools against `npm run dev` on port 3000.
Goal: open every field, upload documents, exercise every flow, log bugs.

## Legend
- 🔴 Bug (broken / error / wrong behavior)
- 🟡 Issue (works but rough: UX, validation gap, console noise)
- 🟢 Verified working

## Environment
- Dev server: `npm run dev` (Next 16, React 19) on 127.0.0.1:3000
- Supabase: real/production project (from `.env.local`)
- Writes: permitted (per user)

---

Signed in (existing session in preview browser): a Super Admin account on a customer tenant.

## A. Public surface (no auth)
- 🟢 `/` landing renders.
- 🟢 `/login` renders (email/pw + signup; SSO button correctly disabled — no provider configured).
- 🟢 `/pricing`, `/help`, `/auth/error`, `/offline`, `/web` → 200.
- 🟢 `/verify-email`, `/billing/expired` → redirect when not entitled (auth-gated, correct).

## B. e2e-fixture pages — 🟢 `/e2e-fixtures/document-control` renders (file input, no client error). All 8 fixtures 200.

## C. Authenticated admin app — every route SSR-renders 200; **zero error-level console logs** across the whole session.

Write/interactive flows exercised end-to-end (all 🟢):
- Dashboard `/admin` — real tenant stats render.
- Forms — create template; builder shows **20 field types**; added a Short-Answer item → **persists across reload** (POST `/api/sections/:id/items`); form preview renders worker view.
- Documents — **controlled-document upload works** (injected PNG → "Document uploaded.", register 1→2).
- Equipment — create unit; detail tabs (Overview/Service/Maintenance/Meter/Documents/Inspections); **equipment-document upload works** ("added").
- Workers — invite form validation correct (blocks empty + malformed email). NOT submitted (sends real Resend email — needs an address you control).
- Incidents / Corrective Actions — register views render (populated from flagged submissions; no direct create, by design).
- Managed Lists — create list ("created").
- Locations — create location ("created", becomes active).
- Visitors — sign-in works once an active location exists ("signed in"); correctly gated before that.
- Workflow Station — create sequence ("created").
- Transport → Drivers — create driver ("added"); HOS, Fleet, Connections render.
- Settings — Save Print Settings persists ("saved"); company + print forms render.
- Worker app `/web` — Time Card, Roster, Assigned Forms, Resources, Equipment render; **worker form-filler opens** (signature pad + Save Draft + Submit), no client error. (Not submitted.)
- Analytics / Monitor render with no client error.

Routes verified SSR-200 (heading sane), not all deep-interacted: access, permission-profiles, consultant-access, auto-share, setup, certification-types, worker-tickets, cor/export, transport/program, transport/audit, visitors/roster, setup/form-lists.

---

## FIXES APPLIED (2026-06-04)
1. ✅ **Audit crash (clock in/out + worker ticket).** `src/lib/tenant-audit.ts`: `recordTenantAuditEvent` is now best-effort (logs instead of throwing on missing service-role client or insert error); same treatment for the consultant-login audit. Verified: clock in/out succeed with no crash, log shows graceful skip; 31 audit unit tests pass.
2. ✅ **OCR "Scan Form" hang.** `next.config.ts`: added `tesseract.js` + `tesseract.js-core` to `serverExternalPackages` (bundling mangled the Node worker-script path → MODULE_NOT_FOUND → worker hung). Verified: scan completes, "Tesseract OCR found 4 fields."
3. ⃝ **Duplicate COR routes — NOT A BUG.** `/admin/transport/audit` and `/admin/transport/program` are intentional `redirect("/admin/cor")` stubs (retired routes kept for back-compat). No change.
4. ✅ **Logo image aspect-ratio warning.** `LandingPage.tsx`, `HelpShell.tsx`, `pricing/page.tsx`: corrected `width`/`height` props from 120×36 to the true natural 128×41 and removed the ineffective `style={{ width: "auto" }}` (the inline style never affected Next's check; the prop/aspect mismatch did). Verified via Next's exact condition: `wouldWarn: false`, logo still 36px tall.

Full suite: 479/480 pass; the 1 failure is a pre-existing flaky OCR test (`form-import.test.ts`) that times out only under parallel load and passes in isolation (untouched by these changes). Not committed/pushed.

## Bug log

### 🔴 Worker Clock In / Clock Out crash the page (audit logging not isolated)
- **Repro:** `/web` → Time Card → click **Clock In** (or **Clock Out**). Page replaces with "This page couldn't load — A server error occurred."
- **Error:** `SUPABASE_SERVICE_ROLE_KEY is required to record tenant audit events.` at `src/lib/tenant-audit.ts:80` (`recordTenantAuditEvent`).
- **Two distinct problems:**
  1. **Config (local):** `.env.local` has no `SUPABASE_SERVICE_ROLE_KEY`, so `createSupabaseAdminClient()` returns null and audit recording always fails locally. Dashboard "0 audit entries" confirms it has never succeeded here.
  2. **Resilience (prod-relevant):** `recordTenantAuditEvent` is `await`-ed inline in the clock action with no try/catch, and it both `throw`s on a null client AND re-throws on any insert error (`if (error) throw error`, line 86-88). So an audit-log hiccup (missing key locally, or any transient insert/RLS error in prod) **takes down the user's action**.
- **Non-atomic:** the clock-in DB write **succeeds** — after reload the Time Card shows "Clocked in …" with a Clock Out button. So the user sees an error page yet is actually clocked in. Confusing + risks double actions.
- **Scope:** `recordTenantAuditEvent` is awaited inline in many places (src/app/actions.ts ×7, admin/actions.ts, equipment-actions route, auto-share route, all the reminder/cron routes). Any of these will 500 the caller if the audit insert fails. (Worker form *submit* did NOT crash — it goes through the offline sync path, so the inline-await pattern is the differentiator.)
- **Fix:** make audit writes best-effort — wrap the insert in try/catch inside `recordTenantAuditEvent` (log + swallow), or wrap each call site. And set `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` for local testing.
- **Blocks local testing of:** clock in/out, and likely any other audit-dependent action (equipment audit actions, auto-share notifications, reminder crons).

### 🔴 Worker certification-ticket upload (`/web` → Upload Ticket) crashes — same audit bug
- Same `SUPABASE_SERVICE_ROLE_KEY` audit crash as clock in/out. The ticket record + file **do persist** (visible after reload), but the page 500s.

### 🟡 OCR "Scan Form" import never completed
- `/admin/forms` (and `/admin/documents`) → Import Existing Form → inject image → **Scan Form** stays on "Scanning…" for 90s+ with no result, no console error, no failed asset. Likely the tesseract.js worker is hung or extremely slow in the headless preview browser. Needs a real-browser check. Could not confirm OCR extraction works.

### 🟢 Confirmed strong: worker form submission is fully offline-first
- Hazard Report submit wrote **directly to Supabase** from the browser (signature PNG + photo PNG to storage, `submissions`/`submission_values`/`signatures`/`submission_photos` all 201) and appears in admin Monitor. This path does NOT use the server-action audit, so it is unaffected by the service-role bug.

### Minor
- 🟡 **Logo image aspect-ratio warning** (repeated on nearly every page). `/images/cor pathways logo bg removed.png` sets one of width/height but not both. Add `style={{ height: 'auto' }}` (or width) to the `next/image`. Cosmetic console noise only.
- 🟡 **Duplicate COR routes.** `/admin/cor`, `/admin/transport/audit`, and `/admin/transport/program` all render the **identical** "COR Audit" page. Matches the in-progress "single COR home" consolidation — two of these are likely dead routes to remove/redirect. Not a functional defect.

### Not bugs (ruled out)
- `/help/getting-started` 404 was my guessed slug; real slugs (e.g. `/help/create-your-first-form`) return 200, unknown slugs correctly 404.
- `/admin`, `/choose` returning 200 while "signed out" = there was already a valid session cookie in the preview browser (an existing Super Admin session). Not an auth bypass.

## Not yet exercised (would need more time / your input)
- OCR "Scan Form" import (tesseract/unpdf) on Forms + Documents.
- Worker invite email (Resend) — needs a safe recipient address.
- Certification-type / employee-ticket **Upload Ticket** file flow (same upload mechanism as the two verified ones).
- ELD **Connect** (Motive OAuth) — external provider.
- Auto-Share "Send Queued Email" — sends real email.
- Permission Profiles / Access / Setup writes; equipment Service-Schedule range fields; per-row Save/Delete on the Forms list.
- Full field-by-field fill on every form (representative fields filled, not exhaustive).

## CLEANUP DONE (2026-06-04)
All test data removed and verified. Deleted 19 DB rows (form + section + item, controlled doc, equipment unit + doc, list, location, visitor, workflow, driver, 2 certs, cert type, permission profile, auto-share recipient, Hazard Report submission + its values/signature/photo, time card) scoped to tenant `3e956eef-…` by id + "(delete me)" match, plus 6 storage files via the Storage API. Post-cleanup counts match the pre-test baseline exactly (forms 11, equipment 2, locations 0, profiles 4, submissions 0, lists 6). Note: clicking worker "Mark Read" marked pre-existing notifications read (benign, not removable test data).

## (historical) Test records created (writes were authorized) — now deleted
All named "QA ... (delete me)" on the customer tenant:
- Form "QA Test Form (delete me)" (+ 1 Short-Answer item)
- Controlled document "QA Test Doc (delete me)" (+ uploaded PNG in storage)
- Equipment unit "QA-UNIT-DEL / QA Test Unit (delete me)" (+ "QA Reg Doc" document + uploaded PNG)
- Managed list "QA Test List (delete me)"
- Location "QA Test Yard (delete me)"
- Visitor sign-in "QA Visitor (delete me)" (currently on-site)
- Workflow "QA Test Workflow (delete me)"
- Driver "QA Test Driver (delete me)"
- Print settings: re-saved with unchanged values (no data change)
