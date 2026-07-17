import { describe, expect, it } from "vitest";
import {
  compareOfflineResourceSectionOrder,
  filterOfflineResources,
  offlineResourceMatchesSearch,
  resourceFileName,
  type OfflineResourceSummary,
} from "@/lib/offline/resources";

const resources: OfflineResourceSummary[] = [
  {
    bodyText: "Company Policy\nEmployees must report incidents within 24 hours.",
    dcn: "ACME-POL-0002",
    id: "policy",
    mimeType: "application/pdf",
    name: "Company Policy",
    sectionId: "policies",
    signedUrl: "https://example.com/policy",
    sortOrder: 200,
    storagePath: "tenant/resources/company-policy.pdf",
    tenantId: "tenant-1",
    updatedAt: "2026-05-22T09:00:00.000Z",
  },
  {
    bodyText: "Working Alone Procedure\nCheck in with dispatch every 30 minutes.",
    dcn: "ACME-PRC-0001",
    id: "working-alone",
    mimeType: "application/pdf",
    name: "Working Alone Procedure",
    sectionId: "procedures",
    signedUrl: "https://example.com/working-alone",
    sortOrder: 100,
    storagePath: "tenant/resources/working-alone.pdf",
    tenantId: "tenant-1",
    updatedAt: "2026-05-22T10:00:00.000Z",
  },
];

describe("offline resource helpers", () => {
  it("filters resources by knowledge search terms", () => {
    expect(offlineResourceMatchesSearch(resources[1], "working procedure")).toBe(true);
    expect(offlineResourceMatchesSearch(resources[0], "working procedure")).toBe(false);
    expect(filterOfflineResources(resources, "ACME PRC").map((resource) => resource.id)).toEqual(["working-alone"]);
  });

  it("matches a phrase from the extracted body text, not just the title", () => {
    // 'dispatch' lives only in the body_text of the Working Alone Procedure - the title doesn't mention it.
    expect(offlineResourceMatchesSearch(resources[1], "dispatch")).toBe(true);
    expect(offlineResourceMatchesSearch(resources[0], "dispatch")).toBe(false);
    // 'incidents' lives only in the Company Policy's body_text.
    expect(filterOfflineResources(resources, "incidents within 24").map((r) => r.id)).toEqual(["policy"]);
  });

  it("sorts sections and derives file names", () => {
    expect(
      [
        { id: "b", name: "Policies", sortOrder: 200, tenantId: "tenant-1" },
        { id: "a", name: "Manuals", sortOrder: 100, tenantId: "tenant-1" },
      ].sort(compareOfflineResourceSectionOrder).map((section) => section.name),
    ).toEqual(["Manuals", "Policies"]);

    expect(resourceFileName(resources[1])).toBe("working-alone.pdf");
    expect(resourceFileName({ name: "Fallback", storagePath: "" })).toBe("Fallback");
  });
});
