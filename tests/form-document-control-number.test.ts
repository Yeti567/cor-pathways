import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");
const formsPage = readFileSync(join(process.cwd(), "src/app/admin/forms/page.tsx"), "utf8");
const builderPage = readFileSync(join(process.cwd(), "src/app/admin/forms/[formId]/page.tsx"), "utf8");
const builderClient = readFileSync(join(process.cwd(), "src/app/admin/forms/[formId]/FormTypeDetailsBuilder.tsx"), "utf8");

describe("form document control numbers", () => {
  it("announces generated DCNs after new and imported form creation", () => {
    expect(adminActions).toContain("let documentControlNumber: string | null = null;");
    expect(adminActions.match(/documentControlNumber = dcn;/g)).toHaveLength(2);
    expect(adminActions).toContain("Form template created. DCN ${documentControlNumber} registered.");
    expect(adminActions).toContain("${importSource} draft created for review. DCN ${documentControlNumber} registered.");
    expect(adminActions).toContain("redirect(`/admin/forms?notice=${encodeURIComponent(notice)}`)");
    expect(adminActions).toContain("redirect(`/admin/forms/${draft.formId}/builder?notice=${encodeURIComponent(draft.notice)}`)");
  });

  it("shows active form DCNs on the forms inventory", () => {
    expect(formsPage).toContain("type FormDocumentControlRow");
    expect(formsPage).toContain('.from("document_control_register")');
    expect(formsPage).toContain('.eq("source_table", "forms")');
    expect(formsPage).toContain('.eq("active", true)');
    expect(formsPage).toContain('.in("source_id", formIds)');
    expect(formsPage).toContain("documentControlByFormId");
    expect(formsPage).toContain("DCN {controlledDocument.dcn} v{controlledDocument.version}");
    expect(formsPage).toContain("formatApprovalStatus(controlledDocument.approval_status)");
    expect(formsPage).toContain("DCN pending");
  });

  it("shows the active form DCN in the builder header", () => {
    expect(builderPage).toContain("type FormDocumentControlRow");
    expect(builderPage).toContain('.from("document_control_register")');
    expect(builderPage).toContain('.eq("source_table", "forms")');
    expect(builderPage).toContain('.eq("source_id", form.id)');
    expect(builderPage).toContain('.eq("active", true)');
    expect(builderPage).toContain(".maybeSingle<FormDocumentControlRow>()");
    expect(builderClient).toContain("DCN {formDocumentControl.dcn} v{formDocumentControl.version}");
    expect(builderClient).toContain("formatApprovalStatus(formDocumentControl.approval_status)");
    expect(builderClient).toContain("Document control off");
  });
});
