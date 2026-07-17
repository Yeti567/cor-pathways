import { describe, expect, it } from "vitest";
import type {
  AnalyticsForm,
  AnalyticsFormItem,
  AnalyticsSubmission,
  AnalyticsSubmissionValue,
  AnalyticsUser,
} from "@/lib/report-analytics";
import { getAnalyticsValueLabels } from "@/lib/report-analytics";
import { buildAnalyticsBucketDrilldown, buildAnalyticsDrilldownHref } from "@/lib/report-drilldown";

const forms: AnalyticsForm[] = [
  { code: "INSP", id: "inspection-form", name: "Inspection Form", use_item_data_in_analytics: true },
  { code: "HAZ", id: "hazard-form", name: "Hazard Report", use_item_data_in_analytics: true },
];

const items: AnalyticsFormItem[] = [
  {
    field_type: "dropdown_select_multiple",
    form_id: "inspection-form",
    id: "hazards-found",
    label: "Hazards found",
    sort_order: 1,
  },
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
  {
    created_at: "2026-03-05T14:30:00.000Z",
    form_id: "inspection-form",
    id: "submission-b",
    submitted_at: "2026-03-05T14:30:00.000Z",
    submitted_by: "user-b",
  },
  {
    created_at: "2026-03-06T14:30:00.000Z",
    form_id: "hazard-form",
    id: "submission-c",
    submitted_at: "2026-03-06T14:30:00.000Z",
    submitted_by: "user-b",
  },
];

const values: AnalyticsSubmissionValue[] = [
  { form_item_id: "hazards-found", submission_id: "submission-a", value: ["Housekeeping", "PPE"] },
  { form_item_id: "hazards-found", submission_id: "submission-b", value: ["Housekeeping"] },
  { form_item_id: "hazards-found", submission_id: "submission-c", value: ["PPE"] },
];

describe("report drilldowns", () => {
  it("finds exact submissions behind an analytics answer bucket", () => {
    const drilldown = buildAnalyticsBucketDrilldown({
      forms,
      itemId: "hazards-found",
      items,
      submissions,
      users,
      valueLabel: "Housekeeping",
      values,
    });

    expect(drilldown.fieldLabel).toBe("Hazards found");
    expect(drilldown.formName).toBe("Inspection Form");
    expect(drilldown.submissions.map((submission) => submission.id)).toEqual(["submission-b", "submission-a"]);
    expect(drilldown.submissions[0]).toMatchObject({
      formCode: "INSP",
      submittedByLabel: "Casey Worker",
    });
  });

  it("uses the same value-label normalization as analytics summaries", () => {
    expect(getAnalyticsValueLabels(["Housekeeping", false, null, ""])).toEqual(["Housekeeping"]);
    expect(getAnalyticsValueLabels({ type: "equipment", unitNumber: "EX-1", name: "Excavator" })).toEqual([
      "EX-1, Excavator",
    ]);
  });

  it("builds encoded drilldown URLs", () => {
    expect(
      buildAnalyticsDrilldownHref({
        end: "2026-03-31",
        itemId: "hazards-found",
        start: "2026-03-01",
        valueLabel: "Fail / unsafe",
      }),
    ).toBe("/admin/analytics/drilldown?end=2026-03-31&itemId=hazards-found&start=2026-03-01&value=Fail+%2F+unsafe");
  });
});
