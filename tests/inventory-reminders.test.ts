import { describe, expect, it } from "vitest";
import { buildInventoryLowStockNotifications } from "@/lib/inventory-reminders";
import type { StockLevelBalance, StockLevelItem } from "@/lib/inventory-stock-levels";
import type { Database } from "@/types/database";

type User = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;

const worker: User = {
  active: true,
  app_access: "app_access",
  email: "worker@example.com",
  full_name: "Wanda Worker",
  id: "worker-1",
  power_level: "worker",
};
const manager: User = {
  active: true,
  app_access: "admin_access",
  email: "manager@example.com",
  full_name: "Manny Manager",
  id: "manager-1",
  power_level: "manager",
};
const inactiveManager: User = { ...manager, active: false, email: "gone@example.com", id: "manager-2" };

const gloves: StockLevelItem = {
  id: "gloves",
  name: "Nitrile gloves",
  reorder_point: 20,
  unit_of_measure: "box",
  active: true,
};

function bal(item_id: string, qty: number, allows_negative = false): StockLevelBalance {
  return { allows_negative, item_id, qty };
}

const build = (over: {
  balances?: StockLevelBalance[];
  items?: StockLevelItem[];
  users?: User[];
}) =>
  buildInventoryLowStockNotifications({
    balances: over.balances ?? [],
    createdAt: "2026-07-24T00:00:00.000Z",
    items: over.items ?? [gloves],
    tenantId: "tenant-1",
    users: over.users ?? [manager],
  });

describe("buildInventoryLowStockNotifications", () => {
  it("raises nothing when stock is above the reorder point", () => {
    expect(build({ balances: [bal("gloves", 30)] })).toHaveLength(0);
  });

  it("raises a low-stock notice at or below the reorder point", () => {
    const notes = build({ balances: [bal("gloves", 12)] });

    expect(notes).toHaveLength(1);
    expect(notes[0].title).toBe("Low stock: Nitrile gloves");
    expect(notes[0].body).toContain("12 box on hand");
    expect(notes[0].body).toContain("reorder point of 20");
    expect(notes[0].user_id).toBe("manager-1");
    expect(notes[0].recipient_type).toBe("inventory_manager");
  });

  it("says out of stock, not low, when there is nothing on hand", () => {
    const notes = build({ balances: [] });

    expect(notes[0].title).toBe("Out of stock: Nitrile gloves");
    expect(notes[0].body).toContain("out of stock");
  });

  // Only real places count toward on-hand, so stock sitting in loss must not mask a shortage.
  it("ignores virtual-place balances when deciding a shortage", () => {
    const notes = build({ balances: [bal("gloves", 5), bal("gloves", 100, true)] });

    expect(notes).toHaveLength(1);
    expect(notes[0].body).toContain("5 box on hand");
  });

  it("notifies every active manager or admin, and no one else", () => {
    const notes = build({ balances: [bal("gloves", 1)], users: [worker, manager, inactiveManager] });

    expect(notes.map((note) => note.user_id)).toEqual(["manager-1"]);
  });

  it("does not watch an item without a reorder point", () => {
    const notes = build({
      balances: [bal("mats", 0)],
      items: [{ id: "mats", name: "Rig mats", reorder_point: null, unit_of_measure: "each", active: true }],
    });

    expect(notes).toHaveLength(0);
  });
});
