import { describe, expect, it } from "vitest";
import type { AnalyticsForm, AnalyticsSubmission, AnalyticsUser, ReportAnalytics } from "@/lib/report-analytics";
import {
  buildAnalyticsReportCsv,
  buildOperationsReportCsv,
  reportCsvFilenameSegment,
  type ReportExportFollowUp,
} from "@/lib/report-export";

const forms: AnalyticsForm[] = [
  { code: "INSP", id: "inspection-form", name: "Inspection, Daily", use_item_data_in_analytics: true },
  { code: "HAZ", id: "hazard-form", name: "Hazard Report", use_item_data_in_analytics: false },
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

const submissions: AnalyticsSubmission[] = [
  {
    created_at: "2026-03-04T14:30:00.000Z",
    form_id: "inspection-form",
    id: "submission-a",
    submitted_at: "2026-03-04T14:30:00.000Z",
    submitted_by: "user-a",
  },
];

const baseAnalytics: ReportAnalytics = {
  correctiveActionsFromIncidents: 0,
  correctiveActionsFromInspections: 1,
  correctiveActionsThisYear: 1,
  fieldValueSummaries: [],
  hazardReportsThisYear: 0,
  incidentsThisYear: 0,
  inspectionsThisYear: 1,
  missingTimeCardUsers: [users[1]],
  possibleMissingTimeCards: 1,
  timeCardsThisYear: 0,
  topForms: [{ count: 1, formId: "inspection-form", name: "Inspection, Daily" }],
};

describe("report CSV exports", () => {
  it("exports operations report sections with escaped table values", () => {
    const followUps: ReportExportFollowUp[] = [
      {
        assigned_to: "user-a",
        created_at: "2026-03-04T15:00:00.000Z",
        description: 'Needs "review"\nsoon',
        id: "follow-up-a",
        parent_submission_id: "submission-a",
        status: "open",
        title: "Guardrail, missing",
      },
    ];
    const csv = buildOperationsReportCsv({
      analytics: baseAnalytics,
      dateRangeLabel: "01 Mar 2026 to 31 Mar 2026",
      followUps,
      forms,
      generatedAt: new Date("2026-03-31T12:00:00.000Z"),
      preparedBy: "Admin User",
      submissions,
      tenantName: "Acme Construction",
      users,
    });

    expect(csv).toContain("Operations Trend Report");
    expect(csv).toContain("Date Range,01 Mar 2026 to 31 Mar 2026");
    expect(csv).toContain('"Inspection, Daily",1');
    expect(csv).toContain('"Guardrail, missing",open,"Inspection, Daily",Alex Worker');
    expect(csv).toContain('"Needs ""review"" soon"');
  });

  it("exports analytics templates and field answer buckets", () => {
    const csv = buildAnalyticsReportCsv({
      analytics: {
        ...baseAnalytics,
        fieldValueSummaries: [
          {
            fieldType: "pass_fail_na",
            formId: "inspection-form",
            formName: "Inspection, Daily",
            itemId: "result-field",
            label: "Inspection Result",
            total: 4,
            values: [
              { count: 3, label: "Pass" },
              { count: 1, label: "Fail, unsafe" },
            ],
          },
        ],
      },
      analyticsFormIds: ["inspection-form"],
      analyticsSubmissionIds: ["submission-a"],
      dateRangeLabel: "01 Mar 2026 to 31 Mar 2026",
      forms,
      generatedAt: new Date("2026-03-31T12:00:00.000Z"),
      preparedBy: "Admin User",
      submissions,
      tenantName: "Acme Construction",
    });

    expect(csv).toContain("Form Item Analytics");
    expect(csv).toContain('INSP,"Inspection, Daily",1');
    expect(csv).toContain('"Inspection, Daily",Inspection Result,pass_fail_na,Pass,3,75%,4');
    expect(csv).toContain('"Inspection, Daily",Inspection Result,pass_fail_na,"Fail, unsafe",1,25%,4');
  });

  it("normalizes CSV filename segments", () => {
    expect(reportCsvFilenameSegment("March 2026 / Shop #1")).toBe("march-2026-shop-1");
  });
});
