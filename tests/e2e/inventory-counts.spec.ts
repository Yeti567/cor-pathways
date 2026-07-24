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

// A count states an absolute quantity; everything else in the module only moves stock. The
// proof that matters: an admin counts fewer than the books say, and the shortage is posted
// as a movement into the loss place rather than by editing a balance. The on-hand grid then
// shows the yard down and the loss place up by exactly the difference.
test("inventory counts: a short count posts the difference to loss", async ({ page }) => {
  test.setTimeout(120_000);

  await login(page, "superadmin@northwind.test");

  // Enable the module.
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

  // A yard to count.
  await goto(page, "/admin/inventory/locations");
  if ((await page.getByRole("paragraph").filter({ hasText: /^Queen Street Yard$/ }).count()) === 0) {
    await page.selectOption('select[name="kind"]', "yard");
    await page.selectOption('select[name="backingId"]', { label: "Queen Street Yard" });
    await page.getByRole("button", { name: "Add stocking place" }).click();
    await expect(page.getByText("Stocking place added.")).toBeVisible();
  }

  // A per-run item, so the exact-quantity assertions hold against a dirty ledger.
  const itemName = `Count Mat ${Date.now()}`;
  await goto(page, "/admin/inventory/items");
  const addItem = page.locator("section").filter({ hasText: "Add an item" }).last();
  await addItem.locator('input[name="name"]').fill(itemName);
  await addItem.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText(`"${itemName}" added.`)).toBeVisible();

  // Put 50 on the shelf.
  await goto(page, "/admin/inventory/stock");
  const record = page.locator("form").filter({ has: page.locator('select[name="movementType"]') });
  await record.locator('select[name="movementType"]').selectOption("receive");
  await record.locator('select[name="itemId"]').selectOption({ label: itemName });
  await record.locator('input[name="qty"]').fill("50");
  await record.locator('select[name="toLocationId"]').selectOption({ label: "Queen Street Yard" });
  await record.getByRole("button", { name: "Record movement" }).click();
  await expect(page.getByText("Recorded: received 50.")).toBeVisible();

  // Count 46: four short.
  await goto(page, "/admin/inventory/counts");
  const countForm = page.locator("form").filter({ has: page.locator('input[name="countedQty"]') });
  await countForm.locator('select[name="itemId"]').selectOption({ label: itemName });
  await countForm.locator('select[name="locationId"]').selectOption({ label: "Queen Street Yard" });
  // The live preview reads the books before anything is posted.
  await expect(page.getByText(/The books say/)).toBeVisible();
  await countForm.locator('input[name="countedQty"]').fill("46");
  await expect(page.getByText(/4 short: this will move 4/)).toBeVisible();
  await countForm.getByRole("button", { name: "Record count" }).click();

  await expect(page.getByText("The books said 50, so 4 short was recorded to Loss.")).toBeVisible();

  // The recent-counts table shows the variance.
  const countRow = page.getByRole("row").filter({ hasText: itemName });
  await expect(countRow.getByText("4 short")).toBeVisible();

  // On hand: 46 left at the yard, 4 sitting in loss.
  await goto(page, "/admin/inventory/on-hand");
  const gridRow = page.getByRole("row").filter({ hasText: itemName });
  await expect(gridRow.getByRole("link", { name: "46", exact: true })).toBeVisible();
  await expect(gridRow.getByRole("link", { name: "4", exact: true })).toBeVisible();
});
