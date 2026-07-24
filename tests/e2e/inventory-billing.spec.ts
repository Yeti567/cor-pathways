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

// Billing is a report derived from the ledger, admin only. An "each"-basis item is charged
// per unit delivered to a customer site, independent of time, which makes the amount exact
// without backdating anything: deliver 4 at $5 each and the report owes $20. That proves the
// whole read path (auth, RLS, the ledger, the builder, the page) end to end.
test("inventory billing: delivered billable stock shows a charge for the customer site", async ({ page }) => {
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

  // A customer site to bill. Riverside Project is seeded as a customer_site; add it if not.
  await goto(page, "/admin/inventory/locations");
  if ((await page.getByRole("paragraph").filter({ hasText: /^Riverside Project$/ }).count()) === 0) {
    await page.selectOption('select[name="kind"]', "customer_site");
    await page.selectOption('select[name="backingId"]', { label: "Riverside Project" });
    await page.getByRole("button", { name: "Add stocking place" }).click();
    await expect(page.getByText("Stocking place added.")).toBeVisible();
  }

  // A billable item charged $5 per unit.
  const itemName = `Billing Marker ${Date.now()}`;
  await goto(page, "/admin/inventory/items");
  const addItem = page.locator("section").filter({ hasText: "Add an item" }).last();
  await addItem.locator('input[name="name"]').fill(itemName);
  await addItem.locator('input[name="billable"]').check();
  await addItem.locator('input[name="defaultRate"]').fill("5");
  await addItem.locator('select[name="rateBasis"]').selectOption("each");
  await addItem.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText(`"${itemName}" added.`)).toBeVisible();

  // Deliver 4 units to the customer site.
  await goto(page, "/admin/inventory/stock");
  const record = page.locator("form").filter({ has: page.locator('select[name="movementType"]') });
  await record.locator('select[name="movementType"]').selectOption("receive");
  await record.locator('select[name="itemId"]').selectOption({ label: itemName });
  await record.locator('input[name="qty"]').fill("4");
  await record.locator('select[name="toLocationId"]').selectOption({ label: "Riverside Project" });
  await record.getByRole("button", { name: "Record movement" }).click();
  await expect(page.getByText("Recorded: received 4.")).toBeVisible();

  // The billing report owes $20 for this item at the customer site.
  await goto(page, "/admin/inventory/billing");
  await expect(page.getByRole("heading", { name: "Rental charges" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: itemName });
  await expect(row.getByText("$5.00 each")).toBeVisible();
  await expect(row.getByText("$20.00")).toBeVisible();
});
