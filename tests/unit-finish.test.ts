import { describe, expect, it } from "vitest";
import {
  buildUnitFinish,
  describeTask,
  finishQueue,
  type FinishDocumentRow,
  type FinishUnitRow,
} from "@/lib/unit-finish";

const now = new Date("2026-10-03T12:00:00Z");
const trailer: FinishUnitRow = { category: "trailer", id: "u1", is_commercial: true, name: null, unit_number: "101" };
const types = [
  { appliesByDefault: true, id: "fx", name: "Fire extinguisher inspection" },
  { appliesByDefault: false, id: "vk", name: "External visual and leak (VK)" },
];

let next = 0;
function doc(partial: Partial<FinishDocumentRow>): FinishDocumentRow {
  next += 1;
  return {
    attachment_ids: null,
    certification_type_id: null,
    doc_type: "registration",
    equipment_id: "u1",
    expiry_date: null,
    id: `d${next}`,
    is_active: true,
    issued_date: null,
    reminder_lead_days: 30,
    title: null,
    ...partial,
  };
}

const scanned = ["t/equipment/u1/documents/a.pdf"];
const greenFiles = [
  doc({ attachment_ids: scanned, doc_type: "registration" }),
  doc({ attachment_ids: scanned, doc_type: "cvip", expiry_date: "2027-06-01" }),
];

describe("buildUnitFinish", () => {
  it("asks for nothing on a unit that is fully on file", () => {
    const result = buildUnitFinish(
      {
        certificationTypes: types,
        documents: [...greenFiles, doc({ attachment_ids: scanned, certification_type_id: "fx", doc_type: "certification", expiry_date: "2027-01-01" })],
        requiredTypeIds: null,
        unit: trailer,
      },
      now,
    );

    expect(result.tasks).toEqual([]);
    expect(result.open).toBe(0);
  });

  it("never asks a trailer for insurance (it rides on the tractor's policy)", () => {
    const result = buildUnitFinish({ certificationTypes: [], documents: [], requiredTypeIds: [], unit: trailer }, now);

    expect(result.tasks.map((task) => task.key).sort()).toEqual(["file:cvip", "file:registration"]);
  });

  it("files the scan onto the dated row that is waiting for it, with its dates", () => {
    const waiting = doc({ doc_type: "cvip", expiry_date: "2027-03-01", issued_date: "2026-03-01" });
    const result = buildUnitFinish(
      { certificationTypes: [], documents: [greenFiles[0], waiting], requiredTypeIds: [], unit: trailer },
      now,
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      documentId: waiting.id,
      issuedDate: "2026-03-01",
      mode: "attach",
      state: "awaiting_proof",
    });
  });

  it("asks for a new document when the only one has expired, keeping the old one as history", () => {
    const result = buildUnitFinish(
      {
        certificationTypes: [],
        documents: [greenFiles[0], doc({ attachment_ids: scanned, doc_type: "cvip", expiry_date: "2026-05-01" })],
        requiredTypeIds: [],
        unit: trailer,
      },
      now,
    );

    expect(result.tasks[0]).toMatchObject({ documentId: null, mode: "new", state: "expired" });
    expect(result.red).toBe(1);
  });

  it("reads the newest copy, so last year's expired CVIP does not hold a renewed unit up", () => {
    const result = buildUnitFinish(
      {
        certificationTypes: [],
        documents: [...greenFiles, doc({ attachment_ids: scanned, doc_type: "cvip", expiry_date: "2025-06-01" })],
        requiredTypeIds: [],
        unit: trailer,
      },
      now,
    );

    expect(result.tasks).toEqual([]);
  });

  it("shows a renewal in its window but does not let it hold the unit up", () => {
    const result = buildUnitFinish(
      {
        certificationTypes: [],
        documents: [greenFiles[0], doc({ attachment_ids: scanned, doc_type: "cvip", expiry_date: "2026-10-20" })],
        requiredTypeIds: [],
        unit: trailer,
      },
      now,
    );

    expect(result.tasks[0]).toMatchObject({ canWait: true, mode: "new", state: "due_soon" });
    expect(result.open).toBe(0);
  });

  it("asks only for the inspections the unit is held to, and lets only those be waived", () => {
    const result = buildUnitFinish(
      { certificationTypes: types, documents: greenFiles, requiredTypeIds: ["vk"], unit: trailer },
      now,
    );

    expect(result.tasks.map((task) => [task.key, task.waivable])).toEqual([["cert:vk", true]]);
  });

  it("falls back to the default list when the unit's list was never set", () => {
    const result = buildUnitFinish({ certificationTypes: types, documents: greenFiles, requiredTypeIds: null, unit: trailer }, now);

    expect(result.tasks.map((task) => task.key)).toEqual(["cert:fx"]);
  });

  it("puts red items first", () => {
    const result = buildUnitFinish(
      {
        certificationTypes: types,
        documents: [doc({ doc_type: "cvip", expiry_date: "2027-03-01" })],
        requiredTypeIds: ["fx"],
        unit: trailer,
      },
      now,
    );

    expect(result.tasks.map((task) => task.state)).toEqual(["missing", "missing", "awaiting_proof"]);
  });

  it("asks a non-commercial unit for no registry files", () => {
    const shop = { ...trailer, is_commercial: false };
    const result = buildUnitFinish({ certificationTypes: [], documents: [], requiredTypeIds: [], unit: shop }, now);

    expect(result.tasks).toEqual([]);
  });

  it("ignores a document that has been switched off", () => {
    const result = buildUnitFinish(
      {
        certificationTypes: [],
        documents: [greenFiles[0], doc({ attachment_ids: scanned, doc_type: "cvip", expiry_date: "2027-06-01", is_active: false })],
        requiredTypeIds: [],
        unit: trailer,
      },
      now,
    );

    expect(result.tasks.map((task) => task.key)).toEqual(["file:cvip"]);
  });
});

describe("finishQueue", () => {
  const finish = (id: string, unitNumber: string, open: number) => ({
    open,
    red: open,
    tasks: [],
    unit: { ...trailer, id, unit_number: unitNumber },
  });

  it("puts the unit closest to finished first, then by unit number, and drops finished ones", () => {
    const queue = finishQueue([finish("a", "830", 3), finish("b", "92", 1), finish("c", "9", 1), finish("d", "1", 0)]);

    expect(queue.map((unit) => unit.unit.unit_number)).toEqual(["9", "92", "830"]);
  });
});

describe("describeTask", () => {
  const format = (value: string) => value;
  const base = buildUnitFinish({ certificationTypes: [], documents: [], requiredTypeIds: [], unit: trailer }, now).tasks[0];

  it("speaks plainly for each state", () => {
    expect(describeTask({ ...base, state: "missing" }, format)).toMatch(/^Not on file yet/);
    expect(describeTask({ ...base, expiryDate: "2026-05-01", state: "expired" }, format)).toBe("Expired on 2026-05-01. Upload the new one.");
    expect(describeTask({ ...base, expiryDate: "2027-01-01", state: "awaiting_proof" }, format)).toMatch(/not the document/);
    expect(describeTask({ ...base, canWait: true, expiryDate: "2026-10-20", state: "due_soon" }, format)).toMatch(/^On file/);
  });
});
