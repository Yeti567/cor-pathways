import { describe, expect, it } from "vitest";
import {
  buildFormItemSettings,
  buildFormItemLabelSettings,
  coerceEquipmentPickerScope,
  coerceFormBuilderMoveDirection,
  coerceFormFieldType,
  coerceFormItemVisibility,
  coerceFormStatus,
  coerceWorkerPickerScope,
  duplicateFormBuilderName,
  formatFormFieldType,
  formatFormStatus,
  formFieldTypeSupportsManagedList,
  getFormItemSettingString,
  getFormBuilderReorderUpdates,
  isFormItemAdminOnly,
  isFormItemUsedAsLabel,
  nextFormBuilderSortOrder,
  normalizeFormCode,
  resolveFormCode,
} from "@/lib/form-templates";
import {
  buildResourceSearchText,
  buildDocumentControlNumberSettings,
  coerceDocumentApprovalStatusFilter,
  coerceDocumentType,
  coerceResourceMoveDirection,
  compareResourceOrder,
  createDocumentControlNumber,
  getDocumentTypePrefix,
  getKnowledgeSearchTerms,
  getResourceReorderUpdates,
  nextResourceSortOrder,
  normalizeDcnSegment,
  normalizeKnowledgeSearchQuery,
  parseDetectedFormFields,
  sanitizeStorageFilename,
} from "@/lib/document-control";

describe("form template helpers", () => {
  it("normalizes template codes for stable tenant-scoped identifiers", () => {
    expect(normalizeFormCode(" daily field report ")).toBe("DAILY-FIELD-REPORT");
    expect(normalizeFormCode("Check #7 / trailer")).toBe("CHECK-7-TRAILER");
  });

  it("falls back to the form name when no code is entered", () => {
    expect(resolveFormCode("", "Daily Field Report")).toBe("DAILY-FIELD-REPORT");
  });

  it("creates clear duplicate names for form builder rows", () => {
    expect(duplicateFormBuilderName(" Daily Field Report ")).toBe("Daily Field Report (copy)");
    expect(duplicateFormBuilderName("")).toBe("Untitled (copy)");
  });

  it("places duplicated form builder rows after existing rows", () => {
    expect(nextFormBuilderSortOrder([{ sort_order: 100 }, { sort_order: 250 }])).toBe(350);
    expect(nextFormBuilderSortOrder([])).toBe(100);
  });

  it("coerces form builder move directions", () => {
    expect(coerceFormBuilderMoveDirection("up")).toBe("up");
    expect(coerceFormBuilderMoveDirection("down")).toBe("down");
    expect(coerceFormBuilderMoveDirection("left")).toBeNull();
  });

  it("builds normalized form builder reorder updates", () => {
    expect(getFormBuilderReorderUpdates([{ id: "a" }, { id: "b" }, { id: "c" }], "b", "up")).toEqual([
      { id: "b", sort_order: 100 },
      { id: "a", sort_order: 200 },
      { id: "c", sort_order: 300 },
    ]);

    expect(getFormBuilderReorderUpdates([{ id: "a" }, { id: "b" }, { id: "c" }], "b", "down")).toEqual([
      { id: "a", sort_order: 100 },
      { id: "c", sort_order: 200 },
      { id: "b", sort_order: 300 },
    ]);
    expect(getFormBuilderReorderUpdates([{ id: "a" }, { id: "b" }], "a", "up")).toEqual([]);
  });

  it("coerces unknown statuses to draft", () => {
    expect(coerceFormStatus("published")).toBe("published");
    expect(coerceFormStatus("ready")).toBe("draft");
  });

  it("formats known statuses for admin display", () => {
    expect(formatFormStatus("archived")).toBe("Archived");
    expect(formatFormStatus("custom")).toBe("custom");
  });

  it("coerces unsupported field types to short text", () => {
    expect(coerceFormFieldType("yes_no")).toBe("yes_no_na");
    expect(coerceFormFieldType("equipment_select")).toBe("equipment_select");
    expect(coerceFormFieldType("signature")).toBe("signature");
    expect(coerceFormFieldType("photo")).toBe("photo");
    expect(coerceFormFieldType("unsupported")).toBe("short_text");
  });

  it("formats field types for the builder", () => {
    expect(formatFormFieldType("long_text")).toBe("Long Answer");
    expect(formatFormFieldType("equipment_select")).toBe("Select Equipment");
    expect(formatFormFieldType("legacy_type")).toBe("legacy_type");
  });

  it("marks dropdown and checkbox fields as managed-list capable", () => {
    expect(formFieldTypeSupportsManagedList("dropdown_select_one")).toBe(true);
    expect(formFieldTypeSupportsManagedList("multi_select")).toBe(true);
    expect(formFieldTypeSupportsManagedList("long_text")).toBe(false);
  });

  it("builds advanced form item settings without noisy defaults", () => {
    expect(coerceFormItemVisibility("admin_only")).toBe("admin_only");
    expect(coerceFormItemVisibility("unknown")).toBe("worker");
    expect(coerceWorkerPickerScope("current_worker")).toBe("current_worker");
    expect(coerceWorkerPickerScope("unknown")).toBe("all_active");
    expect(coerceEquipmentPickerScope("current_location")).toBe("current_location");
    expect(coerceEquipmentPickerScope("unknown")).toBe("reachable");

    const settings = buildFormItemSettings(
      { options: ["Pass", "Fail"] },
      {
        equipmentPickerScope: "current_location",
        sourceLabel: "Site map",
        sourceUrl: " https://example.com/site-map.pdf ",
        visibility: "admin_only",
        workerPickerScope: "current_worker",
      },
    );

    expect(settings).toEqual({
      equipmentPickerScope: "current_location",
      options: ["Pass", "Fail"],
      sourceLabel: "Site map",
      sourceUrl: "https://example.com/site-map.pdf",
      visibility: "admin_only",
      workerPickerScope: "current_worker",
    });
    expect(getFormItemSettingString(settings, "sourceUrl")).toBe("https://example.com/site-map.pdf");
    expect(isFormItemAdminOnly(settings)).toBe(true);
    expect(
      buildFormItemSettings(
        {
          equipmentPickerScope: "assigned_to_worker",
          sourceLabel: "Old reference",
          sourceUrl: "https://example.com/old.pdf",
          visibility: "admin_only",
          workerPickerScope: "current_worker",
        },
        {
          equipmentPickerScope: "reachable",
          sourceLabel: "",
          sourceUrl: "",
          visibility: "worker",
          workerPickerScope: "all_active",
        },
      ),
    ).toEqual({});
  });

  it("stores one form item as the submission label marker", () => {
    expect(isFormItemUsedAsLabel({ useAsLabel: true })).toBe(true);
    expect(isFormItemUsedAsLabel({ useAsLabel: false })).toBe(false);
    expect(buildFormItemLabelSettings({ options: ["A"] }, true)).toEqual({
      options: ["A"],
      useAsLabel: true,
    });
    expect(buildFormItemLabelSettings({ options: ["A"], useAsLabel: true }, false)).toEqual({
      options: ["A"],
    });
  });

  it("normalizes document control numbers and storage filenames", () => {
    expect(normalizeDcnSegment(" north camp / daily report ")).toBe("NORTH-CAMP-DAILY-REPORT");
    expect(sanitizeStorageFilename("Blank Form (Rev A).pdf")).toBe("Blank-Form-Rev-A.pdf");
    expect(
      createDocumentControlNumber({
        tenantSlug: "north company",
        documentType: "form import",
        sequence: 7,
      }),
    ).toBe("NORTH-COMPANY-FRM-0007");
    expect(getDocumentTypePrefix("policy")).toBe("POL");
    expect(getDocumentTypePrefix("form")).toBe("FRM");
  });

  it("builds configurable document control numbers", () => {
    const settings = buildDocumentControlNumberSettings({
      companyId: "north company",
      dcnCompanyPrefix: "acme",
      dcnIncludeRevision: true,
      dcnIncludeSourceCode: true,
      dcnSequencePadding: 5,
    });

    expect(settings).toEqual({
      companyPrefix: "ACME",
      includeRevision: true,
      includeSourceCode: true,
      includeYear: false,
      sequencePadding: 5,
    });
    expect(
      createDocumentControlNumber({
        companyPrefix: settings.companyPrefix,
        documentType: "procedure",
        includeRevision: settings.includeRevision,
        includeSourceCode: settings.includeSourceCode,
        revision: "1.0",
        sequence: 12,
        sequencePadding: settings.sequencePadding,
        sourceCode: "working alone",
      }),
    ).toBe("ACME-PRC-WORKING-ALONE-00012-REV-01");
  });

  it("renders alpha revisions, numeric revisions, and a year segment", () => {
    expect(
      createDocumentControlNumber({
        companyPrefix: "ACME",
        documentType: "policy",
        includeRevision: true,
        revision: "2",
        sequence: 7,
      }),
    ).toBe("ACME-POL-0007-REV-02");

    expect(
      createDocumentControlNumber({
        companyPrefix: "ACME",
        documentType: "policy",
        includeRevision: true,
        revision: "B",
        sequence: 7,
      }),
    ).toBe("ACME-POL-0007-REV-B");

    expect(
      createDocumentControlNumber({
        companyPrefix: "ACME",
        documentType: "form",
        includeSourceCode: true,
        includeYear: true,
        sequence: 12,
        sourceCode: "JHA",
        year: 2026,
      }),
    ).toBe("ACME-2026-FRM-JHA-0012");
  });

  it("coerces document types and parses OCR field candidates", () => {
    expect(coerceDocumentType("policy")).toBe("policy");
    expect(coerceDocumentType("unknown")).toBe("other");
    expect(coerceDocumentApprovalStatusFilter("approved")).toBe("approved");
    expect(coerceDocumentApprovalStatusFilter("revision")).toBe("revision");
    expect(coerceDocumentApprovalStatusFilter("unknown")).toBe("all");

    expect(
      parseDetectedFormFields("1. Inspection date:\n2. Total hours\n3. Pass / Fail\n4. Notes").map((field) => [
        field.label,
        field.fieldType,
      ]),
    ).toEqual([
      ["Inspection date", "date"],
      ["Total hours", "number"],
      ["Pass / Fail", "pass_fail_na"],
      ["Notes", "long_text"],
    ]);
    expect(parseDetectedFormFields("Unit number").map((field) => field.fieldType)).toEqual(["equipment_select"]);
  });

  it("prepares knowledge base search terms and resource text", () => {
    expect(normalizeKnowledgeSearchQuery(" working   alone procedure ")).toBe("working alone procedure");
    expect(getKnowledgeSearchTerms("working alone procedure!")).toEqual(["working", "alone", "procedure"]);
    expect(
      buildResourceSearchText({
        dcn: "ACME-WORKING-ALONE-001",
        documentType: "procedure",
        fileName: "Working Alone Procedure.pdf",
        name: "Working Alone Procedure",
        revisionNotes: "Reviewed for field crew use.",
      }),
    ).toContain("Working Alone Procedure.pdf");
  });

  it("orders resources inside library sections", () => {
    const resources = [
      { name: "Orientation", sort_order: 200, updated_at: "2026-05-22T09:00:00.000Z" },
      { name: "Company Rules", sort_order: 100, updated_at: "2026-05-22T09:00:00.000Z" },
      { name: "Acts and Regulations", sort_order: 100, updated_at: "2026-05-22T10:00:00.000Z" },
    ];

    expect([...resources].sort(compareResourceOrder).map((resource) => resource.name)).toEqual([
      "Acts and Regulations",
      "Company Rules",
      "Orientation",
    ]);
    expect(nextResourceSortOrder(resources)).toBe(300);
    expect(nextResourceSortOrder([])).toBe(100);
  });

  it("builds normalized resource reorder updates", () => {
    expect(coerceResourceMoveDirection("up")).toBe("up");
    expect(coerceResourceMoveDirection("down")).toBe("down");
    expect(coerceResourceMoveDirection("sideways")).toBeNull();

    const resources = [
      { id: "policy", name: "Policy", sort_order: 100, updated_at: "2026-05-20T00:00:00.000Z" },
      { id: "procedure", name: "Procedure", sort_order: 200, updated_at: "2026-05-20T00:00:00.000Z" },
      { id: "manual", name: "Manual", sort_order: 300, updated_at: "2026-05-20T00:00:00.000Z" },
    ];

    expect(getResourceReorderUpdates(resources, "procedure", "up")).toEqual([
      { id: "procedure", sort_order: 100 },
      { id: "policy", sort_order: 200 },
      { id: "manual", sort_order: 300 },
    ]);
    expect(getResourceReorderUpdates(resources, "procedure", "down")).toEqual([
      { id: "policy", sort_order: 100 },
      { id: "manual", sort_order: 200 },
      { id: "procedure", sort_order: 300 },
    ]);
    expect(getResourceReorderUpdates(resources, "policy", "up")).toEqual([]);
  });
});
