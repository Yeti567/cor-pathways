import { describe, expect, it } from "vitest";
import {
  approvedChangeOrderTotal,
  coerceChangeOrderOrigin,
  coerceChangeOrderStatus,
  coerceCoProjectStatus,
  coerceLineCategory,
  computeChangeOrderTotals,
  decisionNeedsSignature,
  FIELD_TICKET_STATUS_LABELS,
  formatFileSize,
  formatSignedCurrency,
  lineAmount,
  resolveMarkupAmount,
  revisedContractValue,
  STATUS_TO_DECISION,
} from "@/lib/change-orders";

describe("change order money math", () => {
  const orders = [
    { status: "approved" as const, total_amount: 1000 },
    { status: "approved" as const, total_amount: 250.5 },
    { status: "submitted" as const, total_amount: 9999 },
    { status: "rejected" as const, total_amount: 500 },
    { status: "draft" as const, total_amount: 42 },
    { status: "void" as const, total_amount: 7 },
  ];

  it("counts only approved change orders toward the total", () => {
    expect(approvedChangeOrderTotal(orders)).toBe(1250.5);
  });

  it("ignores everything when nothing is approved", () => {
    expect(approvedChangeOrderTotal([{ status: "submitted", total_amount: 100 }])).toBe(0);
  });

  it("adds approved changes to the original contract value", () => {
    expect(revisedContractValue({ original_contract_value: 100000 }, orders)).toBe(101250.5);
  });

  it("returns the original value when there are no approved changes", () => {
    expect(revisedContractValue({ original_contract_value: 50000 }, [])).toBe(50000);
  });
});

describe("signed currency formatting", () => {
  it("prefixes positive amounts with a plus", () => {
    expect(formatSignedCurrency(1200)).toBe("+$1,200.00");
  });

  it("prefixes negative amounts with a minus and no double sign", () => {
    expect(formatSignedCurrency(-300)).toBe("-$300.00");
  });

  it("shows zero without a sign", () => {
    expect(formatSignedCurrency(0)).toBe("$0.00");
  });
});

describe("enum coercion falls back to safe defaults", () => {
  it("coerces unknown origins to field_condition", () => {
    expect(coerceChangeOrderOrigin("nonsense")).toBe("field_condition");
    expect(coerceChangeOrderOrigin("rfi")).toBe("rfi");
    expect(coerceChangeOrderOrigin(null)).toBe("field_condition");
  });

  it("coerces unknown statuses to draft", () => {
    expect(coerceChangeOrderStatus("nonsense")).toBe("draft");
    expect(coerceChangeOrderStatus("approved")).toBe("approved");
  });

  it("coerces project status to active unless explicitly closed", () => {
    expect(coerceCoProjectStatus("closed")).toBe("closed");
    expect(coerceCoProjectStatus("active")).toBe("active");
    expect(coerceCoProjectStatus("garbage")).toBe("active");
  });

  it("coerces unknown line categories to labor", () => {
    expect(coerceLineCategory("material")).toBe("material");
    expect(coerceLineCategory("nonsense")).toBe("labor");
    expect(coerceLineCategory(null)).toBe("labor");
  });
});

describe("change order pricing", () => {
  it("multiplies quantity by unit cost, rounded to cents", () => {
    expect(lineAmount({ quantity: 3, unit_cost: 12.5 })).toBe(37.5);
    expect(lineAmount({ quantity: 2.5, unit_cost: 10.1 })).toBe(25.25);
  });

  it("resolves a percent markup against the subtotal", () => {
    expect(resolveMarkupAmount({ percent: 10, amount: 0 }, 1000)).toBe(100);
    expect(resolveMarkupAmount({ percent: 7.5, amount: 0 }, 200)).toBe(15);
  });

  it("uses the fixed amount when percent is null", () => {
    expect(resolveMarkupAmount({ percent: null, amount: 250 }, 1000)).toBe(250);
  });

  it("computes subtotal, markups, and total together", () => {
    const lines = [
      { quantity: 2, unit_cost: 100 }, // 200
      { quantity: 1, unit_cost: 50.5 }, // 50.5
    ];
    const markups = [
      { percent: 10, amount: 0 }, // 25.05
      { percent: null, amount: 100 }, // 100
    ];
    const totals = computeChangeOrderTotals(lines, markups);

    expect(totals.subtotal).toBe(250.5);
    expect(totals.resolvedMarkups).toEqual([25.05, 100]);
    expect(totals.markupTotal).toBe(125.05);
    expect(totals.total).toBe(375.55);
  });

  it("is all zeros with no lines or markups", () => {
    expect(computeChangeOrderTotals([], [])).toEqual({
      subtotal: 0,
      markupTotal: 0,
      total: 0,
      resolvedMarkups: [],
    });
  });
});

describe("approval decisions", () => {
  it("maps each target status to a decision", () => {
    expect(STATUS_TO_DECISION.submitted).toBe("submitted");
    expect(STATUS_TO_DECISION.approved).toBe("approved");
    expect(STATUS_TO_DECISION.rejected).toBe("rejected");
    expect(STATUS_TO_DECISION.draft).toBe("reopened");
    expect(STATUS_TO_DECISION.void).toBe("voided");
  });

  it("requires a signature only for approve and reject", () => {
    expect(decisionNeedsSignature("approved")).toBe(true);
    expect(decisionNeedsSignature("rejected")).toBe(true);
    expect(decisionNeedsSignature("submitted")).toBe(false);
    expect(decisionNeedsSignature("draft")).toBe(false);
    expect(decisionNeedsSignature("void")).toBe(false);
  });
});

describe("file size formatting", () => {
  it("formats bytes, kilobytes, and megabytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("returns an empty string for zero or missing sizes", () => {
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(null)).toBe("");
  });
});

describe("field ticket statuses", () => {
  it("labels each field-ticket status", () => {
    expect(FIELD_TICKET_STATUS_LABELS.open).toBe("Open");
    expect(FIELD_TICKET_STATUS_LABELS.promoted).toBe("Promoted");
    expect(FIELD_TICKET_STATUS_LABELS.dismissed).toBe("Dismissed");
  });
});
