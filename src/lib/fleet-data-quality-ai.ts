// The judgement calls a rule cannot make.
//
// scanFleetDataQuality finds what is arithmetically wrong. It cannot find what is
// only probably wrong: that 612A and 705A are one physical trailer entered twice
// under two unit numbers, with one character dropped from each serial so neither
// exact-matches the other. That happened on the real fleet load and no rule
// caught it - a person spotted it by reading two sheets side by side.
//
// This file asks a model to do that reading. Three constraints keep it honest:
//
// 1. THE MODEL NEVER SEES THE FLEET. Candidate pairs are chosen here, by edit
//    distance, so the prompt is a short bounded list rather than 160 rows. That
//    keeps it cheap, keeps it fast, and means a model with a bad day can only be
//    wrong about pairs that already look alike.
// 2. THE MODEL CANNOT INVENT A UNIT. Every unit number it returns is matched back
//    against the candidate list and dropped if it is not there. A hallucinated
//    trailer never reaches the report.
// 3. EVERY FINDING IS MARKED `ai_suggested`. The report renders those as a
//    question, not as a fact, and they sort below everything deterministic.
//
// If the model is not configured, or the call fails, this returns nothing and the
// deterministic report stands on its own. An AI outage must never take the
// scanner down.

import type { DataQualityFinding, DataQualityUnit } from "@/lib/fleet-data-quality";

export type FleetAiStatus = { ready: boolean; missing: string[] };

export function getFleetAiStatus(env: Partial<NodeJS.ProcessEnv> = process.env): FleetAiStatus {
  const missing: string[] = [];

  if (!env.OPENROUTER_API_KEY?.trim()) {
    missing.push("OPENROUTER_API_KEY");
  }

  if (!fleetAiModel(env)) {
    missing.push("OPENROUTER_FORM_IMPORT_MODEL");
  }

  return { missing, ready: missing.length === 0 };
}

function fleetAiModel(env: Partial<NodeJS.ProcessEnv>) {
  return env.OPENROUTER_FLEET_SCAN_MODEL?.trim() || env.OPENROUTER_FORM_IMPORT_MODEL?.trim() || "";
}

export type CandidatePair = {
  left: DataQualityUnit;
  right: DataQualityUnit;
  /** Why the pair was put in front of the model. Shown as evidence. */
  reason: string;
};

/** Levenshtein, capped: we only care whether the distance is small. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) {
    return cap + 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let best = i;

    for (let j = 1; j <= b.length; j += 1) {
      const value = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );

      current.push(value);
      best = Math.min(best, value);
    }

    if (best > cap) {
      return cap + 1;
    }

    previous = current;
  }

  return previous[b.length];
}

const MAX_CANDIDATES = 40;

/**
 * Pairs of units that look enough alike to be worth a second opinion.
 *
 * The qualifying signal is a DIFFERENCE IN LENGTH, not similarity.
 *
 * That is the whole trick, and getting it wrong is expensive. Trailers bought as
 * a batch carry sequential VINs - 2H9QW4RG5LT330805, ...806, ...808, ...809 are
 * four different trailers off one production line, all seventeen characters, all
 * within two characters of each other. A plain edit-distance rule offered forty
 * such pairs on the real fleet: forty questions with the same right answer, paid
 * for one at a time, each one a chance for the model to say yes by mistake.
 *
 * A transcription error looks different. When somebody drops a character off a
 * VIN while retyping it, the result is SHORTER than the original. So a pair is
 * only worth asking about when the two serials are of different lengths and
 * otherwise nearly identical - which is exactly how 612A and 705A arrived, the
 * same trailer from two spreadsheets, each having lost a different character.
 *
 * Anything an exact rule already reports is left out too: a certain finding does
 * not need a model's opinion on top of it.
 */
export function findCandidatePairs(
  units: readonly DataQualityUnit[],
  alreadyReported: readonly DataQualityFinding[] = [],
): CandidatePair[] {
  const settled = new Set<string>();

  for (const finding of alreadyReported) {
    if (finding.confidence !== "certain") {
      continue;
    }

    for (const left of finding.units) {
      for (const right of finding.units) {
        settled.add([left.id, right.id].sort().join("|"));
      }
    }
  }

  const road = units.filter((unit) => unit.status !== "retired" && unit.status !== "sold");
  const pairs: CandidatePair[] = [];

  for (let i = 0; i < road.length; i += 1) {
    for (let j = i + 1; j < road.length; j += 1) {
      const left = road[i];
      const right = road[j];

      if (settled.has([left.id, right.id].sort().join("|"))) {
        continue;
      }

      const leftVin = left.vin_or_serial?.trim().toUpperCase() ?? "";
      const rightVin = right.vin_or_serial?.trim().toUpperCase() ?? "";

      if (leftVin.length < 6 || rightVin.length < 6 || leftVin === rightVin) {
        continue;
      }

      // Same length means two real units off one build run, not one unit typed
      // twice. Skipping them is what keeps this list short enough to be worth
      // paying for.
      if (leftVin.length === rightVin.length) {
        continue;
      }

      if (leftVin.includes(rightVin) || rightVin.includes(leftVin)) {
        pairs.push({ left, reason: "one serial is the other with a character missing", right });
        continue;
      }

      if (editDistance(leftVin, rightVin, 2) <= 2) {
        pairs.push({ left, reason: "serials are nearly identical but of different lengths", right });
      }
    }
  }

  return pairs.slice(0, MAX_CANDIDATES);
}

type ModelVerdict = { left: string; right: string; sameUnit: boolean; reason: string };

function parseVerdicts(text: string): ModelVerdict[] {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { pairs?: unknown }).pairs)) {
    return [];
  }

  return (parsed as { pairs: unknown[] }).pairs.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return [];
    }

    const row = entry as Record<string, unknown>;

    if (typeof row.left !== "string" || typeof row.right !== "string" || typeof row.sameUnit !== "boolean") {
      return [];
    }

    return [
      {
        left: row.left,
        reason: typeof row.reason === "string" ? row.reason : "",
        right: row.right,
        sameUnit: row.sameUnit,
      },
    ];
  });
}

export async function reviewCandidatesWithAi(input: {
  candidates: readonly CandidatePair[];
  env?: Partial<NodeJS.ProcessEnv>;
  fetchImpl?: typeof fetch;
}): Promise<DataQualityFinding[]> {
  const env = input.env ?? process.env;
  const status = getFleetAiStatus(env);

  if (!status.ready || input.candidates.length === 0) {
    return [];
  }

  const rows = input.candidates.map(({ left, right }) => ({
    a: {
      make: left.make ?? null,
      plate: left.license_plate ?? null,
      serial: left.vin_or_serial ?? null,
      unit: left.unit_number,
      year: left.year ?? null,
    },
    b: {
      make: right.make ?? null,
      plate: right.license_plate ?? null,
      serial: right.vin_or_serial ?? null,
      unit: right.unit_number,
      year: right.year ?? null,
    },
  }));

  let text = "";

  try {
    const response = await (input.fetchImpl ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
      body: JSON.stringify({
        max_tokens: 1500,
        messages: [
          {
            content:
              "You compare pairs of commercial trailer records and decide whether the two records describe the SAME " +
              "physical unit entered twice, or two different units that merely look similar. Answer only about the " +
              "pairs given. Return exactly {\"pairs\":[{\"left\":\"unit\",\"right\":\"unit\",\"sameUnit\":true|false," +
              "\"reason\":\"one short sentence\"}]} and no other text.",
            role: "system",
          },
          {
            content:
              // The unit numbers ALWAYS differ. Saying so is not padding: without
              // it the model reads two different unit numbers as proof of two
              // different trailers and rejects every pair, which is exactly what
              // it did on the first run of this prompt. The records come from
              // separate spreadsheets, so a single trailer appearing under two
              // numbers is the thing being looked for, not evidence against.
              "These records were merged from several spreadsheets covering one fleet. The two unit numbers in a pair " +
              "are ALWAYS different - that is the situation being investigated, not evidence that the trailers are " +
              "different. Ignore the unit numbers entirely when deciding.\n\n" +
              "The serial identifies the physical trailer. Decide whether one serial is a mistyped or truncated copy " +
              "of the other.\n\n" +
              "Same trailer: one serial is the other with a character dropped or misread, especially where make and " +
              "year match. A missing plate on one side is normal for a partly filled sheet and is not evidence of a " +
              "second trailer.\n\n" +
              "Different trailers: both serials are well formed and complete, and differ in the way sequential units " +
              "from one build run do; or the make or the year disagree.\n\n" +
              JSON.stringify(rows),
            role: "user",
          },
        ],
        model: fleetAiModel(env),
        temperature: 0,
      }),
      headers: {
        authorization: `Bearer ${env.OPENROUTER_API_KEY!.trim()}`,
        "content-type": "application/json",
        ...(env.OPENROUTER_SITE_URL ? { "HTTP-Referer": env.OPENROUTER_SITE_URL } : {}),
        ...(env.OPENROUTER_APP_NAME ? { "X-Title": env.OPENROUTER_APP_NAME } : {}),
      },
      method: "POST",
    });

    if (!response.ok) {
      return [];
    }

    const json = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };

    text = (json.choices ?? [])
      .map((choice) => (typeof choice?.message?.content === "string" ? choice.message.content : ""))
      .join("\n");
  } catch {
    // A model outage must not take the deterministic report down with it.
    return [];
  }

  // Constraint 2: nothing reaches the report that was not in the candidate list.
  const byNumber = new Map<string, CandidatePair>();

  for (const pair of input.candidates) {
    byNumber.set([pair.left.unit_number, pair.right.unit_number].sort().join("|"), pair);
  }

  return parseVerdicts(text).flatMap((verdict) => {
    if (!verdict.sameUnit) {
      return [];
    }

    const pair = byNumber.get([verdict.left, verdict.right].sort().join("|"));

    if (!pair) {
      return [];
    }

    return [
      {
        confidence: "ai_suggested" as const,
        detail:
          `${verdict.reason || "The two records look like one trailer entered twice."} This is a suggestion from the ` +
          "model, not a certainty - confirm against the registrations before merging anything.",
        evidence: [
          { label: pair.left.unit_number, value: `serial ${pair.left.vin_or_serial ?? "none"} · plate ${pair.left.license_plate ?? "none"} · ${pair.left.year ?? "year unknown"}` },
          { label: pair.right.unit_number, value: `serial ${pair.right.vin_or_serial ?? "none"} · plate ${pair.right.license_plate ?? "none"} · ${pair.right.year ?? "year unknown"}` },
          { label: "Flagged because", value: pair.reason },
        ],
        id: `ai_same_unit:${[pair.left.id, pair.right.id].sort().join(":")}`,
        rule: "ai_same_unit",
        severity: "warning" as const,
        title: `${pair.left.unit_number} and ${pair.right.unit_number} may be the same trailer`,
        units: [
          { id: pair.left.id, unitNumber: pair.left.unit_number },
          { id: pair.right.id, unitNumber: pair.right.unit_number },
        ],
      },
    ];
  });
}
