# Equipment Inventory And Files Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-scoped equipment inventory and equipment files that track identity, meter history, service, documents, assignments, and linked inspections.

**Architecture:** Reuse the existing Supabase tenant isolation pattern, existing `locations` table, existing offline cache queue, existing form submissions, and existing admin shell. Build the equipment module as additive tables and focused helpers first, then add admin read/write screens, then wire the mobile form selector and submission linking.

**Tech Stack:** Next.js App Router, TypeScript, Supabase Postgres with RLS, Dexie offline cache, Tailwind CSS, Vitest.

---

## File Map

- Create: `supabase/migrations/20260524031851_equipment_inventory.sql`, adds equipment tables, indexes, triggers, RLS, and down-unit location enforcement.
- Modify: `src/types/database.ts`, adds equipment tables to `TenantScopedTable` and typed table rows.
- Create: `src/lib/equipment.ts`, owns category/status labels, service indicator logic, meter formatting, and completion math.
- Create: `tests/equipment.test.ts`, tests service indicator, document expiry, recurrence advancement, and status coercion.
- Modify: `tests/schema-rls.test.ts`, verifies equipment tables are covered by migrations and RLS policies.
- Modify: `src/lib/offline/db.ts`, includes equipment tables through `TenantScopedTable` and bumps Dexie when dedicated equipment queries need indexes.
- Modify: `src/app/admin/_components/AdminShell.tsx`, adds an Equipment nav item.
- Create: `src/app/admin/equipment/page.tsx`, inventory list and add-equipment form.
- Create: `src/app/admin/equipment/[equipmentId]/page.tsx`, equipment file with overview, schedule, maintenance, meter, documents, and linked forms tabs.
- Modify: `src/app/admin/actions.ts`, adds server actions for equipment create/update, meter logging, maintenance logging, scheduled service create/complete, document create, and manual submission link/unlink.
- Modify: `src/lib/offline/form-model.ts`, supports the equipment selector field settings.
- Modify: `src/lib/form-templates.ts`, adds `equipment_select` to the field palette.
- Modify: `src/app/web/_components/AssignedFormsPanel.tsx`, renders the equipment picker and queues equipment link metadata offline.
- Modify: `src/lib/offline/forms.ts` and `src/lib/offline/sync.ts`, includes equipment links, meter logs, and maintenance or document mutations in offline sync.

## Milestone Breakdown

### M-EQ-1: Data Layer And Shared Logic

**Files:**
- Create: `supabase/migrations/20260524031851_equipment_inventory.sql`
- Modify: `src/types/database.ts`
- Create: `src/lib/equipment.ts`
- Create: `tests/equipment.test.ts`
- Modify: `tests/schema-rls.test.ts`

- [ ] **Step 1: Add failing schema tests**

Add the equipment tables to `tenantScopedTables` and make the test read every migration:

```ts
const migrationFiles = [
  "0001_foundation.sql",
  "20260524031851_equipment_inventory.sql",
];
const allMigrations = migrationFiles.map((file) => readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8")).join("\n");
```

Expected tables:

```ts
"equipment",
"equipment_meter_log",
"equipment_maintenance_log",
"equipment_scheduled_service",
"equipment_submission_link",
"equipment_document",
```

Run: `npm test -- tests/schema-rls.test.ts`

Expected: fails until the migration exists and the type union includes the tables.

- [ ] **Step 2: Add equipment helper tests**

Create `tests/equipment.test.ts` with cases for:

```ts
expect(coerceEquipmentStatus("sold")).toBe("sold");
expect(coerceEquipmentStatus("bad")).toBe("active");
expect(formatEquipmentMeter({ trackingMode: "hours", value: 125.5 })).toBe("125.5 hours");
expect(getEquipmentDocumentStatus({ expiryDate: "2026-06-20", reminderLeadDays: 30 }, new Date("2026-05-24T12:00:00Z")).state).toBe("due_soon");
expect(getEquipmentServiceIndicator({ currentMeter: 9000, documents: [], scheduledServices: [{ dueMeter: 8500, dueDate: null, intervalMode: "by_meter", isActive: true }] }, new Date("2026-05-24T12:00:00Z")).state).toBe("overdue");
```

Run: `npm test -- tests/equipment.test.ts`

Expected: fails because `src/lib/equipment.ts` does not exist.

- [ ] **Step 3: Create the migration**

Create the six tables. Reuse `locations`; do not create `equipment_location`.

Key SQL:

```sql
create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  unit_number text not null,
  name text,
  category text not null default 'other' check (category in ('vehicle', 'mobile_equipment', 'trailer', 'generator', 'compressor', 'light_tower', 'tool', 'other')),
  make text,
  model text,
  year integer,
  vin_or_serial text,
  license_plate text,
  tracking_mode text not null check (tracking_mode in ('mileage', 'hours')),
  current_meter numeric,
  status text not null default 'active' check (status in ('active', 'down', 'retired', 'sold')),
  assigned_to uuid references public.users(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  purchase_date date,
  notes text,
  photo_ids uuid[] not null default '{}',
  created_by uuid references public.users(id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, unit_number),
  check (status <> 'down' or location_id is null)
);
```

Add child tables for meter log, maintenance log, scheduled service, submission link, and document.

Add triggers:

```sql
create or replace function public.enforce_equipment_rules()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'down' then
    new.location_id = null;
  end if;
  return new;
end;
$$;
```

Add a child tenant trigger that raises when `equipment_id` belongs to a different tenant. Add an after trigger on `equipment_meter_log` that recomputes `equipment.current_meter` from the newest reading.

Run: `npm test -- tests/schema-rls.test.ts`

Expected: table coverage test passes.

- [ ] **Step 4: Update TypeScript database types**

Add the six tables to `TenantScopedTable` and add typed row definitions. Keep insert/update style consistent with current table definitions:

```ts
equipment: {
  Row: TenantScopedRow & {
    unit_number: string;
    name: string | null;
    category: string;
    tracking_mode: "mileage" | "hours";
    current_meter: number | null;
    status: "active" | "down" | "retired" | "sold";
    assigned_to: string | null;
    location_id: string | null;
    deleted_at: string | null;
  };
  Insert: Partial<Database["public"]["Tables"]["equipment"]["Row"]> & Pick<Database["public"]["Tables"]["equipment"]["Row"], "tenant_id" | "unit_number" | "tracking_mode">;
  Update: Partial<Database["public"]["Tables"]["equipment"]["Row"]>;
  Relationships: [];
};
```

Run: `npm test -- tests/schema-rls.test.ts tests/offline-db.test.ts`

Expected: passes.

- [ ] **Step 5: Add shared equipment logic**

Create `src/lib/equipment.ts` with:

```ts
export const equipmentCategoryOptions = [...];
export const equipmentStatusOptions = [...];
export const equipmentTrackingModeOptions = [...];
export function coerceEquipmentStatus(value: string): EquipmentStatus;
export function formatEquipmentMeter(input: { trackingMode: EquipmentTrackingMode; value: number | null | undefined }): string;
export function getEquipmentDocumentStatus(document, now): EquipmentDueStatus;
export function getEquipmentScheduleStatus(service, currentMeter, now): EquipmentDueStatus;
export function getEquipmentServiceIndicator(input, now): EquipmentDueStatus;
export function advanceScheduledService(input): { dueDate: string | null; dueMeter: number | null };
```

Run: `npm test -- tests/equipment.test.ts`

Expected: passes.

### M-EQ-2: Inventory List, Read-Only Equipment File, And Navigation

**Files:**
- Modify: `src/app/admin/_components/AdminShell.tsx`
- Create: `src/app/admin/equipment/page.tsx`
- Create: `src/app/admin/equipment/[equipmentId]/page.tsx`
- Create: `tests/equipment-page-data.test.ts`

- [ ] **Step 1: Add admin nav entry**

Add `{ href: "/admin/equipment", label: "Equipment", icon: Truck }` after Follow-ups or Locations.

- [ ] **Step 2: Build inventory query and page**

Query `equipment`, `locations`, `users`, `equipment_scheduled_service`, and `equipment_document` by tenant. Support search and filters using `searchParams`:

```ts
const query = firstParam(params.q)?.trim() ?? "";
const status = firstParam(params.status) ?? "all";
const category = firstParam(params.category) ?? "all";
```

Rows show unit, category, current meter, status, location, assignee, and service indicator.

- [ ] **Step 3: Build read-only equipment file**

Tabs:

```ts
const equipmentTabs = ["overview", "service", "maintenance", "meter", "documents", "forms"] as const;
```

Each tab renders existing rows only. Linked forms link to `/admin/monitor/[submissionId]/print`.

- [ ] **Step 4: Verify browser**

Run: `npm run lint`, `npm test`, `npm run build`, restart dev server, open `/admin/equipment`.

Expected: route renders for an authenticated admin and redirects unauthenticated users to login.

### M-EQ-3: Admin Writes For Equipment Files

**Files:**
- Modify: `src/app/admin/actions.ts`
- Modify: `src/app/admin/equipment/page.tsx`
- Modify: `src/app/admin/equipment/[equipmentId]/page.tsx`
- Create: `tests/equipment-actions.test.ts`

- [ ] **Step 1: Add create and update actions**

Implement `createEquipment` and `updateEquipment`. Validate required `unitNumber`, `category`, and `trackingMode`. If status is `down`, send `location_id: null`.

- [ ] **Step 2: Add meter logging**

Implement `createEquipmentMeterReading`. Insert a meter log row with `source = manual`; the database trigger updates `current_meter`.

- [ ] **Step 3: Add maintenance logging**

Implement `createEquipmentMaintenanceLog`. Accept type, title, description, performed date, meter, cost, vendor, and attachment ids.

- [ ] **Step 4: Add scheduled service create and complete**

Create `createEquipmentScheduledService` and `completeEquipmentScheduledService`. Complete inserts a maintenance log row and advances the schedule using `advanceScheduledService`.

- [ ] **Step 5: Add document create**

Create `createEquipmentDocument`. Accept type, title, issued date, expiry date, lead days, and attachment ids.

### M-EQ-4: Offline Equipment Cache And Mobile Read

**Files:**
- Modify: `src/lib/offline/db.ts`
- Create: `src/lib/offline/equipment.ts`
- Modify: `src/app/web/page.tsx`
- Create: `src/app/web/_components/EquipmentPanel.tsx`
- Create: `tests/offline-equipment.test.ts`

- [ ] Cache active equipment, service schedules, documents, and locations by tenant.
- [ ] Read cached equipment in the worker app.
- [ ] Add an Equipment menu surface in the worker app only after cached data exists.

### M-EQ-5: Equipment Selector And Auto-Linking Inspections

**Files:**
- Modify: `src/lib/form-templates.ts`
- Modify: `src/app/admin/forms/[formId]/page.tsx`
- Modify: `src/app/web/_components/AssignedFormsPanel.tsx`
- Modify: `src/lib/offline/forms.ts`
- Modify: `src/lib/offline/sync.ts`
- Create: `tests/equipment-linking.test.ts`

- [ ] Add `equipment_select` form item type.
- [ ] Render tenant-scoped equipment selector in the mobile form renderer from offline cache.
- [ ] Queue selected `equipmentId` and optional meter reading with the submission.
- [ ] During sync, create `equipment_submission_link`.
- [ ] If a meter reading is submitted, insert `equipment_meter_log` with `source = inspection`.
- [ ] In equipment file, show linked forms and link to printable submission output.

### M-EQ-6: Manual Linking, Alerts, And Dashboard Polish

**Files:**
- Modify: `src/app/admin/equipment/[equipmentId]/page.tsx`
- Modify: `src/app/admin/actions.ts`
- Modify: `src/app/admin/page.tsx`
- Create: `src/lib/equipment-reminders.ts`
- Create: `tests/equipment-reminders.test.ts`

- [ ] Add manual link and unlink actions.
- [ ] Add due soon and overdue notifications for schedules and equipment documents.
- [ ] Add dashboard counts for down units, overdue service, and expiring documents.
- [ ] Add audit-ready metadata to action payloads until a general audit table exists.

## Acceptance Coverage

- Criteria 1 through 8 are covered by M-EQ-1 through M-EQ-3.
- Criteria 9 is covered by M-EQ-3 and M-EQ-6.
- Criteria 10 through 12 are covered by M-EQ-5.
- Criteria 13 is covered by M-EQ-4 and M-EQ-5.
- Criteria 14 is partially blocked until the platform has a general tenant audit log. M-EQ-6 stores audit-ready metadata and should be upgraded when that log exists.
- Criteria 15 is covered by using `AdminShell`, existing form controls, existing badge styles, and existing mobile panels.
