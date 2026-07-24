import { describe, expect, it } from "vitest";
import {
  buildInventoryMovementWrite,
  formatInventoryQty,
  inventoryMovementTypes,
  parseInventoryQty,
  type InventoryMovementInput,
} from "@/lib/inventory-ledger";

const base: InventoryMovementInput = {
  fromLocationId: "place-a",
  itemId: "item-1",
  lossLocationId: "place-loss",
  movementType: "transfer",
  note: null,
  qty: 10,
  toLocationId: "place-b",
};

const build = (overrides: Partial<InventoryMovementInput> = {}) =>
  buildInventoryMovementWrite({ ...base, ...overrides });

function writeOf(result: ReturnType<typeof build>) {
  if (!result.ok) {
    throw new Error(`expected a movement, got: ${result.error}`);
  }
  return result.write;
}

function errorOf(result: ReturnType<typeof build>) {
  if (result.ok) {
    throw new Error("expected an error, got a movement");
  }
  return result.error;
}

describe("parseInventoryQty", () => {
  it("reads a plain number", () => {
    expect(parseInventoryQty("60")).toBe(60);
    expect(parseInventoryQty("12.5")).toBe(12.5);
  });

  it("tolerates thousands separators and stray spaces", () => {
    expect(parseInventoryQty(" 1,250 ")).toBe(1250);
  });

  // Returning 0 here would post a movement of nothing and look like it worked.
  it("returns null for anything unparseable, never zero", () => {
    expect(parseInventoryQty("")).toBeNull();
    expect(parseInventoryQty("   ")).toBeNull();
    expect(parseInventoryQty("abc")).toBeNull();
  });

  it("rounds to the three decimals the column stores", () => {
    expect(parseInventoryQty("1.23456")).toBe(1.235);
  });
});

describe("buildInventoryMovementWrite", () => {
  it("requires an item and a quantity", () => {
    expect(errorOf(build({ itemId: "" }))).toBe("Choose an item.");
    expect(errorOf(build({ qty: null }))).toBe("Enter a quantity.");
  });

  // Mirrors inventory_movement_qty_check. Direction lives in the endpoints, so a
  // negative quantity is never a way of expressing "the other way".
  it("refuses a zero or negative quantity", () => {
    expect(errorOf(build({ qty: 0 }))).toContain("greater than zero");
    expect(errorOf(build({ qty: -5 }))).toContain("greater than zero");
  });

  it("builds a transfer with both ends", () => {
    expect(writeOf(build())).toMatchObject({
      from_location_id: "place-a",
      qty: 10,
      to_location_id: "place-b",
    });
  });

  // Mirrors inventory_movement_endpoints_check.
  it("refuses a movement to where the stock already is", () => {
    expect(errorOf(build({ fromLocationId: "same", toLocationId: "same" }))).toContain("two different places");
  });

  it("drops the origin on a receipt, because new stock comes from outside", () => {
    const write = writeOf(build({ fromLocationId: "place-a", movementType: "receive" }));

    expect(write.from_location_id).toBeNull();
    expect(write.to_location_id).toBe("place-b");
  });

  it("requires a destination on a receipt", () => {
    expect(errorOf(build({ movementType: "receive", toLocationId: null }))).toBe("Choose where the stock is going.");
  });

  it("requires an origin on a transfer", () => {
    expect(errorOf(build({ fromLocationId: null }))).toBe("Choose where the stock is coming from.");
  });

  // A write-off always lands in the virtual loss place, so a balance is reduced by
  // recording where the stock went rather than by editing a number.
  it("routes a write-off to the loss place, whatever the form said", () => {
    const write = writeOf(build({ movementType: "write_off", toLocationId: "place-b" }));

    expect(write.to_location_id).toBe("place-loss");
    expect(write.from_location_id).toBe("place-a");
  });

  it("explains itself if the loss place is missing rather than posting a half movement", () => {
    expect(errorOf(build({ lossLocationId: null, movementType: "write_off" }))).toContain("write-off place is missing");
  });

  it("trims a note, and stores nothing rather than whitespace", () => {
    expect(writeOf(build({ note: "  spring thaw  " })).note).toBe("spring thaw");
    expect(writeOf(build({ note: "   " })).note).toBeNull();
  });

  it("never produces a movement that the endpoints constraint would reject", () => {
    const types = Object.keys(inventoryMovementTypes) as (keyof typeof inventoryMovementTypes)[];

    for (const movementType of types) {
      const result = build({ movementType });
      if (!result.ok) continue;

      const { from_location_id: from, to_location_id: to } = result.write;

      expect(from !== null || to !== null).toBe(true);
      expect(from === null || to === null || from !== to).toBe(true);
      expect(result.write.qty).toBeGreaterThan(0);
    }
  });
});

describe("formatInventoryQty", () => {
  it("drops the stored trailing zeros", () => {
    expect(formatInventoryQty(40)).toBe("40");
    expect(formatInventoryQty(12.5)).toBe("12.5");
  });
});
