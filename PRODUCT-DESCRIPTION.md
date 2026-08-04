# Cor Pathways Operations Platform
## Product Description and Source of Truth

This document is the single source of truth for what the product is, who it serves, and what it must do.

---

## 1. What This Product Is

Cor Pathways Operations is a multi-tenant, offline-first, mobile-first electronic forms and operations platform for industrial and trades companies. It digitizes the paper and clipboard processes that run a job site: site inspections, equipment inspections, time cards, mileage logs, material ordering, training records, hazard assessments, incident reports, and any other form a company runs on.

It is sold as a SaaS product. Each client company gets its own isolated tenant.

---

## 2. Positioning (Deliberate and Important)

This product is intentionally NOT branded or sold as a safety app or a COR certification app.

The reason is commercial. Companies that do not want COR certification dismiss anything labelled a "safety app" as not for them. Real prospects have said this directly about the existing Cor Pathways safety product. Cor Pathways Operations is for any company that wants to replace paper forms, regardless of whether safety is the reason.

The platform handles safety forms well (hazard assessments, inspections, incident reports), but safety is one capability among many, not the headline. A company can use it purely to track vehicle mileage, run time cards, or manage material ordering for projects and never touch a safety form. The product must read as an operations tool first.

This is a standalone product. It has its own repository and its own Supabase project. It is walled off from the existing Cor Pathways safety platform. There is no shared codebase, no shared database, and no data flow between the two products in v1.

---

## 3. Who Uses It

Access is built on two independent dimensions: power level (what you can do) and reach (what you can touch). The same power level becomes a different real-world role depending on reach.

### Power levels (top to bottom)

1. **Consultant.** Cor Pathways staff, above all tenants. See Section 4.
2. **Super Admin.** Top of a single tenant. The only role that can remove Admins. Role and permission management plus full admin and app access.
3. **Admin.** Admin panel plus app access. Manages forms, workers, locations, resources, and configuration.
4. **Manager.** Admin-level capability scoped by reach. A manager assigned to one project is a project manager; the same role assigned to all projects is a general manager.
5. **Supervisor.** Fills training forms, runs worker engagement, reviews and signs off on submissions, assigns and tracks corrective actions.
6. **Worker.** Fills assigned forms (site inspections, equipment inspections, hours, and similar), signs, captures photos, completes assigned corrective actions.

### Reach

Reach is assigned per user, independent of power level: all projects in the tenant, or specific projects only. Reach is what creates the project-manager versus general-manager distinction without adding extra roles to the list. Workers and supervisors are scoped to the locations or projects they are assigned to, and they only see forms and data for those.

### Permission Profiles

On top of the fixed power tiers, tenants can create and customize their own Permission Profiles: App Admin, App Supervisor, Worker (Solo), and Worker (Team), each tied to a permission type. A tenant can define profiles that match their own org structure. Fixed power tiers set the ceiling; custom profiles tune what a user can do within that ceiling.

### Visitor (presence record, not a permissioned user)

A visitor is not a user account and has no form permissions. A visitor is a presence record that replaces the paper sign-in sheet. Ministry of Labour inspectors, COR auditors, and suppliers sign in so the site has a live roster of who is present, which matters for emergency mustering. The visitor record captures who they are, why they are on site, and when they signed in and out.

---

## 4. Consultant Access and the Override (Governance-Critical)

The Consultant is Cor Pathways (the operator of the platform). The Consultant has access to every tenant by default, in order to update portals, repair broken configuration or code, and clean up a portal for a new user after a client leaves.

Every consultant login and every consultant action is logged and visible to the tenant's Super Admin. Consultant access is never silent.

Each tenant has a switch to revoke consultant access. When a tenant revokes it, the Consultant cannot enter under normal conditions.

The Consultant can override a revocation only under three defined conditions:

1. A court order.
2. A Ministry of Labour order.
3. The tenant account has been dormant for 90 days.

Every override is logged with its reason, is timestamped, and is surfaced to the tenant. The override is a higher tier of the same audit trail that covers all consultant access. This protects the client (they control access), protects the Consultant (a defensible audit trail of exactly what was touched and when), and is table stakes for selling to governance-minded buyers.

---

## 5. Core Capabilities

### 5.1 Form Builder

A section-based builder. A form contains sections; each section contains items (fields). Sections can be marked Collapsible and Repeatable. Forms indicate required fields. Every form renders mobile-first, then tablet, then desktop.

Field types (the full palette):

- Pass / Fail / NA
- Check Box
- Short Answer
- Long Answer
- Text Info Block (static instructional text, no input)
- Drop-down List: Select One
- Drop-down List: Select Multiple
- Yes / No / NA
- Pass / Fail Total (tallies pass and fail counts)
- Number Only
- Select Date
- Select Time
- Select Worker
- Select Multiple Workers
- View Image
- Add GPS Coordinates
- Insert PDFs
- View PDF

Every form item must be flaggable (see Workflow Station, Section 5.6). A flag opens an assignment and a camera or photo capture.

Per-form settings (from the form templates screen): App Menu Visibility (in menu or not), Private flag, Allow Duplicates, and Use Form Item Data In Analytics. When a new form is created, the creator chooses Standard Form or Private Form. Standard: all workers can fill it and view signed copies. Private: all workers can fill it, but signed copies are viewable only on the device they were signed on or from the Admin Panel.

### 5.2 List Manager (reusable dropdown lists)

A tenant-level library of named, reusable lists that populate dropdown fields across forms. Examples shown: certification type, condition, contractor rating, control effectiveness, control implementation, corrective action types, days of week, equipment type, hazards, hierarchy level, inspection type, inspection severity level, and many more. Each list supports an "Include Other" option and tracks how many forms currently use it. Lists are created and edited independently of forms, then referenced by dropdown fields.

### 5.3 PDF-to-Form Mapping

A client uploads a blank PDF form. The system detects field types and field names and auto-builds most of the form. The user fixes any fields that were missed in the builder.

Detection uses Google Document AI for field detection plus Gemini through OpenRouter for field-schema extraction. Templates are blank, so the job is field type and field name only. No body-text extraction.

### 5.4 Document Control (toggle per tenant)

A module that can be turned on or off per tenant. When enabled, every document created in the system and every PDF uploaded to the resource library is assigned a Document Control Number (DCN), and the system maintains a register that tracks each document and its revision history.

The DCN format is coded by form and location, for example `ACME-VEHICLEINSP-S...`, `ACME-DHA-RIVERSIDE...`, `ACME-DSR-FAIRVIEW-...`, `ACME-INR-RIVERSIDE...`. The register tracks document identity, version, and changes over time. When the module is disabled, the platform runs normally without control numbers.

### 5.5 Resource Library

A sectioned document library (manuals, signed policies, signed procedures, safe work practices, company rules, toolbox talks, acts and regulations, orientation documents, SDS, and similar). Sections are reorderable. Resources are viewable in the mobile app under a Resources menu. When Document Control is enabled, uploaded resources receive DCNs.

### 5.6 Workflow Station (Automation Engine)

The Workflow Station is a built-in automation engine. It has three capabilities. In v1, workflows are configured through a structured, form-based step builder (a step list), not a visual drag-the-nodes canvas. The visual canvas is deferred to a later phase.

**A. Form completion triggers next forms, branched by field answers.**

When a form is completed, the workflow can advance to the next form or forms in a sequence. Branch logic lives inside the form as specific questions. The answers decide whether the workflow advances, which branch it takes, or whether it stops.

Worked example (incident on a job site):
1. Worker fills the First Aid form.
2. On completion, the system tells them to fill a WSIB or WCB injury form and an Incident Report.
3. Inside the Incident Report, questions such as "Was the worker transported to hospital?" and "Was the worker admitted to hospital?" drive the branch. If admitted is Yes, the incident has crossed the reporting threshold, so the system immediately requires a Ministry of Labour form and routes it to the ministry. If admitted is No, that branch stops.

Workflow conditions read a named field's value from a form in the sequence (the engine watches a specific field on a specific form and branches on its value).

**B. Flag and assign loop (corrective actions tracked to sign-off).**

Inside a form (for example a site inspection), any item can be flagged. Flagging an item lets the user:
- assign the fix to a specific worker,
- attach a photo taken on the spot so everyone knows exactly what is being referred to (photo capture works offline and syncs like everything else),
- spawn a separate corrective-action follow-up.

The parent form (the inspection) is completed and signed, but each flagged item lives on as its own tracked follow-up with its own lifecycle: open, assigned, in progress, completed, signed off. The assigned worker is notified in-app and sees the item in a personal "assigned to me / outstanding" list. The person who flagged it tracks it through to sign-off in their own view. This maps onto the Follow-up Templates shown (Corrective Action, Equipment/Tool Request, Maintenance Request).

**C. Time-triggered scheduling with reminders and overdue tracking.**

A schedule fires and the system assigns the right form to the right person and reminds them it is due. Examples: monthly site inspection, monthly office inspection, hourly checks, employee hours every second Thursday. The system tracks what is due, reminds the assignee, and flags or escalates anything scheduled that was not completed. There must be a clear "what is due and what is overdue" view.

Because branching reads submitted form data, the Workflow Station is built after the forms and submissions engine exists. It sits on top of forms, submissions, follow-ups, and notifications.

### 5.7 Monitor, Reports, and Analytics

The Monitor is the live feed of submitted forms grouped by day, with date-range filters and a per-submission signature count. It is what managers and owners watch. Reports and Analytics summarize submitted form data; forms flagged "Use Form Item Data In Analytics" feed the analytics layer.

### 5.8 Workers, Locations, Certifications

- **Workers:** the master admin grid. Columns shown: name, title, access tier, app permission, locations count, certifications count, mobile number. Locations and certifications are assignable inline. (Chat is excluded from this product, see Section 6.)
- **Locations (projects/sites):** the core organizing unit. Each location has visibility rules (for example "Only Workers Assigned"), assigned workers, and a start date. Reach assignments scope users to locations.
- **Certifications:** a full per-worker certification module with active and expiry tracking, attachments, grid and list views, and an "Add Certification" action. A tenant-level Certification Types library backs it.

### 5.9 Employee Profiles

Per-worker profile: name, job title, photo, contact details, employment details (employee number, date hired), and emergency contacts. Tabs shown: Profile, App Access, Certifications, Current Locations, Signed Documents.

### 5.10 Company Settings and Print Settings

- **Company Info:** company name, address, phone, timezone, and logo, plus a company ID.
- **Print Settings (Form Header):** choose how company information appears on completed and printed forms. Three options shown: Company Info Only, Company Info and Logo, Logo Only. Logo upload with left or right placement.
- **Integrations:** an integrations section exists in settings.

### 5.11 Auto-Share

Per-location and all-locations auto-share: completed forms are automatically sent to defined recipients (by name and type). This is a simpler sibling of the Workflow Station and feeds the same notification layer.

### 5.12 Offline-First with Background Sync

Non-negotiable architectural foundation, not an enhancement. Every form-filling action, signature, photo capture, resource view, and submission works fully offline and syncs silently when connectivity returns. Target users work in remote industrial environments (oilfields, construction sites, pipelines, mines) where signal is absent for hours or days. Per-user offline data storage duration is configurable, defaulting to one month.

### 5.13 Authentication

Email-first login, with an optional SSO provider of the operator's choosing. Account creation and password entry are performed by the user, never on the user's behalf.

---

## 6. Explicitly Out of Scope for v1

- **Worker chat / in-app messaging.** Out of scope. No Chat Permission column, no per-location chat toggle, no Chat profiles, no messaging UI.
- **Visual drag-the-nodes workflow canvas.** The Workflow Station ships with a form-based step builder in v1. The visual canvas is a later phase.
- **Data flow between this product and the Cor Pathways safety platform.** Walled off in v1.

---

## 7. Architecture (Locked)

- Standalone product. Own repository, own Supabase project.
- Next.js application.
- Supabase backend with strict per-tenant row-level isolation (Row Level Security on every tenant-scoped table).
- Offline storage and sync following the safety platform's proven approach: IndexedDB via Dexie for local storage, a service worker for sync, background sync on reconnect.
- Prefer established, well-maintained libraries over custom code wherever sensible.
- Google Document AI plus Gemini through OpenRouter for the PDF-to-form pipeline.

---

## 8. Build Order (Summary)

The order the platform was built in, kept as a map of how the pieces depend on each
other:

0. Foundation: stack, repo, env, Supabase project, multi-tenant schema spine, RLS.
1. Auth, tenants, the seven-tier access model, custom permission profiles, consultant access and override with audit logging.
2. Workers, locations (projects/sites), reach assignment, employee profiles, certifications and certification types, visitor sign-in.
3. List Manager.
4. Form builder (sections, items, all field types, required fields, Standard vs Private, per-form settings).
5. Form renderer and submission flow, signatures, photo capture, fully offline with background sync.
6. PDF-to-form mapping pipeline.
7. Resource library and Document Control module (DCN assignment and register).
8. Monitor, Reports, Analytics.
9. Auto-Share and notifications.
10. Workflow Station (sequence chains with field-driven branching, flag-and-assign corrective-action loop, time-triggered scheduling with reminders and overdue tracking).
11. Company Settings and Print Settings.

Offline-first is built into every stage from Stage 5 onward, not bolted on at the end.
