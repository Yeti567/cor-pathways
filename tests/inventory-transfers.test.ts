import { describe, expect, it } from "vitest";
import {
  buildTransferArrivalWrite,
  buildTransferDepartureWrite,
  formatTransferAge,
  summariseTransferMovements,
  type TransferDepartureInput,
} from "@/lib/inventory-transfers";

const baseDeparture: TransferDepartureInput = {
  driverId: null,
  fromLocationId: "yard",
  lines: [{ itemId: "mat", qty: 60 }],
  note: null,
  toLocationId: "site7",
  vehicleId: null,
};

const departure = (overrides: Partial<TransferDepartureInput> = {}) =>
  buildTransferDepartureWrite({ ...baseDeparture, ...overrides });

function departureWrite(result: ReturnType<typeof departure>) {
  if (!result.ok) throw new Error(`expected a departure, got: ${result.error}`);
  return result.write;
}
function departureError(result: ReturnType<typeof departure>) {
  if (result.ok) throw new Error("expected an error, got a departure");
  return result.error;
}

describe("buildTransferDepartureWrite", () => {
  it("requires an origin, a destination, and different ones", () => {
    expect(departureError(departure({ fromLocationId: null }))).toContain("coming from");
    expect(departureError(departure({ toLocationId: null }))).toContain("going");
    expect(departureError(departure({ fromLocationId: "x", toLocationId: "x" }))).toContain("somewhere different");
  });

  it("requires at least one item", () => {
    expect(departureError(departure({ lines: [{ itemId: "", qty: null }] }))).toContain("at least one item");
  });

  it("rejects a non-positive quantity", () => {
    expect(departureError(departure({ lines: [{ itemId: "mat", qty: 0 }] }))).toContain("greater than zero");
    expect(departureError(departure({ lines: [{ itemId: "mat", qty: -5 }] }))).toContain("greater than zero");
  });

  it("builds the header and one line", () => {
    const write = departureWrite(departure({ driverId: "d1", vehicleId: "v1", note: " load 1 " }));

    expect(write.header).toMatchObject({
      driver_id: "d1",
      from_location_id: "yard",
      note: "load 1",
      to_location_id: "site7",
      vehicle_id: "v1",
    });
    expect(write.lines).toEqual([{ item_id: "mat", qty: 60 }]);
  });

  // Two rows for the same item become one line, so the manifest carries one movement per
  // item and the residual maths stays simple.
  it("folds duplicate item rows into one line", () => {
    const write = departureWrite(
      departure({ lines: [{ itemId: "mat", qty: 40 }, { itemId: "mat", qty: 20 }, { itemId: "", qty: null }] }),
    );

    expect(write.lines).toEqual([{ item_id: "mat", qty: 60 }]);
  });

  it("ignores blank rows", () => {
    const write = departureWrite(
      departure({ lines: [{ itemId: "mat", qty: 60 }, { itemId: "", qty: null }, { itemId: "", qty: null }] }),
    );

    expect(write.lines).toHaveLength(1);
  });
});

describe("buildTransferArrivalWrite", () => {
  it("defaults nothing but posts only what was delivered", () => {
    const result = buildTransferArrivalWrite([
      { itemId: "mat", qtyDelivered: 58, qtyLoaded: 60 },
      { itemId: "block", qtyDelivered: 0, qtyLoaded: 10 },
    ]);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.deliver).toEqual([{ item_id: "mat", qty: 58 }]);
  });

  it("refuses a negative delivered quantity", () => {
    const result = buildTransferArrivalWrite([{ itemId: "mat", qtyDelivered: -1, qtyLoaded: 60 }]);
    expect(result.ok === false && result.error).toContain("cannot be negative");
  });

  // You cannot take more off the truck than went on it.
  it("refuses delivering more than was loaded", () => {
    const result = buildTransferArrivalWrite([{ itemId: "mat", qtyDelivered: 61, qtyLoaded: 60 }]);
    expect(result.ok === false && result.error).toContain("more of an item than was loaded");
  });

  it("refuses an arrival where nothing was delivered", () => {
    const result = buildTransferArrivalWrite([{ itemId: "mat", qtyDelivered: 0, qtyLoaded: 60 }]);
    expect(result.ok === false && result.error).toContain("cancel the load instead");
  });
});

describe("summariseTransferMovements", () => {
  const transit = "transit";

  it("reads loaded, delivered, and the residual from the movements", () => {
    const summary = summariseTransferMovements(
      [
        { item_id: "mat", qty: 60, from_location_id: "yard", to_location_id: transit },
        { item_id: "mat", qty: 58, from_location_id: transit, to_location_id: "site7" },
      ],
      transit,
    );

    expect(summary).toEqual([{ itemId: "mat", loaded: 60, delivered: 58, residual: 2 }]);
  });

  it("shows a full residual for a load that has not arrived", () => {
    const summary = summariseTransferMovements(
      [{ item_id: "mat", qty: 60, from_location_id: "yard", to_location_id: transit }],
      transit,
    );

    expect(summary[0]).toMatchObject({ loaded: 60, delivered: 0, residual: 60 });
  });
});

describe("formatTransferAge", () => {
  const t0 = new Date("2026-07-24T00:00:00Z").getTime();

  it("reads minutes, hours, and days", () => {
    expect(formatTransferAge("2026-07-24T00:00:00Z", t0 + 5 * 60000)).toBe("5 minutes");
    expect(formatTransferAge("2026-07-24T00:00:00Z", t0 + 3 * 3600000)).toBe("3 hours");
    expect(formatTransferAge("2026-07-24T00:00:00Z", t0 + 3 * 86400000)).toBe("3 days");
  });

  it("never goes negative for a clock skew", () => {
    expect(formatTransferAge("2026-07-24T00:00:00Z", t0 - 10000)).toBe("0 minutes");
  });
});
