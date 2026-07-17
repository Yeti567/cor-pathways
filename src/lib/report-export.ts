import type { AnalyticsForm, AnalyticsSubmission, AnalyticsUser, ReportAnalytics } from "@/lib/report-analytics";

export type ReportExportFollowUp = {
  assigned_to: string | null;
  created_at: string;
  description: string | null;
  id: string;
  parent_submission_id: string | null;
  status: string;
  title: string;
};

export type ReportExportInput = {
  analytics: ReportAnalytics;
  dateRangeLabel: string;
  followUps: ReportExportFollowUp[];
  forms: AnalyticsForm[];
  generatedAt: Date;
  preparedBy: string;
  submissions: AnalyticsSubmission[];
  tenantName: string;
  users: AnalyticsUser[];
};

export type AnalyticsExportInput = {
  analytics: ReportAnalytics;
  analyticsFormIds: string[];
  analyticsSubmissionIds: string[];
  dateRangeLabel: string;
  forms: AnalyticsForm[];
  generatedAt: Date;
  preparedBy: string;
  submissions: AnalyticsSubmission[];
  tenantName: string;
};

function csvValue(value: string | number | null | undefined) {
  const normalized = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return /[",]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function rowsToCsv(rows: Array<Array<string | number | null | undefined>>) {
  return `${rows.map((row) => row.map(csvValue).join(",")).join("\r\n")}\r\n`;
}

function formatReportExportDateTime(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

export function reportCsvFilenameSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "report"
  );
}

function metadataRows({
  dateRangeLabel,
  generatedAt,
  preparedBy,
  tenantName,
  title,
}: {
  dateRangeLabel: string;
  generatedAt: Date;
  preparedBy: string;
  tenantName: string;
  title: string;
}) {
  return [
    [title],
    ["Tenant", tenantName],
    ["Date Range", dateRangeLabel],
    ["Generated", formatReportExportDateTime(generatedAt)],
    ["Prepared By", preparedBy],
    [],
  ];
}

export function buildOperationsReportCsv({
  analytics,
  dateRangeLabel,
  followUps,
  forms,
  generatedAt,
  preparedBy,
  submissions,
  tenantName,
  users,
}: ReportExportInput) {
  const formById = new Map(forms.map((form) => [form.id, form]));
  const submissionById = new Map(submissions.map((submission) => [submission.id, submission]));
  const userById = new Map(users.map((user) => [user.id, user]));
  const rows: Array<Array<string | number | null | undefined>> = [
    ...metadataRows({
      dateRangeLabel,
      generatedAt,
      preparedBy,
      tenantName,
      title: "Operations Trend Report",
    }),
    ["Summary Metric", "Value"],
    ["Incidents", analytics.incidentsThisYear],
    ["Hazard reports", analytics.hazardReportsThisYear],
    ["Inspections done", analytics.inspectionsThisYear],
    ["Time cards", analytics.timeCardsThisYear],
    ["Corrective actions", analytics.correctiveActionsThisYear],
    ["Missing time cards", analytics.possibleMissingTimeCards],
    [],
    ["Top Submitted Forms"],
    ["Form", "Submissions"],
  ];

  if (analytics.topForms.length === 0) {
    rows.push(["No submitted forms in range", 0]);
  } else {
    for (const form of analytics.topForms) {
      rows.push([form.name, form.count]);
    }
  }

  rows.push([], ["Time-Card Gaps"], ["Worker", "Email"]);

  if (analytics.missingTimeCardUsers.length === 0) {
    rows.push(["No missing time-card users in range", ""]);
  } else {
    for (const user of analytics.missingTimeCardUsers) {
      rows.push([user.full_name, user.email]);
    }
  }

  rows.push([], ["Corrective Actions"], ["Title", "Status", "Source Form", "Assigned To", "Created", "Description"]);

  if (followUps.length === 0) {
    rows.push(["No corrective actions in range", "", "", "", "", ""]);
  } else {
    for (const followUp of followUps) {
      const parentSubmission = followUp.parent_submission_id ? submissionById.get(followUp.parent_submission_id) : null;
      const sourceForm = parentSubmission ? formById.get(parentSubmission.form_id) : null;
      const assignedUser = followUp.assigned_to ? userById.get(followUp.assigned_to) : null;

      rows.push([
        followUp.title,
        followUp.status,
        sourceForm?.name ?? "Unknown source",
        assignedUser?.full_name ?? "Unassigned",
        formatReportExportDateTime(followUp.created_at),
        followUp.description ?? "",
      ]);
    }
  }

  return rowsToCsv(rows);
}

export function buildAnalyticsReportCsv({
  analytics,
  analyticsFormIds,
  analyticsSubmissionIds,
  dateRangeLabel,
  forms,
  generatedAt,
  preparedBy,
  submissions,
  tenantName,
}: AnalyticsExportInput) {
  const analyticsFormIdSet = new Set(analyticsFormIds);
  const submissionCountByFormId = new Map<string, number>();
  const analyticsEnabledForms = forms.filter((form) => analyticsFormIdSet.has(form.id));
  const totalFieldAnswerCount = analytics.fieldValueSummaries.reduce((sum, summary) => sum + summary.total, 0);

  for (const submission of submissions) {
    submissionCountByFormId.set(submission.form_id, (submissionCountByFormId.get(submission.form_id) ?? 0) + 1);
  }

  const rows: Array<Array<string | number | null | undefined>> = [
    ...metadataRows({
      dateRangeLabel,
      generatedAt,
      preparedBy,
      tenantName,
      title: "Form Item Analytics",
    }),
    ["Summary Metric", "Value"],
    ["Analytics-enabled forms", analyticsEnabledForms.length],
    ["Analytics submissions", analyticsSubmissionIds.length],
    ["Field summaries", analytics.fieldValueSummaries.length],
    ["Field answers counted", totalFieldAnswerCount],
    [],
    ["Enabled Templates"],
    ["Form Code", "Form Name", "Submissions In Range"],
  ];

  if (analyticsEnabledForms.length === 0) {
    rows.push(["", "No form templates are marked for analytics", 0]);
  } else {
    for (const form of analyticsEnabledForms) {
      rows.push([form.code, form.name, submissionCountByFormId.get(form.id) ?? 0]);
    }
  }

  rows.push([], ["Field Answer Trends"], ["Form", "Field", "Field Type", "Answer", "Count", "Percent", "Total"]);

  if (analytics.fieldValueSummaries.length === 0) {
    rows.push(["", "No analytics-enabled form answers in range", "", "", 0, "0%", 0]);
  } else {
    for (const summary of analytics.fieldValueSummaries) {
      for (const value of summary.values) {
        const percent = summary.total > 0 ? Math.round((value.count / summary.total) * 100) : 0;
        rows.push([
          summary.formName,
          summary.label,
          summary.fieldType,
          value.label,
          value.count,
          `${percent}%`,
          summary.total,
        ]);
      }
    }
  }

  return rowsToCsv(rows);
}
