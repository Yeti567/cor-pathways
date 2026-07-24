import type { InventoryMovementType } from "@/types/database";

/**
 * Movement rules for the inventory ledger.
 *
 * Everything here mirrors a constraint on `inventory_movement` or a rule in the
 * `apply_inventory_movement` trigger. The database is what makes those rules true; this
 * is what makes breaking one produce a sentence instead of a constraint name.
 *
 * The one rule worth stating out loud: quantity is always positive. Direction is carried
 * by the two endpoints, never by the sign, so a negative number can never quietly mean
 * the opposite of what someone intended.
 */

type MovementMeta = {
  /** Whether an origin and a destination are required, forbidden, or chosen by the user. */
  from: "required" | "forbidden";
  to: "required" | "forbidden" | "virtual_loss";
  label: string;
  verb: string;
};

export const inventoryMovementTypes: Record<InventoryMovementType, MovementMeta> = {
  adjustment: {
    from: "required",
    label: "Adjustment",
    to: "virtual_loss",
    verb: "adjusted",
  },
  consume: {
    from: "required",
    label: "Used on a job",
    to: "required",
    verb: "used",
  },
  receive: {
    from: "forbidden",
    label: "Received",
    to: "required",
    verb: "received",
  },
  reversal: {
    from: "required",
    label: "Reversal",
    to: "required",
    verb: "reversed",
  },
  transfer: {
    from: "required",
    label: "Moved",
    to: "required",
    verb: "moved",
  },
  write_off: {
    from: "required",
    label: "Written off",
    to: "virtual_loss",
    verb: "written off",
  },
};

export function coerceInventoryMovementType(value: unknown): InventoryMovementType | null {
  return typeof value === "string" && value in inventoryMovementTypes ? (value as InventoryMovementType) : null;
}

/** The movement kinds an admin records by hand. Reversals are posted by the app, not chosen. */
export const recordableInventoryMovementTypes = ["receive", "transfer", "consume", "write_off"] as const;

export type InventoryMovementInput = {
  fromLocationId: string | null;
  itemId: string;
  lossLocationId: string | null;
  movementType: InventoryMovementType;
  note: string | null;
  qty: number | null;
  toLocationId: string | null;
};

export type InventoryMovementWrite = {
  from_location_id: string | null;
  item_id: string;
  movement_type: InventoryMovementType;
  note: string | null;
  qty: number;
  to_location_id: string | null;
};

export type InventoryMovementWriteResult =
  | { ok: false; error: string }
  | { ok: true; write: InventoryMovementWrite };

/**
 * Parses a quantity from a form field.
 *
 * Returns null rather than 0 for anything unparseable, so a typo becomes "enter a
 * quantity" instead of silently posting a movement of nothing.
 */
export function parseInventoryQty(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "");
  if (!cleaned) {
    return null;
  }

  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  // Three decimals, matching numeric(14,3) in the schema, so what is shown back is what
  // was actually stored.
  return Math.round(parsed * 1000) / 1000;
}

export function buildInventoryMovementWrite(input: InventoryMovementInput): InventoryMovementWriteResult {
  if (!input.itemId) {
    return { ok: false, error: "Choose an item." };
  }

  if (input.qty === null) {
    return { ok: false, error: "Enter a quantity." };
  }

  if (input.qty <= 0) {
    return { ok: false, error: "Enter a quantity greater than zero. Direction comes from the two places, not the sign." };
  }

  const meta = inventoryMovementTypes[input.movementType];
  const from = meta.from === "required" ? input.fromLocationId : null;
  const to =
    meta.to === "virtual_loss" ? input.lossLocationId : meta.to === "required" ? input.toLocationId : null;

  if (meta.from === "required" && !from) {
    return { ok: false, error: "Choose where the stock is coming from." };
  }

  if (meta.to === "required" && !to) {
    return { ok: false, error: "Choose where the stock is going." };
  }

  if (meta.to === "virtual_loss" && !to) {
    return {
      ok: false,
      error: "The write-off place is missing. Switch the Inventory module off and on again under Setup to restore it.",
    };
  }

  // Mirrors inventory_movement_endpoints_check.
  if (!from && !to) {
    return { ok: false, error: "A movement needs somewhere to come from or somewhere to go." };
  }

  if (from && to && from === to) {
    return { ok: false, error: "Choose two different places. Stock cannot move to where it already is." };
  }

  return {
    ok: true,
    write: {
      from_location_id: from,
      item_id: input.itemId,
      movement_type: input.movementType,
      note: input.note?.trim() || null,
      qty: input.qty,
      to_location_id: to,
    },
  };
}

/** Formats a stored quantity without trailing noise: 12.500 reads as 12.5, 40.000 as 40. */
export function formatInventoryQty(qty: number): string {
  return Number(qty).toLocaleString(undefined, { maximumFractionDigits: 3 });
}
