import { expect, test } from "@playwright/test";

test.describe("mobile equipment file", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { height: 844, width: 390 },
  });

  test("queues field updates and verifies the equipment file feed", async ({ page }, testInfo) => {
    const runId = `equipment-${testInfo.workerIndex}-${Date.now()}`;

    await page.goto(`/e2e-fixtures/equipment?run=${runId}`);

    await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
    await expect(page.getByText("Saved for offline")).toBeVisible();

    const unit = page.locator("article").filter({ hasText: "Unit 47" }).first();
    await expect(unit).toContainText("Service Truck");
    await expect(unit).toContainText("Main Yard (YD)");
    await expect(unit).toContainText("meter overdue");

    await page.context().setOffline(true);

    await unit.getByPlaceholder("Log mileage").fill("1250");
    await unit.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Unit 47 meter reading saved offline and queued to sync.")).toBeVisible();
    await expect(unit).toContainText("1,250 mileage");

    await unit.getByRole("button", { name: "Assign" }).click();
    await unit.getByLabel("Status").selectOption("down");
    await expect(unit.getByLabel("Location")).toBeDisabled();
    await expect(unit.getByText("Down units cannot be assigned to a location.")).toBeVisible();
    await unit.getByRole("button", { name: "Save Assignment" }).click();
    await expect(page.getByText("Unit 47 assignment saved offline and queued to sync.")).toBeVisible();
    await expect(unit).toContainText("Down");
    await expect(unit).toContainText("No location while down");

    await unit.getByRole("button", { name: "Add Document" }).click();
    await unit.getByLabel("Document title").fill("Insurance Card");
    await unit.getByLabel("Expires on").fill("2026-12-31");
    const documentInput = unit.getByLabel("Scan or photo");
    await expect(documentInput).toHaveAttribute("capture", "environment");
    await documentInput.setInputFiles({
      buffer: Buffer.from("insurance fixture"),
      mimeType: "image/png",
      name: "insurance-card.png",
    });
    await expect(unit.getByText("1 attachment ready")).toBeVisible();
    await unit.getByRole("button", { name: "Save Document" }).click();
    await expect(page.getByText("Unit 47 document saved offline and queued to sync.")).toBeVisible();

    await unit.getByRole("button", { name: "Add Service" }).click();
    const serviceForm = unit.locator("form").filter({ hasText: "Service title" });
    await serviceForm.getByLabel("Service title").fill("Quarterly Inspection");
    await serviceForm.getByRole("combobox", { name: "Interval" }).selectOption("by_meter");
    await serviceForm.getByRole("spinbutton", { name: "Due meter (mileage)" }).fill("1300");
    await serviceForm.getByRole("spinbutton", { name: "Recurrence interval" }).fill("250");
    await serviceForm.getByRole("combobox", { name: "Recurrence unit" }).selectOption("meter");
    await serviceForm.getByRole("button", { name: "Save Service" }).click();
    await expect(page.getByText("Unit 47 scheduled service saved offline and queued to sync.")).toBeVisible();

    await unit.getByRole("button", { name: "Complete Service" }).first().click();
    const completionForm = unit.locator("form").filter({ hasText: "Scheduled service" });
    await completionForm.getByRole("combobox", { name: "Scheduled service" }).selectOption({ label: "Quarterly Inspection" });
    await completionForm.getByRole("spinbutton", { name: "Meter (mileage)" }).fill("1300");
    await completionForm.getByRole("button", { name: "Complete Service" }).click();
    await expect(page.getByText("Unit 47 scheduled service completed offline and queued to sync.")).toBeVisible();
    await expect(unit).toContainText("1,300 mileage");

    await unit.getByRole("button", { name: "Link Form" }).click();
    await unit.getByLabel("Submitted form").selectOption(`submission-linkable-${runId}`);
    await unit.getByRole("button", { name: "Link Form" }).nth(1).click();
    await expect(page.getByText("Unit 47 form link saved offline and queued to sync.")).toBeVisible();

    await unit.getByRole("button", { name: "Details" }).click();
    await expect(unit.getByRole("heading", { name: "Service Schedule" })).toBeVisible();
    await expect(unit.getByText("Oil Change", { exact: true })).toBeVisible();
    await expect(unit.getByText("Quarterly Inspection", { exact: true }).first()).toBeVisible();
    await expect(unit.getByText("Due at 1,550")).toBeVisible();
    await expect(unit.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(unit.getByText("Insurance Card")).toBeVisible();
    await expect(unit.getByText("Registration", { exact: true })).toBeVisible();
    await expect(unit.getByRole("heading", { name: "Maintenance History" })).toBeVisible();
    await expect(unit.getByText("Completed scheduled service: Quarterly Inspection")).toBeVisible();
    await expect(unit.getByRole("heading", { name: "Meter History" })).toBeVisible();
    await expect(unit.getByText("1,300 mileage").nth(1)).toBeVisible();
    await expect(unit.getByText("1,250 mileage")).toBeVisible();
    await expect(unit.getByRole("heading", { name: "Inspections and Forms" })).toBeVisible();
    await expect(unit.getByText("Daily Inspection")).toBeVisible();
    await expect(unit.getByText("Monthly Inspection")).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

    await page.context().setOffline(false);
  });
});
