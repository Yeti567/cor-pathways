import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const formBuilderPage = readFileSync(join(process.cwd(), "src/app/admin/forms/[formId]/page.tsx"), "utf8");
const formBuilderClient = readFileSync(
  join(process.cwd(), "src/app/admin/forms/[formId]/FormTypeDetailsBuilder.tsx"),
  "utf8",
);
const formTemplates = readFileSync(join(process.cwd(), "src/lib/form-templates.ts"), "utf8");
const createItemRoute = readFileSync(join(process.cwd(), "src/app/api/sections/[id]/items/route.ts"), "utf8");
const updateItemRoute = readFileSync(join(process.cwd(), "src/app/api/items/[id]/route.ts"), "utf8");
const builderItemTypesStart = formTemplates.indexOf("export const formBuilderItemTypeOptions = [");
const builderItemTypesEnd = formTemplates.indexOf("] as const;", builderItemTypesStart);
const builderItemTypesBlock = formTemplates.slice(builderItemTypesStart, builderItemTypesEnd);

describe("form builder item buttons", () => {
  it("loads the section-based client builder on the existing form route", () => {
    expect(formBuilderPage).toContain("FormTypeDetailsBuilder");
    expect(formBuilderPage).toContain(".from(\"form_sections\")");
    expect(formBuilderPage).toContain(".from(\"form_items\")");
    expect(formBuilderPage).toContain(".eq(\"tenant_id\", context.appUser.tenant_id)");
    expect(formBuilderPage).toContain('title="Form Type Details"');
  });

  it("offers the requested item types through an icon-row picker and inline draft row", () => {
    const builderTypeValues = [...builderItemTypesBlock.matchAll(/value: "([^"]+)"/g)].map((match) => match[1]);

    expect(formTemplates).toContain("export const formBuilderItemTypeOptions = [");
    expect(builderTypeValues).toEqual([
      "pass_fail_na",
      "checkbox",
      "short_text",
      "long_text",
      "text_info",
      "dropdown_select_one",
      "dropdown_select_multiple",
      "yes_no_na",
      "pass_fail_total",
      "number",
      "date",
      "time",
      "worker_select",
      "workers_select",
      "photo",
      "signature",
      "image_view",
      "gps_coordinates",
      "pdf_insert",
      "pdf_view",
    ]);
    expect(formBuilderClient).toContain("Create New Item Type");
    expect(formBuilderClient).toContain("formBuilderItemTypeOptions.map");
    expect(formBuilderClient).toContain("onPickType(section.id, option.value)");
    expect(formBuilderClient).toContain("function DraftItemRow");
    expect(formBuilderClient).toContain('placeholder="Question"');
    expect(formBuilderClient).toContain("/api/sections/${sectionId}/items");
    expect(formBuilderClient).toContain('showToast("A new item was added successfully.");');
    expect(formTemplates).toContain('{ value: "photo", label: "Take Photo" }');
    expect(formTemplates).toContain('{ value: "signature", label: "Signature" }');
    expect(formTemplates).toContain('{ value: "pdf_view", label: "View PDF" }');
    expect(builderItemTypesBlock).not.toContain("equipment_select");
  });

  it("supports required and flaggable toggles, inline prompt edits, and per-type details", () => {
    expect(formBuilderClient).toContain("title=\"Required\"");
    expect(formBuilderClient).toContain("Allow flag");
    expect(formBuilderClient).toContain("Flag on");
    expect(formBuilderClient).toContain("Workers can flag this question");
    expect(formBuilderClient).toContain("Allow workers to flag this question");
    expect(formBuilderClient).toContain("setEditingPrompt(true)");
    expect(formBuilderClient).toContain("Use As Label");
    expect(formBuilderClient).toContain("Help text / instructions");
    expect(formBuilderClient).toContain("DropdownOptionsEditor");
    expect(formBuilderClient).toContain("Marked as Fail");
    expect(formBuilderClient).toContain("Pass/Fail items to roll up");
    expect(formBuilderClient).toContain("Rich-text body");
    expect(formBuilderClient).toContain("Decimal places");
    expect(formBuilderClient).toContain('accept="application/pdf"');
  });

  it("exposes form and section controls from the requested layout", () => {
    expect(formBuilderClient).toContain("Back To Forms");
    expect(formBuilderClient).toContain("Indicate Required Fields");
    expect(formBuilderClient).toContain("Allow Duplicates");
    expect(formBuilderClient).toContain("Create Section");
    expect(formBuilderClient).toContain("Section name");
    expect(formBuilderClient).toContain("Add Section");
    expect(formBuilderClient).toContain("Collapsible");
    expect(formBuilderClient).toContain("Repeatable");
    expect(formBuilderClient).toContain("SectionsOutline");
    expect(formBuilderClient).toContain("Delete section");
  });

  it("persists item creation and edits through tenant-scoped API routes", () => {
    expect(createItemRoute).toContain("isFormBuilderItemType");
    expect(createItemRoute).toContain(".from(\"form_items\")");
    expect(createItemRoute).toContain("tenant_id: access.tenantId");
    expect(createItemRoute).toContain("section.form_id");
    expect(updateItemRoute).toContain("getTenantItem");
    expect(updateItemRoute).toContain(".eq(\"tenant_id\", access.tenantId)");
    expect(updateItemRoute).toContain("update.settings = bodyJsonObject(body, \"config\")");
    expect(updateItemRoute).toContain("update.required = bodyBoolean(body, \"required\")");
    expect(updateItemRoute).toContain("update.flaggable = bodyBoolean(body, \"flaggable\")");
  });
});
