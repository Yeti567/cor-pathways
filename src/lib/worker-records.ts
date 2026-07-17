export type WorkerDocumentSubmissionLike = {
  created_at: string;
  id: string;
  submitted_at: string | null;
};

export type WorkerSignatureLike = {
  submission_id: string;
};

function documentDate(value: WorkerDocumentSubmissionLike) {
  return value.submitted_at ?? value.created_at;
}

export function mergeWorkerDocumentSubmissions<T extends WorkerDocumentSubmissionLike>(groups: T[][]) {
  const byId = new Map<string, T>();

  for (const group of groups) {
    for (const submission of group) {
      byId.set(submission.id, submission);
    }
  }

  return Array.from(byId.values()).sort(
    (left, right) => new Date(documentDate(right)).getTime() - new Date(documentDate(left)).getTime(),
  );
}

export function countWorkerSignaturesBySubmissionId(signatures: WorkerSignatureLike[]) {
  const counts = new Map<string, number>();

  for (const signature of signatures) {
    counts.set(signature.submission_id, (counts.get(signature.submission_id) ?? 0) + 1);
  }

  return counts;
}
