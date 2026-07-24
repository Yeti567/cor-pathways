import type { InventoryRateBasis, InventoryTrackingMode } from "@/types/database";

/**
 * Item rules for the inventory module.
 *
 * The database enforces these as check constraints, which is what makes them true. This
 * module enforces the same rules on the way in, which is what makes them survivable: a
 * user who mis-configures an item gets a sentence, not a raw Postgres constraint name.
 * Both layers exist on purpose. Drop the database half and the rules become advisory;
 * drop this half and the app leaks constraint violations into the UI.
 */

export const inventoryTrackingModes = [
  {
    description: "Counted as a quantity. Use for anything interchangeable: mats, fittings, gloves, oil.",
    label: "Bulk",
    value: "bulk",
  },
  {
    description: "Each unit identified individually. Use when you care which one, not just how many.",
    label: "Serialized",
    value: "serial",
  },
] as const satisfies ReadonlyArray<{ description: string; label: string; value: InventoryTrackingMode }>;

export const inventoryRateBases = [
  { label: "Per day", value: "day" },
  { label: "Per week", value: "week" },
  { label: "Per month", value: "month" },
  { label: "Per unit", value: "each" },
] as const satisfies ReadonlyArray<{ label: string; value: InventoryRateBasis }>;

/** Common units, offered as suggestions. The column is free text: nobody can list every unit. */
export const inventoryUnits = ["each", "pair", "box", "metre", "foot", "litre", "gallon", "kg", "lb", "hour"] as const;

export function coerceInventoryTrackingMode(value: unknown): InventoryTrackingMode {
  return value === "serial" ? "serial" : "bulk";
}

export function coerceInventoryRateBasis(value: unknown): InventoryRateBasis | null {
  return inventoryRateBases.some((basis) => basis.value === value) ? (value as InventoryRateBasis) : null;
}

export type InventoryItemInput = {
  name: string;
  sku: string | null;
  categoryId: string | null;
  trackingMode: InventoryTrackingMode;
  unitOfMeasure: string;
  returnable: boolean;
  billable: boolean;
  defaultRate: number | null;
  rateBasis: InventoryRateBasis | null;
  reorderPoint: number | null;
  equipmentId: string | null;
  notes: string | null;
  active: boolean;
};

export type InventoryItemWrite = {
  active: boolean;
  billable: boolean;
  category_id: string | null;
  default_rate: number | null;
  equipment_id: string | null;
  name: string;
  notes: string | null;
  rate_basis: InventoryRateBasis | null;
  reorder_point: number | null;
  returnable: boolean;
  sku: string | null;
  tracking_mode: InventoryTrackingMode;
  unit_of_measure: string;
};

/**
 * Discriminated on `ok` rather than on the presence of `error`, so callers narrow
 * cleanly. Optional-property narrowing does not survive a redirect helper in between.
 */
export type InventoryItemWriteResult =
  | { ok: false; error: string }
  | { ok: true; write: InventoryItemWrite };

/**
 * Normalizes an item into the row the database will accept, or explains why it will not.
 *
 * Normalizing rather than rejecting is deliberate for the two coupled fields. Turning
 * billing off clears the rate instead of erroring, because "this item is no longer
 * charged" is a complete instruction and demanding the user also blank two other boxes
 * is busywork. Switching a serialized item to bulk clears the equipment link for the
 * same reason. What cannot be guessed, such as a missing name or a negative rate, is
 * returned as an error.
 */
export function buildInventoryItemWrite(input: InventoryItemInput): InventoryItemWriteResult {
  const name = input.name.trim();

  if (!name) {
    return { ok: false, error: "Enter a name for the item." };
  }

  const unitOfMeasure = input.unitOfMeasure.trim() || "each";
  const sku = input.sku?.trim() || null;
  const notes = input.notes?.trim() || null;

  if (input.defaultRate !== null && (!Number.isFinite(input.defaultRate) || input.defaultRate < 0)) {
    return { ok: false, error: "A rate cannot be negative." };
  }

  if (input.reorderPoint !== null && (!Number.isFinite(input.reorderPoint) || input.reorderPoint < 0)) {
    return { ok: false, error: "A reorder point cannot be negative." };
  }

  // A billable item priced at nothing is almost always an unfinished form rather than a
  // deliberate zero, and it would bill nothing without ever looking wrong.
  if (input.billable && input.defaultRate !== null && input.rateBasis === null) {
    return { ok: false, error: "Choose how the rate is charged: per day, week, month, or unit." };
  }

  const billable = input.billable;

  return {
    ok: true,
    write: {
      active: input.active,
      billable,
      category_id: input.categoryId,
      // The rate and its period only exist on a billable item. The database says the
      // same thing; clearing here is what stops it becoming an error the user must fix.
      default_rate: billable ? input.defaultRate : null,
      // Only an individually identified unit can carry an equipment record.
      equipment_id: input.trackingMode === "serial" ? input.equipmentId : null,
      name,
      notes,
      rate_basis: billable ? input.rateBasis : null,
      // A reorder point is watched independently of billing; keep it whatever the item does.
      reorder_point: input.reorderPoint,
      returnable: input.returnable,
      sku,
      tracking_mode: input.trackingMode,
      unit_of_measure: unitOfMeasure,
    },
  };
}

/** One-line plain-English summary of how an item behaves, for list rows. */
export function describeInventoryItem(item: {
  billable: boolean;
  default_rate: number | null;
  rate_basis: InventoryRateBasis | null;
  returnable: boolean;
  tracking_mode: InventoryTrackingMode;
}): string {
  const parts: string[] = [item.tracking_mode === "serial" ? "Serialized" : "Bulk"];

  parts.push(item.returnable ? "Comes back" : "Consumed");

  if (item.billable) {
    const basis = inventoryRateBases.find((entry) => entry.value === item.rate_basis);
    parts.push(item.default_rate !== null && basis ? `Billed ${basis.label.toLowerCase()}` : "Billable");
  }

  return parts.join(" · ");
}
