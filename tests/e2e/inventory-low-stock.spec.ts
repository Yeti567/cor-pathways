import { expect, test, type Page } from "@playwright/test";

// Cold routes compile on first hit; retry the ERR_ABORTED that Chromium reports meanwhile.
async function goto(page: Page, path: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(path);
      return;
    } catch (error) {
      if (attempt >= 2 || !String(error).includes("ERR_ABORTED")) throw error;
      await page.waitForTimeout(500);
    }
  }
}

async function login(page: Page, email: string) {
  await goto(page, "/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill("Password123!");
  await page.getByRole("button", { exact: true, name: "Next" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// A reorder point is a promise: tell me before this runs out. The proof is that an item
// stocked below its reorder point surfaces as low, derived live from the ledger, without
// anyone flagging it by hand.
test("inventory low stock: an item below its reorder point surfaces as low", async ({ page }) => {
  test.setTimeout(120_000);

  await login(page, "superadmin@northwind.test");

  const toggle = (label: "On" | "Off") =>
    page.locator(
      'xpath=//p[contains(text(),"Track how many of a thing you have")]' +
        `/ancestor::div[contains(@class,"rounded-md")][1]//button[normalize-space()="${label}"]`,
    );
  await goto(page, "/admin/setup");
  if (await toggle("Off").isEnabled()) await toggle("Off").click();
  await goto(page, "/admin/setup");
  await toggle("On").click();
  await expect(page).toHaveURL(/Inventory(\+|%20)module(\+|%20)enabled/);

  await goto(page, "/admin/inventory/locations");
  if ((await page.getByRole("paragraph").filter({ hasText: /^Queen Street Yard$/ }).count()) === 0) {
    await page.selectOption('select[name="kind"]', "yard");
    await page.selectOption('select[name="backingId"]', { label: "Queen Street Yard" });
    await page.getByRole("button", { name: "Add stocking place" }).click();
    await expect(page.getByText("Stocking place added.")).toBeVisible();
  }

  // A per-run item with a reorder point of 20.
  const itemName = `Low Stock Gloves ${Date.now()}`;
  await goto(page, "/admin/inventory/items");
  const addItem = page.locator("section").filter({ hasText: "Add an item" }).last();
  await addItem.locator('input[name="name"]').fill(itemName);
  await addItem.locator('input[name="reorderPoint"]').fill("20");
  await addItem.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText(`"${itemName}" added.`)).toBeVisible();
  // The reorder point is shown on the item row.
  await expect(page.getByText(/Reorder at 20/).first()).toBeVisible();

  // Receive 15, which is below the reorder point.
  await goto(page, "/admin/inventory/stock");
  const record = page.locator("form").filter({ has: page.locator('select[name="movementType"]') });
  await record.locator('select[name="movementType"]').selectOption("receive");
  await record.locator('select[name="itemId"]').selectOption({ label: itemName });
  await record.locator('input[name="qty"]').fill("15");
  await record.locator('select[name="toLocationId"]').selectOption({ label: "Queen Street Yard" });
  await record.getByRole("button", { name: "Record movement" }).click();
  await expect(page.getByText("Recorded: received 15.")).toBeVisible();

  // The inventory landing raises the reorder banner.
  await goto(page, "/admin/inventory");
  await expect(page.getByText(/\d+ items? to reorder/).first()).toBeVisible();
  await expect(page.getByText(itemName).first()).toBeVisible();
  await expect(page.getByText("15 each on hand").first()).toBeVisible();
  await expect(page.getByText("reorder at 20").first()).toBeVisible();

  // On hand shows the same low-stock callout.
  await goto(page, "/admin/inventory/on-hand");
  await expect(page.getByText("at or below the reorder point").first()).toBeVisible();
  await expect(page.getByText(itemName).first()).toBeVisible();
});
