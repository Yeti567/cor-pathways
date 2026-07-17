import { expect, test } from "@playwright/test";

test.describe("document control register", () => {
  test("uploads, approves, revises, and verifies controlled document history", async ({ page }, testInfo) => {
    const runId = `document-control-${testInfo.workerIndex}-${Date.now()}`;

    await page.goto(`/e2e-fixtures/document-control?run=${runId}`);

    await expect(page.getByRole("heading", { name: "Document Control" })).toBeVisible();
    await expect(page.getByText("Disabled")).toBeVisible();

    await page.getByRole("button", { name: "Enable Document Control" }).click();
    await expect(page.getByText("Document control enabled.")).toBeVisible();
    await expect(page.getByText("Enabled", { exact: true })).toBeVisible();

    await page.getByLabel("Document name").fill("Working Alone Procedure");
    await page.getByLabel("Type").selectOption("procedure");
    await page.getByLabel("Version").fill("1.0");
    await page.getByLabel("Source code").fill("WAP");
    await page.getByLabel("File").setInputFiles({
      buffer: Buffer.from("procedure v1"),
      mimeType: "application/pdf",
      name: "working-alone-v1.pdf",
    });
    await page.getByRole("button", { name: "Upload" }).click();

    await expect(page.getByText("Uploaded Working Alone Procedure as ACME-PRC-WAP-0001 v1.0.")).toBeVisible();

    const register = page.getByRole("region", { name: "Register" });
    const procedure = register.getByRole("article", { name: /Working Alone Procedure 1.0/ });

    await expect(procedure).toContainText("ACME-PRC-WAP-0001 v1.0 - Procedure");
    await expect(procedure).toContainText("Pending approval");

    await procedure.getByRole("button", { name: "Approve Working Alone Procedure" }).click();
    await expect(procedure).toContainText("Approved");
    await expect(procedure).toContainText("Reviewed by Jordan Admin");

    await page.getByLabel("Document name").fill("Working Alone Procedure");
    await page.getByLabel("Version").fill("2.0");
    await page.getByLabel("Revision of").selectOption({ label: "ACME-PRC-WAP-0001 v1.0 - Procedure" });
    await page.getByLabel("File").setInputFiles({
      buffer: Buffer.from("procedure v2"),
      mimeType: "application/pdf",
      name: "working-alone-v2.pdf",
    });
    await page.getByLabel("Revision notes").fill("Updated isolation steps.");
    await page.getByRole("button", { name: "Upload" }).click();

    const revisedProcedure = register.getByRole("article", { name: /Working Alone Procedure 2.0/ });

    await expect(revisedProcedure).toContainText("ACME-PRC-WAP-0001 v2.0 - Procedure");
    await expect(revisedProcedure).toContainText("Updated isolation steps.");
    await expect(revisedProcedure).toContainText("Pending approval");

    await revisedProcedure.getByRole("button", { name: "Approve Working Alone Procedure" }).click();
    await expect(revisedProcedure).toContainText("Approved");
    await revisedProcedure.getByText("Revision history").click();
    await expect(revisedProcedure).toContainText("v2.0");
    await expect(revisedProcedure).toContainText("v1.0");
    await expect(revisedProcedure).toContainText("reviewed by Jordan Admin");

    const library = page.getByRole("region", { name: "Resource Library" });
    await expect(library).toContainText("working-alone-v1.pdf");
    await expect(library).toContainText("working-alone-v2.pdf");
  });
});
