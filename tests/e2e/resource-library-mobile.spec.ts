import { expect, test } from "@playwright/test";

test.describe("mobile resource library", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  });

  test("browses sections and opens cached resources while offline", async ({ page }, testInfo) => {
    const runId = `resource-${testInfo.workerIndex}-${Date.now()}`;

    await page.goto(`/e2e-fixtures/resources?run=${runId}`);

    await expect(page.getByRole("heading", { name: "Resources" })).toBeVisible();
    await expect(page.getByRole("button", { name: "All (3)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Policies (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Procedures (1)" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Unsectioned (1)" })).toBeVisible();

    await page.getByRole("button", { name: "Procedures (1)" }).click();

    const procedure = page.locator("article").filter({ hasText: "Working Alone Procedure" });
    await expect(procedure).toBeVisible();
    await expect(procedure.getByText("ACME-PRC-0001")).toBeVisible();
    await expect(procedure.getByText("Procedures")).toBeVisible();
    await expect(page.getByText("Company Policy")).toBeHidden();

    const openLink = procedure.getByRole("link", { name: "Open" });
    await expect(openLink).toHaveAttribute("href", /resource-download\?run=.*file=working-alone/);

    await procedure.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("Working Alone Procedure is saved for offline use.")).toBeVisible();
    await expect(procedure.getByText("Offline", { exact: true })).toBeVisible();
    await expect(procedure.getByRole("button", { name: "Update" })).toBeVisible();
    await expect(openLink).toHaveAttribute("href", /^data:application\/pdf;base64,/);

    await page.context().setOffline(true);
    await expect(openLink).toHaveAttribute("href", /^data:application\/pdf;base64,/);
    await page.context().setOffline(false);

    await page.getByPlaceholder("working alone procedure").fill("policy");

    const policy = page.locator("article").filter({ hasText: "Company Policy" });
    await expect(policy).toBeVisible();
    await expect(policy.getByText("ACME-POL-0002")).toBeVisible();
    await expect(page.locator("article").filter({ hasText: "Working Alone Procedure" })).toHaveCount(0);
  });
});
