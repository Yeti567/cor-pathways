import { describe, expect, it } from "vitest";
import { buildWorkOrderLabourPayload, normalizeWorkOrderLabourPayload } from "@/lib/offline/maintenance";
import { labourCost, partLineTotal } from "@/lib/maintenance";

// Time logged on a work order from a phone with no signal is queued and posted later.
// The builder (used by the panel) and the normaliser (used by the sync engine) must agree,
// and the posted row must satisfy the table's check constraints exactly.

const input = {
  hours: 2.5,
  note: " Swapped the hose ",
  tenantId: "tenant-1",
  userId: "worker-1",
  workOrderId: "wo-1",
  workedOn: "2026-10-21",
};

describe("buildWorkOrderLabourPayload", () => {
  it("stamps the entry with its idempotency key, the worker and no rate", () => {
    expect(buildWorkOrderLabourPayload(input, "uuid-1", "2026-10-22")).toEqual({
      ok: true,
      payload: {
        client_uuid: "uuid-1",
        cost: 0,
        hours: 2.5,
        note: "Swapped the hose",
        rate: 0,
        tenant_id: "tenant-1",
        work_order_id: "wo-1",
        worked_on: "2026-10-21",
        worker_id: "worker-1",
      },
    });
  });

  it("refuses an entry with no work order, impossible hours or a future day", () => {
    expect(buildWorkOrderLabourPayload({ ...input, workOrderId: "" }, "u", "2026-10-22").ok).toBe(false);
    expect(buildWorkOrderLabourPayload({ ...input, hours: null }, "u", "2026-10-22").ok).toBe(false);
    expect(buildWorkOrderLabourPayload({ ...input, hours: 30 }, "u", "2026-10-22").ok).toBe(false);
    expect(buildWorkOrderLabourPayload({ ...input, workedOn: "2026-10-30" }, "u", "2026-10-22").ok).toBe(false);
  });
});

describe("normalizeWorkOrderLabourPayload", () => {
  it("passes a queued entry the panel built, unchanged", () => {
    const built = buildWorkOrderLabourPayload(input, "uuid-1", "2026-10-22");
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(normalizeWorkOrderLabourPayload(built.payload)).toEqual(built.payload);
    }
  });

  it("drops anything a phone tried to price, and refuses a malformed entry", () => {
    expect(
      normalizeWorkOrderLabourPayload({
        client_uuid: "u",
        cost: 999,
        hours: 1,
        rate: 999,
        tenant_id: "t",
        work_order_id: "w",
        worked_on: "2026-10-21",
        worker_id: "p",
      }),
    ).toMatchObject({ cost: 0, rate: 0 });

    expect(normalizeWorkOrderLabourPayload(null)).toBeNull();
    expect(normalizeWorkOrderLabourPayload([])).toBeNull();
    expect(normalizeWorkOrderLabourPayload({ client_uuid: "u", hours: 1, tenant_id: "t", work_order_id: "w", worked_on: "bad", worker_id: "p" })).toBeNull();
    expect(normalizeWorkOrderLabourPayload({ client_uuid: "u", hours: 0, tenant_id: "t", work_order_id: "w", worked_on: "2026-10-21", worker_id: "p" })).toBeNull();
    expect(normalizeWorkOrderLabourPayload({ hours: 1, tenant_id: "t", work_order_id: "w", worked_on: "2026-10-21", worker_id: "p" })).toBeNull();
  });
});

describe("line arithmetic matches the database exactly", () => {
  // Postgres multiplies numerics exactly and rounds half away from zero. These are the
  // cases a float gets wrong by a cent, which the check constraints would refuse.
  it.each([
    [2.5, 19.99, 49.98],
    [1.005, 1, 1.01],
    [3, 0.335, 1.01],
    [0.125, 0.1, 0.01],
  ])("part %s x %s is %s", (qty, unitCost, total) => {
    expect(partLineTotal(qty, unitCost)).toBe(total);
  });

  it.each([
    [1.25, 10.02, 12.53],
    [0.15, 0.5, 0.08],
    [24, 99.99, 2399.76],
  ])("labour %s h x %s is %s", (hours, rate, total) => {
    expect(labourCost(hours, rate)).toBe(total);
  });
});
