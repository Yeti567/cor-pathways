import { describe, expect, it } from "vitest";
import {
  lowStockLevels,
  summariseInventoryStockLevels,
  type StockLevelBalance,
  type StockLevelItem,
} from "@/lib/inventory-stock-levels";

const gloves: StockLevelItem = {
  id: "gloves",
  name: "Nitrile gloves",
  reorder_point: 20,
  unit_of_measure: "box",
  active: true,
};
const mats: StockLevelItem = {
  id: "mats",
  name: "Rig mats",
  reorder_point: null,
  unit_of_measure: "each",
  active: true,
};

function bal(item_id: string, qty: number, allows_negative = false): StockLevelBalance {
  return { allows_negative, item_id, qty };
}

describe("summariseInventoryStockLevels", () => {
  // On-hand is the sum across real places; the virtual loss and transit places
  // (allows_negative) are not stock you can deploy.
  it("sums real places and ignores the virtual ones", () => {
    const levels = summariseInventoryStockLevels(
      [gloves],
      [bal("gloves", 8), bal("gloves", 5), bal("gloves", 30, true)],
    );

    expect(levels).toHaveLength(1);
    expect(levels[0].onHand).toBe(13);
    expect(levels[0].state).toBe("low");
  });

  it("marks an item at or below its reorder point low, and above it ok", () => {
    expect(summariseInventoryStockLevels([gloves], [bal("gloves", 20)])[0].state).toBe("low");
    expect(summariseInventoryStockLevels([gloves], [bal("gloves", 21)])[0].state).toBe("ok");
  });

  it("marks an item with nothing on hand as out, not merely low", () => {
    expect(summariseInventoryStockLevels([gloves], [])[0].state).toBe("out");
    expect(summariseInventoryStockLevels([gloves], [bal("gloves", 0)])[0].state).toBe("out");
  });

  // A negative real balance is an error condition, but it is certainly not "in stock".
  it("treats a negative real balance as out", () => {
    expect(summariseInventoryStockLevels([gloves], [bal("gloves", -3)])[0].state).toBe("out");
  });

  it("does not watch an item without a reorder point", () => {
    expect(summariseInventoryStockLevels([mats], [bal("mats", 0)])).toHaveLength(0);
  });

  it("does not watch an archived item", () => {
    expect(summariseInventoryStockLevels([{ ...gloves, active: false }], [])).toHaveLength(0);
  });

  // Worst first, so the most urgent shortage is what a reader sees at the top.
  it("orders out before low before ok", () => {
    const levels = summariseInventoryStockLevels(
      [
        { ...gloves, id: "a", name: "A", reorder_point: 10 },
        { ...gloves, id: "b", name: "B", reorder_point: 10 },
        { ...gloves, id: "c", name: "C", reorder_point: 10 },
      ],
      [bal("a", 50), bal("b", 0), bal("c", 5)],
    );

    expect(levels.map((level) => level.itemId)).toEqual(["b", "c", "a"]);
  });
});

describe("lowStockLevels", () => {
  it("keeps only the items that need attention", () => {
    const levels = summariseInventoryStockLevels(
      [
        { ...gloves, id: "a", name: "A", reorder_point: 10 },
        { ...gloves, id: "b", name: "B", reorder_point: 10 },
      ],
      [bal("a", 50), bal("b", 2)],
    );

    expect(lowStockLevels(levels).map((level) => level.itemId)).toEqual(["b"]);
  });
});
