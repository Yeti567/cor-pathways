import { describe, expect, it } from "vitest";
import {
  summarizeReportAnalytics,
  type AnalyticsFollowUp,
  type AnalyticsForm,
  type AnalyticsFormItem,
  type AnalyticsSubmission,
  type AnalyticsSubmissionValue,
  type AnalyticsUser,
} from "@/lib/report-analytics";

const forms: AnalyticsForm[] = [
  { id: "incident-form", code: "INC", name: "Incident Report" },
  { id: "hazard-form", code: "HAZ", name: "Hazard Report" },
  { id: "inspection-form", code: "INSP", name: "Monthly Site Inspection" },
  { id: "time-form", code: "TIME", name: "Employee Time Card" },
];

const users: AnalyticsUser[] = [
  {
    active: true,
    app_access: "app_access",
    email: "alex@example.com",
    full_name: "Alex Worker",
    id: "user-a",
    power_level: "worker",
  },
  {
    active: true,
    app_access: "app_access",
    email: "casey@example.com",
    full_name: "Casey Worker",
    id: "user-b",
    power_level: "worker",
  },
];

describe("report analytics", () => {
  it("summarizes yearly form trends and corrective action sources", () => {
    const submissions: AnalyticsSubmission[] = [
      {
        created_at: "2026-01-15T12:00:00.000Z",
        form_id: "incident-form",
        id: "incident-submission",
        submitted_at: "2026-01-15T12:00:00.000Z",
        submitted_by: "user-a",
      },
      {
        created_at: "2026-02-15T12:00:00.000Z",
        form_id: "hazard-form",
        id: "hazard-submission",
        submitted_at: "2026-02-15T12:00:00.000Z",
        submitted_by: "user-a",
      },
      {
        created_at: "2026-03-15T12:00:00.000Z",
        form_id: "inspection-form",
        id: "inspection-submission",
        submitted_at: "2026-03-15T12:00:00.000Z",
        submitted_by: "user-a",
      },
      {
        created_at: "2026-05-15T12:00:00.000Z",
        form_id: "time-form",
        id: "time-submission",
        submitted_at: "2026-05-15T12:00:00.000Z",
        submitted_by: "user-a",
      },
    ];
    const followUps: AnalyticsFollowUp[] = [
      {
        created_at: "2026-03-16T12:00:00.000Z",
        id: "inspection-action",
        parent_submission_id: "inspection-submission",
      },
      {
        created_at: "2026-01-16T12:00:00.000Z",
        id: "incident-action",
        parent_submission_id: "incident-submission",
      },
    ];

    const summary = summarizeReportAnalytics({
      followUps,
      forms,
      recentEnd: new Date("2026-05-22T00:00:00.000Z"),
      recentStart: new Date("2026-05-01T00:00:00.000Z"),
      submissions,
      users,
      yearEnd: new Date("2027-01-01T00:00:00.000Z"),
      yearStart: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(summary.incidentsThisYear).toBe(1);
    expect(summary.hazardReportsThisYear).toBe(1);
    expect(summary.inspectionsThisYear).toBe(1);
    expect(summary.timeCardsThisYear).toBe(1);
    expect(summary.correctiveActionsThisYear).toBe(2);
    expect(summary.correctiveActionsFromInspections).toBe(1);
    expect(summary.correctiveActionsFromIncidents).toBe(1);
    expect(summary.missingTimeCardUsers.map((user) => user.id)).toEqual(["user-b"]);
    expect(summary.topForms[0]?.count).toBe(1);
  });

  it("summarizes field values for forms opted into item analytics", () => {
    const analyticsForms: AnalyticsForm[] = [
      { id: "inspection-form", code: "INSP", name: "Monthly Site Inspection", use_item_data_in_analytics: true },
      { id: "hazard-form", code: "HAZ", name: "Hazard Report", use_item_data_in_analytics: false },
    ];
    const submissions: AnalyticsSubmission[] = [
      {
        created_at: "2026-03-15T12:00:00.000Z",
        form_id: "inspection-form",
        id: "inspection-a",
        submitted_at: "2026-03-15T12:00:00.000Z",
        submitted_by: "user-a",
      },
      {
        created_at: "2026-03-16T12:00:00.000Z",
        form_id: "inspection-form",
        id: "inspection-b",
        submitted_at: "2026-03-16T12:00:00.000Z",
        submitted_by: "user-b",
      },
      {
        created_at: "2026-03-17T12:00:00.000Z",
        form_id: "hazard-form",
        id: "hazard-a",
        submitted_at: "2026-03-17T12:00:00.000Z",
        submitted_by: "user-b",
      },
    ];
    const items: AnalyticsFormItem[] = [
      {
        field_type: "pass_fail_na",
        form_id: "inspection-form",
        id: "inspection-result",
        label: "Inspection result",
        sort_order: 1,
      },
      {
        field_type: "dropdown_select_multiple",
        form_id: "inspection-form",
        id: "hazards-found",
        label: "Hazards found",
        sort_order: 2,
      },
      {
        field_type: "long_text",
        form_id: "inspection-form",
        id: "notes",
        label: "Notes",
        sort_order: 3,
      },
      {
        field_type: "pass_fail_na",
        form_id: "hazard-form",
        id: "hazard-result",
        label: "Hazard result",
        sort_order: 1,
      },
    ];
    const values: AnalyticsSubmissionValue[] = [
      { form_item_id: "inspection-result", submission_id: "inspection-a", value: "pass" },
      { form_item_id: "inspection-result", submission_id: "inspection-b", value: "fail" },
      { form_item_id: "hazards-found", submission_id: "inspection-a", value: ["Housekeeping", "PPE"] },
      { form_item_id: "hazards-found", submission_id: "inspection-b", value: ["Housekeeping"] },
      { form_item_id: "notes", submission_id: "inspection-a", value: "Free text should not become a chart bucket" },
      { form_item_id: "hazard-result", submission_id: "hazard-a", value: "fail" },
    ];

    const summary = summarizeReportAnalytics({
      followUps: [],
      forms: analyticsForms,
      items,
      recentEnd: new Date("2026-05-22T00:00:00.000Z"),
      recentStart: new Date("2026-05-01T00:00:00.000Z"),
      submissions,
      users,
      values,
      yearEnd: new Date("2027-01-01T00:00:00.000Z"),
      yearStart: new Date("2026-01-01T00:00:00.000Z"),
    });

    expect(summary.fieldValueSummaries).toHaveLength(2);
    expect(summary.fieldValueSummaries[0]).toMatchObject({
      formName: "Monthly Site Inspection",
      label: "Hazards found",
      total: 3,
      values: [
        { count: 2, label: "Housekeeping" },
        { count: 1, label: "PPE" },
      ],
    });
    expect(summary.fieldValueSummaries[1]).toMatchObject({
      label: "Inspection result",
      values: [
        { count: 1, label: "fail" },
        { count: 1, label: "pass" },
      ],
    });
  });
});
