import { expect, test, type Page } from "@playwright/test";

// End-to-end cover for unit certification tracking: filing a CVIP-style certification
// with an expiry date on a unit, and seeing it surface everywhere it should.
//
// This exists because the feature shipped once already and was reported as missing. It
// was not missing, it was unreachable: the only entry point was three levels inside one
// unit, behind a dropdown that had to be changed before the field appeared, and nothing
// above it named a certification. So this spec walks the path a person actually takes,
// Transport first, and asserts the signposts as well as the data. A regression that
// hides the entry point again should fail here, not in the field.

async function goto(page: Page, path: string) {
  // Turbopack compiles each route on first hit and can drop the connection while it
  // does, which Chromium reports as ERR_ABORTED. Cold start, not a product fault.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.goto(path);
      return;
    } catch (error) {
      if (attempt >= 2 || !String(error).includes("ERR_ABORTED")) {
        throw error;
      }
      await page.waitForTimeout(500);
    }
  }
}

async function signInAsAdmin(page: Page) {
  await page.context().clearCookies();
  await goto(page, "/login");
  await page.locator("#login-email").fill("superadmin@northwind.test");
  await page.locator("#login-password").fill("Password123!");
  await page.getByRole("button", { exact: true, name: "Next" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * Turn the Transport module on, since it ships off by default.
 *
 * Done through Setup rather than by writing to the database, so the spec runs against a
 * freshly reset database without a back door, and so the toggle itself stays covered.
 */
async function enableTransport(page: Page) {
  await goto(page, "/admin/setup");

  const on = page.locator(
    'xpath=//p[contains(text(),"NSC and COR compliance")]' +
      '/ancestor::div[contains(@class,"rounded-md")][1]//button[normalize-space()="On"]',
  );

  if (await on.isEnabled()) {
    await on.click();
  }

  // Assert the outcome that matters rather than the toggle's own chrome: Transport is
  // reachable. When the module is off every Transport route redirects to Setup.
  await goto(page, "/admin/transport");
  await expect(page).toHaveURL(/\/admin\/transport$/);
}

/** A unit of its own per run, so parallel workers do not read each other's gaps. */
async function createFleetUnit(page: Page, unitNumber: string) {
  await goto(page, "/admin/equipment");

  // The form lives inside a collapsed <details>, and role selectors do not see inside a
  // closed one, so the summary has to be opened before the form can be located at all.
  const details = page.locator("details").filter({ hasText: "Add Equipment" }).first();
  if (!(await details.getAttribute("open"))) {
    await details.locator("summary").first().click();
  }

  const form = details.locator("form").filter({ has: page.getByRole("button", { name: "Save Equipment" }) });
  await form.getByPlaceholder("Unit 47").fill(unitNumber);
  await form.getByPlaceholder("Service truck").fill("Picker truck");
  await form.getByRole("button", { name: "Save Equipment" }).click();

  // Saving drops straight onto the new unit's file, so the id comes from the URL.
  await page.waitForURL(/\/admin\/equipment\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: new RegExp(unitNumber) })).toBeVisible();

  const equipmentId = page.url().match(/equipment\/([0-9a-f-]{36})/)?.[1];
  expect(equipmentId, "created unit should have an id").toBeTruthy();

  return equipmentId as string;
}

test.describe("unit certifications", () => {
  test("files a certification with an expiry and surfaces it on the unit and in Transport", async ({
    page,
  }, testInfo) => {
    const unitNumber = `CERT${testInfo.workerIndex}${Date.now().toString().slice(-6)}`;

    await signInAsAdmin(page);
    await enableTransport(page);
    const equipmentId = await createFleetUnit(page, unitNumber);

    // A brand new road unit is held to the whole certification list, so every type on
    // it reads Missing before anything is filed.
    await goto(page, `/admin/equipment/${equipmentId}?tab=documents`);
    const checklist = page.locator("div").filter({ hasText: /^Certifications/ }).last();
    await expect(page.getByText("Crane / picker inspection")).toBeVisible();
    await expect(checklist.getByText("Missing").first()).toBeVisible();

    // The expiry field only appears once the document type is Certification. This is
    // the step that made the feature look absent, so assert the reveal explicitly.
    const addDocument = page.locator("form").filter({ has: page.getByRole("button", { name: "Add Document" }) });
    await expect(addDocument.locator('select[name="certificationTypeId"]')).toHaveCount(0);
    await addDocument.locator('select[name="docType"]').selectOption("certification");

    const certificationType = addDocument.locator('select[name="certificationTypeId"]');
    await expect(certificationType).toBeVisible();
    await certificationType.selectOption({ label: "Crane / picker inspection" });

    // Expiry is required, and it is the entire point of the feature.
    const expiry = addDocument.locator('input[name="expiryDate"]');
    await expect(expiry).toHaveAttribute("required", "");
    await expiry.fill("2030-08-25");
    await addDocument.getByRole("button", { name: "Add Document" }).click();

    // Title is optional for a certification: the type supplies the name.
    await expect(page.getByText("Crane / picker inspection").first()).toBeVisible();
    await expect(page.getByText("Aug 25, 2030").first()).toBeVisible();

    // Transport reads the same row. It must never become a second place to type, so
    // assert the read-only framing and the deep link back to the one entry point.
    await goto(page, "/admin/transport/vehicle-files?file=vehicle_certifications");
    await expect(page.getByText("This is a read-only audit view.")).toBeVisible();

    const unitCard = page.locator("section").filter({ hasText: unitNumber }).first();
    await expect(unitCard).toContainText("Crane / picker inspection");
    await expect(unitCard).toContainText("On file");
    // The unit is deliberately not commercial: certifications follow the iron, not NSC.
    await expect(unitCard.getByRole("link", { name: "Open unit file" })).toHaveAttribute(
      "href",
      `/admin/equipment/${equipmentId}?tab=documents`,
    );

    // A never-filed type is still a gap, which is what makes the top-level tile useful.
    await expect(unitCard).toContainText("Tank inspection (CSA B620)");
    await expect(unitCard).toContainText("Missing");
  });

  test("names the certification gap count on the Transport home", async ({ page }) => {
    await signInAsAdmin(page);
    await enableTransport(page);
    await goto(page, "/admin/transport");

    // The discoverability fix: before this, nothing above a single unit said the word
    // certification, so there was no way to find the feature by looking.
    const tile = page.getByRole("link", { name: /Certification gaps/ });
    await expect(tile).toBeVisible();
    await expect(tile).toHaveAttribute("href", "/admin/transport/vehicle-files?file=vehicle_certifications");
  });
});
