import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const builderClient = readFileSync(join(process.cwd(), "src/app/admin/forms/[formId]/FormTypeDetailsBuilder.tsx"), "utf8");
const previewPage = readFileSync(join(process.cwd(), "src/app/admin/forms/[formId]/preview/page.tsx"), "utf8");
const previewComponent = readFileSync(
  join(process.cwd(), "src/app/admin/forms/[formId]/preview/FormTemplatePreview.tsx"),
  "utf8",
);
const assignedFormsPanel = readFileSync(join(process.cwd(), "src/app/web/_components/AssignedFormsPanel.tsx"), "utf8");
const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");

describe("form builder preview wiring", () => {
  it("links the form builder to a preview route", () => {
    expect(builderClient).toContain('href={`/admin/forms/${form.id}/preview`}');
    expect(builderClient).toContain("Preview");
    expect(builderClient).toContain("<Eye");
  });

  it("builds preview data with the worker offline form model", () => {
    expect(previewPage).toContain("buildOfflineFormSummary");
    expect(previewPage).toContain("getManagedListIdFromSettings");
    expect(previewPage).toContain("resolveManagedListSettings");
    expect(previewPage).toContain("<FormTemplatePreview form={previewForm} workers={workerOptions} />");
  });

  it("renders worker-compatible field preview controls", () => {
    for (const fieldType of [
      'case "signature"',
      'case "photo"',
      'case "gps_coordinates"',
      'case "equipment_select"',
      'case "worker_select"',
      'case "pdf_insert"',
      'case "image_view"',
      'case "pdf_view"',
    ]) {
      expect(previewComponent).toContain(fieldType);
    }

    expect(previewComponent).toContain("getOfflineFieldOptions");
    expect(previewComponent).toContain("PreviewWorkerOption");
    expect(previewComponent).toContain("workers.map((worker) => worker.fullName)");
    expect(previewComponent).toContain("renderWorkerMultiSelect");
    expect(previewComponent).toContain('type="checkbox"');
    expect(previewComponent).toContain("section.repeatable");
    expect(previewComponent).toContain("Entry 1");
  });

  it("keeps manual item creation simple while honoring advanced settings at runtime", () => {
    expect(builderClient).toContain('placeholder="Question"');
    expect(builderClient).toContain("/api/sections/${sectionId}/items");
    expect(builderClient).toContain("Help text / instructions");
    expect(builderClient).toContain("title=\"Required\"");
    expect(builderClient).toContain("Use As Label");
    expect(builderClient).toContain("DropdownOptionsEditor");

    expect(adminActions).toContain("buildFormItemSettings");
    expect(adminActions).toContain("buildFormItemLabelSettings");
    expect(previewComponent).toContain("isFormItemAdminOnly");
    expect(previewComponent).toContain("sourceLabel");
    expect(assignedFormsPanel).toContain("coerceWorkerPickerScope");
    expect(assignedFormsPanel).toContain("selectedWorkers.includes(worker.id)");
    expect(assignedFormsPanel).toContain("Array.from(new Set([...selectedWorkers, worker.id]))");
    expect(assignedFormsPanel).toContain("coerceEquipmentPickerScope");
    expect(assignedFormsPanel).toContain("No worker-visible fields are configured");
  });
});
