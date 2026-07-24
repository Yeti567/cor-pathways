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

// The worker field panel is offline-first, but the online path is the one that proves the
// whole pipeline: the panel queues the move, flushes it, and it lands in the ledger. A
// super admin sets the module up; a worker on /web records the move; the admin on-hand
// grid then shows the stock actually moved.
test("inventory field capture: a worker records a move that reaches the ledger", async ({ page }) => {
  test.setTimeout(120_000);

  // --- Admin sets up the module ----------------------------------------------
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

  // Two stocking places.
  await goto(page, "/admin/inventory/locations");
  for (const backing of ["Queen Street Yard", "Riverside Project"]) {
    if ((await page.getByRole("paragraph").filter({ hasText: new RegExp(`^${backing}$`) }).count()) === 0) {
      await page.selectOption('select[name="kind"]', "yard");
      await page.selectOption('select[name="backingId"]', { label: backing });
      await page.getByRole("button", { name: "Add stocking place" }).click();
      await expect(page.getByText("Stocking place added.")).toBeVisible();
    }
  }

  // One item.
  const itemName = `Field Mat ${Date.now()}`;
  await goto(page, "/admin/inventory/items");
  const addItem = page.locator("section").filter({ hasText: "Add an item" }).last();
  await addItem.locator('input[name="name"]').fill(itemName);
  await addItem.getByRole("button", { name: "Add item" }).click();
  await expect(page.getByText(`"${itemName}" added.`)).toBeVisible();

  // Stock the yard, so there is something for the worker to move.
  await goto(page, "/admin/inventory/stock");
  const record = page.locator("form").filter({ has: page.locator('select[name="movementType"]') });
  await record.locator('select[name="movementType"]').selectOption("receive");
  await record.locator('select[name="itemId"]').selectOption({ label: itemName });
  await record.locator('input[name="qty"]').fill("50");
  await record.locator('select[name="toLocationId"]').selectOption({ label: "Queen Street Yard" });
  await record.getByRole("button", { name: "Record movement" }).click();
  await expect(page.getByText("Recorded: received 50.")).toBeVisible();

  // --- Worker records a move from the field ----------------------------------
  await goto(page, "/logout").catch(() => {});
  await page.context().clearCookies();
  await login(page, "worker@northwind.test");
  await goto(page, "/web");

  const panel = page.locator("section#inventory");
  await expect(panel.getByRole("heading", { name: "Move stock" })).toBeVisible();

  await panel.locator("select").nth(0).selectOption({ label: "Queen Street Yard" }); // From
  await panel.locator("select").nth(1).selectOption({ label: "Riverside Project" }); // To
  await panel.locator("select").nth(2).selectOption({ label: itemName }); // Item
  await panel.locator('input[inputmode="decimal"]').fill("8");
  await panel.getByRole("button", { name: "Record move" }).click();

  // Recorded locally right away, and it syncs (no "waiting to sync" left once online).
  await expect(panel.getByText(`8 ${itemName}: Queen Street Yard → Riverside Project`)).toBeVisible();
  await expect(panel.getByText(/waiting to sync/)).toHaveCount(0, { timeout: 15_000 });

  // --- Admin confirms the stock actually moved -------------------------------
  await goto(page, "/logout").catch(() => {});
  await page.context().clearCookies();
  await login(page, "superadmin@northwind.test");
  await goto(page, "/admin/inventory/on-hand");

  const row = page.getByRole("row").filter({ hasText: itemName });
  // 50 received, 8 moved out: 42 at the yard, 8 at Riverside.
  await expect(row.getByRole("link", { name: "42", exact: true })).toBeVisible();
  await expect(row.getByRole("link", { name: "8", exact: true })).toBeVisible();
});
