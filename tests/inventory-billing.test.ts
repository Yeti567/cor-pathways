import { describe, expect, it } from "vitest";
import {
  buildRentalCharges,
  formatRentalRate,
  type BillingItem,
  type BillingMovement,
  type BillingPlace,
} from "@/lib/inventory-billing";

const periodStartMs = Date.parse("2026-06-01T00:00:00Z");
const periodEndMs = Date.parse("2026-06-11T00:00:00Z"); // a 10-day period

const matDaily: BillingItem = {
  id: "mat",
  name: "Rig mat",
  unit_of_measure: "each",
  billable: true,
  default_rate: 10,
  rate_basis: "day",
};

const siteA: BillingPlace = { id: "site-a", kind: "customer_site", label: "Acme Lease 7" };
const siteB: BillingPlace = { id: "site-b", kind: "customer_site", label: "Borealis Pad 3" };
const yard: BillingPlace = { id: "yard", kind: "yard", label: "Home Yard" };

function move(over: Partial<BillingMovement> & { at: string }): BillingMovement {
  return {
    item_id: over.item_id ?? "mat",
    from_location_id: over.from_location_id ?? null,
    to_location_id: over.to_location_id ?? null,
    qty: over.qty ?? 0,
    occurred_at: over.at,
  };
}

const run = (input: {
  items?: BillingItem[];
  places?: BillingPlace[];
  movements: BillingMovement[];
}) =>
  buildRentalCharges({
    items: input.items ?? [matDaily],
    places: input.places ?? [siteA, yard],
    movements: input.movements,
    periodEndMs,
    periodStartMs,
  });

describe("buildRentalCharges", () => {
  it("charges quantity times days times rate for a full-period stay", () => {
    // 5 mats delivered at the start, never picked up: 5 x 10 days x $10 = $500.
    const report = run({ movements: [move({ to_location_id: "site-a", qty: 5, at: "2026-06-01T00:00:00Z" })] });

    expect(report.lines).toHaveLength(1);
    expect(report.lines[0].quantity).toBe(50);
    expect(report.lines[0].amount).toBe(500);
    expect(report.total).toBe(500);
  });

  // Stock delivered before the period is still on site and still billable during it.
  it("carries an opening balance from before the period", () => {
    const report = run({ movements: [move({ to_location_id: "site-a", qty: 5, at: "2026-05-25T00:00:00Z" })] });

    expect(report.lines[0].amount).toBe(500);
  });

  // The property the whole design exists for: a partial pickup just lowers the quantity for
  // the rest of the period. Nobody writes pickup logic.
  it("bills a partial pickup for free by lowering the quantity mid-period", () => {
    // 10 mats for 5 days, then 4 picked up leaving 6 for 5 days: 50 + 30 = 80 unit-days.
    const report = run({
      movements: [
        move({ to_location_id: "site-a", qty: 10, at: "2026-06-01T00:00:00Z" }),
        move({ from_location_id: "site-a", qty: 4, at: "2026-06-06T00:00:00Z" }),
      ],
    });

    expect(report.lines[0].quantity).toBe(80);
    expect(report.lines[0].amount).toBe(800);
  });

  it("bills only the time within the period, ignoring a pickup after it", () => {
    const report = run({
      movements: [
        move({ to_location_id: "site-a", qty: 5, at: "2026-06-01T00:00:00Z" }),
        move({ from_location_id: "site-a", qty: 5, at: "2026-06-21T00:00:00Z" }),
      ],
    });

    expect(report.lines[0].amount).toBe(500);
  });

  it("stops billing once stock leaves mid-period", () => {
    // 5 mats for 2 days, then all gone: 10 unit-days, $100.
    const report = run({
      movements: [
        move({ to_location_id: "site-a", qty: 5, at: "2026-06-01T00:00:00Z" }),
        move({ from_location_id: "site-a", qty: 5, at: "2026-06-03T00:00:00Z" }),
      ],
    });

    expect(report.lines[0].quantity).toBe(10);
    expect(report.lines[0].amount).toBe(100);
  });

  it("prices a weekly rate proportionally", () => {
    const weekly: BillingItem = { ...matDaily, default_rate: 70, rate_basis: "week" };
    // 7 units for 10 days = 10 unit-weeks (10/7 of a week each) x $70 = $700.
    const report = run({
      items: [weekly],
      movements: [move({ to_location_id: "site-a", qty: 7, at: "2026-06-01T00:00:00Z" })],
    });

    expect(report.lines[0].quantity).toBe(10);
    expect(report.lines[0].amount).toBe(700);
  });

  // "each" is a one-time per-unit charge, not a rental: count what was delivered in the
  // period, and do not count what arrived before it.
  it("charges an each-basis item per unit delivered in the period", () => {
    const perEach: BillingItem = { ...matDaily, name: "Marker flag", default_rate: 5, rate_basis: "each" };
    const report = run({
      items: [perEach],
      movements: [
        move({ to_location_id: "site-a", qty: 3, at: "2026-05-20T00:00:00Z" }), // before period: ignored
        move({ to_location_id: "site-a", qty: 3, at: "2026-06-02T00:00:00Z" }),
        move({ to_location_id: "site-a", qty: 2, at: "2026-06-05T00:00:00Z" }),
      ],
    });

    expect(report.lines[0].intervals).toHaveLength(0);
    expect(report.lines[0].quantity).toBe(5);
    expect(report.lines[0].amount).toBe(25);
  });

  it("does not bill stock in your own yard", () => {
    const report = run({ movements: [move({ to_location_id: "yard", qty: 5, at: "2026-06-01T00:00:00Z" })] });

    expect(report.lines).toHaveLength(0);
    expect(report.total).toBe(0);
  });

  it("ignores an item that is not billable or has no rate", () => {
    const notBillable: BillingItem = { ...matDaily, billable: false };
    const noRate: BillingItem = { ...matDaily, id: "norate", default_rate: null };

    expect(run({ items: [notBillable], movements: [move({ to_location_id: "site-a", qty: 5, at: "2026-06-01T00:00:00Z" })] }).lines).toHaveLength(0);
    expect(run({ items: [noRate], movements: [move({ item_id: "norate", to_location_id: "site-a", qty: 5, at: "2026-06-01T00:00:00Z" })] }).lines).toHaveLength(0);
  });

  it("totals per site and overall", () => {
    const report = run({
      places: [siteA, siteB, yard],
      movements: [
        move({ to_location_id: "site-a", qty: 5, at: "2026-06-01T00:00:00Z" }), // 500
        move({ to_location_id: "site-b", qty: 2, at: "2026-06-01T00:00:00Z" }), // 200
      ],
    });

    expect(report.sites).toHaveLength(2);
    expect(report.sites.find((site) => site.siteId === "site-a")?.amount).toBe(500);
    expect(report.sites.find((site) => site.siteId === "site-b")?.amount).toBe(200);
    expect(report.total).toBe(700);
  });
});

describe("formatRentalRate", () => {
  it("reads a per-period rate and a per-unit rate", () => {
    expect(formatRentalRate(10, "day")).toBe("$10.00/day");
    expect(formatRentalRate(5, "each")).toBe("$5.00 each");
  });
});
