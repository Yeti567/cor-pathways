import { formatSubmissionValue } from "@/lib/submission-values";
import type { Database, Json } from "@/types/database";

type AppAccessLevel = Database["public"]["Enums"]["app_access_level"];
type PowerLevel = Database["public"]["Enums"]["power_level"];

export type AnalyticsForm = {
  code: string;
  id: string;
  name: string;
  use_item_data_in_analytics?: boolean;
};

export type AnalyticsSubmission = {
  created_at: string;
  form_id: string;
  id: string;
  submitted_at: string | null;
  submitted_by: string | null;
};

export type AnalyticsFormItem = {
  field_type: string;
  form_id: string;
  id: string;
  label: string;
  sort_order: number;
};

export type AnalyticsSubmissionValue = {
  form_item_id: string;
  submission_id: string;
  value: Json;
};

export type AnalyticsFollowUp = {
  created_at: string;
  id: string;
  parent_submission_id: string | null;
};

export type AnalyticsUser = {
  active: boolean;
  app_access: AppAccessLevel;
  email: string;
  full_name: string;
  id: string;
  power_level: PowerLevel;
};

export type ReportAnalytics = {
  correctiveActionsFromIncidents: number;
  correctiveActionsFromInspections: number;
  correctiveActionsThisYear: number;
  fieldValueSummaries: AnalyticsFieldValueSummary[];
  hazardReportsThisYear: number;
  incidentsThisYear: number;
  inspectionsThisYear: number;
  missingTimeCardUsers: AnalyticsUser[];
  possibleMissingTimeCards: number;
  timeCardsThisYear: number;
  topForms: { count: number; formId: string; name: string }[];
};

export type AnalyticsFieldValueSummary = {
  fieldType: string;
  formId: string;
  formName: string;
  itemId: string;
  label: string;
  total: number;
  values: { count: number; label: string }[];
};

const incidentKeywords = ["incident", "injury", "near miss", "accident"];
const hazardKeywords = ["hazard"];
const inspectionKeywords = ["inspection", "inspect", "audit", "checklist"];
const timeCardKeywords = ["timecard", "time card", "time sheet", "timesheet", "hours"];
const analyticsFieldTypes = new Set([
  "checkbox",
  "dropdown_select_multiple",
  "dropdown_select_one",
  "multi_select",
  "number",
  "pass_fail_na",
  "pass_fail_total",
  "single_select",
  "worker_select",
  "workers_select",
  "yes_no",
  "yes_no_na",
]);
const maxFieldValueSummaries = 6;
const maxValuesPerField = 5;

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[_-]+/g, " ");
}

function formText(form: AnalyticsForm) {
  return normalizeText(`${form.name} ${form.code}`);
}

export function formMatchesKeywords(form: AnalyticsForm | undefined, keywords: readonly string[]) {
  if (!form) {
    return false;
  }

  const text = formText(form);
  return keywords.some((keyword) => text.includes(normalizeText(keyword)));
}

function dateInRange(value: string | null | undefined, start: Date, end: Date) {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  return date >= start && date < end;
}

function submissionDate(submission: AnalyticsSubmission) {
  return submission.submitted_at ?? submission.created_at;
}

export function getAnalyticsValueLabels(value: Json): string[] {
  if (value === false || value === null) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => getAnalyticsValueLabels(item));
  }

  const label = formatSubmissionValue(value);
  return label === "No answer" ? [] : [label];
}

function summarizeFieldValues({
  forms,
  items,
  submissionsThisYear,
  values,
}: {
  forms: AnalyticsForm[];
  items: AnalyticsFormItem[];
  submissionsThisYear: AnalyticsSubmission[];
  values: AnalyticsSubmissionValue[];
}) {
  const analyticsFormIds = new Set(forms.filter((form) => form.use_item_data_in_analytics).map((form) => form.id));

  if (analyticsFormIds.size === 0) {
    return [];
  }

  const formById = new Map(forms.map((form) => [form.id, form]));
  const itemById = new Map(items.map((item) => [item.id, item]));
  const analyticsSubmissionIds = new Set(
    submissionsThisYear
      .filter((submission) => analyticsFormIds.has(submission.form_id))
      .map((submission) => submission.id),
  );
  const grouped = new Map<
    string,
    {
      counts: Map<string, number>;
      fieldType: string;
      formId: string;
      formName: string;
      label: string;
      total: number;
    }
  >();

  for (const submissionValue of values) {
    if (!analyticsSubmissionIds.has(submissionValue.submission_id)) {
      continue;
    }

    const item = itemById.get(submissionValue.form_item_id);

    if (!item || !analyticsFormIds.has(item.form_id) || !analyticsFieldTypes.has(item.field_type)) {
      continue;
    }

    const labels = getAnalyticsValueLabels(submissionValue.value);

    if (labels.length === 0) {
      continue;
    }

    const group = grouped.get(item.id) ?? {
      counts: new Map<string, number>(),
      fieldType: item.field_type,
      formId: item.form_id,
      formName: formById.get(item.form_id)?.name ?? "Unknown form",
      label: item.label,
      total: 0,
    };

    for (const label of labels) {
      group.counts.set(label, (group.counts.get(label) ?? 0) + 1);
      group.total += 1;
    }

    grouped.set(item.id, group);
  }

  return Array.from(grouped.entries())
    .map(([itemId, group]) => ({
      fieldType: group.fieldType,
      formId: group.formId,
      formName: group.formName,
      itemId,
      label: group.label,
      total: group.total,
      values: Array.from(group.counts.entries())
        .map(([label, count]) => ({ count, label }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
        .slice(0, maxValuesPerField),
    }))
    .sort((left, right) => right.total - left.total || left.formName.localeCompare(right.formName) || left.label.localeCompare(right.label))
    .slice(0, maxFieldValueSummaries);
}

export function summarizeReportAnalytics({
  followUps,
  forms,
  items = [],
  recentEnd,
  recentStart,
  submissions,
  users,
  values = [],
  yearEnd,
  yearStart,
}: {
  followUps: AnalyticsFollowUp[];
  forms: AnalyticsForm[];
  items?: AnalyticsFormItem[];
  recentEnd: Date;
  recentStart: Date;
  submissions: AnalyticsSubmission[];
  users: AnalyticsUser[];
  values?: AnalyticsSubmissionValue[];
  yearEnd: Date;
  yearStart: Date;
}): ReportAnalytics {
  const formById = new Map(forms.map((form) => [form.id, form]));
  const submissionById = new Map(submissions.map((submission) => [submission.id, submission]));
  const submissionsThisYear = submissions.filter((submission) => dateInRange(submissionDate(submission), yearStart, yearEnd));
  const followUpsThisYear = followUps.filter((followUp) => dateInRange(followUp.created_at, yearStart, yearEnd));

  const incidentSubmissions = submissionsThisYear.filter((submission) =>
    formMatchesKeywords(formById.get(submission.form_id), incidentKeywords),
  );
  const hazardSubmissions = submissionsThisYear.filter((submission) =>
    formMatchesKeywords(formById.get(submission.form_id), hazardKeywords),
  );
  const inspectionSubmissions = submissionsThisYear.filter((submission) =>
    formMatchesKeywords(formById.get(submission.form_id), inspectionKeywords),
  );
  const timeCardSubmissions = submissionsThisYear.filter((submission) =>
    formMatchesKeywords(formById.get(submission.form_id), timeCardKeywords),
  );

  const recentTimeCardUserIds = new Set(
    submissions
      .filter((submission) => dateInRange(submissionDate(submission), recentStart, recentEnd))
      .filter((submission) => formMatchesKeywords(formById.get(submission.form_id), timeCardKeywords))
      .map((submission) => submission.submitted_by)
      .filter((userId): userId is string => Boolean(userId)),
  );

  const missingTimeCardUsers = users
    .filter(
      (user) =>
        user.active &&
        user.app_access !== "no_access" &&
        (user.power_level === "manager" || user.power_level === "supervisor" || user.power_level === "worker"),
    )
    .filter((user) => !recentTimeCardUserIds.has(user.id))
    .sort((left, right) => left.full_name.localeCompare(right.full_name));

  const correctiveActionsFromInspections = followUpsThisYear.filter((followUp) => {
    const submission = followUp.parent_submission_id ? submissionById.get(followUp.parent_submission_id) : undefined;
    return formMatchesKeywords(formById.get(submission?.form_id ?? ""), inspectionKeywords);
  }).length;

  const correctiveActionsFromIncidents = followUpsThisYear.filter((followUp) => {
    const submission = followUp.parent_submission_id ? submissionById.get(followUp.parent_submission_id) : undefined;
    return formMatchesKeywords(formById.get(submission?.form_id ?? ""), incidentKeywords);
  }).length;

  const formCounts = new Map<string, number>();
  for (const submission of submissionsThisYear) {
    formCounts.set(submission.form_id, (formCounts.get(submission.form_id) ?? 0) + 1);
  }

  const topForms = Array.from(formCounts.entries())
    .map(([formId, count]) => ({
      count,
      formId,
      name: formById.get(formId)?.name ?? "Unknown form",
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name))
    .slice(0, 5);

  return {
    correctiveActionsFromIncidents,
    correctiveActionsFromInspections,
    correctiveActionsThisYear: followUpsThisYear.length,
    fieldValueSummaries: summarizeFieldValues({ forms, items, submissionsThisYear, values }),
    hazardReportsThisYear: hazardSubmissions.length,
    incidentsThisYear: incidentSubmissions.length,
    inspectionsThisYear: inspectionSubmissions.length,
    missingTimeCardUsers,
    possibleMissingTimeCards: missingTimeCardUsers.length,
    timeCardsThisYear: timeCardSubmissions.length,
    topForms,
  };
}
