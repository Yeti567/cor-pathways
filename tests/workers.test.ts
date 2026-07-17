import { describe, expect, it } from "vitest";
import {
  buildEmergencyContacts,
  certificationStatus,
  coerceWorkerDetailTab,
  normalizePhone,
  parseEmergencyContacts,
} from "@/lib/workers";

describe("worker helpers", () => {
  it("coerces worker detail tabs", () => {
    expect(coerceWorkerDetailTab("certifications")).toBe("certifications");
    expect(coerceWorkerDetailTab("missing")).toBe("profile");
    expect(coerceWorkerDetailTab(undefined)).toBe("profile");
  });

  it("normalizes phone numbers and emergency contacts", () => {
    expect(normalizePhone(" 613***407 4720 ext.1 ")).toBe("613407 4720 .1");
    expect(
      buildEmergencyContacts([
        { name: " Elizabeth Hayton ", phone: " 613-304-5000 ", relationship: " Emergency " },
        { name: "", phone: "", relationship: "" },
      ]),
    ).toEqual([{ name: "Elizabeth Hayton", phone: "613-304-5000", relationship: "Emergency" }]);
    expect(parseEmergencyContacts([{ name: "Blake", phone: "780 832 5158", relationship: "Primary" }])).toEqual([
      { name: "Blake", phone: "780 832 5158", relationship: "Primary" },
    ]);
  });

  it("labels certification status by expiry", () => {
    const now = new Date("2026-05-22T12:00:00");

    expect(certificationStatus(null, now)).toEqual({ label: "No expiry", tone: "neutral" });
    expect(certificationStatus("2026-05-21", now)).toEqual({ label: "Deficiency", tone: "danger" });
    expect(certificationStatus("2026-06-01", now)).toEqual({ label: "Expiring soon", tone: "warning" });
    expect(certificationStatus("2026-08-01", now)).toEqual({ label: "Active", tone: "success" });
  });
});
