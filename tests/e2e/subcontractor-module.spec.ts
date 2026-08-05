import { expect, test, type Locator, type Page } from "@playwright/test";

// End-to-end cover for the subcontractor carrier module, walking all six slices against
// the seeded local database, from both sides of the relationship.
//
// The half that matters most is the carrier's. Everything a hired carrier can actually
// do is exercised here as that carrier, signed in through the real login page: read the
// checklist, correct their own contact details, upload a document, see it come back
// rejected with a reason, upload a replacement, and be told when a limit is too low. The
// last test is the one to keep if the others ever become a maintenance burden: it proves
// a carrier cannot reach the staff app, which is the whole risk of having let them in.
//
// Production carriers sign in with a magic link and have no password. The seeded one has
// a password so this can drive the portal through the real login page instead of a
// test-only back door; nothing in the portal is special-cased for it.

// Turbopack compiles each route on its first hit, and while it does the dev server can
// drop the connection, which Chromium reports as ERR_ABORTED. That is a cold-start
// artifact, not a product fault, so retry the navigation a couple of times.
async function goto(page: Page, path: string) {
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

async function signIn(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await goto(page, "/login");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { exact: true, name: "Next" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** A believable certificate. Content does not matter; the MIME type does, the bucket filters on it. */
function dummyPdf(name: string) {
  return {
    buffer: Buffer.from(`%PDF-1.4\n${name}\n`),
    mimeType: "application/pdf",
    name: `${name}.pdf`,
  };
}

/**
 * Open the upload form for one requirement and return it.
 *
 * Anchored on the hidden slotKey input rather than on visible text, because eight slots
 * share the same field labels and the same "File" button. The details element has to be
 * opened first: its contents are in the DOM but not visible, and Playwright will not
 * type into something a person could not.
 */
async function openSlotForm(scope: Page | Locator, slotKey: string): Promise<Locator> {
  const form = scope.locator("form").filter({ has: scope.locator(`input[name="slotKey"][value="${slotKey}"]`) });
  const details = form.locator("xpath=ancestor::details[1]");

  if (!(await details.getAttribute("open"))) {
    await details.locator("summary").first().click();
  }

  await expect(form).toBeVisible();
  return form;
}

/**
 * Clear the review queue for one requirement, however many are sitting in it.
 *
 * The seeded carrier is shared, so a rerun of this spec, or an earlier run that failed
 * partway, leaves its own uploads behind. Draining the queue rather than assuming a
 * single item means the assertions that follow are about this run and not about
 * whatever the last one left, and the spec stays runnable without resetting the
 * database first.
 */
async function reviewAllPending(page: Page, slotLabel: string, decision: "Accept" | "Send back", reason?: string) {
  const pending = page.getByRole("article", { name: `Pending ${slotLabel}` });

  for (let guard = 0; (await pending.count()) > 0 && guard < 10; guard++) {
    const next = pending.first();

    if (decision === "Send back") {
      await next.locator('input[name="rejectionReason"]').fill(reason ?? "Not acceptable.");
    }

    await next.getByRole("button", { name: decision }).click();
    await expect(page.getByText(decision === "Accept" ? "Accepted." : "Returned to the carrier")).toBeVisible();
  }

  await expect(pending).toHaveCount(0);
}

test.describe("subcontractor carrier module", () => {
  test("a hired carrier files its paperwork and the company reviews it", async ({ page }) => {
    // One spec walks all six slices, and on a cold dev server every route compiles on
    // first hit, so it needs well over the default budget.
    test.setTimeout(300_000);

    const runId = `${Date.now()}`;
    const carrierName = `Probe Carrier ${runId}`;

    // ---------------------------------------------------------------- slice 1
    await signIn(page, "superadmin@northwind.test", "Password123!");
    await goto(page, "/admin/setup");

    const toggle = (label: "On" | "Off") =>
      page.locator(
        'xpath=//p[contains(text(),"Keep the insurance, carrier profile, and WCB paperwork")]' +
          `/ancestor::div[contains(@class,"rounded-md")][1]//button[normalize-space()="${label}"]`,
      );

    if (await toggle("On").isEnabled()) {
      await toggle("On").click();
      await expect(page.getByText("Subcontractor module enabled.")).toBeVisible();
    }

    await goto(page, "/admin/subcontractors");
    await expect(page.getByRole("heading", { level: 1, name: "Hired carriers" })).toBeVisible();
    // Seeded, so the screen is never empty on a fresh database. The name appears twice
    // by design: once in the carrier list and once in the Coming due panel, because the
    // seed includes a certificate expiring inside the warning window.
    await expect(page.getByRole("link", { name: "Redwater Hauling Ltd." }).first()).toBeVisible();

    // Adding a carrier.
    await page.getByLabel("Legal name").fill(carrierName);
    await page.getByLabel("Operating name (optional)").fill("Probe Trucking");
    await page.getByLabel("Email").fill(`probe-${runId}@example.test`);
    await page.getByRole("button", { name: "Add carrier" }).click();
    await expect(page.getByText(`${carrierName} added.`)).toBeVisible();

    const carrierUrl = page.url().split("?")[0];

    // Admin-side filing, which is how a company loads what is already in its inbox.
    // Dated inside the default warning window on purpose, so the Coming due panel is
    // asserted against a document this run created rather than against whatever state an
    // earlier run happened to leave behind.
    const expiringSoon = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const adminFleetForm = await openSlotForm(page, "fleet_insurance");
    await adminFleetForm.locator('input[name="file"]').setInputFiles(dummyPdf("probe-fleet-coi"));
    await adminFleetForm.locator('input[name="expiryDate"]').fill(expiringSoon);
    await adminFleetForm.locator('input[name="coverageAmount"]').fill("5000000");
    await adminFleetForm.locator('input[name="insurer"]').fill("Prairie Mutual");
    await adminFleetForm.getByRole("button", { name: /^File fleet insurance$/ }).click();
    await expect(page.getByText("Fleet insurance filed.")).toBeVisible();
    await expect(page.getByRole("article", { exact: true, name: "Fleet insurance" })).toContainText("Due soon");

    // Twenty days out is inside the warning window, so it has to surface on the list.
    await goto(page, "/admin/subcontractors");
    // Anchored on the heading and walked up to its own section: filtering sections by
    // text also matches any ancestor section, which picks up the carrier list too.
    const comingDue = page
      .getByRole("heading", { level: 2, name: "Coming due" })
      .locator("xpath=ancestor::section[1]");
    await expect(comingDue.getByRole("listitem").filter({ hasText: carrierName })).toHaveCount(1);

    // ---------------------------------------------------------------- slice 2
    await goto(page, "/admin/subcontractors/requirements");
    await expect(page.getByRole("heading", { name: "What you demand of a hired carrier" })).toBeVisible();
    await page.locator('input[name="minimum__fleet_insurance"]').fill("2000000");
    await page.locator('input[name="minimum__general_liability"]').fill("2000000");
    await page.locator('input[name="lead__fleet_insurance"]').fill("45");
    await page.getByRole("button", { name: "Save requirements" }).click();
    await expect(page.getByText("Requirements saved.")).toBeVisible();
    await expect(page.locator('input[name="minimum__fleet_insurance"]')).toHaveValue("2000000");

    // ---------------------------------------------------------------- slice 3
    // Inviting a carrier contact. Creating the login runs through the service role, so
    // without SUPABASE_SERVICE_ROLE_KEY in .env.local the action reports that instead of
    // sending. Either answer proves the form posted and the action reported honestly;
    // the portal itself is then driven as the seeded contact below.
    await goto(page, carrierUrl);
    await page.getByLabel("Their name").fill("Probe Contact");
    await page.getByLabel("Their email").fill(`probe-contact-${runId}@example.test`);
    await page.getByRole("button", { name: "Send sign-in link" }).click();
    await expect(
      page.getByText(/Invitation sent to|was not sent|service role key/),
    ).toBeVisible();

    // ---------------------------------------------------------------- slice 4
    // Now as the carrier. Signing in lands on their own page rather than the marketing
    // site, which is the redirect the fourth identity needed.
    await signIn(page, "dana@redwater.test", "Password123!");
    await page.waitForURL(/\/sub/);
    await expect(page.getByRole("heading", { name: "Redwater Hauling Ltd." })).toBeVisible();

    // They can see the bar they are being asked to meet.
    await expect(page.getByRole("article", { exact: true, name: "Fleet insurance" })).toContainText(
      "Minimum limit required",
    );

    // Correcting their own contact details.
    await page.getByLabel("Your name").fill("Dana Whitfield");
    await page.getByLabel("Phone").fill("780-555-0143");
    await page.getByRole("button", { name: "Save my details" }).click();
    await expect(page.getByText("Your details are saved.")).toBeVisible();

    // Filing a document. It must arrive for review, never accepted.
    const cargoForm = await openSlotForm(page, "cargo_insurance");
    await cargoForm.locator('input[name="file"]').setInputFiles(dummyPdf("redwater-cargo-coi"));
    await cargoForm.locator('input[name="expiryDate"]').fill("2027-05-31");
    await cargoForm.locator('input[name="coverageAmount"]').fill("250000");
    await cargoForm.getByRole("button", { name: "Send it" }).click();
    await expect(page.getByText("Cargo insurance sent.")).toBeVisible();

    const cargoOnPortal = page.getByRole("article", { exact: true, name: "Cargo insurance" });
    await expect(cargoOnPortal).toContainText("Awaiting review");
    // The carrier cannot mark their own paperwork accepted, so it must not read as received.
    await expect(cargoOnPortal).not.toContainText("Received");

    // The company reviews it and sends it back.
    await signIn(page, "superadmin@northwind.test", "Password123!");
    await goto(page, "/admin/subcontractors/40000000-0000-0000-0000-000000000001");

    await expect(page.getByRole("article", { name: "Pending Cargo insurance" }).first()).toBeVisible();
    await reviewAllPending(page, "Cargo insurance", "Send back", "Expired, send the current one.");

    // The carrier sees why.
    await signIn(page, "dana@redwater.test", "Password123!");
    await page.waitForURL(/\/sub/);
    await expect(page.getByRole("article", { exact: true, name: "Cargo insurance" })).toContainText(
      "Expired, send the current one.",
    );

    // And sends a replacement.
    const cargoAgain = await openSlotForm(page, "cargo_insurance");
    await cargoAgain.locator('input[name="file"]').setInputFiles(dummyPdf("redwater-cargo-coi-v2"));
    await cargoAgain.locator('input[name="expiryDate"]').fill("2028-05-31");
    await cargoAgain.locator('input[name="coverageAmount"]').fill("250000");
    await cargoAgain.getByRole("button", { name: "Send it" }).click();
    await expect(page.getByText("Cargo insurance sent.")).toBeVisible();

    // This time the company accepts it.
    await signIn(page, "superadmin@northwind.test", "Password123!");
    await goto(page, "/admin/subcontractors/40000000-0000-0000-0000-000000000001");
    await reviewAllPending(page, "Cargo insurance", "Accept");
    await expect(page.getByRole("article", { exact: true, name: "Cargo insurance" })).toContainText("On file");

    // A certificate that is on file, in date, and still not good enough.
    await signIn(page, "dana@redwater.test", "Password123!");
    await page.waitForURL(/\/sub/);
    const glForm = await openSlotForm(page, "general_liability");
    await glForm.locator('input[name="file"]').setInputFiles(dummyPdf("redwater-gl-coi"));
    await glForm.locator('input[name="expiryDate"]').fill("2028-01-31");
    await glForm.locator('input[name="coverageAmount"]').fill("1000000");
    await glForm.getByRole("button", { name: "Send it" }).click();
    await expect(page.getByText("General liability insurance sent.")).toBeVisible();

    await signIn(page, "superadmin@northwind.test", "Password123!");
    await goto(page, "/admin/subcontractors/40000000-0000-0000-0000-000000000001");
    // Flagged as under the limit before anyone accepts it, so the reviewer is told
    // rather than having to compare two numbers themselves.
    await expect(page.getByRole("article", { name: "Pending General liability insurance" }).first()).toContainText(
      "under the",
    );
    await reviewAllPending(page, "General liability insurance", "Accept");
    await expect(page.getByRole("article", { exact: true, name: "General liability insurance" })).toContainText(
      "Under your limit",
    );

    // ---------------------------------------------------------------- slice 6
    await goto(page, "/admin/subcontractors/40000000-0000-0000-0000-000000000001/pack");
    await expect(page.getByRole("heading", { name: "Redwater Hauling Ltd." })).toBeVisible();
    await expect(page.getByText("Hired carrier due diligence file")).toBeVisible();
    // The rejected general liability limit is called out rather than shown as a red dot.
    await expect(page.getByText(/carries .* against the .* required/)).toBeVisible();
    // The history section is what makes the pack worth keeping.
    await expect(page.getByText("What was held, and when it was checked")).toBeVisible();
    await expect(page.getByText("since replaced").first()).toBeVisible();
    // And it does not overclaim.
    await expect(page.getByText(/not a certification of the carrier by any regulator/)).toBeVisible();
  });

  test("a carrier cannot reach the staff app", async ({ page }) => {
    test.setTimeout(120_000);

    await signIn(page, "dana@redwater.test", "Password123!");

    // Every staff surface bounces them home rather than showing a menu of doors they
    // cannot open. This is the assertion that justifies the whole slice 3 design.
    for (const path of ["/admin", "/admin/subcontractors", "/admin/setup", "/admin/workers", "/web", "/choose"]) {
      await goto(page, path);
      await page.waitForURL(/\/sub/, { timeout: 15_000 });
    }

    await expect(page.getByRole("heading", { name: "Redwater Hauling Ltd." })).toBeVisible();

    // They do see who is asking, by design: the portal names the hiring company so the
    // carrier knows whose checklist this is. What they must not get is any way into that
    // company's app, so the assertion is on the staff navigation, not on the name.
    await expect(page.getByRole("link", { name: "Setup" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Workers" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Overview" })).toHaveCount(0);

    // And only their own carrier: the other seeded carrier under the same company is
    // invisible to them.
    await expect(page.getByText("Two Hills Transport")).toHaveCount(0);
  });

  test("the help articles and the landing section are reachable", async ({ page }) => {
    test.setTimeout(120_000);

    // Both are public. Help that 404s or a landing section that fails to render are
    // silent regressions: nothing errors, the page just quietly stops saying the thing.
    await goto(page, "/help");
    await expect(page.getByRole("heading", { level: 2, name: "Subcontractors" })).toBeVisible();

    await goto(page, "/help/track-subcontractor-carriers");
    await expect(page.getByRole("heading", { level: 1, name: "Track the carriers you hire" })).toBeVisible();
    // The honest framing has to survive an edit, because it is the bit a carrier or an
    // auditor would catch us on.
    await expect(page.getByText(/Alberta Transportation does not require you to hold documents/)).toBeVisible();

    await goto(page, "/help/subcontractor-troubleshooting");
    await expect(
      page.getByRole("heading", { level: 1, name: "Subcontractors: checking your work and fixing problems" }),
    ).toBeVisible();
    await expect(page.getByText("Under your limit").first()).toBeVisible();

    await goto(page, "/");
    await expect(page.getByRole("heading", { name: "The carriers you hire, on file and in date" })).toBeVisible();
  });

  test("the reminder cron runs and reports cleanly", async ({ request }) => {
    const secret = process.env.CRON_SECRET;

    // The dev server reads .env.local; this process does not. Skip rather than fail when
    // the secret is not visible to the test runner.
    test.skip(!secret, "CRON_SECRET is not exposed to the test runner.");

    const response = await request.get("/api/cron/certification-reminders", {
      headers: { authorization: `Bearer ${secret}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
  });
});
