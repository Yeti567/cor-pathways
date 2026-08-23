import { describe, expect, it } from "vitest";
import {
  scanFleetDataQuality,
  searchFindings,
  summariseFindings,
  type DataQualityUnit,
} from "@/lib/fleet-data-quality";
import { findCandidatePairs, reviewCandidatesWithAi } from "@/lib/fleet-data-quality-ai";

function unit(overrides: Partial<DataQualityUnit> & { id: string; unit_number: string }): DataQualityUnit {
  return {
    category: "trailer",
    is_commercial: true,
    license_plate: "6AA 001",
    status: "active",
    vin_or_serial: "8RTKK3M55NS770016",
    ...overrides,
  };
}

const AI_ENV = {
  OPENROUTER_API_KEY: "test-key",
  OPENROUTER_FORM_IMPORT_MODEL: "google/gemini-3.5-flash",
};

function ruleIds(findings: { rule: string }[]) {
  return findings.map((finding) => finding.rule);
}

describe("fleet data quality scanner", () => {
  it("reports two units sharing one plate, however the separators are written", () => {
    // The real one: 410B is a 2013 Tremcar, 411B a 2008 Heil, both down as 7AB4-21.
    const findings = scanFleetDataQuality({
      units: [
        unit({ id: "a", license_plate: "7AB4-21", unit_number: "410B", vin_or_serial: "3M8QW1RG7LT330541", year: 2013 }),
        unit({ id: "b", license_plate: "7AB4 21", unit_number: "411B", vin_or_serial: "4N7ZX2SH9MU220118", year: 2008 }),
      ],
    });

    const duplicate = findings.find((finding) => finding.rule === "duplicate_plate");

    expect(duplicate).toBeDefined();
    expect(duplicate!.severity).toBe("critical");
    expect(duplicate!.confidence).toBe("certain");
    expect(duplicate!.units.map((u) => u.unitNumber)).toEqual(["410B", "411B"]);
  });

  it("does not group units that merely have no plate", () => {
    const findings = scanFleetDataQuality({
      units: [
        unit({ id: "a", license_plate: null, unit_number: "520A" }),
        unit({ id: "b", license_plate: null, unit_number: "520B", vin_or_serial: "5PQZZ1A20VB000772" }),
      ],
    });

    expect(ruleIds(findings)).not.toContain("duplicate_plate");
    expect(ruleIds(findings)).toContain("missing_plate");
  });

  it("catches duplicate serials and duplicate unit numbers", () => {
    const findings = scanFleetDataQuality({
      units: [
        unit({ id: "a", license_plate: "6AA 001", unit_number: "100A" }),
        unit({ id: "b", license_plate: "6AA 002", unit_number: "100A" }),
      ],
    });

    expect(ruleIds(findings)).toContain("duplicate_vin");
    expect(ruleIds(findings)).toContain("duplicate_unit_number");
  });

  it("flags a short serial as suspect, not certain", () => {
    const findings = scanFleetDataQuality({
      units: [unit({ id: "a", unit_number: "300A", vin_or_serial: "8RTKK3M55NS77001" })],
    });
    const short = findings.find((finding) => finding.rule === "vin_length");

    expect(short).toBeDefined();
    expect(short!.confidence).toBe("suspect");
    expect(short!.evidence[0].value).toContain("16 characters");
  });

  it("flags a VIN containing a letter the standard excludes", () => {
    const findings = scanFleetDataQuality({
      units: [unit({ id: "a", unit_number: "301A", vin_or_serial: "8RTKK3M55NS7700IO" })],
    });
    const bad = findings.find((finding) => finding.rule === "vin_ambiguous_characters");

    expect(bad).toBeDefined();
    expect(bad!.confidence).toBe("certain");
    expect(bad!.evidence[0].value).toContain("I");
  });

  it("does not flag a valid 17 character VIN", () => {
    const findings = scanFleetDataQuality({
      units: [unit({ id: "a", unit_number: "302A", vin_or_serial: "1X9YY7K42PS412873" })],
    });

    expect(ruleIds(findings)).not.toContain("vin_length");
    expect(ruleIds(findings)).not.toContain("vin_ambiguous_characters");
  });

  it("catches a serial that is really a date", () => {
    const findings = scanFleetDataQuality({
      units: [unit({ id: "a", unit_number: "705A", vin_or_serial: "2024-06-11" })],
    });

    expect(ruleIds(findings)).toContain("vin_is_a_date");
  });

  it("catches Excel's 1904 epoch wreckage in an expiry date", () => {
    const findings = scanFleetDataQuality({
      documents: [
        { equipment_id: "a", expiry_date: "1904-12-29", title: "Tank thickness (T)" },
        { equipment_id: "a", expiry_date: "2027-03-10", title: "Product hose" },
      ],
      units: [unit({ id: "a", unit_number: "400A" })],
    });
    const bad = findings.find((finding) => finding.rule === "implausible_expiry_date");

    expect(bad).toBeDefined();
    expect(bad!.evidence).toHaveLength(1);
    expect(bad!.evidence[0].value).toContain("1904-12-29");
  });

  it("ignores a superseded certificate when judging dates", () => {
    const findings = scanFleetDataQuality({
      documents: [{ equipment_id: "a", expiry_date: "1904-12-29", is_active: false, title: "Old" }],
      units: [unit({ id: "a", unit_number: "401A" })],
    });

    expect(ruleIds(findings)).not.toContain("implausible_expiry_date");
  });

  it("notices a B-train missing its other half, but not a complete pair", () => {
    const paired = scanFleetDataQuality({
      units: [
        unit({ id: "a", license_plate: "6AA 001", unit_number: "330A", vin_or_serial: "1X9YY7K42PS412873" }),
        unit({ id: "b", license_plate: "6AA 002", unit_number: "330B", vin_or_serial: "1X9YY7K42PS412874" }),
      ],
    });

    expect(ruleIds(paired)).not.toContain("unpaired_trailer");

    const lonely = scanFleetDataQuality({
      units: [unit({ id: "a", unit_number: "330A", vin_or_serial: "1X9YY7K42PS412873" })],
    });

    expect(ruleIds(lonely)).toContain("unpaired_trailer");
  });

  it("leaves sold and retired units out of the report", () => {
    const findings = scanFleetDataQuality({
      units: [
        unit({ id: "a", license_plate: "7AB4-21", status: "sold", unit_number: "210" }),
        unit({ id: "b", license_plate: "7AB4-21", status: "retired", unit_number: "211" }),
      ],
    });

    expect(findings).toEqual([]);
  });

  it("puts the least arguable findings at the top", () => {
    const findings = scanFleetDataQuality({
      units: [
        unit({ id: "a", license_plate: "7AB4-21", unit_number: "410B" }),
        unit({ id: "b", license_plate: "7AB4-21", unit_number: "411B", vin_or_serial: "4N7ZX2SH9MU22011" }),
      ],
    });

    expect(findings[0].severity).toBe("critical");
    expect(findings[findings.length - 1].confidence).not.toBe("certain");
  });
});

describe("searching the report", () => {
  const findings = scanFleetDataQuality({
    units: [
      unit({ id: "a", license_plate: "7AB4-21", unit_number: "410B" }),
      unit({ id: "b", license_plate: "7AB4-21", unit_number: "411B", vin_or_serial: "4N7ZX2SH9MU220118" }),
      unit({ id: "c", license_plate: null, unit_number: "520A", vin_or_serial: "5PQZZ1J36VB000771" }),
    ],
  });

  it("finds by unit number, by rule and by plain words", () => {
    // 410B legitimately appears in two findings - the shared plate and, since
    // there is no 410A in this fixture, the unpaired-trailer one.
    expect(searchFindings(findings, "410B").map((f) => f.rule).sort()).toEqual(["duplicate_plate", "unpaired_trailer"]);
    expect(searchFindings(findings, "duplicate_plate")).toHaveLength(1);
    expect(searchFindings(findings, "plate")).not.toHaveLength(0);
  });

  it("does not join prose words together when matching", () => {
    // The stripped index covers identifiers only, so a query that only exists by
    // running two words together must not match.
    expect(searchFindings(findings, "platetwo")).toHaveLength(0);
    expect(searchFindings(findings, "unitscannot")).toHaveLength(0);
  });

  it("finds by plate however the separators are typed", () => {
    expect(searchFindings(findings, "7AB4-21")).toHaveLength(1);
    expect(searchFindings(findings, "7AB421")).toHaveLength(1);
    expect(searchFindings(findings, "7AB4 21")).toHaveLength(1);
  });

  it("returns everything for an empty query and nothing for a miss", () => {
    expect(searchFindings(findings, "   ")).toHaveLength(findings.length);
    expect(searchFindings(findings, "6ZZ 999")).toHaveLength(0);
  });

  it("counts affected units once even when they appear in several findings", () => {
    const summary = summariseFindings(findings);

    expect(summary.total).toBe(findings.length);
    expect(summary.unitsAffected).toBe(3);
    expect(summary.critical).toBeGreaterThan(0);
  });
});

describe("the Gemini second opinion", () => {
  // 647/815 as they really arrived: the same two trailers under two unit numbers,
  // each sheet dropping a different character from the serial.
  const twins: DataQualityUnit[] = [
    unit({ id: "a", license_plate: "7CD9-33", unit_number: "612A", vin_or_serial: "8RTKK3M55NS770016" }),
    unit({ id: "b", license_plate: "7CD9-33", unit_number: "705A", vin_or_serial: "8RTKK3M55NS77001" }),
  ];

  it("offers near-identical serials as candidates", () => {
    const pairs = findCandidatePairs(twins);

    expect(pairs).toHaveLength(1);
    expect(pairs[0].left.unit_number).toBe("612A");
    expect(pairs[0].right.unit_number).toBe("705A");
  });

  it("does not re-ask about a pair a certain rule already reported", () => {
    const certain = scanFleetDataQuality({ units: twins }).filter((f) => f.confidence === "certain");

    expect(certain.some((f) => f.rule === "duplicate_plate")).toBe(true);
    expect(findCandidatePairs(twins, certain)).toHaveLength(0);
  });

  it("leaves unrelated serials alone", () => {
    const pairs = findCandidatePairs([
      unit({ id: "a", unit_number: "100A", vin_or_serial: "1X9YY7K42PS412873" }),
      unit({ id: "b", unit_number: "200A", vin_or_serial: "4N7ZX2SH9MU220118" }),
    ]);

    expect(pairs).toEqual([]);
  });

  it("does not ask about sequential serials from one build batch", () => {
    // Real units 901, 902, 903 and 904 - four trailers off one production line.
    // All seventeen characters, all within two of each other. An edit-distance
    // rule offered every combination of these; length is what tells them apart
    // from a retyping error.
    const batch = [
      unit({ id: "a", license_plate: "6AA 001", unit_number: "901", vin_or_serial: "2H9QW4RG5LT330805" }),
      unit({ id: "b", license_plate: "6AA 002", unit_number: "902", vin_or_serial: "2H9QW4RG7LT330806" }),
      unit({ id: "c", license_plate: "6AA 003", unit_number: "903", vin_or_serial: "2H9QW4RG0LT330808" }),
      unit({ id: "d", license_plate: "6AA 004", unit_number: "904", vin_or_serial: "2H9QW4RG2LT330809" }),
    ];

    expect(findCandidatePairs(batch)).toEqual([]);
  });

  it("turns a positive verdict into an ai_suggested finding", async () => {
    const findings = await reviewCandidatesWithAi({
      candidates: findCandidatePairs(twins),
      env: AI_ENV,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: '{"pairs":[{"left":"612A","right":"705A","sameUnit":true,"reason":"One character dropped."}]}',
                },
              },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0].confidence).toBe("ai_suggested");
    expect(findings[0].rule).toBe("ai_same_unit");
    expect(findings[0].detail).toContain("confirm against the registrations");
  });

  it("drops a unit the model invented", async () => {
    const findings = await reviewCandidatesWithAi({
      candidates: findCandidatePairs(twins),
      env: AI_ENV,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '{"pairs":[{"left":"999Z","right":"888Y","sameUnit":true,"reason":"Invented."}]}' } },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });

    expect(findings).toEqual([]);
  });

  it("reports nothing when the model says the units are different", async () => {
    const findings = await reviewCandidatesWithAi({
      candidates: findCandidatePairs(twins),
      env: AI_ENV,
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: '{"pairs":[{"left":"612A","right":"705A","sameUnit":false,"reason":"Sequential."}]}' } },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });

    expect(findings).toEqual([]);
  });

  it("stays quiet when the model is unconfigured, erroring or talking nonsense", async () => {
    const candidates = findCandidatePairs(twins);

    await expect(reviewCandidatesWithAi({ candidates, env: {} })).resolves.toEqual([]);

    await expect(
      reviewCandidatesWithAi({
        candidates,
        env: AI_ENV,
        fetchImpl: (async () => new Response("upstream is down", { status: 500 })) as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);

    await expect(
      reviewCandidatesWithAi({
        candidates,
        env: AI_ENV,
        fetchImpl: (async () => {
          throw new Error("network");
        }) as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);

    await expect(
      reviewCandidatesWithAi({
        candidates,
        env: AI_ENV,
        fetchImpl: (async () =>
          new Response(JSON.stringify({ choices: [{ message: { content: "I could not do that." } }] }), {
            status: 200,
          })) as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);
  });
});
