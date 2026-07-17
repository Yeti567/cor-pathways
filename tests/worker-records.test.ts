import { describe, expect, it } from "vitest";
import { countWorkerSignaturesBySubmissionId, mergeWorkerDocumentSubmissions } from "@/lib/worker-records";

describe("worker records", () => {
  it("deduplicates signed and submitted documents and sorts newest first", () => {
    const merged = mergeWorkerDocumentSubmissions([
      [
        {
          created_at: "2026-05-20T08:00:00.000Z",
          id: "signed-only",
          submitted_at: "2026-05-20T08:00:00.000Z",
        },
        {
          created_at: "2026-05-21T08:00:00.000Z",
          id: "same-document",
          submitted_at: null,
        },
      ],
      [
        {
          created_at: "2026-05-22T08:00:00.000Z",
          id: "submitted-only",
          submitted_at: "2026-05-22T08:00:00.000Z",
        },
        {
          created_at: "2026-05-21T08:00:00.000Z",
          id: "same-document",
          submitted_at: null,
        },
      ],
    ]);

    expect(merged.map((submission) => submission.id)).toEqual(["submitted-only", "same-document", "signed-only"]);
  });

  it("counts worker signatures by submission", () => {
    expect(
      Array.from(
        countWorkerSignaturesBySubmissionId([
          { submission_id: "submission-a" },
          { submission_id: "submission-a" },
          { submission_id: "submission-b" },
        ]).entries(),
      ),
    ).toEqual([
      ["submission-a", 2],
      ["submission-b", 1],
    ]);
  });
});
