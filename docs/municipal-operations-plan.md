# Municipal operations: build plan

Status: slice 0 (tenant RLS coverage) done. Slices 1 to 3 in progress. Written 2026-10-22,
kept current as it is built.

## Why this exists

Cor Pathway 360 is being offered to municipalities as everything outside the finance
office: safety, inspections, fleet and equipment maintenance, work orders and purchasing.
Most of that already exists for contractors. This plan covers what a town's public works
yard expects and the app does not yet do.

The gap list was built by reading the public product pages and public help centres of ten
established municipal operations products (October 2026) and comparing what they describe
with what this repository already does. Nothing was copied: the requirements below are
written from the behaviour those products describe, and the design is our own. Finance
(accounting, general ledger posting, payables, billing, tax) stays out of scope on
purpose. Towns already own a finance system, and this app hands it clean exports instead
of competing with it.

Every module below ships the way inventory did: **a tenant toggle, off by default**, so a
fresh install and every fork carry the code and turning it on is a switch, not a build.
A trucking tenant never sees any of it unless someone turns it on.

## What already exists and is reused

| Need | Already built | Where |
|---|---|---|
| Forms, offline fill, photos, GPS, signatures | Forms engine and the offline PWA | `src/lib/form-templates.ts`, `src/lib/offline/*` |
| A failed item becomes an action | Corrective actions (`follow_ups`), automatic for failed equipment inspection items, major defect sets the unit out of service | `src/lib/offline/follow-ups.ts`, `src/lib/pre-trip-sync.ts` |
| Recurring inspections | `schedules` and `scheduled_tasks` | `src/lib/workflow-station.ts` |
| Assets with meters and service intervals | `equipment`, meter log, maintenance log, scheduled service by date or meter | `src/lib/equipment*.ts` |
| Stock, places, movements | Inventory ledger, places of kind `vendor`, reorder points | `docs/inventory-module-plan.md` |
| Approvals | Change orders, document control, follow-up sign-off | `change_order_approval`, `admin/documents` |
| Work order shape | Trades work orders (lines, materials, time, tasks, notes, sign-off), customer facing | `trade_work_order*` |
| Reminders | Daily cron, in-app notifications, Resend email | `vercel.json`, `src/app/api/cron/*` |

## The gaps, ranked

| # | Gap | Priority | How common | Module flag |
|---|---|---|---|---|
| 1 | Internal maintenance work orders | P1 | 10 of 10 | `maintenance_enabled` |
| 2 | Purchase requests and orders | P1 | 7 of 10 (4 with a full flow) | `purchasing_enabled` |
| 3 | Inspection deficiency loop and municipal starter forms | P1 | 6 to 8 of 10 | rides on `maintenance_enabled` |
| 4 | Suppliers and inventory costing | P2 | 5 to 8 of 10 | ships with purchasing |
| 5 | Service requests with a public page | P2 | 9 of 10 | `service_requests_enabled` |
| 6 | Non-vehicle assets with a condition rating | P2 | 6 to 9 of 10 | extends equipment |
| 7 | Map view | P3 | 9 of 10 | none (reads existing GPS) |
| 8 | Fuel log and warranty | P3 | 2 to 4 of 10 | extends equipment |

Out of scope: permits, licensing and code enforcement, and facility booking. They are
common, but they serve the clerk's office, not the yard.

## Slice 1: purchasing (gaps 2 and 4)

**One record is both the request and the order.** It moves through statuses; there is no
separate requisition object to keep in step.

### Data model

- `supplier`: name, contact name, phone, email, address, our account number, terms notes,
  categories (text array), active, notes. Documents reuse the existing document pattern.
- `supplier_item`: supplier, inventory item, supplier part number, pack size, lead time
  days, last unit cost, preferred flag. One preferred supplier per item.
- `inventory_item` gains `unit_cost` (last received cost) and `reorder_qty`.
- `purchase_order`: auto number per tenant (`PO-000123`), title, status, requester,
  location (department or yard), supplier, account code (text, stored for export only),
  linked work order (nullable, wired in slice 2), needed by, ship-to place
  (inventory location), notes, emergency flag, discount, shipping, tax, subtotal, total,
  a timestamp per status change, `exported_at`.
- `purchase_order_line`: kind (`stock`, `non_stock`, `work_order_part`), inventory item
  (for stock), description, unit, quantity ordered, quantity received, unit cost, line
  total, account code override.
- `purchase_approval_rule`: name, threshold amount, approver users, style (`band` or
  `sequential`), level, active, optional location.
- `purchase_order_event`: the audit and approval trail: who, when, action
  (submitted, approved, rejected, ordered, received, closed, cancelled, reopened),
  rule applied, reason.
- `purchase_receipt` and `purchase_receipt_line`: received date, receiver, packing slip,
  invoice reference, per-line quantity, the place it was received into, and the
  inventory movement it posted.

Every table: `tenant_id`, row level security, the four `is_tenant_member` policies, grants.
`tests/schema-rls.test.ts` now finds tenant tables on its own, so nothing has to be added
to a list.

### Rules

- **Status ladder:** draft, pending approval, rejected, approved, ordered, partially
  received, received, closed, cancelled. Rejected returns to editable. Lines are editable
  only in draft, pending approval (approver only) and rejected.
- **Approval:** the order total picks the rule. In `band` style the highest band at or
  under the total decides and one approver from it is enough; an approver of a higher band
  may approve a lower one. In `sequential` style every level up to the matching one
  approves in order. Below the lowest threshold an order auto-approves when the tenant
  allows it. The requester never approves their own order. One rejection rejects, with a
  reason when the tenant requires one. An emergency order may be placed first and approved
  after, and is marked as such in the trail.
- **Ordered** can be undone until anything is received.
- **Receiving:** quantity per line with a fill-all shortcut. A partial receipt leaves the
  order open and shows the remainder as backordered. A stock line posts a movement from
  the supplier's `vendor` place into the chosen place through the existing ledger, and sets
  the item's `unit_cost`. A non-stock line can land on a work order. Over-receipt is
  refused on the line; it goes on a separate line. Costs lock once received; the order
  locks at close and only an admin reopens it, with a reason.
- **Finance export, never posting:** CSV of orders and lines with account codes, filtered
  by date, supplier and location; exporting stamps `exported_at`. Invoice matching stays in
  the town's finance system; we keep the invoice reference and the document.

### Screens

`/admin/purchasing` (list with status tabs and an "awaiting my approval" queue),
`/admin/purchasing/new`, `/admin/purchasing/[id]` (header, lines, approve or reject,
order, receive, close, trail), `/admin/purchasing/suppliers`, `/admin/purchasing/rules`,
`/admin/purchasing/export`. Toggle on `/admin/setup`. Nav entry hidden when off.

## Slice 2: maintenance work orders (gap 1)

Internal work orders for the tenant's own assets, separate from the trades module's
customer jobs, which carry a customer and feed invoices.

### Data model

- `maintenance_work_order`: auto number (`WO-000123`), title, description, equipment
  (nullable), location, type (`corrective`, `preventive`, `inspection`, `project`),
  priority (`urgent`, `high`, `normal`, `low`), status, source (`manual`, `follow_up`,
  `scheduled_service`, `service_request`, `inspection`) with the source id, requester,
  assignee, scheduled start, due date, meter at completion, completion notes, closed by,
  closed at, cost roll-up columns (labour, parts, vendor, other, total).
- `maintenance_work_order_task`: checklist rows with done flag and who did them.
- `maintenance_work_order_labour`: worker, date, hours, rate, cost.
- `maintenance_work_order_part`: inventory item or free text, quantity, unit cost, the
  inventory movement it posted (issue to the job), `to_order` flag that a purchase line
  can pick up.
- `maintenance_work_order_cost`: outside vendor work and other costs (supplier,
  reference, amount).
- `maintenance_work_order_note`: a notes thread.

### Rules

- **Statuses:** requested, approved, assigned, in progress, on hold, completed, closed,
  cancelled. Completion needs notes, and a meter reading when the asset is metered; that
  reading goes to the meter log. Closing writes a row to the equipment maintenance log so
  the asset's history stays in one place, and locks the costs.
- **Parts:** issuing a stock part posts a movement out of the chosen place through the
  ledger at the item's `unit_cost`; removing it posts the return. A part marked
  `to_order` can be pulled onto a purchase order; receiving that line lands on this work
  order.
- **Sources:** a corrective action (`follow_up`) gets a "Create work order" button and the
  work order links back; completing the work order completes the action. A scheduled
  service that comes due generates a preventive work order, unless one is already open
  for it, and completing it advances the service from the completion date or meter.
- **No duplicates:** an open work order for the same asset and source is reused, not
  doubled.

### Screens

`/admin/maintenance` (board by status, filters by asset, type, assignee, overdue),
`/admin/maintenance/new`, `/admin/maintenance/[id]`, and a Work orders tab on the
equipment detail page with cost to date. Workers see their assigned work orders in the
worker app and can log time, parts and completion offline.

## Slice 3: inspection deficiency loop and municipal starter forms (gap 3)

- **Severity per item:** `settings.severity` on a flaggable item: `critical`, `major`,
  `minor`. Critical keeps the existing out-of-service behaviour and notifies at once. Each
  level maps to a default work order priority (urgent, high, normal).
- **Failure to work order:** with maintenance on, a failed item raises its corrective
  action exactly as now and, when the form says so (`settings.autoWorkOrder`, default on
  for municipal forms), a work order linked to it. One open work order per item and asset.
- **Re-inspection:** the next submission of the same form for the same asset lists the
  open deficiencies for that asset so the inspector can confirm the repair.
- **Starter forms** in `templates/forms/municipal/*.json`, in the format
  `scripts/apply-form-definition.ts` reads, installed per tenant with the new `--create`
  and `--tenant` options. Written in our own words, editable, and **not certified**:
  each playground form names the Canadian playground standard and tells the town to check
  its own inspection programme against it. Forms: playground (routine visual), playground
  (monthly operational), facility safety, light vehicle pre-use, heavy equipment pre-use,
  sidewalk and trail, hydrant.

## Later slices

- **Slice 4, service requests (gap 5):** a public, unauthenticated page per tenant
  (category, description, location or map pin, photos, optional contact) with a tracking
  number and status page, spam protection, staff triage, convert to work order, and a QR
  code per asset that opens a prefilled request. Needs its own security review: it is the
  first anonymous write path in the app.
- **Slice 5, non-vehicle assets (gap 6):** equipment categories for building, playground,
  sports field, trail, sign, hydrant, culvert; install date, expected life, replacement
  cost, parent asset; a condition score (1 to 5 with descriptors) set from inspections;
  a replacement planning list by condition.
- **Slice 6, map (gap 7):** pins for assets, open requests and work orders from stored GPS,
  filtered by type and status, clicking through to the record.
- **Slice 7, fleet extras (gap 8):** fuel entries with efficiency and a CSV upload, and
  warranty dates or meter limits flagged on work orders.
- **Reminder reliability:** equipment and stock reminders are computed on page load today.
  Move due service, overdue inspections and overdue work orders onto the daily cron.

## Tests to add (each slice)

- Pure functions with unit tests: approval rule matching (band and sequential, self
  approval refused, auto-approve limit), the purchase and work order status machines,
  receipt arithmetic (partial, backorder, over-receipt refused), cost roll-up, preventive
  next-due calculation, duplicate detection.
- Schema: RLS coverage is automatic; add a test that each new table's toggle hides its
  nav entry and that pages redirect when the module is off.
- Form definitions: every starter form parses, uses only known field types, has unique
  labels, switches off evidence photos, and carries no tenant id.

## Explicitly out of scope

General ledger posting, payables, three-way invoice matching, tax calculation, billing,
permits and licensing, facility booking.
