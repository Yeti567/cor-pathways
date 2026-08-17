import { describe, expect, it } from "vitest";
import {
  duplicateMessage,
  findEmailDuplicate,
  findEquipmentDuplicate,
  findPersonNameDuplicate,
  normalizeIdentifier,
  normalizePersonName,
  type EquipmentDuplicateRow,
} from "@/lib/duplicate-check";

describe("normalizeIdentifier", () => {
  it("treats the real-world spellings of one unit number as the same", () => {
    const variants = ["T-014", "t 014", "T014", "t-014 ", "T.014"];
    const keys = new Set(variants.map(normalizeIdentifier));
    expect(keys.size).toBe(1);
  });

  it("keeps genuinely different units apart", () => {
    expect(normalizeIdentifier("T-014")).not.toBe(normalizeIdentifier("T-140"));
    expect(normalizeIdentifier("T-14")).not.toBe(normalizeIdentifier("T-014"));
  });
});

describe("normalizePersonName", () => {
  it("ignores casing, padding and punctuation", () => {
    expect(normalizePersonName("  Sam  O'Rivera ")).toBe(normalizePersonName("sam o rivera"));
  });

  it("does not collapse different people", () => {
    expect(normalizePersonName("Sam Rivera")).not.toBe(normalizePersonName("Sam Riveray"));
  });
});

describe("findEquipmentDuplicate", () => {
  const fleet: EquipmentDuplicateRow[] = [
    {
      id: "e1",
      unit_number: "T-014",
      vin_or_serial: "1XKYDP9X5KJ123456",
      license_plate: "ABC1234",
      status: "active",
    },
    { id: "e2", unit_number: "TR-88", vin_or_serial: null, license_plate: null, status: "retired" },
  ];

  it("catches the same unit typed with different punctuation", () => {
    const match = findEquipmentDuplicate({ unitNumber: "t014" }, fleet);
    expect(match).toMatchObject({ id: "e1", field: "unit number", label: "T-014" });
  });

  it("catches a repeat VIN even when the unit is named differently", () => {
    const match = findEquipmentDuplicate({ unitNumber: "BRAND-NEW", vin: "1xkydp9x5kj123456" }, fleet);
    expect(match).toMatchObject({ id: "e1", field: "VIN" });
  });

  it("prefers the VIN collision, because a VIN is the most conclusive", () => {
    const match = findEquipmentDuplicate({ unitNumber: "TR-88", vin: "1XKYDP9X5KJ123456" }, fleet);
    expect(match?.field).toBe("VIN");
  });

  it("catches a repeat plate", () => {
    const match = findEquipmentDuplicate({ unitNumber: "SOMETHING-ELSE", plate: "abc 1234" }, fleet);
    expect(match).toMatchObject({ field: "licence plate" });
  });

  it("reports a retired unit's status so the operator knows why they cannot see it", () => {
    const match = findEquipmentDuplicate({ unitNumber: "tr88" }, fleet);
    expect(match?.status).toBe("retired");
    expect(duplicateMessage(match!, "unit")).toContain("(retired)");
  });

  it("lets a unit keep its own identifiers when being edited", () => {
    expect(findEquipmentDuplicate({ unitNumber: "T-014", excludeId: "e1" }, fleet)).toBeNull();
  });

  it("still blocks renaming one unit onto another", () => {
    const match = findEquipmentDuplicate({ unitNumber: "T-014", excludeId: "e2" }, fleet);
    expect(match).toMatchObject({ id: "e1" });
  });

  it("returns null for a genuinely new unit", () => {
    expect(findEquipmentDuplicate({ unitNumber: "T-999", vin: "NEWVIN", plate: "ZZZ9999" }, fleet)).toBeNull();
  });

  it("does not match on blank identifiers", () => {
    const withBlanks: EquipmentDuplicateRow[] = [
      { id: "e3", unit_number: "T-1", vin_or_serial: null, license_plate: null },
    ];
    // A new unit with no VIN must not match the existing unit's null VIN.
    expect(findEquipmentDuplicate({ unitNumber: "T-2", vin: null, plate: null }, withBlanks)).toBeNull();
  });
});

describe("findPersonNameDuplicate", () => {
  const drivers = [
    { id: "d1", full_name: "Sam Rivera" },
    { id: "d2", full_name: "Jordan Ellis" },
  ];

  it("flags the same driver entered twice", () => {
    expect(findPersonNameDuplicate({ fullName: "  sam   rivera " }, drivers)).toMatchObject({
      id: "d1",
      field: "name",
    });
  });

  it("lets a person keep their own name when being edited", () => {
    expect(findPersonNameDuplicate({ fullName: "Sam Rivera", excludeId: "d1" }, drivers)).toBeNull();
  });

  it("returns null for a new name and for a blank name", () => {
    expect(findPersonNameDuplicate({ fullName: "Someone New" }, drivers)).toBeNull();
    expect(findPersonNameDuplicate({ fullName: "   " }, drivers)).toBeNull();
  });
});

describe("findEmailDuplicate", () => {
  const users = [{ id: "u1", email: "Sam@Example.com", full_name: "Sam Rivera" }];

  it("matches regardless of casing or padding, because email is the login", () => {
    expect(findEmailDuplicate({ email: " sam@example.com " }, users)).toMatchObject({ id: "u1", field: "email" });
  });

  it("returns null for a new address", () => {
    expect(findEmailDuplicate({ email: "new@example.com" }, users)).toBeNull();
  });
});

describe("duplicateMessage", () => {
  it("names the field and the existing record, and says what to do", () => {
    const message = duplicateMessage({ id: "e1", field: "unit number", label: "T-014", status: "active" }, "unit");
    expect(message).toContain("unit number");
    expect(message).toContain("T-014");
    expect(message).toMatch(/instead of creating a second one/i);
    // An active record needs no status noise.
    expect(message).not.toContain("(active)");
  });
});
