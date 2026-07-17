import {
  getAnalyticsValueLabels,
  type AnalyticsForm,
  type AnalyticsFormItem,
  type AnalyticsSubmission,
  type AnalyticsSubmissionValue,
  type AnalyticsUser,
} from "@/lib/report-analytics";

export type AnalyticsBucketDrilldownInput = {
  forms: AnalyticsForm[];
  itemId: string;
  items: AnalyticsFormItem[];
  submissions: AnalyticsSubmission[];
  users: AnalyticsUser[];
  valueLabel: string;
  values: AnalyticsSubmissionValue[];
};

export type AnalyticsBucketDrilldownSubmission = {
  formCode: string;
  formId: string;
  formName: string;
  id: string;
  submittedAt: string;
  submittedAtLabel: string;
  submittedByLabel: string;
};

export type AnalyticsBucketDrilldown = {
  fieldLabel: string;
  formId: string | null;
  formName: string;
  submissions: AnalyticsBucketDrilldownSubmission[];
  valueLabel: string;
};

function formatDrilldownDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not submitted";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not submitted";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function submittedAtValue(submission: AnalyticsSubmission) {
  return submission.submitted_at ?? submission.created_at;
}

export function buildAnalyticsDrilldownHref({
  end,
  itemId,
  start,
  valueLabel,
}: {
  end: string;
  itemId: string;
  start: string;
  valueLabel: string;
}) {
  const params = new URLSearchParams({
    end,
    itemId,
    start,
    value: valueLabel,
  });
  return `/admin/analytics/drilldown?${params.toString()}`;
}

export function buildAnalyticsBucketDrilldown({
  forms,
  itemId,
  items,
  submissions,
  users,
  valueLabel,
  values,
}: AnalyticsBucketDrilldownInput): AnalyticsBucketDrilldown {
  const item = items.find((candidate) => candidate.id === itemId) ?? null;
  const formById = new Map(forms.map((form) => [form.id, form]));
  const submissionById = new Map(submissions.map((submission) => [submission.id, submission]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const matchingSubmissionIds = new Set<string>();

  for (const value of values) {
    if (value.form_item_id !== itemId || !submissionById.has(value.submission_id)) {
      continue;
    }

    if (getAnalyticsValueLabels(value.value).includes(valueLabel)) {
      matchingSubmissionIds.add(value.submission_id);
    }
  }

  const matchingSubmissions = Array.from(matchingSubmissionIds)
    .map((submissionId) => submissionById.get(submissionId))
    .filter((submission): submission is AnalyticsSubmission => Boolean(submission))
    .sort((left, right) => new Date(submittedAtValue(right)).getTime() - new Date(submittedAtValue(left)).getTime())
    .map((submission) => {
      const form = formById.get(submission.form_id);
      const user = submission.submitted_by ? userById.get(submission.submitted_by) : null;
      const submittedAt = submittedAtValue(submission);

      return {
        formCode: form?.code ?? "",
        formId: submission.form_id,
        formName: form?.name ?? "Unknown form",
        id: submission.id,
        submittedAt,
        submittedAtLabel: formatDrilldownDateTime(submittedAt),
        submittedByLabel: user?.full_name ?? user?.email ?? "Unknown worker",
      };
    });

  const form = item ? formById.get(item.form_id) : null;

  return {
    fieldLabel: item?.label ?? "Unknown field",
    formId: item?.form_id ?? null,
    formName: form?.name ?? "Unknown form",
    submissions: matchingSubmissions,
    valueLabel,
  };
}
