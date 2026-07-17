import { expect, test } from "@playwright/test";

test.describe("offline sync recovery", () => {
  test("surfaces signature and photo upload failures with retry and remove controls", async ({ page }, testInfo) => {
    const runId = `offline-sync-${testInfo.workerIndex}-${Date.now()}`;

    await page.goto(`/e2e-fixtures/offline-sync?run=${runId}`);

    await expect(page.getByRole("heading", { name: "Offline Sync Fixture" })).toBeVisible();

    await page.getByRole("button", { name: "Seed upload failures" }).click();

    await expect(page.getByText("Upload failures seeded")).toBeVisible();
    await expect(page.getByText("Failed sync details")).toBeVisible();

    const signatureFailure = page.getByRole("article", { name: /Signature Upload Check/ });
    const photoFailure = page.getByRole("article", { name: /Photo Upload Check/ });

    await expect(signatureFailure).toContainText("Signature Upload Check (SIG)");
    await expect(signatureFailure).toContainText("Form submission");
    await expect(signatureFailure).toContainText("Queued attachment is not a supported PNG, JPEG, or WebP image.");
    await expect(signatureFailure).toContainText("Attempts: 1");

    await expect(photoFailure).toContainText("Photo Upload Check (PHOTO)");
    await expect(photoFailure).toContainText("Queued attachment is not a supported PNG, JPEG, or WebP image.");
    await expect(photoFailure).toContainText("Attempts: 1");

    await signatureFailure.getByRole("button", { name: "Retry" }).click();
    await expect(signatureFailure).toContainText("Attempts: 2");

    await photoFailure.getByRole("button", { name: "Remove" }).click();
    await expect(photoFailure).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry 1" })).toBeVisible();

    await page.getByRole("button", { name: "Check background sync" }).click();
    await expect(page.getByText(/Background sync (registered|unavailable)/)).toBeVisible();

    const serviceWorkerResponse = await page.request.get("/sw.js");
    await expect(serviceWorkerResponse).toBeOK();
    await expect(await serviceWorkerResponse.text()).toContain("core-pathways-sync-queue");
  });
});
