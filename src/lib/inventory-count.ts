import type { InventoryMovementType } from "@/types/database";

/**
 * Count reconciliation, worked out ahead of the write.
 *
 * The authoritative version of this lives in the `record_inventory_count` function, which
 * does it inside a transaction so the adjustment and the count row cannot half-land. This
 * is the same arithmetic in TypeScript, for two jobs the database function cannot do: to
 * show the operator what a count will do before they commit it, and to be unit tested
 * without a database. The two must agree, so the rule is stated once and plainly: the
 * delta is counted minus expected, a shortage moves stock out to loss, a windfall pulls it
 * back, and a count that matches the books moves nothing.
 */

/** Round to the three decimals numeric(14,3) stores, so a preview matches what is written. */
function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export type InventoryCountInput = {
  /** The absolute quantity counted. Null means nothing was entered. Zero is valid. */
  countedQty: number | null;
  /** The current balance at the place, the figure the count is measured against. */
  expectedQty: number;
  /** The tenant's virtual loss place, needed only when the count does not match. */
  lossLocationId: string | null;
  /** The real place that was counted. */
  locationId: string;
};

/** The adjustment a non-matching count posts. Shaped like an inventory_movement insert. */
export type InventoryCountAdjustment = {
  from_location_id: string;
  to_location_id: string;
  movement_type: InventoryMovementType;
  qty: number;
};

export type InventoryCountPlan = {
  countedQty: number;
  expectedQty: number;
  /** counted minus expected: negative is a shortage, positive is a windfall. */
  delta: number;
  /** The movement to post, or null when the count matches the books. */
  adjustment: InventoryCountAdjustment | null;
};

export type InventoryCountPlanResult =
  | { ok: false; error: string }
  | { ok: true; plan: InventoryCountPlan };

/**
 * Works out what a count will do, or explains why it cannot be recorded.
 *
 * Mirrors the checks in `record_inventory_count`: a count is never negative, and a count
 * that differs from the books needs the loss place to reconcile against. Direction is
 * carried by the endpoints, so the adjustment quantity is always positive.
 */
export function buildInventoryCountPlan(input: InventoryCountInput): InventoryCountPlanResult {
  if (!input.locationId) {
    return { ok: false, error: "Choose the place you counted." };
  }

  if (input.countedQty === null) {
    return { ok: false, error: "Enter the number you counted." };
  }

  if (input.countedQty < 0) {
    return { ok: false, error: "A count cannot be negative. Enter how many are actually there, or zero." };
  }

  const countedQty = roundQty(input.countedQty);
  const expectedQty = roundQty(input.expectedQty);
  const delta = roundQty(countedQty - expectedQty);

  if (delta === 0) {
    return { ok: true, plan: { adjustment: null, countedQty, delta, expectedQty } };
  }

  if (!input.lossLocationId) {
    return {
      ok: false,
      error: "The loss place is missing. Switch the Inventory module off and on again under Setup to restore it.",
    };
  }

  if (input.lossLocationId === input.locationId) {
    return { ok: false, error: "Count a real place, not the loss place." };
  }

  // A shortage moves the missing stock out to loss; a windfall pulls it back from loss.
  const adjustment: InventoryCountAdjustment =
    delta < 0
      ? {
          from_location_id: input.locationId,
          movement_type: "adjustment",
          qty: -delta,
          to_location_id: input.lossLocationId,
        }
      : {
          from_location_id: input.lossLocationId,
          movement_type: "adjustment",
          qty: delta,
          to_location_id: input.locationId,
        };

  return { ok: true, plan: { adjustment, countedQty, delta, expectedQty } };
}

/** A short, human phrase for a count's outcome, for messages and the variance list. */
export function describeCountDelta(delta: number): string {
  if (delta === 0) {
    return "matched the books";
  }
  const magnitude = Math.abs(roundQty(delta)).toLocaleString(undefined, { maximumFractionDigits: 3 });
  return delta < 0 ? `${magnitude} short` : `${magnitude} over`;
}
