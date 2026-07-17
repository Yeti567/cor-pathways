import { describe, expect, it } from "vitest";
import { canViewCompletedSubmissionPrint } from "@/lib/submission-access";

describe("submission access", () => {
  it("allows monitor users, submitters, and signers to view completed print output", () => {
    expect(
      canViewCompletedSubmissionPrint({
        canUseMonitor: true,
        signedByUser: false,
        submittedByUser: false,
      }),
    ).toBe(true);
    expect(
      canViewCompletedSubmissionPrint({
        canUseMonitor: false,
        signedByUser: false,
        submittedByUser: true,
      }),
    ).toBe(true);
    expect(
      canViewCompletedSubmissionPrint({
        canUseMonitor: false,
        signedByUser: true,
        submittedByUser: false,
      }),
    ).toBe(true);
  });

  it("blocks unrelated users", () => {
    expect(
      canViewCompletedSubmissionPrint({
        canUseMonitor: false,
        signedByUser: false,
        submittedByUser: false,
      }),
    ).toBe(false);
  });
});
