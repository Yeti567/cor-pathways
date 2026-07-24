import { describe, expect, it } from "vitest";
import {
  buildInventoryGrid,
  gridCellQty,
  type InventoryGridBalance,
  type InventoryGridItem,
  type InventoryGridPlace,
} from "@/lib/inventory-grid";

const items: InventoryGridItem[] = [
  { id: "mat", name: "Rig Mat", category_id: "mats", unit_of_measure: "each" },
  { id: "gen", name: "Generator", category_id: "tools", unit_of_measure: "each" },
];

const places: InventoryGridPlace[] = [
  { id: "yard", kind: "yard", label: "Queen Street Yard" },
  { id: "site7", kind: "customer_site", label: "Site 7" },
  { id: "transit", kind: "transit", label: "In transit" },
];

const balances: InventoryGridBalance[] = [
  { item_id: "mat", location_id: "yard", qty: 40 },
  { item_id: "mat", location_id: "site7", qty: 60 },
  { item_id: "mat", location_id: "transit", qty: 5 },
  { item_id: "gen", location_id: "yard", qty: 2 },
];

describe("buildInventoryGrid", () => {
  it("pivots balances into rows of items and columns of places", () => {
    const grid = buildInventoryGrid(balances, items, places);

    expect(grid.rows.map((row) => row.item.name)).toEqual(["Generator", "Rig Mat"]);
    expect(grid.columns.map((column) => column.place.label)).toContain("Queen Street Yard");
  });

  it("totals each row, each column, and the whole grid", () => {
    const grid = buildInventoryGrid(balances, items, places);

    const mat = grid.rows.find((row) => row.item.id === "mat")!;
    expect(mat.total).toBe(105);

    const yard = grid.columns.find((column) => column.place.id === "yard")!;
    expect(yard.total).toBe(42);

    expect(grid.grandTotal).toBe(107);
  });

  it("reads a cell back by item and place", () => {
    const grid = buildInventoryGrid(balances, items, places);
    const mat = grid.rows.find((row) => row.item.id === "mat")!;

    expect(gridCellQty(mat, "site7")).toBe(60);
    expect(gridCellQty(mat, "yard")).toBe(40);
  });

  it("returns zero for a cell the item has no balance at", () => {
    const grid = buildInventoryGrid(balances, items, places);
    const gen = grid.rows.find((row) => row.item.id === "gen")!;

    expect(gridCellQty(gen, "site7")).toBe(0);
  });

  // Zeros are how a place empties out and an item is fully paid away. Padding the grid
  // with them makes it unreadable at any real size.
  it("drops a place with no stock and an item with no stock", () => {
    const grid = buildInventoryGrid(
      [{ item_id: "mat", location_id: "yard", qty: 10 }],
      items,
      places,
    );

    expect(grid.columns.map((column) => column.place.id)).toEqual(["yard"]);
    expect(grid.rows.map((row) => row.item.id)).toEqual(["mat"]);
  });

  it("ignores a zero balance entirely", () => {
    const grid = buildInventoryGrid([{ item_id: "mat", location_id: "yard", qty: 0 }], items, places);

    expect(grid.rows).toHaveLength(0);
    expect(grid.grandTotal).toBe(0);
  });

  it("orders real places before virtual ones, so yards keep the left of the table", () => {
    const grid = buildInventoryGrid(balances, items, places);

    const kinds = grid.columns.map((column) => column.virtual);
    // every real column comes before every virtual one
    expect(kinds).toEqual([...kinds].sort((a, b) => Number(a) - Number(b)));
    expect(grid.columns.at(-1)!.place.kind).toBe("transit");
  });

  it("shows a negative transit balance rather than hiding it", () => {
    const grid = buildInventoryGrid(
      [{ item_id: "mat", location_id: "transit", qty: -5 }],
      items,
      places,
    );

    expect(grid.columns).toHaveLength(1);
    expect(grid.rows[0].total).toBe(-5);
    expect(gridCellQty(grid.rows[0], "transit")).toBe(-5);
  });

  describe("filters", () => {
    it("keeps only items in the chosen category", () => {
      const grid = buildInventoryGrid(balances, items, places, { categoryId: "mats" });

      expect(grid.rows.map((row) => row.item.id)).toEqual(["mat"]);
      // the generator's yard stock is gone, so the yard column reflects mats only
      expect(grid.columns.find((column) => column.place.id === "yard")!.total).toBe(40);
    });

    it("keeps only places of the chosen kind", () => {
      const grid = buildInventoryGrid(balances, items, places, { kind: "customer_site" });

      expect(grid.columns.map((column) => column.place.id)).toEqual(["site7"]);
      expect(grid.grandTotal).toBe(60);
    });

    it("treats an empty kind as no filter", () => {
      const all = buildInventoryGrid(balances, items, places, { kind: "" });
      const none = buildInventoryGrid(balances, items, places);

      expect(all.grandTotal).toBe(none.grandTotal);
    });
  });

  it("ignores a balance pointing at an item or place that no longer loads", () => {
    const grid = buildInventoryGrid(
      [
        { item_id: "mat", location_id: "yard", qty: 10 },
        { item_id: "ghost-item", location_id: "yard", qty: 99 },
        { item_id: "mat", location_id: "ghost-place", qty: 99 },
      ],
      items,
      places,
    );

    expect(grid.grandTotal).toBe(10);
  });
});
