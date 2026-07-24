import { expect, test } from "@playwright/test";

// End-to-end cover for the inventory module, against the seeded local database.
//
// The last assertion is the one that matters most. Stocking places deliberately live on
// their own table rather than on public.locations, because that table feeds worker
// assignment, visitors, equipment, incidents and the worker app through around thirty
// queries that mostly filter nothing. Putting the two virtual places there would have
// surfaced "In transit" as somewhere a person could be assigned. This test is what keeps
// that decision honest if anyone is ever tempted to merge the two.
test("inventory module: toggle seeds the virtual places and the screens work", async ({ page }) => {
  await page.goto("/login");
  await page.locator("#login-email").fill("superadmin@northwind.test");
  await page.locator("#login-password").fill("Password123!");
  await page.getByRole("button", { exact: true, name: "Next" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  // The toggle buttons, anchored on the description text that is unique to the card.
  const toggle = (label: "On" | "Off") =>
    page.locator(
      'xpath=//p[contains(text(),"Track how many of a thing you have")]' +
        `/ancestor::div[contains(@class,"rounded-md")][1]//button[normalize-space()="${label}"]`,
    );

  // Start from a known state rather than assuming one, so the spec is repeatable against
  // a database that a previous run already touched.
  await page.goto("/admin/setup");
  if (await toggle("Off").isEnabled()) {
    await toggle("Off").click();
  }

  // Module off: every inventory route bounces to Setup. Asserted at the request level
  // rather than by navigating, which pins the actual redirect the server issues instead
  // of wherever the browser happens to settle. It uses the page's cookies, so it is the
  // signed-in user asking.
  for (const route of [
    "/admin/inventory",
    "/admin/inventory/locations",
    "/admin/inventory/items",
    "/admin/inventory/categories",
    "/admin/inventory/stock",
  ]) {
    const guarded = await page.request.get(route, { maxRedirects: 0 });
    expect(guarded.status(), `${route} must be guarded while the module is off`).toBe(307);
    expect(guarded.headers()["location"]).toContain("/admin/setup");
  }

  // Turn it on through the real Setup control.
  await page.goto("/admin/setup");
  await toggle("On").click();
  await expect(page).toHaveURL(/Inventory(\+|%20)module(\+|%20)enabled/);

  // The two virtual places must now exist, and be presented as untouchable.
  await page.goto("/admin/inventory/locations");
  await expect(page.getByRole("heading", { name: "Where stock can sit" })).toBeVisible();
  await expect(page.getByText("In transit", { exact: true })).toBeVisible();
  await expect(page.getByText("Loss and write-off", { exact: true })).toBeVisible();
  await expect(page.getByText("cannot be removed")).toBeVisible();

  // Switching the module off and on again must not create a second pair, which would
  // split the very balances that exist to be reconciled.
  await page.goto("/admin/setup");
  await toggle("Off").click();
  await page.goto("/admin/setup");
  await toggle("On").click();

  await page.goto("/admin/inventory/locations");
  await expect(page.getByText("In transit", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Loss and write-off", { exact: true })).toHaveCount(1);

  // Add a real stocking place backed by an existing location, unless a previous run
  // already did. Every creation step here is conditional so the spec is repeatable
  // against a database it has already touched.
  const yardPlace = page.getByRole("paragraph").filter({ hasText: /^Queen Street Yard$/ });

  if ((await yardPlace.count()) === 0) {
    await page.selectOption('select[name="kind"]', "yard");
    await page.selectOption('select[name="backingId"]', { label: "Queen Street Yard" });
    await page.getByRole("button", { name: "Add stocking place" }).click();
    await expect(page.getByText("Stocking place added.")).toBeVisible();
  }

  await expect(yardPlace.first()).toBeVisible();

  // That yard is now claimed, so it must not be offered again: one place, one balance.
  const offered = await page.locator('select[name="backingId"] option').allTextContents();
  expect(offered.filter((text) => text.includes("Queen Street Yard"))).toHaveLength(0);

  // Items still work alongside it.
  await page.goto("/admin/inventory/items");
  const addItem = page.locator("section").filter({ hasText: "Add an item" }).last();

  if ((await page.getByRole("paragraph").filter({ hasText: /^Rig Mat 4x8$/ }).count()) === 0) {
    await addItem.locator('input[name="name"]').fill("Rig Mat 4x8");
    await addItem.locator('input[name="billable"]').check();
    await addItem.locator('input[name="defaultRate"]').fill("12.50");
    await addItem.locator('select[name="rateBasis"]').selectOption("day");
    await addItem.getByRole("button", { name: "Add item" }).click();
    await expect(page.getByText('"Rig Mat 4x8" added.')).toBeVisible();
  }

  await expect(page.getByText("Bulk · Comes back · Billed per day").first()).toBeVisible();

  // --- The ledger ----------------------------------------------------------
  await page.goto("/admin/inventory/stock");

  const record = page.locator("form").filter({ has: page.locator('select[name="movementType"]') });
  // Matched as a whole paragraph, because place names also appear in the form's dropdowns
  // and inside the longer movement descriptions.
  const onHandPlace = (name: string) => page.getByRole("paragraph").filter({ hasText: new RegExp(`^${name}$`) });

  // Receive 100 into the yard.
  await record.locator('select[name="movementType"]').selectOption("receive");
  await record.locator('select[name="itemId"]').selectOption({ label: "Rig Mat 4x8" });
  await record.locator('input[name="qty"]').fill("100");
  await record.locator('select[name="toLocationId"]').selectOption({ label: "Queen Street Yard" });
  await record.getByRole("button", { name: "Record movement" }).click();
  await expect(page.getByText("Recorded: received 100.")).toBeVisible();
  await expect(onHandPlace("Queen Street Yard").first()).toBeVisible();
  await expect(page.getByText("100 Rig Mat 4x8 received to Queen Street Yard").first()).toBeVisible();

  // Taking out more than is there must be refused, in words rather than a constraint name.
  await record.locator('select[name="movementType"]').selectOption("write_off");
  await record.locator('select[name="itemId"]').selectOption({ label: "Rig Mat 4x8" });
  await record.locator('input[name="qty"]').fill("999999");
  await record.locator('select[name="fromLocationId"]').selectOption({ label: "Queen Street Yard" });
  await record.getByRole("button", { name: "Record movement" }).click();
  await expect(page.getByText(/Not enough stock at Queen Street Yard/)).toBeVisible();

  // The refused movement must have changed nothing and left no trace in the ledger.
  await expect(page.getByText("999999 Rig Mat 4x8")).toHaveCount(0);

  // A write-off that does fit lands in the built-in loss place, never by editing a number.
  await record.locator('select[name="movementType"]').selectOption("write_off");
  await record.locator('select[name="itemId"]').selectOption({ label: "Rig Mat 4x8" });
  await record.locator('input[name="qty"]').fill("4");
  await record.locator('select[name="fromLocationId"]').selectOption({ label: "Queen Street Yard" });
  await record.getByRole("button", { name: "Record movement" }).click();
  await expect(page.getByText("Recorded: written off 4.")).toBeVisible();
  await expect(
    page.getByText("4 Rig Mat 4x8 written off from Queen Street Yard to Loss and write-off").first(),
  ).toBeVisible();
  await expect(onHandPlace("Loss and write-off").first()).toBeVisible();

  // The critical regression check: no virtual place may leak into a human location list.
  for (const route of ["/admin/locations", "/admin/equipment", "/admin/incidents", "/admin/visitors"]) {
    await page.goto(route);
    await expect(page.getByText("In transit")).toHaveCount(0);
    await expect(page.getByText("Loss and write-off")).toHaveCount(0);
  }
});
