import { expect, test, type Page } from "@playwright/test";

async function expectProtectedRouteRedirect(page: Page, route: string) {
  await page.goto(route);

  await expect(page).toHaveURL((url) => {
    if (url.pathname === "/auth/error") {
      return true;
    }

    return url.pathname === "/login" && url.searchParams.get("next") === route;
  });
}

test.describe("core workflow smoke", () => {
  test("guards admin, worker, and monitor print surfaces behind login", async ({ page }) => {
    await page.goto("/login?next=/admin/monitor");

    await expect(page.getByRole("heading", { name: "Login to your account" })).toBeVisible();
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.locator("#login-password")).toBeVisible();
    await expect(page.getByRole("button", { exact: true, name: "Next" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Login with Cor Pathways SSO" })).toBeVisible();

    for (const route of ["/admin/forms", "/web", "/admin/monitor/e2e-submission/print"]) {
      await expectProtectedRouteRedirect(page, route);
    }
  });

  test("runs admin form setup to worker submission to monitor print", async ({ page }, testInfo) => {
    const runId = `core-workflow-${testInfo.workerIndex}-${Date.now()}`;

    await page.goto(`/e2e-fixtures/core-workflow?run=${runId}`);

    await expect(page.getByRole("heading", { name: "Core Workflow Fixture" })).toBeVisible();

    await page.getByLabel("Managed list name").fill("Hazard Controls");
    await page.getByLabel("Managed list options").fill("Guardrail\nSpotter\nLockout");
    await page.getByRole("button", { name: "Create managed list" }).click();
    await expect(page.getByText("Managed list ready: Hazard Controls (3 options)")).toBeVisible();

    await page.getByLabel("Form name").fill("Daily Field Report");
    await page.getByLabel("Form code").fill("DFR");
    await page.getByRole("button", { name: "Create form template" }).click();

    const workerSubmission = page.getByRole("region", { name: "Worker Submission" });
    await expect(workerSubmission).toContainText("Daily Field Report (DFR)");

    await page.getByLabel("Selected control").selectOption("Guardrail");
    await page.getByLabel("Observation").fill("North stair opening protected before shift.");
    await page.getByLabel("Signature").fill("Blake Cowan");
    await page.getByLabel("Photo evidence").setInputFiles({
      buffer: Buffer.from("fake image bytes"),
      mimeType: "image/png",
      name: "guardrail.png",
    });
    await page.getByLabel("Work offline").check();
    await page.getByRole("button", { name: "Submit form" }).click();

    await expect(page.getByText("Daily Field Report queued offline with signature and photo.")).toBeVisible();

    await page.getByRole("button", { name: "Sync queued submission" }).click();
    await expect(page.getByText("Daily Field Report synced to monitor.")).toBeVisible();

    await page.getByRole("button", { name: "Open monitor" }).click();
    const monitor = page.getByRole("region", { name: "Desktop Monitor" });
    await expect(monitor).toContainText("Daily Field Report (DFR)");
    await expect(monitor).toContainText("Control: Guardrail");
    await expect(monitor).toContainText("Photo: guardrail.png");

    await page.getByRole("button", { name: "Open print preview" }).click();
    const print = page.getByRole("region", { name: "Monitor Print" });
    await expect(print).toContainText("Printable submission report");
    await expect(print).toContainText("North stair opening protected before shift.");
    await expect(print).toContainText("Blake Cowan");
  });
});
