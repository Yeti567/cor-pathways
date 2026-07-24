import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildInventoryLocationWrite,
  coerceInventoryLocationKind,
  inventoryLocationKinds,
  inventoryLocationLabel,
  selectableInventoryLocationKinds,
  virtualInventoryLocations,
} from "@/lib/inventory-locations";

describe("stocking place kinds", () => {
  it("rejects an unknown kind rather than passing it to the database", () => {
    expect(coerceInventoryLocationKind("yard")).toBe("yard");
    expect(coerceInventoryLocationKind("moon_base")).toBeNull();
    expect(coerceInventoryLocationKind(null)).toBeNull();
  });

  it("never offers the virtual pair as something to create by hand", () => {
    expect(selectableInventoryLocationKinds).not.toContain("transit");
    expect(selectableInventoryLocationKinds).not.toContain("loss");
    expect(selectableInventoryLocationKinds).toContain("yard");
  });

  it("seeds exactly the two virtual places, and marks them virtual", () => {
    expect(virtualInventoryLocations.map((place) => place.kind).sort()).toEqual(["loss", "transit"]);

    for (const place of virtualInventoryLocations) {
      expect(inventoryLocationKinds[place.kind].virtual).toBe(true);
      expect(inventoryLocationKinds[place.kind].backing).toBe("none");
    }
  });

  it("gives every non-virtual kind something real to point at", () => {
    for (const kind of selectableInventoryLocationKinds) {
      expect(inventoryLocationKinds[kind].backing).not.toBe("none");
    }
  });
});

describe("buildInventoryLocationWrite", () => {
  it("requires a kind", () => {
    const result = buildInventoryLocationWrite({ backingId: "x", kind: null });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBe("Choose what sort of place this is.");
  });

  it("refuses to hand-create a virtual place", () => {
    const result = buildInventoryLocationWrite({ backingId: null, kind: "transit" });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("created automatically");
  });

  it("asks for the right sort of backing in the message", () => {
    const vehicle = buildInventoryLocationWrite({ backingId: null, kind: "vehicle" });
    const worker = buildInventoryLocationWrite({ backingId: null, kind: "worker" });
    const yard = buildInventoryLocationWrite({ backingId: null, kind: "yard" });

    expect(vehicle.ok === false && vehicle.error).toContain("a vehicle");
    expect(worker.ok === false && worker.error).toContain("a worker");
    expect(yard.ok === false && yard.error).toContain("a location");
  });

  // Mirrors inventory_location_backing_check: exactly one reference, decided by kind.
  it("sets exactly one backing column, matching the kind", () => {
    const cases = [
      { column: "location_id", kind: "yard" },
      { column: "location_id", kind: "customer_site" },
      { column: "location_id", kind: "vendor" },
      { column: "location_id", kind: "job" },
      { column: "equipment_id", kind: "vehicle" },
      { column: "user_id", kind: "worker" },
    ] as const;

    for (const testCase of cases) {
      const result = buildInventoryLocationWrite({ backingId: "backing-id", kind: testCase.kind });

      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      const set = (["location_id", "equipment_id", "user_id"] as const).filter(
        (column) => result.write[column] !== null,
      );

      expect(set).toEqual([testCase.column]);
      expect(result.write[testCase.column]).toBe("backing-id");
    }
  });

  // A backed place borrows its name live, so a renamed yard cannot drift out of step
  // with the stocking place pointing at it.
  it("stores no name of its own for a backed place", () => {
    const result = buildInventoryLocationWrite({ backingId: "backing-id", kind: "yard" });

    expect(result.ok && result.write.name).toBeNull();
  });
});

describe("inventoryLocationLabel", () => {
  it("prefers the live backing name", () => {
    expect(inventoryLocationLabel({ kind: "yard", name: "stale" }, "Queen Street Yard")).toBe("Queen Street Yard");
  });

  it("falls back to the stored name for a virtual place", () => {
    expect(inventoryLocationLabel({ kind: "transit", name: "In transit" })).toBe("In transit");
  });

  it("never renders an empty label", () => {
    expect(inventoryLocationLabel({ kind: "loss", name: null }, "  ")).toBe("Loss and write-off");
  });
});

describe("separation from public.locations", () => {
  const stockingMigration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260723020000_inventory_stocking_locations.sql"),
    "utf8",
  )
    .toLowerCase()
    // Strip the quoted identifiers so assertions read as plain SQL.
    .replace(/"/g, "");

  // The whole point of the table. public.locations feeds worker assignment, visitors,
  // equipment, incidents and the worker app through around thirty queries that mostly
  // filter nothing, so a row nobody can visit must never appear there.
  it("adds no column to public.locations, and takes the slice 1 one away", () => {
    expect(stockingMigration).toContain("drop column if exists location_kind");
    expect(stockingMigration).not.toContain("alter table public.locations add column");
  });

  it("keeps one stocking place per backing record", () => {
    expect(stockingMigration).toContain("inventory_location_tenant_location_key");
    expect(stockingMigration).toContain("inventory_location_tenant_equipment_key");
    expect(stockingMigration).toContain("inventory_location_tenant_user_key");
  });

  it("allows only one transit and one loss per tenant", () => {
    expect(stockingMigration).toContain("inventory_location_tenant_virtual_key");
    expect(stockingMigration).toContain("where kind in ('transit', 'loss')");
  });

  // Cascading here would delete stock history as a side effect of tidying a yard.
  it("restricts deletion of anything a stocking place points at", () => {
    const backingKeys = stockingMigration.match(/foreign key \((location_id|equipment_id|user_id)\)[^;]*/g) ?? [];

    expect(backingKeys).toHaveLength(3);
    for (const key of backingKeys) {
      expect(key).toContain("on delete restrict");
    }
  });
});
