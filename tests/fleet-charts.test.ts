import { describe, expect, it } from "vitest";
import type { UnitCertificationStatus, VehicleFileState } from "@/lib/equipment";
import { gapsByInspection, proofOnFile, readiness, renewalsByMonth } from "@/lib/fleet-charts";
import type { FleetUnitInput } from "@/lib/fleet-compliance";

function certification(
  label: string,
  state: VehicleFileState,
  expiryDate: string | null = null,
  options: { expected?: boolean; hasProof?: boolean } = {},
): UnitCertificationStatus {
  return {
    certificationTypeId: label,
    label,
    state,
    expiryDate,
    daysUntilExpiry: null,
    expected: options.expected ?? true,
    hasProof: options.hasProof ?? false,
  };
}

function unit(id: string, certifications: UnitCertificationStatus[]): FleetUnitInput {
  return { id, unitNumber: id, status: "active", registryFiles: [], certifications };
}

describe("readiness", () => {
  it("orders the ring worst first and keeps empty states in the legend", () => {
    const slices = readiness({ compliant: 0, attention: 3, deficient: 157 });

    expect(slices.map((slice) => slice.key)).toEqual(["deficient", "attention", "compliant"]);
    // A legend row that vanishes when it hits zero makes the chart harder to
    // read between loads, so "0 good to go" still has a row.
    expect(slices.at(-1)).toMatchObject({ key: "compliant", count: 0 });
  });
});

describe("gapsByInspection", () => {
  it("counts units, not documents, and ranks the worst inspection first", () => {
    const units = [
      unit("A", [certification("Fire extinguisher", "missing"), certification("PIUC", "on_file")]),
      unit("B", [certification("Fire extinguisher", "expired"), certification("PIUC", "on_file")]),
      unit("C", [certification("Fire extinguisher", "on_file"), certification("PIUC", "missing")]),
    ];

    expect(gapsByInspection(units)).toEqual([
      { label: "Fire extinguisher", gaps: 2, held: 3 },
      { label: "PIUC", gaps: 1, held: 3 },
    ]);
  });

  it("drops inspections with nothing wrong, so the chart is only the work", () => {
    const units = [unit("A", [certification("PIUC", "on_file")])];

    expect(gapsByInspection(units)).toEqual([]);
  });

  it("ignores a certification the tenant does not expect", () => {
    // A unit can file a certificate nobody asked it for. That is not a gap, and
    // counting it would invent work.
    const units = [unit("A", [certification("Some one-off", "missing", null, { expected: false })])];

    expect(gapsByInspection(units)).toEqual([]);
  });

  it("breaks a tie on name so the bar order does not jitter between loads", () => {
    const units = [unit("A", [certification("Zebra", "missing"), certification("Alpha", "missing")])];

    expect(gapsByInspection(units).map((row) => row.label)).toEqual(["Alpha", "Zebra"]);
  });
});

describe("renewalsByMonth", () => {
  const today = new Date(Date.UTC(2026, 7, 21));

  it("puts everything already expired in one overdue column, not in a month", () => {
    const units = [unit("A", [certification("PIUC", "expired", "2021-12-31")])];
    const buckets = renewalsByMonth(units, today, 3);

    expect(buckets[0]).toMatchObject({ key: "overdue", count: 1, overdue: true });
    // Not filed under December 2021, which would have scrolled off the chart.
    expect(buckets.slice(1).every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("buckets live certificates by the month they expire", () => {
    const units = [
      unit("A", [certification("PIUC", "on_file", "2026-08-31"), certification("VK", "due_soon", "2026-09-04")]),
      unit("B", [certification("PIUC", "on_file", "2026-09-30")]),
    ];
    const buckets = renewalsByMonth(units, today, 3);

    expect(buckets.map((bucket) => [bucket.label, bucket.count])).toEqual([
      ["Late", 0],
      ["Aug", 1],
      ["Sep", 2],
      ["Oct", 0],
    ]);
  });

  it("reads the stored date as written rather than through a timezone", () => {
    // Parsing "2026-09-01" as a local Date lands on Aug 31 west of UTC, which
    // would move a renewal into the month before and understate September.
    const units = [unit("A", [certification("PIUC", "on_file", "2026-09-01")])];
    const buckets = renewalsByMonth(units, today, 3);

    expect(buckets.find((bucket) => bucket.label === "Sep")?.count).toBe(1);
    expect(buckets.find((bucket) => bucket.label === "Aug")?.count).toBe(0);
  });

  it("rolls the month labels over a year boundary", () => {
    const buckets = renewalsByMonth([], new Date(Date.UTC(2026, 10, 15)), 3);

    expect(buckets.map((bucket) => bucket.label)).toEqual(["Late", "Nov", "Dec", "Jan"]);
    expect(buckets.at(-1)?.longLabel).toBe("Jan 2027");
  });

  it("ignores an expiry beyond the horizon instead of piling it on the last month", () => {
    const units = [unit("A", [certification("PIUC", "on_file", "2031-04-30")])];
    const buckets = renewalsByMonth(units, today, 3);

    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });
});

describe("proofOnFile", () => {
  it("splits live records by whether a scan is behind the date", () => {
    const units = [
      unit("A", [
        certification("PIUC", "on_file", "2029-08-31", { hasProof: true }),
        certification("VK", "on_file", "2027-01-31", { hasProof: false }),
      ]),
    ];

    expect(proofOnFile(units)).toEqual({ proven: 1, awaiting: 1 });
  });

  it("does not count a missing or expired record as waiting on proof", () => {
    // Those are gaps, and they belong to the gap chart. Counting them here too
    // would make the proof ring look worse than the paperwork actually is.
    const units = [
      unit("A", [certification("PIUC", "missing"), certification("VK", "expired", "2024-01-01")]),
    ];

    expect(proofOnFile(units)).toEqual({ proven: 0, awaiting: 0 });
  });
});

describe("optional registry files", () => {
  function registryFile(label: string, state: VehicleFileState, required: boolean) {
    return {
      registryKey: "vehicle_registration" as const,
      docType: "permit" as const,
      label,
      description: "",
      required,
      state,
      expiryDate: null,
      daysUntilExpiry: null,
      hasProof: false,
    };
  }

  it("does not report a missing optional document as a gap", () => {
    // "Operating permits" is optional: oversize and fuel tax permits are carried
    // only where the work needs them. Counting the absence put a false gap on
    // every one of 160 trailers and buried the real ones under it.
    const units: FleetUnitInput[] = [
      {
        id: "A",
        unitNumber: "A",
        status: "active",
        registryFiles: [registryFile("Operating permits", "missing", false)],
        certifications: [],
      },
    ];

    expect(gapsByInspection(units)).toEqual([]);
  });

  it("still reports an optional document that was taken out and left to expire", () => {
    const units: FleetUnitInput[] = [
      {
        id: "A",
        unitNumber: "A",
        status: "active",
        registryFiles: [registryFile("Operating permits", "expired", false)],
        certifications: [],
      },
    ];

    expect(gapsByInspection(units)).toEqual([{ label: "Operating permits", gaps: 1, held: 1 }]);
  });

  it("still reports a missing required document", () => {
    const units: FleetUnitInput[] = [
      {
        id: "A",
        unitNumber: "A",
        status: "active",
        registryFiles: [registryFile("Vehicle registration (cab card)", "missing", true)],
        certifications: [],
      },
    ];

    expect(gapsByInspection(units)).toEqual([
      { label: "Vehicle registration (cab card)", gaps: 1, held: 1 },
    ]);
  });
});

describe("proofOnFile against the tile beside it", () => {
  it("skips a missing optional document instead of calling it a date with no scan", () => {
    // It is not a gap, but there is no record behind it either, so it belongs in
    // neither half of this ring. Counting it made the ring read 600 where the
    // "waiting on a document" tile read 440.
    const units: FleetUnitInput[] = [
      {
        id: "A",
        unitNumber: "A",
        status: "active",
        registryFiles: [
          {
            registryKey: "vehicle_registration",
            docType: "permit",
            label: "Operating permits",
            description: "",
            required: false,
            state: "missing",
            expiryDate: null,
            daysUntilExpiry: null,
            hasProof: false,
          },
        ],
        certifications: [certification("PIUC", "on_file", "2029-08-31", { hasProof: false })],
      },
    ];

    expect(proofOnFile(units)).toEqual({ proven: 0, awaiting: 1 });
  });
});
