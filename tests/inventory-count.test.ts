import { describe, expect, it } from "vitest";
import {
  buildInventoryCountPlan,
  describeCountDelta,
  type InventoryCountInput,
} from "@/lib/inventory-count";

const base: InventoryCountInput = {
  countedQty: 46,
  expectedQty: 50,
  locationId: "yard",
  lossLocationId: "loss",
};

const build = (overrides: Partial<InventoryCountInput> = {}) =>
  buildInventoryCountPlan({ ...base, ...overrides });

function planOf(result: ReturnType<typeof build>) {
  if (!result.ok) {
    throw new Error(`expected a plan, got: ${result.error}`);
  }
  return result.plan;
}

function errorOf(result: ReturnType<typeof build>) {
  if (result.ok) {
    throw new Error("expected an error, got a plan");
  }
  return result.error;
}

describe("buildInventoryCountPlan", () => {
  it("requires a place and a number", () => {
    expect(errorOf(build({ locationId: "" }))).toBe("Choose the place you counted.");
    expect(errorOf(build({ countedQty: null }))).toBe("Enter the number you counted.");
  });

  // A count of zero is legitimate (the shelf is empty); a count below zero is not.
  it("accepts zero but refuses a negative count", () => {
    expect(planOf(build({ countedQty: 0 })).delta).toBe(-50);
    expect(errorOf(build({ countedQty: -1 }))).toContain("cannot be negative");
  });

  // A shortage sends the missing stock out to loss. Quantity stays positive; direction is
  // in the endpoints.
  it("moves a shortage out to loss", () => {
    const plan = planOf(build({ countedQty: 46, expectedQty: 50 }));

    expect(plan.delta).toBe(-4);
    expect(plan.adjustment).toEqual({
      from_location_id: "yard",
      movement_type: "adjustment",
      qty: 4,
      to_location_id: "loss",
    });
  });

  // A windfall pulls the extra back from loss, so the loss place can run negative and net
  // out to the true shrinkage.
  it("pulls a windfall back from loss", () => {
    const plan = planOf(build({ countedQty: 53, expectedQty: 50 }));

    expect(plan.delta).toBe(3);
    expect(plan.adjustment).toEqual({
      from_location_id: "loss",
      movement_type: "adjustment",
      qty: 3,
      to_location_id: "yard",
    });
  });

  // The whole point of a count that agrees with the books is that it changes nothing.
  it("posts nothing when the count matches the books", () => {
    const plan = planOf(build({ countedQty: 50, expectedQty: 50 }));

    expect(plan.delta).toBe(0);
    expect(plan.adjustment).toBeNull();
  });

  // A matching count needs no loss place, so it must still succeed when one is absent.
  it("does not need the loss place when nothing moves", () => {
    expect(planOf(build({ countedQty: 50, expectedQty: 50, lossLocationId: null })).adjustment).toBeNull();
  });

  it("explains itself if the loss place is missing and a correction is needed", () => {
    expect(errorOf(build({ countedQty: 46, lossLocationId: null }))).toContain("loss place is missing");
  });

  it("refuses to count the loss place itself", () => {
    expect(errorOf(build({ countedQty: 5, locationId: "loss", lossLocationId: "loss" }))).toContain(
      "not the loss place",
    );
  });

  it("rounds to the three decimals the column stores", () => {
    const plan = planOf(build({ countedQty: 10.1236, expectedQty: 10 }));

    expect(plan.delta).toBe(0.124);
    expect(plan.adjustment?.qty).toBe(0.124);
  });
});

describe("describeCountDelta", () => {
  it("reads a shortage, a surplus, and a match", () => {
    expect(describeCountDelta(-4)).toBe("4 short");
    expect(describeCountDelta(3)).toBe("3 over");
    expect(describeCountDelta(0)).toBe("matched the books");
  });
});
