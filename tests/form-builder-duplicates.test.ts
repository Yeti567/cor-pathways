import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");
const formBuilderClient = readFileSync(
  join(process.cwd(), "src/app/admin/forms/[formId]/FormTypeDetailsBuilder.tsx"),
  "utf8",
);
const duplicateSectionRoute = readFileSync(join(process.cwd(), "src/app/api/sections/[id]/duplicate/route.ts"), "utf8");

describe("form builder duplicate wiring", () => {
  it("exports tenant-scoped duplicate actions for sections and fields", () => {
    expect(adminActions).toContain("export async function duplicateFormSection");
    expect(adminActions).toContain("export async function duplicateFormItem");
    expect(adminActions).toContain("if (!formId || !sectionId || !(await ensureTenantForm(formId, tenantId)))");
    expect(adminActions).toContain("if (!formId || !itemId || !(await ensureTenantForm(formId, tenantId)))");
    expect(adminActions).toContain('.eq("tenant_id", tenantId)');
  });

  it("copies section fields and places duplicates at the end of the builder order", () => {
    expect(adminActions).toContain("const copiedSectionTitle = duplicateFormBuilderName(section.title)");
    expect(adminActions).toContain("const copiedItemLabel = duplicateFormBuilderName(item.label)");
    expect(adminActions).toContain("const copiedSectionSortOrder = nextFormBuilderSortOrder(sectionSortRows ?? [])");
    expect(adminActions).toContain("const copiedItemSortOrder = nextFormBuilderSortOrder(itemSortRows ?? [])");
    expect(adminActions).toContain("section_id: copiedSection.id");
    expect(adminActions).toContain("const itemCopies: FormItemInsertRow[]");
  });

  it("renders the compact duplicate section control in the form builder UI", () => {
    expect(formBuilderClient).toContain("Duplicate");
    expect(formBuilderClient).toContain("<Copy");
    expect(formBuilderClient).toContain("/api/sections/${sectionId}/duplicate");
    expect(duplicateSectionRoute).toContain("duplicateFormBuilderName(section.title)");
    expect(duplicateSectionRoute).toContain("nextFormBuilderSortOrder(sectionSortRows ?? [])");
    expect(duplicateSectionRoute).toContain("section_id: copiedSection.id");
    expect(duplicateSectionRoute).toContain("tenant_id: access.tenantId");
  });
});
