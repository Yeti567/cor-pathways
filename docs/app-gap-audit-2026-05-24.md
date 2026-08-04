# Cor Pathway 360 App Gap Audit And Restart Handoff

Generated: 2026-05-24 02:52 America/Vancouver  
Repo: `C:\Users\blake\OneDrive\Documents\cor pathway non safety app`  
Branch at audit time: `codex/next-plan-stage`  
Latest commit at audit time: `85e393b Add equipment linking tests`

## Restart Prompt To Paste Back Into Codex

Read `docs/app-gap-audit-2026-05-24.md` and continue from Priority 1. Work one commit-sized slice at a time. Before coding each slice, quickly inspect the referenced files so you do not rebuild something that already exists. After each slice, run the focused tests or build check that fits the change, then wait for me to ask for commit and push.

## Specs And Code Reviewed

- Specs reviewed: `PRODUCT-DESCRIPTION.md`, `DESIGN.md`, `SCREENSHOTS-INDEX.md`, `docs/superpowers/plans/2026-05-24-equipment-inventory-files.md`.
- Main routes reviewed: `src/app/admin/*`, `src/app/web/page.tsx`, `src/app/web/_components/*`, `src/app/login/*`, `src/app/_components/OfflineRuntime.tsx`.
- Main libraries reviewed: access control, workers, certifications, forms, form import, managed lists, document control, reports, workflows, auto-share, email delivery, offline sync, equipment.
- Migrations and tests reviewed: `supabase/migrations/*`, `tests/*.test.ts`.

## Do Not Rebuild These From Scratch

These areas exist and should be improved in place:

- Admin sections exist for access, permission profiles, workers, locations, visitors, forms, managed lists, documents/resources, monitor, reports, analytics, workflows, follow-ups, auto-share, settings, incidents, and equipment.
- Worker app exists at `/web` with assigned forms, offline status, resources, equipment, notifications, records, certifications, and signed/submitted documents.
- Offline foundation exists: Dexie cache, queued mutations, service worker registration, background sync helpers, failed queue retry UI, offline resources, offline forms, offline follow-ups, and offline equipment.
- Form builder has sections, items, required fields, flaggable fields, managed list binding, private/shared settings, app menu visibility, duplicate setting, analytics flag, and the full field-type enum including equipment selector.
- Mobile form renderer has real controls for signatures, photos, GPS, PDFs, images, worker selection, equipment selection, pass/fail/NA, yes/no/NA, repeatable sections, required validation, drafts, and queued sync.
- PDF/form import has Google Document AI plus OpenRouter Gemini code with local OCR fallback.
- Document control has enable/disable, DCN numbering settings, register, approval status, revision rows, resource assignment, resource sections, and document upload.
- Monitor has submitted form feed, print output, signatures/photos, workflow/schedule context, auto-share context, filters, and report print footer/header pieces.
- Auto-share has recipients, per-location/all-location scope, queued/delivered/failed/skipped states, email webhook delivery, process queued, and retry.
- Workflows have form-based step builder, branch conditions, scheduled tasks, due dates, overdue reminders, run detail, and worker assignment badges.
- Certifications have ticket image/PDF uploads from admin and worker app, worker profile previews, expiry reminder helpers, and deficiency wording on expired certs.
- Equipment module has data tables, admin inventory/detail, mobile equipment panel, service/docs/maintenance/meter/forms, offline writes, inspection auto-linking, manual link/unlink, reminders, and dashboard alert counts.
- Incidents page already separates incidents, near misses, illnesses, and unsafe work refusals by form keyword.

## Priority 1 - General Tenant Audit Log

Gap:
- The spec requires every consultant login and every consultant action to be logged and visible to the tenant Super Admin.
- The equipment spec also requires every create, edit, retire, complete, link, and unlink action to be written to the existing audit log.
- Current code has `consultant_audit_log` mostly for override events and equipment rows store `action_metadata` as an audit-ready stopgap. There is no general tenant action audit table/helper used across admin actions.

Evidence:
- `src/app/admin/actions.ts` writes `consultant_audit_log` for `requestConsultantOverride`.
- Equipment actions write `action_metadata` on equipment-related rows.
- `docs/superpowers/plans/2026-05-24-equipment-inventory-files.md` says equipment acceptance criterion 14 is partially blocked until a general tenant audit log exists.

Fix slice:
- Add `tenant_audit_log` migration with `tenant_id`, `actor_user_id`, `actor_role`, `action`, `entity_table`, `entity_id`, `metadata`, `created_at`.
- Add RLS so tenant admins/super admins can read their tenant logs and writes happen through server actions.
- Add `recordTenantAuditEvent()` helper.
- Start by wiring it to consultant access, document control, equipment create/update/photo/service/document/link/unlink, worker invite/import, certification create, form publish/settings, and auto-share delivery actions.
- Add an admin audit page or a section under `/admin/consultant-access` for consultant-specific filtering.
- Tests: schema/RLS coverage plus helper tests for audit payload shape.

## Priority 2 - Real SSO Login

Gap:
- The login screen displays `Login with Cor Pathway 360 SSO`, but login actions only implement email/password sign-in and signup.
- The spec requires email-first login plus an SSO option.

Evidence:
- `src/app/login/page.tsx` shows the SSO button text.
- `src/app/login/actions.ts` uses `supabase.auth.signInWithPassword()` and signup only; no OAuth/SSO action was found.

Fix slice:
- Decide configured provider name through env, for example `NEXT_PUBLIC_SSO_PROVIDER`.
- Add a server action for Supabase OAuth/SSO redirect.
- Disable or hide the button when provider env is missing.
- Add tests for safe redirect path and rendered disabled state if practical.

## Priority 3 - Browser/E2E Test Coverage

Gap:
- There are many useful Vitest unit/helper tests, but no Playwright dependency/config or browser workflow tests.
- The product risk is mostly in actual screens: admin creates data, worker fills forms offline, sync resumes, monitor/print output shows the result.

Evidence:
- `package.json` has `vitest`, `eslint`, and Next scripts, but no Playwright dependency or config.
- Tests cover helpers such as offline sync payloads, reports, workflow, equipment, auto-share, certifications, and RLS text checks, not full browser flows.

Fix slice:
- Add Playwright or another browser E2E setup.
- Cover the minimum smoke path: login or seeded auth, create managed list, create form, fill worker form, sign, attach photo, queue offline, sync online, verify monitor print.
- Add equipment E2E: create unit, schedule service, upload doc, worker links inspection to unit, verify equipment file feed.
- Add document control E2E: enable control, upload resource, approve, create revision, verify register.

## Priority 4 - Form Builder UX Parity

Gap:
- The form builder has the data model and controls, but it is still a dense server-rendered form editor with manual sort order fields.
- Product screenshots expect a smoother builder experience: reorder/edit/delete/duplicate controls, section controls, preview behavior, and mobile menu visibility/order.
- Field-level settings beyond required/flaggable/list/manual options need a parity pass: admin-only/private field behavior, analytics item flags if needed per item, media URL/file setting UX for view image/PDF, and clearer field settings for worker/equipment pickers.

Evidence:
- `src/app/admin/forms/[formId]/page.tsx` exposes sort order inputs and edit forms.
- No `duplicate` action/function was found for form items or sections.
- No builder preview route/component using the same renderer as the worker app was found.

Fix slice:
- Add duplicate field and duplicate section actions.
- Add up/down reorder controls that update `sort_order` without manual number entry.
- Add a preview panel/page that renders the same field renderer behavior as worker forms where possible.
- Add settings UI for image/PDF view source URLs and picker behaviors.
- Add tests for duplicate/reorder helper behavior.

## Priority 5 - Offline Sync Production Hardening

Gap:
- Offline sync is implemented, but the highest-risk requirement is field reliability, and there is no browser-level offline verification.
- Need stronger operator-facing visibility for partial failures: which form/equipment/document failed, which attachment failed, and a clear retry path per item.

Evidence:
- `src/lib/offline/sync.ts`, `src/lib/offline/sync-queue.ts`, and `src/app/web/_components/OfflineStatus.tsx` have failed mutation handling and retry.
- Existing tests are helper-level, not real browser offline/online tests with images/signatures/service worker.

Fix slice:
- Improve failed sync detail UI so a worker can see the record name and failure message, not only counts.
- Add a per-record retry/remove option for failed drafts if safe.
- Add browser tests for signature/photo upload failure and retry.
- Verify `public/sw.js` background sync against a real dev server.

## Priority 6 - Document Control Audit And Register Tightening

Gap:
- Document control is now much stronger, but it still needs a compliance pass.
- The spec wants controlled documents registered automatically, approval notifications, revision history, and manager approval. The code has much of this, but it is not tied into a general audit log and needs end-to-end verification.

Evidence:
- `src/app/admin/documents/page.tsx` shows register, approval status, revision history, numbering settings, and resources.
- `src/app/admin/actions.ts` creates approval notifications and register rows.
- No general audit log exists yet.

Fix slice:
- After Priority 1 audit log exists, write audit entries for enable/disable, numbering changes, upload, approve, reject/revision requested, resource assignment, and form registration.
- Add a browser check or E2E test for enable document control -> upload controlled resource -> approve -> upload revision -> verify history.
- Add explicit filters for pending/approved/revision in `/admin/documents` if the screen feels crowded.

## Priority 7 - Auto-Share Production Delivery

Gap:
- Auto-share state handling exists, but production delivery depends on a generic webhook and settings toggle.
- Need final operational polish: provider configuration guidance, delivery audit logs, retry history, and clear handling for skipped SMS/unsupported recipient records.

Evidence:
- `src/lib/email-delivery.ts` posts to `EMAIL_DELIVERY_WEBHOOK_URL`.
- `src/app/admin/auto-share/page.tsx` shows queued/delivered/failed/skipped and retry actions.
- `src/lib/auto-share.ts` marks SMS as skipped because SMS delivery is not configured.

Fix slice:
- Add delivery attempt metadata, retry count, last error, and delivered/failed timestamps if not already complete enough in migrations.
- Add audit events for queue/process/retry/deliver/fail/skipped.
- Add a settings hint that email delivery requires both the integration toggle and webhook env.
- Decide whether SMS is intentionally out of scope or should be removed from recipient capture until configured.

## Priority 8 - Workflow Station End-To-End Execution

Gap:
- Workflow helper logic and screens are substantial, but the spec's core promise is end-to-end: completed forms trigger next forms, branch conditions create the right assignment, overdue reminders fire, and monitor links everything.
- This needs a full workflow browser/integration test and a code pass for edge cases.

Evidence:
- `src/lib/workflow-station.ts` has branch, run status, due date, scheduled task, and recurrence helpers.
- `src/app/admin/workflows/page.tsx`, `src/app/admin/workflows/[runId]/page.tsx`, and monitor workflow context exist.
- Tests cover helper logic but not full form submission -> workflow assignment -> worker completion.

Fix slice:
- Add integration/browser test for incident-style branching: Step A submitted, answer triggers Step B, worker sees assigned Step B, monitor shows run context.
- Add audit entries once Priority 1 exists.
- Add better branch context in admin if a next step was skipped or stopped by a condition.

## Priority 9 - Reports And Analytics Depth

Gap:
- Reports and analytics exist, but they are summary pages rather than a full reporting system.
- Need exports/print parity, stronger filters, drilldowns, and analytics that clearly use only forms/items flagged for analytics.

Evidence:
- `src/app/admin/reports/page.tsx` provides year-to-date operations trend report.
- `src/app/admin/analytics/page.tsx` provides form item analytics for enabled templates.
- `src/lib/report-analytics.ts` handles yearly trends, top forms, missing time cards, corrective action sources, and field value summaries.

Fix slice:
- Add date-range filters to reports/analytics instead of current year-only.
- Add CSV export for report tables.
- Add drilldowns from analytics buckets to submissions.
- Add print/PDF browser verification using company print settings.

## Priority 10 - Resource Library Offline And Mobile Parity

Gap:
- Resource sections, assignment, ordering, search, mobile panel, and document storage exist.
- Need final parity against screenshot behavior: mobile Resources menu organization, section expand/collapse, ordering UI, offline file availability, and document control behavior for all resource uploads.

Evidence:
- `src/app/admin/documents/page.tsx` handles resource sections and resource assignment.
- `src/app/web/_components/ResourceLibraryPanel.tsx` handles mobile resources.
- `tests/offline-resources.test.ts` covers helper search/sort only.

Fix slice:
- Add browser test for mobile resource browsing and offline opening.
- Add clearer admin reorder controls for sections/resources if not ergonomic.
- Verify controlled resource DCNs appear in mobile resource detail and print/register surfaces.

## Priority 11 - Worker Profile And Certification Compliance

Gap:
- Worker profile and certification pages are much improved, including ticket image previews and worker-side upload.
- The remaining compliance gap is scheduled execution and auditability of certification notifications/deficiencies.

Evidence:
- `src/lib/certification-reminders.ts` builds 30-day worker reminders, 14-day worker/manager reminders, and expired deficiency notifications.
- `src/app/admin/workers/page.tsx` and `src/app/web/page.tsx` call `sendCertificationExpiryNotifications()`.
- No external cron/scheduled job for certifications was found; reminders fire when pages/actions run.

Fix slice:
- Add a scheduled automation/cron endpoint for daily certification reminders if the deployment supports it.
- Record audit events for certification create/update and notification sent.
- Add admin dashboard tile/list for certification deficiencies due now.
- Browser test worker ticket upload from a mobile viewport.

## Priority 12 - Visitor Roster And Emergency Mustering

Gap:
- Visitor sign-in/sign-out exists, but the spec emphasizes a live roster for emergency mustering.
- The current page is an admin log; it may need a focused emergency roster view.

Evidence:
- `src/app/admin/visitors/page.tsx` shows signed-in visitors and sign-out actions.
- It has active counts and duration, but no dedicated muster/print/export mode was found.

Fix slice:
- Add `/admin/visitors/roster` or a roster mode showing workers present by location plus signed-in visitors if worker presence exists.
- Add print/export for active visitors by location.
- Add filters by location/status/date.

## Priority 13 - Access Model And Reach Verification

Gap:
- Access tiers, permission profiles, reach type, and user locations exist.
- Need stronger end-to-end verification that workers/supervisors only see assigned-location data and that permission profiles are enforced consistently across every admin action.

Evidence:
- `src/lib/access-control.ts` and tests cover broad roles.
- RLS tests cover tenant isolation.
- Admin actions use manager-specific guard helpers, but permission profile settings need a thorough matrix review.

Fix slice:
- Create a permission matrix test for each admin action group.
- Add UI hints where a permission profile disables access.
- Verify worker app filters forms/resources/equipment/submissions by assigned locations.

## Priority 14 - Equipment Audit, Verification, And Polish

Gap:
- Equipment is feature-rich now, but final acceptance still needs audit log integration and browser verification.
- The equipment plan explicitly says acceptance criterion 14 is partially blocked by the lack of a general audit log.

Evidence:
- Equipment actions write `action_metadata`.
- `docs/superpowers/plans/2026-05-24-equipment-inventory-files.md` marks general audit as the remaining blocker.

Fix slice:
- After Priority 1, convert equipment `action_metadata` from stopgap evidence into actual audit entries.
- Add browser test for equipment: create unit, set down clears location, upload photos, log meter, create/complete service, upload document, link inspection, verify equipment file.
- Add visual polish pass on mobile equipment panel if forms/resources tabs feel too dense.

## Priority 15 - Production Environment Checklist

Gap:
- Several features depend on env vars or migrations being present in production.
- Need a single checklist so nothing lingers after local code changes.

Checklist:
- Supabase service role key configured for worker invite/import.
- Google Document AI env configured: project, location, processor, credentials JSON/path/base64.
- OpenRouter key configured and model set to Gemini through OpenRouter.
- Email delivery webhook configured if auto-share email delivery is enabled.
- Supabase migrations applied, especially equipment, document control, notification delivery, and action metadata.
- Storage buckets and policies verified for `tenant-documents`.
- PWA assets and `public/sw.js` served in production.

## Suggested Next 10 Commit-Sized Slices

1. Add `tenant_audit_log` migration, types, RLS test, and `recordTenantAuditEvent()` helper.
2. Wire audit events into equipment actions and consultant access actions.
3. Implement real SSO action or make SSO button configuration-aware.
4. Add form item duplicate and section duplicate actions.
5. Add form builder up/down reorder controls for fields and sections.
6. Add a form preview page/panel using worker renderer-compatible data.
7. Add failed offline sync detail UI with per-record retry/remove.
8. Add Playwright setup and one smoke test for admin -> worker form -> monitor print.
9. Add certification reminder cron/route plus admin deficiency dashboard card.
10. Add visitor emergency roster print/export view.

## Quick Commands For The Next Agent

```powershell
git status --short
npm test
npm run build
```

Run focused tests while implementing:

```powershell
npm test -- tests/schema-rls.test.ts
npm test -- tests/equipment-actions.test.ts tests/offline-equipment.test.ts
npm test -- tests/workflow-station.test.ts tests/workflow-reminders.test.ts
npm test -- tests/auto-share.test.ts tests/email-delivery.test.ts
```

