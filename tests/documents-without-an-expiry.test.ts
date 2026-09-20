import { describe, expect, it } from "vitest";

import {
  buildUnitCertificationStatuses,
  buildVehicleFileStatuses,
  getEquipmentDocumentStatus,
  getEquipmentServiceIndicator,
} from "@/lib/equipment";
import { certificationStatus } from "@/lib/workers";

const now = new Date("2026-09-19T12:00:00Z");

describe("a document with no expiry date", () => {
  it("is current when a file is attached, and says so instead of showing a date", () => {
    expect(
      getEquipmentDocumentStatus({ expiryDate: null, hasProof: true, isActive: true, reminderLeadDays: 30 }, now),
    ).toMatchObject({ label: "Does not expire", state: "current", tone: "green" });
  });

  it("is a gap when nothing is attached, because an empty record proves nothing", () => {
    expect(
      getEquipmentDocumentStatus({ expiryDate: null, hasProof: false, isActive: true, reminderLeadDays: 30 }, now),
    ).toMatchObject({ label: "Needs a document", state: "due_soon", tone: "amber" });
  });

  it("is taken at its word when the caller cannot know whether a file is attached", () => {
    // Several list pages read a query that does not select attachment_ids. They must
    // keep working, and they must not turn a fleet amber on a fact they did not load.
    expect(
      getEquipmentDocumentStatus({ expiryDate: null, isActive: true, reminderLeadDays: 30 }, now),
    ).toMatchObject({ state: "current" });
  });

  it("never reports overdue, however long ago it was issued", () => {
    // The point of the change: there is no renewal, so there is nothing to be late for.
    expect(
      getEquipmentDocumentStatus({ expiryDate: null, hasProof: true, isActive: true, reminderLeadDays: 0 }, now).state,
    ).not.toBe("overdue");
  });

  it("drags a unit's indicator to amber when it is the only thing missing", () => {
    expect(
      getEquipmentServiceIndicator(
        {
          currentMeter: null,
          documents: [
            { expiryDate: "2027-01-31", hasProof: true, isActive: true, reminderLeadDays: 30 },
            { expiryDate: null, hasProof: false, isActive: true, reminderLeadDays: 30 },
          ],
          scheduledServices: [],
        },
        now,
      ),
    ).toMatchObject({ state: "due_soon" });
  });

  it("leaves the unit green once that document is filed", () => {
    expect(
      getEquipmentServiceIndicator(
        {
          currentMeter: null,
          documents: [
            { expiryDate: "2027-01-31", hasProof: true, isActive: true, reminderLeadDays: 30 },
            { expiryDate: null, hasProof: true, isActive: true, reminderLeadDays: 30 },
          ],
          scheduledServices: [],
        },
        now,
      ),
    ).toMatchObject({ state: "current" });
  });
});

describe("a registration that does not expire, on the unit's file list", () => {
  const registration = (hasProof: boolean) =>
    buildVehicleFileStatuses({
      category: "trailer",
      documents: [
        { docType: "registration", expiryDate: null, hasProof, isActive: true, reminderLeadDays: 30 },
      ],
    }).find((file) => file.docType === "registration");

  it("reads On file once the scan is there", () => {
    expect(registration(true)).toMatchObject({ state: "on_file", hasProof: true });
  });

  it("still asks for the scan when there is none", () => {
    expect(registration(false)).toMatchObject({ state: "awaiting_proof", hasProof: false });
  });

  it("outranks a dated copy of the same file, because it cannot go stale", () => {
    const file = buildVehicleFileStatuses({
      category: "trailer",
      documents: [
        { docType: "registration", expiryDate: "2026-10-01", hasProof: true, isActive: true, reminderLeadDays: 30 },
        { docType: "registration", expiryDate: null, hasProof: true, isActive: true, reminderLeadDays: 30 },
      ],
    }).find((entry) => entry.docType === "registration");

    expect(file).toMatchObject({ expiryDate: null, state: "on_file" });
  });
});

describe("a certification type that never goes out of date", () => {
  it("reads On file rather than a grey No expiry", () => {
    expect(certificationStatus(null, now, true, false)).toEqual({ label: "On file", tone: "success" });
  });

  it("still chases the card when nothing has been uploaded", () => {
    expect(certificationStatus(null, now, false, false)).toMatchObject({ tone: "unproven" });
  });

  it("ignores a stale date someone typed against a non-expiring type", () => {
    // The type is the authority. A leftover date must not turn a ticket red when the
    // tenant has said this kind of ticket does not expire.
    expect(certificationStatus("2020-01-01", now, true, false)).toEqual({ label: "On file", tone: "success" });
  });

  it("leaves an ordinary expiring ticket exactly as it was", () => {
    expect(certificationStatus("2020-01-01", now, true, true)).toMatchObject({ tone: "danger" });
    expect(certificationStatus("2027-06-01", now, true, true)).toMatchObject({ tone: "success" });
    // and unchanged when the flag is not passed at all
    expect(certificationStatus("2020-01-01", now, true)).toMatchObject({ tone: "danger" });
    expect(certificationStatus(null, now, true)).toEqual({ label: "No expiry", tone: "neutral" });
  });
});

describe("unit certifications with no expiry", () => {
  it("counts as satisfied when the certificate is attached", () => {
    const statuses = buildUnitCertificationStatuses({
      certificationTypes: [{ appliesByDefault: true, id: "type-1", name: "Certificate of compliance" }],
      certificationTypeNames: new Map([["type-1", "Certificate of compliance"]]),
      documents: [
        {
          certificationTypeId: "type-1",
          docType: "certification",
          expiryDate: null,
          hasProof: true,
          isActive: true,
          reminderLeadDays: 30,
          title: "Certificate of compliance",
        },
      ],
    });

    expect(statuses[0]).toMatchObject({ state: "on_file", hasProof: true });
  });
});
