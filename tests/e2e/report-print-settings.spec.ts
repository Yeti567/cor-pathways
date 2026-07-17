import { expect, test } from "@playwright/test";

test.describe("report print settings", () => {
  test("applies company print settings in print media and generated PDFs", async ({ page }) => {
    await page.goto("/e2e-fixtures/print-settings");

    await expect(page.getByRole("heading", { name: "Operations trend report" })).toBeVisible();
    await expect(page.getByText("Acme Safety Ltd.")).toBeHidden();

    await page.emulateMedia({ media: "print" });

    await expect(page.getByText("Acme Safety Ltd.")).toBeVisible();
    await expect(page.getByText("123 Safety Way")).toBeVisible();
    await expect(page.getByText("Phone: 604-555-0199")).toBeVisible();
    await expect(page.getByAltText("Acme Safety Ltd. logo")).toBeVisible();
    await expect(page.getByText("Controlled copy when printed from Core Pathways.")).toBeVisible();
    await expect(page.getByText("Prepared for audit by")).toBeVisible();
    await expect(page.getByText("Jordan Admin")).toBeVisible();
    await expect(page.getByText("Company ID", { exact: true })).toBeVisible();
    await expect(page.locator("footer").getByText("COR-123")).toBeVisible();

    const pdf = await page.pdf({ format: "Letter", printBackground: true });
    expect(pdf.length).toBeGreaterThan(1_000);
  });

  test("honors logo-only print headers", async ({ page }) => {
    await page.goto("/e2e-fixtures/print-settings?mode=logo-only");
    await page.emulateMedia({ media: "print" });

    await expect(page.getByAltText("Acme Safety Ltd. logo")).toBeVisible();
    await expect(page.getByText("Acme Safety Ltd.")).toBeHidden();
    await expect(page.getByText("123 Safety Way")).toBeHidden();
  });
});
