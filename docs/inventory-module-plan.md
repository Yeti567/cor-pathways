# Inventory module: build plan

Status: slices 1 to 3 built. Written 2026-07-23, kept current as it is built.

Inventory ships as a toggleable module, off by default, so a fresh install and every
fork already carry it and turning it on is a switch rather than a build.

## What the module is

One ledger that answers two questions for anything a company counts: **how many, and
where.** The first driving use case is a ground protection mat rental operation (mats
sitting on lease sites, hauled between them by the company's own trucks), but nothing in
the model is mat specific. The same ledger handles rental tools, PPE, consumables, and
parts.

Three independent flags describe any trackable thing, instead of a type hierarchy:

| Flag | Values | Reading |
|---|---|---|
| `tracking_mode` | `bulk` / `serial` | count them, or identify each one |
| `returnable` | true / false | does it come back |
| `billable` | true / false | does time on site cost money |

- Rig mat: bulk, returnable, billable
- Rented generator: serial, returnable, billable
- Hand tool: bulk or serial, returnable, not billable
- PPE, filters, oil: bulk, not returnable, not billable

**Stocking places are polymorphic**, and that is what keeps the module small. Give a
place a kind, and every workflow becomes the same movement:

- yard to yard: a stock transfer
- yard to customer site: a rental out
- yard to worker: a tool check out
- yard to vehicle: truck stock
- yard to job: consumption on a work order
- anywhere to `loss`: damage, shrinkage, write off (virtual)
- anywhere to `transit`: a load that has left but not arrived (virtual)

Four non-negotiable rules, each confirmed against primary vendor documentation:

1. Quantity lives **per location**, never as one company total.
2. A movement is **one row with a source and a destination**, not two counter edits.
3. Stock in flight sits in a **transit location**, so a load in the air is visible.
4. A count correction is entered as **the absolute counted quantity**. The system computes
   the delta and posts it to `loss`. There is no path that rewrites a balance directly.

## How it plugs into what already exists

The app has seven module toggles on `tenants`. Inventory is the eighth,
`inventory_enabled`, wired in the four established places. Verified line references:

| Step | File | Pattern to copy |
|---|---|---|
| 1. Column | `supabase/migrations/…_initial_schema.sql:3415` | `transport_enabled boolean DEFAULT false NOT NULL` |
| 2. Nav | [AdminShell.tsx:34](src/app/admin/_components/AdminShell.tsx#L34), [:56](src/app/admin/_components/AdminShell.tsx#L56), [:93](src/app/admin/_components/AdminShell.tsx#L93), [:112](src/app/admin/_components/AdminShell.tsx#L112) | `TRADES_NAV_HREF` const, nav entry, `tradesEnabled` flag, `.filter()` line |
| 3. Guard | [trades/page.tsx:76](src/app/admin/trades/page.tsx#L76) | `if (!context.tenant?.trades_enabled) redirect("/admin/setup")` |
| 4. Toggle | [setup/page.tsx:744](src/app/admin/setup/page.tsx#L744) + [actions.ts:2443](src/app/admin/actions.ts#L2443) | the Trades on/off card and `updateTradesSetting` |

Worker side gets the same treatment at [web/page.tsx:1264](src/app/web/page.tsx#L1264).

These toggles are **product configuration, not a paywall.** The paywall came out when the
app went open source. A toggle decides whether the module clutters that client's nav.
Nothing more. Do not reintroduce plan gating.

Also reused, not rebuilt:

- **Locations** (`public.locations`) already exist and already carry `tenant_id`,
  `visibility_rule`, and per-worker assignment through `user_locations`. Inventory points
  at them from `inventory_location` rather than copying them, and adds nothing to the
  table itself. See the data model note below for why they stay separate.
- **Offline capture** (`src/lib/offline/`): `db.ts`, `sync-queue.ts`, `background-sync.ts`
  already queue mutations and replay them. A pickup or drop recorded in a dead zone rides
  the existing queue. `src/lib/offline/equipment.ts` is the closest working model to copy.
- **Photos and signatures** through `submission_photos` and `signatures`, the same path
  the form builder already uses.
- **RLS** through the existing `authz.is_tenant_member(tenant_id)` helper, matching the
  policies on `equipment_document` and every other table.
- **Notifications and reminders** for low stock, through the existing machinery.

### Equipment versus Inventory: the boundary, settled

The two must not collide, and the split is:

- **Equipment answers** "what condition is this unit in, and when is it next serviced?"
- **Inventory answers** "how many of these are there, and where are they?"

A serialized inventory item may **optionally link** to an equipment record when that unit
also needs a maintenance life. A rented generator is both: an inventory unit that moves
between sites and an equipment record with service intervals. A rig mat is inventory only.
A company truck is equipment only. One nullable `equipment_id` on the serial unit carries
this. Do not merge the tables.

Note that `public.equipment` already uses the column name `tracking_mode` for something
different (`mileage` / `hours`). Inventory's `tracking_mode` (`bulk` / `serial`) lives on
a different table, so there is no conflict in the database, but name the TypeScript types
distinctly (`InventoryTrackingMode`) so nobody confuses them in code.

## Data model

New tables, all `tenant_id` scoped, all RLS on:

1. **`inventory_item`**: `id, tenant_id, name, sku, category_id, tracking_mode
   ('bulk'|'serial'), unit_of_measure, returnable, billable, default_rate, rate_basis,
   active, equipment_id (nullable), created_at, updated_at, deleted_at`.

2. **`inventory_category`**: grouping and filtering (Mats, Tools, PPE, Parts,
   Consumables). Flat, not a tree. A tree is a later problem if it is ever a problem.

3. **`inventory_location`** (stocking places): `id, tenant_id, kind, location_id,
   equipment_id, user_id, name, active`. Kinds are `yard`, `customer_site`, `vendor`,
   `job` (each backed by a `locations` row), `vehicle` (backed by equipment), `worker`
   (backed by a user), plus the virtual `transit` and `loss`, which are backed by nothing.
   A check constraint allows exactly one backing reference per kind, and none for the
   virtual pair.

   **Corrected during slice 3.** The original plan put a `location_kind` column on the
   existing `locations` table. Building it showed why that is wrong: `locations` is the
   human-facing list of places people go, feeding worker assignment, visitors, equipment,
   incidents, workflows and the worker app across roughly thirty queries, of which only
   six filter anything at all. There is no chokepoint, so "In transit" and "Loss" would
   have appeared in every one of those pickers as though a worker could be assigned to
   them, and preventing that would mean remembering an exclusion in every present and
   future query. This codebase has already been bitten twice by rules that must be
   remembered everywhere. A separate table costs one join and removes the whole class of
   mistake. `locations` is left exactly as it was.

   Making customer sites first-class stocking places is still a deliberate departure from
   how Point of Rental models it (branches only, with customer-held units tracked against
   a contract). It answers "how many are at each site" directly, which is the question a
   rental operator actually asks.

4. **`inventory_movement`** (the ledger): `id, tenant_id, item_id, qty` (always positive),
   `from_location_id, to_location_id, movement_type, occurred_at, transfer_id, ticket_id,
   note, created_by, client_uuid, created_at`.

   **Insert only.** No UPDATE and no DELETE grant to `authenticated`, enforced the same way
   `worker_time_cards` already has DELETE revoked in the baseline schema. Corrections are
   reversing rows. `client_uuid` is unique per tenant and gives offline replay its
   idempotency, so a double sync cannot double count.

5. **`inventory_balance`**: `tenant_id, item_id, location_id, qty`, primary key on the
   triple. Maintained by an `AFTER INSERT` trigger on `inventory_movement`. A derived
   table rather than a view, for query speed and so a check constraint can forbid a
   negative balance at a physical location while allowing it at a virtual one. This is
   Odoo's "quant" pattern: an immutable move log with a materialized balance beside it.

6. **`inventory_transfer`** (the load): `id, tenant_id, equipment_id (the truck),
   driver_id, from_location_id, to_location_id, departed_at, arrived_at, status, note`.
   Departing posts origin to `transit`. Arriving posts `transit` to destination.

   **A leg mismatch (loaded 55, delivered 53) leaves a residual in transit that must be
   explicitly resolved.** That residual is the drift detector. It is a feature, not a bug,
   and the UI must show it rather than quietly balance it.

7. **`inventory_count`** and **`inventory_count_line`**: the user enters the absolute
   counted quantity per (item, location). The system computes the delta and posts an
   adjustment movement to `loss`. Never write a balance directly.

8. **`inventory_reorder_point`**: per item, optionally per location, with a minimum
   quantity that raises a low stock alert through the existing notification path. Mainly
   for consumables and PPE.

## Build order

Each slice ends with the app working, the build green, and a commit. No slice leaves a
half-wired module behind.

**Slice 1: the toggle and the empty module.** DONE.
Migration adding `tenants.inventory_enabled` (default false). Nav entry, page guard, Setup toggle, server action with audit event, and
an `/admin/inventory` landing page describing what is coming, exactly as
`src/app/admin/trades/page.tsx` does today. Nothing tracks anything yet. This proves the
wiring and gives every fork the switch.

**Slice 2: items and categories.** DONE.
Migration for `inventory_item` and `inventory_category` with RLS. Admin list, create, and
edit. The three flags are set here. This is a plain CRUD slice and should be quick.

**Slice 3: stocking places.** DONE.
`inventory_location`, with an admin screen that promotes an existing location, vehicle, or
worker into a place stock can sit. The two virtual places are seeded per tenant when the
module is switched on, not at signup, so a tenant with it off carries none of the
furniture. Seeding inserts only what is missing rather than upserting, because the
uniqueness of the virtual pair is a partial index and Postgres cannot match ON CONFLICT
against one.

**Slice 4: the ledger and balances.** DONE.
Migration for `inventory_movement` and `inventory_balance`, the trigger, the insert only
grants, and the negative balance constraint. A simple "receive stock" and "adjust" admin
screen so quantity can get into the system at all. **Write the tests in this slice**, not
later: this is the piece everything else stands on.

**Slice 5: the on hand view.** DONE.
The screen that pays for the module: a grid of item by location with quantities, filters
by category and location kind, and a drill down into the movement history for any cell.
Read only, and it is the first slice with obvious daily value.

**Slice 6: transfers, the two leg move.** DONE.
`inventory_transfer` plus the depart and arrive actions. Pick a truck, a driver, an
origin, a destination, and the lines. Depart posts to transit. Arrive posts out of it. A
transit ageing view lists loads that departed and never arrived, and any residual from a
leg mismatch.

**Slice 7: field capture.** DONE (core), photos/signature deferred.
The driver's phone. A worker on `/web` records stock moving from one place to another,
which queues offline through the existing `queueOfflineMutation` pipeline and syncs when
signal returns. `client_uuid` on the queued move plus the unique index on
`(tenant_id, client_uuid)` make a replayed sync idempotent: a move posts exactly once
however many times the queue flushes. A new `flushInventoryMovementMutation` handler in
`src/lib/offline/sync.ts` treats the duplicate-key error as success. Pure builders in
`src/lib/offline/inventory.ts` are shared by the panel (to queue) and the sync engine (to
validate), so what the panel accepts is what the ledger accepts.

Deliberately DEFERRED to a follow-on (call it 7b): **photos and a signature as
proof-of-delivery.** Those attach through the `submission_photos` / `signatures` machinery,
which is a separate substantial layer, and the movement capture is the valuable core that
makes the module usable in the field. The natural shape later: a field move optionally
opens a proof-of-delivery form submission carrying the photos and signature, linked to the
movement. Not built yet.

**Slice 8: counts and reconciliation.** DONE.
`inventory_count` is the one place a person states an absolute quantity; everywhere else a
quantity is only moved. It keeps that promise by not writing the balance either: it reads
what the books say, takes the counted number, and posts the difference as an ordinary
`adjustment` movement (a shortage out to the virtual loss place, a windfall pulled back
from it). The balance then falls out of the ledger as always, and the loss place becomes
the running record of shrinkage. Two rows land, the adjustment movement and the count
record, so they are written together inside `record_inventory_count`, a SECURITY INVOKER
function that runs as the caller (every write checked by the caller's own row security)
and in one transaction, so neither an unexplained adjustment nor a dangling count can be
left behind. The count row keeps the absolute counted and expected figures the delta alone
throws away, pinned by a check (`delta = counted_qty - expected_qty`) and by
`(delta = 0) = (movement_id is null)`. The pure `buildInventoryCountPlan` in
`src/lib/inventory-count.ts` mirrors the same arithmetic for the form's live preview and
the unit tests. `/admin/inventory/counts` carries the entry form (with a live "the books
say" and delta preview), a recent-counts table, and the variance report: what has
accumulated in the loss place, per item, so it is reviewable rather than a black hole.
On hand gained a "Count this" link from each real-place drill-down. No new balance write
path: the movement moves the balance, exactly as slice 4 guaranteed.

**Slice 9: reorder points and low stock alerts.** DONE.
One nullable `reorder_point` on an item: the level at or below which someone should
reorder before running out. Null means the item is not watched, the sensible default for
rental units. The alert needs no schema of its own, it is derived: on-hand across the real
places (transit and loss excluded, told apart by `allows_negative`) is summed from
`inventory_balance` and compared to the reorder point, so it is always current and never a
stored flag that drifts. The pure `summariseInventoryStockLevels` in
`src/lib/inventory-stock-levels.ts` is shared by the screens and the notifier, so the badge
and the alert can never disagree. `src/lib/inventory-reminders.ts` builds low-stock
notifications through the very same machinery equipment service reminders use (manager and
admin recipients, deduped by recipient+title+body so a steady shortage does not nag, and a
worsening one is announced again), raised on the inventory landing and the admin dashboard.
The reorder point is set on the items form; low stock is shown as a banner on the inventory
landing and on On hand. The `Low Stock Alerts` module card is now Ready.

**Slice 10 (deferred until asked): billing from the ledger.**
An interval series per (customer, site, item): quantity, start, end. Charge is the sum of
quantity times days times rate. A partial pickup shortens one interval and opens a smaller
one, so partial return billing falls out of the model for free rather than being special
cased. Rate ladders and retroactive re-rating stay out until a client's pricing genuinely
tiers.

**Admin side only**, per the standing rule that field workers never see pricing.

## Tests to add

`tests/schema-rls.test.ts` asserts invariants per table and must gain the new ones (RLS
enabled plus a tenant policy for each of the eight tables). Beyond that:

- **`tests/inventory-ledger.test.ts`**: a movement updates both balances; balance equals
  the sum of movements; a physical location cannot go negative; a virtual one can.
- **`tests/inventory-transfer.test.ts`**: depart and arrive post the right legs; a leg
  mismatch leaves the residual in transit and does not silently vanish.
- **`tests/inventory-count.test.ts`**: an absolute count posts the correct delta, in both
  directions, and a count equal to the current balance posts nothing.
- **`tests/offline-inventory.test.ts`**: a replayed mutation with the same `client_uuid`
  does not double post.
- **`tests/inventory-toggle.test.ts`**: with the module off, the nav entry is absent and
  a direct route hit redirects to Setup.

The ledger tests are the ones that matter. Everything else in the module is a view over
them, so if the ledger is right the rest is cosmetics, and if the ledger is wrong nothing
above it can be trusted.

## Explicitly out of scope for v1

Named so they do not creep in: per serial unit history and lifecycle, retroactive rate
ladders with automated credit lines, cross branch overbooking reports, sub rental,
perpetual inventory valuation with GL postings, barcode / QR / RFID tagging, and condition
grading on return. Every one of these is a real feature. None is needed to answer "how
many mats are at Site 7."

## Open questions

Nothing here blocks slices 1 through 5. These need an answer from a real operator before
slices 6 and 10 are worth building:

1. **How many units per load, and of what type?** Decides whether a load is one number or
   a short list of item lines.
2. **What is the real billing basis?** Per unit per day, per load, or monthly with a
   minimum. The rate ladder machinery is only worth building if pricing genuinely tiers.
3. **How is damage and loss handled today?** Chargebacks, condition grading, write offs.
   Unresearched, and any rental operator hits it within a month of going live.
