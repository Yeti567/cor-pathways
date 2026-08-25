import { describe, expect, it } from "vitest";
import {
  buildEquipmentAttachmentStoragePath,
  buildVehicleFileStatuses,
  equipmentAttachmentStoragePrefix,
  parseUploadedEquipmentAttachmentPaths,
} from "@/lib/equipment";

const tenantId = "0a0a0a0a-1b1b-4c2c-8d3d-4e4e4e4e4e4e";
const otherTenantId = "11111111-2222-4333-8444-555555555555";
const equipmentId = "5f5f5f5f-6a6a-4b7b-8c8c-9d9d9d9d9d9d";
const otherEquipmentId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const location = { equipmentId, folder: "documents", tenantId } as const;
const prefix = equipmentAttachmentStoragePrefix(location);

describe("equipment attachment storage paths", () => {
  it("keeps a path the browser uploaded into this unit's own folder", () => {
    const path = `${prefix}1787600004365-0-951-CVIP.pdf`;

    expect(parseUploadedEquipmentAttachmentPaths([path], location)).toEqual([path]);
  });

  it("drops another tenant's path", () => {
    const path = `${otherTenantId}/equipment/${equipmentId}/documents/stolen.pdf`;

    expect(parseUploadedEquipmentAttachmentPaths([path], location)).toEqual([]);
  });

  it("drops another unit's path", () => {
    const path = `${tenantId}/equipment/${otherEquipmentId}/documents/other-unit.pdf`;

    expect(parseUploadedEquipmentAttachmentPaths([path], location)).toEqual([]);
  });

  it("drops a path from a different folder", () => {
    const path = `${tenantId}/equipment/${equipmentId}/photos/photo.jpg`;

    expect(parseUploadedEquipmentAttachmentPaths([path], location)).toEqual([]);
  });

  it("drops traversal and nested segments", () => {
    const paths = [`${prefix}../../../secrets.pdf`, `${prefix}nested/deeper.pdf`, `${prefix}..`];

    expect(parseUploadedEquipmentAttachmentPaths(paths, location)).toEqual([]);
  });

  it("ignores non-string form entries and de-duplicates", () => {
    const path = `${prefix}1787600004365-0-951-CVIP.pdf`;

    expect(parseUploadedEquipmentAttachmentPaths([path, path, 42 as unknown as string], location)).toEqual([path]);
  });

  it("builds a path the parser accepts, with the filename sanitised", () => {
    const built = buildEquipmentAttachmentStoragePath({
      ...location,
      fileName: "951 CVIP Exp. Dec 31 2026.pdf",
      index: 0,
    });

    expect(built.startsWith(prefix)).toBe(true);
    expect(built).toContain("951-CVIP-Exp.-Dec-31-2026.pdf");
    expect(parseUploadedEquipmentAttachmentPaths([built], location)).toEqual([built]);
  });
});

describe("a duplicate entry does not hide a filed certificate", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  // A unit as it stood after the fleet load plus an admin's upload: the bulk-loaded
  // placeholder and the scanned certificate, both expiring on the same day.
  const placeholder = { expiryDate: "2026-12-31", hasProof: false, isActive: true, docType: "cvip" } as const;
  const scanned = { expiryDate: "2026-12-31", hasProof: true, isActive: true, docType: "cvip" } as const;

  it("reads as on file whichever order the rows arrive in", () => {
    for (const documents of [
      [placeholder, scanned],
      [scanned, placeholder],
    ]) {
      const [cvip] = buildVehicleFileStatuses({ category: "trailer", documents: documents.map((d) => ({ ...d, reminderLeadDays: 30 })) }, now).filter(
        (status) => status.docType === "cvip",
      );

      expect(cvip.state).toBe("on_file");
      expect(cvip.hasProof).toBe(true);
    }
  });

  it("still refuses to let last year's scan prove this year's inspection", () => {
    const [cvip] = buildVehicleFileStatuses(
      {
        category: "trailer",
        documents: [
          { docType: "cvip", expiryDate: "2025-12-31", hasProof: true, isActive: true, reminderLeadDays: 30 },
          { docType: "cvip", expiryDate: "2026-12-31", hasProof: false, isActive: true, reminderLeadDays: 30 },
        ],
      },
      now,
    ).filter((status) => status.docType === "cvip");

    expect(cvip.state).toBe("awaiting_proof");
  });
});
