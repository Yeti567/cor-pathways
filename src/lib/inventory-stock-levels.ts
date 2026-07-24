/**
 * Low-stock levels, derived from the ledger.
 *
 * There is no stored "is low" flag anywhere, on purpose: a stored flag drifts out of step
 * with the balances the moment a movement lands and nobody recomputes it. Instead this
 * sums what is actually on hand and compares it to the item's reorder point, so the answer
 * is always current by construction.
 *
 * "On hand" is the stock at real places only. Transit and loss are excluded: a mat in the
 * loss place is gone, and a load in transit is between two real places, not available to
 * deploy. Those two are exactly the places allowed to hold a negative balance, so
 * `allows_negative` tells them apart without a second lookup.
 *
 * This pure function is shared by the notification builder and the screens that show the
 * low-stock list, so an item the badge calls low is an item that raises an alert.
 */

export type StockLevelItem = {
  id: string;
  name: string;
  unit_of_measure: string;
  reorder_point: number | null;
  active: boolean;
};

export type StockLevelBalance = {
  item_id: string;
  qty: number;
  allows_negative: boolean;
};

/** ok = above the reorder point; low = at or below it; out = nothing on hand at all. */
export type StockState = "ok" | "low" | "out";

export type ItemStockLevel = {
  itemId: string;
  name: string;
  unit: string;
  onHand: number;
  reorderPoint: number;
  state: StockState;
};

function roundQty(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Summarises every watched item (one with a reorder point set) against its on-hand total,
 * worst first. Items with no reorder point are not watched and are left out entirely.
 */
export function summariseInventoryStockLevels(
  items: StockLevelItem[],
  balances: StockLevelBalance[],
): ItemStockLevel[] {
  // On-hand per item, real places only.
  const onHandByItem = new Map<string, number>();
  for (const balance of balances) {
    if (balance.allows_negative) {
      continue;
    }
    onHandByItem.set(balance.item_id, (onHandByItem.get(balance.item_id) ?? 0) + Number(balance.qty));
  }

  const levels: ItemStockLevel[] = [];

  for (const item of items) {
    if (item.reorder_point === null || !item.active) {
      continue;
    }

    const onHand = roundQty(onHandByItem.get(item.id) ?? 0);
    const reorderPoint = roundQty(item.reorder_point);
    const state: StockState = onHand <= 0 ? "out" : onHand <= reorderPoint ? "low" : "ok";

    levels.push({
      itemId: item.id,
      name: item.name,
      onHand,
      reorderPoint,
      state,
      unit: item.unit_of_measure,
    });
  }

  // Worst first: out before low before ok, then by how far under, then by name.
  const rank: Record<StockState, number> = { out: 0, low: 1, ok: 2 };
  return levels.sort(
    (a, b) =>
      rank[a.state] - rank[b.state] ||
      a.onHand - a.reorderPoint - (b.onHand - b.reorderPoint) ||
      a.name.localeCompare(b.name),
  );
}

/** The watched items that need attention now: out of stock or at or below the reorder point. */
export function lowStockLevels(levels: ItemStockLevel[]): ItemStockLevel[] {
  return levels.filter((level) => level.state !== "ok");
}
