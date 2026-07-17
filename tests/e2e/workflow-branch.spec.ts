import { expect, test } from "@playwright/test";

test.describe("workflow branch execution", () => {
  test("submits Step A, assigns Step B, and shows monitor branch context", async ({ page }, testInfo) => {
    const runId = `workflow-branch-${testInfo.workerIndex}-${Date.now()}`;

    await page.goto(`/e2e-fixtures/workflow-branch?run=${runId}`);

    await expect(page.getByRole("heading", { name: "Workflow Branch Fixture" })).toBeVisible();

    await page.getByLabel("Medical aid required").selectOption("yes");
    await page.getByRole("button", { name: "Submit Step A" }).click();

    const assignment = page.getByRole("article", { name: "Worker Assignment - Medical Aid Follow-up" });
    const monitor = page.getByRole("region", { name: "Run Monitor" });

    await expect(assignment).toContainText("Medical Aid Follow-up");
    await expect(assignment).toContainText("Assigned to Blake Cowan");
    await expect(monitor).toContainText("Step A submitted");
    await expect(monitor).toContainText("Step B assigned");
    await expect(monitor).toContainText("Resolved route: Step 2 Medical Aid Follow-up.");
    await expect(monitor).toContainText("Matched condition: Medical aid required");
    await expect(monitor).toContainText("Skipped condition: No aid required");

    await assignment.getByRole("button", { name: "Complete Step B" }).click();
    await expect(monitor).toContainText("Step B completed");
    await expect(page.getByText("Run completed")).toBeVisible();

    await page.getByRole("button", { name: "Reset run" }).click();
    await page.getByLabel("Medical aid required").selectOption("no");
    await page.getByRole("button", { name: "Submit Step A" }).click();

    await expect(page.getByText("No follow-up assignment created.")).toBeVisible();
    await expect(monitor).toContainText("Step B not assigned");
    await expect(monitor).toContainText("Resolved route: matched stop condition; no follow-up step assigned.");
    await expect(monitor).toContainText("Skipped condition: Medical aid required");
    await expect(monitor).toContainText("Stopped condition: No aid required");
  });
});
