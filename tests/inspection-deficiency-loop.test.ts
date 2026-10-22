import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInspectionDefectFollowUps } from "@/lib/offline/follow-ups";
import type { OfflineFormSummary } from "@/lib/offline/form-model";
import type { Json } from "@/types/database";

// Slice 3: a failed inspection item raises a work order when the maintenance module is on.
// The corrective action it already raises must stay exactly as it is, and a tenant with the
// module off (every trucking tenant today) must see no difference at all. These tests pin
// both, for the phone side (createInspectionDefectFollowUps) and the database side (the
// trigger that raises the work order once the action syncs).

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8");

function form(items: { id: string; label: string; settings: Json }[]): OfflineFormSummary {
  return {
    code: "TEST",
    description: null,
    id: "form-1",
    name: "Inspection",
    sections: [
      {
        collapsible: false,
        id: "section-1",
        items: items.map((item, index) => ({
          fieldType: "pass_fail_na",
          flaggable: true,
          helperText: null,
          id: item.id,
          label: item.label,
          required: true,
          settings: item.settings,
          sortOrder: index,
        })),
        repeatable: false,
        sortOrder: 0,
        title: "Checks",
      },
    ],
    status: "active",
    tenantId: "tenant-1",
    updatedAt: "2026-10-01T00:00:00.000Z",
  };
}

// The trucking pre-trip shape: NSC Schedule 1 defaults, no maintenance settings.
const truckingForm = form([
  { id: "brakes", label: "Brakes", settings: { defect_severity: "major" } },
  { id: "lights", label: "Lights", settings: { defect_severity: "minor" } },
  { id: "horn", label: "Horn", settings: {} },
]);

// The municipal starter form shape: settings.severity and settings.autoWorkOrder.
const municipalForm = form([
  { id: "tires", label: "Tires", settings: { allowEvidencePhotos: false, autoWorkOrder: true, severity: "critical" } },
  { id: "wipers", label: "Wipers", settings: { allowEvidencePhotos: false, autoWorkOrder: true, severity: "major" } },
  { id: "decals", label: "Decals", settings: { allowEvidencePhotos: false, autoWorkOrder: true, severity: "minor" } },
]);

const baseArgs = {
  assignedTo: "mechanic-1",
  createdAt: "2026-10-22T08:00:00.000Z",
  equipmentId: "unit-7",
  idFactory: () => "follow-up-id",
  submissionId: "submission-1",
  tenantId: "tenant-1",
};

const allFail = (summary: OfflineFormSummary) =>
  Object.fromEntries(summary.sections.flatMap((section) => section.items).map((item) => [item.id, "fail" as Json]));

describe("with the maintenance module off, nothing changes", () => {
  it.each([
    ["the trucking form", truckingForm],
    ["a municipal form", municipalForm],
  ])("gives exactly the same result for %s whether the flag is left out or set off", (_label, summary) => {
    const omitted = createInspectionDefectFollowUps({ ...baseArgs, form: summary, values: allFail(summary) });
    const off = createInspectionDefectFollowUps({
      ...baseArgs,
      form: summary,
      maintenanceEnabled: false,
      values: allFail(summary),
    });

    expect(off).toEqual(omitted);
  });

  it("keeps the trucking behaviour it has always had: major pulls the unit, minor does not", () => {
    const result = createInspectionDefectFollowUps({ ...baseArgs, form: truckingForm, values: allFail(truckingForm) });

    expect(result.followUps.map((followUp) => followUp.title)).toEqual([
      "Major vehicle defect: Brakes",
      "Minor vehicle defect: Lights",
      "Minor vehicle defect: Horn",
    ]);
    expect(result.outOfServiceEquipmentIds).toEqual(["unit-7"]);
  });

  it("does not read the maintenance severity, so a critical municipal item does not pull the unit", () => {
    const result = createInspectionDefectFollowUps({ ...baseArgs, form: municipalForm, values: allFail(municipalForm) });

    expect(result.followUps.map((followUp) => followUp.title)).toEqual([
      "Minor vehicle defect: Tires",
      "Minor vehicle defect: Wipers",
      "Minor vehicle defect: Decals",
    ]);
    expect(result.outOfServiceEquipmentIds).toEqual([]);
  });
});

describe("with the maintenance module on", () => {
  it("leaves the trucking form exactly as it is", () => {
    const off = createInspectionDefectFollowUps({ ...baseArgs, form: truckingForm, values: allFail(truckingForm) });
    const on = createInspectionDefectFollowUps({
      ...baseArgs,
      form: truckingForm,
      maintenanceEnabled: true,
      values: allFail(truckingForm),
    });

    expect(on).toEqual(off);
  });

  it("keeps the out-of-service behaviour for a critical item, and only for a critical one", () => {
    const result = createInspectionDefectFollowUps({
      ...baseArgs,
      form: municipalForm,
      maintenanceEnabled: true,
      values: { decals: "fail", tires: "fail", wipers: "fail" },
    });

    expect(result.outOfServiceEquipmentIds).toEqual(["unit-7"]);
    expect(result.followUps.map((followUp) => followUp.title)).toEqual([
      "Major vehicle defect: Tires",
      "Minor vehicle defect: Wipers",
      "Minor vehicle defect: Decals",
    ]);
  });

  it("still raises each corrective action pinned to the unit, one per failed item", () => {
    const result = createInspectionDefectFollowUps({
      ...baseArgs,
      form: municipalForm,
      maintenanceEnabled: true,
      values: { decals: "pass", tires: "na", wipers: "fail" },
    });

    expect(result.followUps).toHaveLength(1);
    expect(result.followUps[0]).toMatchObject({ equipment_id: "unit-7", form_item_id: "wipers", status: "open" });
    expect(result.outOfServiceEquipmentIds).toEqual([]);
  });

  it("lets the worker's explicit choice win over the item's severity, as it always has", () => {
    const result = createInspectionDefectFollowUps({
      ...baseArgs,
      chosenSeverities: { tires: "minor" },
      form: municipalForm,
      maintenanceEnabled: true,
      values: { tires: "fail" },
    });

    expect(result.outOfServiceEquipmentIds).toEqual([]);
  });
});

describe("the database side of the loop", () => {
  const migration = read("supabase/migrations/20261022150000_inspection_deficiency_work_orders.sql")
    .toLowerCase()
    .replace(/--[^\n]*/g, "")
    .replace(/"/g, "")
    .replace(/\s+/g, " ");
  const body = migration.slice(migration.indexOf("as $$"), migration.indexOf("$$;"));

  it("returns before doing anything else when the tenant has the module off", () => {
    const guard = body.indexOf("if not public.maintenance_module_on(new.tenant_id) then return new; end if;");

    expect(guard).toBeGreaterThan(-1);
    expect(body.indexOf("insert into")).toBeGreaterThan(guard);
    expect(body.indexOf("update public.follow_ups")).toBeGreaterThan(guard);
    expect(body.indexOf("from public.form_items")).toBeGreaterThan(guard);
  });

  it("never changes the corrective action except to link it to its work order", () => {
    const updates = body.match(/update public\.follow_ups set [^;]*;/g) ?? [];

    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("set maintenance_work_order_id = existing where id = new.id");
  });

  it("runs after the corrective action is written, not before, so it cannot alter or block it", () => {
    expect(migration).toContain(
      "create or replace trigger follow_ups_create_inspection_work_order after insert on public.follow_ups for each row",
    );
    expect(migration).not.toContain("before insert on public.follow_ups");
  });

  it("raises a work order only for a flaggable item that failed, opted in, on an asset", () => {
    expect(body).toContain("if not found or not item.flaggable then return new;");
    expect(body).toContain("(item.settings -> 'autoworkorder') is distinct from 'true'::jsonb");
    expect(body).toContain("if not failed then return new;");
    expect(body).toContain("if asset is null then return new;");
  });

  it("maps severity to priority the same way the app does", () => {
    expect(body).toContain("when 'critical' then 'urgent' when 'major' then 'high' else 'normal'");
  });

  it("links a repeat failure to the open work order instead of raising a second", () => {
    expect(body).toContain("wo.source = 'inspection' and wo.source_id = new.form_item_id and wo.equipment_id = asset");
    expect(body).toContain("exception when unique_violation then");
  });
});
