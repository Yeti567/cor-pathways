import { describe, expect, it } from "vitest";
import {
  buildInventoryItemWrite,
  coerceInventoryRateBasis,
  coerceInventoryTrackingMode,
  describeInventoryItem,
  type InventoryItemInput,
} from "@/lib/inventory";

const baseInput: InventoryItemInput = {
  active: true,
  billable: false,
  categoryId: null,
  defaultRate: null,
  equipmentId: null,
  name: "Rig Mat",
  notes: null,
  rateBasis: null,
  returnable: true,
  sku: null,
  trackingMode: "bulk",
  unitOfMeasure: "each",
};

const build = (overrides: Partial<InventoryItemInput> = {}) => buildInventoryItemWrite({ ...baseInput, ...overrides });

/** Asserts the build succeeded and hands back the row, so tests read without optional chaining. */
function writeOf(result: ReturnType<typeof build>) {
  if (!result.ok) {
    throw new Error(`expected a successful write, got: ${result.error}`);
  }

  return result.write;
}

/** Asserts the build failed and hands back the message. */
function expectError(result: ReturnType<typeof build>) {
  if (result.ok) {
    throw new Error("expected a validation error, got a successful write");
  }

  return result.error;
}

describe("coercion", () => {
  it("treats anything that is not 'serial' as bulk", () => {
    expect(coerceInventoryTrackingMode("serial")).toBe("serial");
    expect(coerceInventoryTrackingMode("bulk")).toBe("bulk");
    expect(coerceInventoryTrackingMode("nonsense")).toBe("bulk");
    expect(coerceInventoryTrackingMode(undefined)).toBe("bulk");
  });

  it("rejects an unknown rate basis rather than passing it to the database", () => {
    expect(coerceInventoryRateBasis("day")).toBe("day");
    expect(coerceInventoryRateBasis("fortnight")).toBeNull();
    expect(coerceInventoryRateBasis("")).toBeNull();
  });
});

describe("buildInventoryItemWrite", () => {
  it("requires a name", () => {
    expect(expectError(build({ name: "   " }))).toBe("Enter a name for the item.");
  });

  it("trims the name and blanks an empty SKU rather than storing whitespace", () => {
    const result = build({ name: "  Rig Mat  ", sku: "   " });

    expect(writeOf(result).name).toBe("Rig Mat");
    expect(writeOf(result).sku).toBeNull();
  });

  it("falls back to 'each' when no unit is given", () => {
    expect(writeOf(build({ unitOfMeasure: "  " })).unit_of_measure).toBe("each");
  });

  it("refuses a negative rate", () => {
    expect(expectError(build({ billable: true, defaultRate: -1, rateBasis: "day" }))).toBe("A rate cannot be negative.");
  });

  it("refuses a rate with no period to charge it against", () => {
    expect(expectError(build({ billable: true, defaultRate: 25, rateBasis: null }))).toBe(
      "Choose how the rate is charged: per day, week, month, or unit.",
    );
  });

  it("keeps a fully specified billable item intact", () => {
    const result = build({ billable: true, defaultRate: 25, rateBasis: "day" });

    expect(writeOf(result)).toMatchObject({ billable: true, default_rate: 25, rate_basis: "day" });
  });

  // The database forbids a rate on a non-billable item. Clearing it here is what stops
  // that constraint ever surfacing as an error the user has to decode.
  it("clears the rate when billing is turned off, instead of erroring", () => {
    const result = build({ billable: false, defaultRate: 25, rateBasis: "day" });

    expect(result.ok).toBe(true);
    expect(writeOf(result).default_rate).toBeNull();
    expect(writeOf(result).rate_basis).toBeNull();
  });

  // Likewise: only a serialized unit may point at an equipment record.
  it("drops the equipment link when the item is bulk", () => {
    const result = build({ equipmentId: "40000000-0000-0000-0000-000000000001", trackingMode: "bulk" });

    expect(result.ok).toBe(true);
    expect(writeOf(result).equipment_id).toBeNull();
  });

  it("keeps the equipment link on a serialized unit", () => {
    const result = build({ equipmentId: "40000000-0000-0000-0000-000000000001", trackingMode: "serial" });

    expect(writeOf(result).equipment_id).toBe("40000000-0000-0000-0000-000000000001");
  });

  it("produces a write that satisfies every database check constraint", () => {
    // Mirrors inventory_item_billable_rate_check and inventory_item_equipment_serial_check.
    const combinations: Partial<InventoryItemInput>[] = [
      { billable: false, defaultRate: 99, rateBasis: "week" },
      { billable: true, defaultRate: 99, rateBasis: "week" },
      { equipmentId: "40000000-0000-0000-0000-000000000001", trackingMode: "bulk" },
      { equipmentId: "40000000-0000-0000-0000-000000000001", trackingMode: "serial" },
    ];

    for (const overrides of combinations) {
      const built = build(overrides);
      const write = built.ok ? built.write : undefined;

      expect(write).toBeDefined();
      if (!write) continue;

      const rateOnlyWhenBillable = write.billable || (write.default_rate === null && write.rate_basis === null);
      const equipmentOnlyWhenSerial = write.equipment_id === null || write.tracking_mode === "serial";

      expect(rateOnlyWhenBillable).toBe(true);
      expect(equipmentOnlyWhenSerial).toBe(true);
    }
  });
});

describe("describeInventoryItem", () => {
  it("describes a bulk rental that bills by the day", () => {
    expect(
      describeInventoryItem({
        billable: true,
        default_rate: 25,
        rate_basis: "day",
        returnable: true,
        tracking_mode: "bulk",
      }),
    ).toBe("Bulk · Comes back · Billed per day");
  });

  it("describes a consumable", () => {
    expect(
      describeInventoryItem({
        billable: false,
        default_rate: null,
        rate_basis: null,
        returnable: false,
        tracking_mode: "bulk",
      }),
    ).toBe("Bulk · Consumed");
  });

  it("says billable without inventing a period when the rate is not set", () => {
    expect(
      describeInventoryItem({
        billable: true,
        default_rate: null,
        rate_basis: null,
        returnable: true,
        tracking_mode: "serial",
      }),
    ).toBe("Serialized · Comes back · Billable");
  });
});
