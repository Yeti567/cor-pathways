import { expect, test } from "@playwright/test";

test.describe("mobile worker certification ticket upload", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  });

  test("captures ticket details and mobile camera file input", async ({ page }) => {
    await page.goto("/e2e-fixtures/worker-certification-ticket");

    await expect(page.getByRole("heading", { name: "Certification Tickets" })).toBeVisible();
    await expect(page.getByText("No certification tickets have been added to your profile yet.")).toBeVisible();

    const ticketFileInput = page.getByLabel("Ticket photo or PDF");
    await expect(ticketFileInput).toHaveAttribute("accept", "image/*,.pdf,application/pdf");
    await expect(ticketFileInput).toHaveAttribute("capture", "environment");

    await page.getByLabel("Ticket name").fill("First Aid Level 1");
    await page.getByLabel("Issued on").fill("2026-05-01");
    await page.getByLabel("Expires on").fill("2029-05-01");
    await ticketFileInput.setInputFiles({
      buffer: Buffer.from("mobile ticket fixture"),
      mimeType: "image/png",
      name: "first-aid-ticket.png",
    });

    await page.getByRole("button", { name: "Upload Ticket" }).click();

    await expect(page.getByText("Ticket upload captured.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Captured Ticket" })).toBeVisible();
    await expect(page.getByText("First Aid Level 1")).toBeVisible();
    await expect(page.getByText("2026-05-01")).toBeVisible();
    await expect(page.getByText("2029-05-01")).toBeVisible();
    await expect(page.getByText("first-aid-ticket.png (image/png)")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
});
