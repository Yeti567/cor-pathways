import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const documentsPage = readFileSync(join(process.cwd(), "src/app/admin/documents/page.tsx"), "utf8");

describe("document control page", () => {
  it("filters the register by approval and revision status", () => {
    expect(documentsPage).toContain("documentApprovalStatusFilterOptions");
    expect(documentsPage).toContain("coerceDocumentApprovalStatusFilter");
    expect(documentsPage).toContain("params.approvalStatus");
    expect(documentsPage).toContain('.eq("approval_status", approvalStatusFilter)');
    expect(documentsPage).toContain('.not("revision_of_id", "is", null)');
    expect(documentsPage).toContain("documentRegisterFilterHref(option.value, query)");
  });
});
