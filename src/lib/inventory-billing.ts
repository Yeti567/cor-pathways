import type { InventoryLocationKind, InventoryRateBasis } from "@/types/database";

/**
 * Rental billing, derived from the ledger.
 *
 * Nothing about a charge is stored: there is no invoice table, no interval table, no
 * running total that a movement has to remember to update. A charge is reconstructed on
 * demand from the same movements that move the balances, which is what makes "partial
 * pickup falls out for free" true rather than a special case. Pick up half a load and the
 * quantity on site drops for the rest of the period; the interval after the pickup simply
 * carries the smaller quantity, and the sum is right without anyone writing pickup logic.
 *
 * The billing question is: for each billable item at each customer site, how many units
 * sat there, and for how long, inside the billing period? That is an interval series, and
 * the charge is the sum over intervals of quantity times duration times rate.
 *
 * Duration is proportional (exact elapsed time in the rate's unit), not rounded up per
 * segment. Rounding each segment up would double-charge a unit that sits still while other
 * units come and go around it, because the ledger cuts its stay into segments at every
 * movement. Proportional billing is neutral to how the timeline happens to be sliced. A
 * "day started" convention, or monthly minimums, are the kind of real pricing rule that
 * waits for a client who actually charges that way (open question 2 in the plan).
 */

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
// A calendar month varies; 30 days is the documented approximation until a client's
// per-month pricing says otherwise.
const MONTH_MS = 30 * DAY_MS;

/** The place kinds a customer is billed for. Stock in your own yard or on a truck is not billed. */
export const billableSiteKinds: InventoryLocationKind[] = ["customer_site"];

export type BillingItem = {
  id: string;
  name: string;
  unit_of_measure: string;
  billable: boolean;
  default_rate: number | null;
  rate_basis: InventoryRateBasis | null;
};

export type BillingPlace = {
  id: string;
  kind: InventoryLocationKind;
  label: string;
};

export type BillingMovement = {
  item_id: string;
  from_location_id: string | null;
  to_location_id: string | null;
  qty: number;
  occurred_at: string;
};

export type BillingInterval = {
  startMs: number;
  endMs: number;
  qty: number;
  /** Duration in the rate's unit (days, weeks, or months). Fractional and exact. */
  periods: number;
};

export type BillingLine = {
  itemId: string;
  itemName: string;
  unit: string;
  siteId: string;
  siteLabel: string;
  basis: InventoryRateBasis;
  rate: number;
  /** Time-based bases: the intervals the stock sat on site within the period. */
  intervals: BillingInterval[];
  /** The billable quantity: unit-periods for time bases, units delivered for "each". */
  quantity: number;
  amount: number;
};

export type BillingSiteTotal = {
  siteId: string;
  siteLabel: string;
  amount: number;
};

export type BillingReport = {
  periodStartMs: number;
  periodEndMs: number;
  lines: BillingLine[];
  sites: BillingSiteTotal[];
  total: number;
};

function unitMsFor(basis: InventoryRateBasis): number {
  switch (basis) {
    case "week":
      return WEEK_MS;
    case "month":
      return MONTH_MS;
    default:
      return DAY_MS;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Reconstructs the quantity-on-site timeline for one item at one place, clipped to the
 * billing period. Movements before the period set the opening quantity; movements inside
 * it cut the period into intervals of constant quantity. Only intervals holding stock are
 * returned.
 */
function siteIntervals(
  movements: BillingMovement[],
  siteId: string,
  periodStartMs: number,
  periodEndMs: number,
): BillingInterval[] {
  let openingQty = 0;
  const events: { atMs: number; delta: number }[] = [];

  for (const movement of movements) {
    const delta =
      (movement.to_location_id === siteId ? Number(movement.qty) : 0) -
      (movement.from_location_id === siteId ? Number(movement.qty) : 0);
    if (delta === 0) {
      continue;
    }

    const atMs = Date.parse(movement.occurred_at);
    if (Number.isNaN(atMs)) {
      continue;
    }

    if (atMs < periodStartMs) {
      openingQty += delta;
    } else if (atMs < periodEndMs) {
      events.push({ atMs, delta });
    }
    // Movements at or after the period end do not affect this period.
  }

  events.sort((a, b) => a.atMs - b.atMs);

  const intervals: BillingInterval[] = [];
  let cursor = periodStartMs;
  let qty = openingQty;

  const push = (start: number, end: number, atQty: number) => {
    if (end > start && atQty > 0) {
      intervals.push({ endMs: end, periods: 0, qty: atQty, startMs: start });
    }
  };

  for (const event of events) {
    push(cursor, event.atMs, qty);
    qty += event.delta;
    cursor = Math.max(cursor, event.atMs);
  }
  push(cursor, periodEndMs, qty);

  return intervals;
}

/** Total units delivered to a site within the period, for the one-time "each" basis. */
function unitsDelivered(
  movements: BillingMovement[],
  siteId: string,
  periodStartMs: number,
  periodEndMs: number,
): number {
  let total = 0;
  for (const movement of movements) {
    if (movement.to_location_id !== siteId) {
      continue;
    }
    const atMs = Date.parse(movement.occurred_at);
    if (Number.isNaN(atMs) || atMs < periodStartMs || atMs >= periodEndMs) {
      continue;
    }
    total += Number(movement.qty);
  }
  return total;
}

/**
 * Builds the rental charges for a period: one line per (billable item, customer site) that
 * accrued anything, plus a per-site total and a grand total. A report, not an invoice: it
 * says what to charge, and stores nothing.
 */
export function buildRentalCharges(input: {
  items: BillingItem[];
  places: BillingPlace[];
  movements: BillingMovement[];
  periodStartMs: number;
  periodEndMs: number;
}): BillingReport {
  const { items, movements, periodEndMs, periodStartMs, places } = input;

  const billableItems = items.filter(
    (item) => item.billable && item.default_rate !== null && item.rate_basis !== null,
  );
  const sites = places.filter((place) => billableSiteKinds.includes(place.kind));

  const lines: BillingLine[] = [];

  for (const item of billableItems) {
    const rate = Number(item.default_rate);
    const basis = item.rate_basis as InventoryRateBasis;
    const itemMovements = movements.filter((movement) => movement.item_id === item.id);

    for (const site of sites) {
      if (basis === "each") {
        const quantity = round3(unitsDelivered(itemMovements, site.id, periodStartMs, periodEndMs));
        if (quantity <= 0) {
          continue;
        }
        lines.push({
          amount: round2(quantity * rate),
          basis,
          intervals: [],
          itemId: item.id,
          itemName: item.name,
          quantity,
          rate,
          siteId: site.id,
          siteLabel: site.label,
          unit: item.unit_of_measure,
        });
        continue;
      }

      const unitMs = unitMsFor(basis);
      const intervals = siteIntervals(itemMovements, site.id, periodStartMs, periodEndMs).map((interval) => ({
        ...interval,
        periods: round3((interval.endMs - interval.startMs) / unitMs),
      }));

      if (intervals.length === 0) {
        continue;
      }

      // Unit-periods: sum of quantity times its exact duration. This is the billable
      // quantity, and multiplying by the rate once keeps a single rounding at the end.
      const quantity = round3(
        intervals.reduce((sum, interval) => sum + interval.qty * ((interval.endMs - interval.startMs) / unitMs), 0),
      );
      if (quantity <= 0) {
        continue;
      }

      lines.push({
        amount: round2(quantity * rate),
        basis,
        intervals,
        itemId: item.id,
        itemName: item.name,
        quantity,
        rate,
        siteId: site.id,
        siteLabel: site.label,
        unit: item.unit_of_measure,
      });
    }
  }

  lines.sort((a, b) => a.siteLabel.localeCompare(b.siteLabel) || a.itemName.localeCompare(b.itemName));

  const siteTotals = new Map<string, BillingSiteTotal>();
  for (const line of lines) {
    const existing = siteTotals.get(line.siteId);
    if (existing) {
      existing.amount = round2(existing.amount + line.amount);
    } else {
      siteTotals.set(line.siteId, { amount: line.amount, siteId: line.siteId, siteLabel: line.siteLabel });
    }
  }

  const siteList = [...siteTotals.values()].sort((a, b) => a.siteLabel.localeCompare(b.siteLabel));
  const total = round2(siteList.reduce((sum, site) => sum + site.amount, 0));

  return { lines, periodEndMs, periodStartMs, sites: siteList, total };
}

/** A short label for a rate, e.g. "$10.00/day" or "$5.00 each". */
export function formatRentalRate(rate: number, basis: InventoryRateBasis): string {
  const money = `$${(Number.isFinite(rate) ? rate : 0).toFixed(2)}`;
  return basis === "each" ? `${money} each` : `${money}/${basis}`;
}
