/**
 * Transfer rules: the two-leg move of a load through transit.
 *
 * Pure, database-free. A transfer is a header plus the movements it posts; what was
 * loaded and delivered is read back from those movements, never stored twice. These
 * helpers validate the forms and phrase the numbers, so a bad load gets a sentence rather
 * than a constraint name, and the pages stay thin.
 */

export type InventoryTransferStatus = "in_transit" | "arrived" | "cancelled";

export const inventoryTransferStatuses: Record<InventoryTransferStatus, { label: string; tone: "warn" | "success" | "muted" }> = {
  arrived: { label: "Arrived", tone: "success" },
  cancelled: { label: "Cancelled", tone: "muted" },
  in_transit: { label: "In transit", tone: "warn" },
};

/** How many blank line rows the departure form offers. A mat load is usually one item type. */
export const transferLineRowCount = 6;

export type TransferLineInput = { itemId: string; qty: number | null };

export type TransferDepartureInput = {
  driverId: string | null;
  fromLocationId: string | null;
  lines: TransferLineInput[];
  note: string | null;
  toLocationId: string | null;
  vehicleId: string | null;
};

export type TransferDepartureWrite = {
  header: {
    driver_id: string | null;
    from_location_id: string;
    note: string | null;
    to_location_id: string;
    vehicle_id: string | null;
  };
  lines: { item_id: string; qty: number }[];
};

export type TransferDepartureResult =
  | { ok: false; error: string }
  | { ok: true; write: TransferDepartureWrite };

/**
 * Validates a departure and folds duplicate item rows together.
 *
 * Folding rather than rejecting duplicates means the same item entered on two rows
 * becomes one line of the combined quantity, so the manifest carries one movement per
 * item and the residual maths stays simple.
 */
export function buildTransferDepartureWrite(input: TransferDepartureInput): TransferDepartureResult {
  if (!input.fromLocationId) {
    return { ok: false, error: "Choose where the load is coming from." };
  }

  if (!input.toLocationId) {
    return { ok: false, error: "Choose where the load is going." };
  }

  if (input.fromLocationId === input.toLocationId) {
    return { ok: false, error: "A load has to go somewhere different from where it started." };
  }

  const byItem = new Map<string, number>();
  for (const line of input.lines) {
    if (!line.itemId) {
      continue;
    }

    if (line.qty === null || !Number.isFinite(line.qty) || line.qty <= 0) {
      return { ok: false, error: "Every item on the load needs a quantity greater than zero." };
    }

    byItem.set(line.itemId, (byItem.get(line.itemId) ?? 0) + line.qty);
  }

  if (byItem.size === 0) {
    return { ok: false, error: "Add at least one item to the load." };
  }

  return {
    ok: true,
    write: {
      header: {
        driver_id: input.driverId,
        from_location_id: input.fromLocationId,
        note: input.note?.trim() || null,
        to_location_id: input.toLocationId,
        vehicle_id: input.vehicleId,
      },
      lines: [...byItem.entries()].map(([item_id, qty]) => ({ item_id, qty })),
    },
  };
}

export type TransferArrivalLineInput = { itemId: string; qtyDelivered: number | null; qtyLoaded: number };

export type TransferArrivalResult =
  | { ok: false; error: string }
  | { ok: true; deliver: { item_id: string; qty: number }[] };

/**
 * Validates an arrival. Delivered defaults to loaded but may be less (a short delivery),
 * which is fine: the shortfall stays in transit as a residual to chase. Delivered may not
 * exceed loaded, because you cannot take more off the truck than went on it. A line
 * delivered at zero posts nothing and leaves its whole quantity in transit.
 */
export function buildTransferArrivalWrite(lines: TransferArrivalLineInput[]): TransferArrivalResult {
  const deliver: { item_id: string; qty: number }[] = [];

  for (const line of lines) {
    const delivered = line.qtyDelivered;

    if (delivered === null || !Number.isFinite(delivered) || delivered < 0) {
      return { ok: false, error: "Delivered quantities cannot be negative." };
    }

    if (delivered > line.qtyLoaded) {
      return { ok: false, error: "You cannot deliver more of an item than was loaded. Check the numbers." };
    }

    if (delivered > 0) {
      deliver.push({ item_id: line.itemId, qty: delivered });
    }
  }

  if (deliver.length === 0) {
    return { ok: false, error: "Nothing was recorded as delivered. Enter what arrived, or cancel the load instead." };
  }

  return { ok: true, deliver };
}

/** A short, human age for an open load: "3 hours", "2 days". */
export function formatTransferAge(departedAtIso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - new Date(departedAtIso).getTime());
  const minutes = Math.floor(ms / 60000);

  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Folds a transfer's tagged movements into a per-item manifest.
 *
 * A departure leg lands in transit (to === transit); an arrival leg leaves it
 * (from === transit). Loaded minus delivered is what is still in transit for that item,
 * the residual.
 */
export function summariseTransferMovements(
  movements: { item_id: string; qty: number; from_location_id: string | null; to_location_id: string | null }[],
  transitId: string,
): { itemId: string; loaded: number; delivered: number; residual: number }[] {
  const loaded = new Map<string, number>();
  const delivered = new Map<string, number>();

  for (const movement of movements) {
    if (movement.to_location_id === transitId) {
      loaded.set(movement.item_id, (loaded.get(movement.item_id) ?? 0) + movement.qty);
    } else if (movement.from_location_id === transitId) {
      delivered.set(movement.item_id, (delivered.get(movement.item_id) ?? 0) + movement.qty);
    }
  }

  return [...loaded.entries()]
    .map(([itemId, loadedQty]) => ({
      delivered: delivered.get(itemId) ?? 0,
      itemId,
      loaded: loadedQty,
      residual: loadedQty - (delivered.get(itemId) ?? 0),
    }))
    .sort((a, b) => a.itemId.localeCompare(b.itemId));
}
