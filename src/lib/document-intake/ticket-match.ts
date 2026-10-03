// Whose ticket is this? Matching the name printed on a ticket to a person.
//
// Names are the weakest identifier there is. "SMITH, JOHN", "J. Smith", "John M Smith" and
// "Jon Smith" can all be one man, and "J. Smith" can be two. So this never decides on a
// near thing: only a name that matches exactly ONE person, word for word, is "matched".
// Anything less is "suggested", and the page asks "Is this John Smith's ticket?" and saves
// nothing until a person clicks Yes. That rule is the client's, and it is the right one: a
// ticket filed on the wrong worker makes one person look qualified who is not.

import { editDistance } from "./match";

export type TicketPerson = {
  id: string;
  kind: "worker" | "contracted";
  fullName: string;
  /** The carrier a contracted driver drives for, shown to tell two namesakes apart. */
  carrier?: string | null;
};

export type PersonMatch = {
  status: "matched" | "suggested" | "unmatched";
  person: TicketPerson | null;
  /** Everyone worth offering, best first. Includes the suggested person. */
  candidates: TicketPerson[];
  /** Plain-language reason, shown to the reviewer. */
  reason: string;
};

/** Lowercase words, accents and punctuation removed, "Last, First" turned round. */
export function nameWords(name: string): string[] {
  const flipped = name.includes(",")
    ? name
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .reverse()
        .join(" ")
    : name;

  return flipped
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/['-]/g, "")
    .split(/\s+/)
    .filter(Boolean);
}

type Score = { person: TicketPerson; score: number; why: string };

/**
 * How well a printed name fits a person, 0 to 100. Exact word-for-word is 100 and is the
 * only score that can make a match; everything else only ranks suggestions.
 */
function scoreName(printed: string[], person: TicketPerson): Score {
  const known = nameWords(person.fullName);

  if (printed.length === 0 || known.length === 0) {
    return { person, score: 0, why: "" };
  }

  const printedSorted = [...printed].sort().join(" ");
  const knownSorted = [...known].sort().join(" ");

  if (printedSorted === knownSorted) {
    return { person, score: 100, why: "same name" };
  }

  const printedLast = printed[printed.length - 1];
  const knownLast = known[known.length - 1];
  const printedFirst = printed[0];
  const knownFirst = known[0];
  const sameLast = printedLast === knownLast;

  // "John Michael Smith" vs "John Smith": every word of the shorter one is in the longer.
  const [shorter, longer] = printed.length <= known.length ? [printed, known] : [known, printed];

  if (sameLast && shorter.length >= 2 && shorter.every((word) => longer.includes(word))) {
    return { person, score: 85, why: "same name with a middle name added or left out" };
  }

  // "J. Smith" or "J Smith" vs "John Smith".
  if (sameLast && printedFirst.length === 1 && knownFirst.startsWith(printedFirst)) {
    return { person, score: 75, why: "same last name and first initial" };
  }

  if (sameLast && knownFirst.length === 1 && printedFirst.startsWith(knownFirst)) {
    return { person, score: 75, why: "same last name and first initial" };
  }

  // A small misspelling across the whole name: "Jon Smith", "John Smyth".
  const distance = editDistance(printed.join(" "), known.join(" "), 2);

  if (distance <= 2 && Math.min(printed.join(" ").length, known.join(" ").length) >= 6) {
    return { person, score: 70 - distance * 5, why: "very close spelling" };
  }

  if (sameLast && editDistance(printedFirst, knownFirst, 2) <= 2) {
    return { person, score: 55, why: "same last name, similar first name" };
  }

  if (sameLast) {
    return { person, score: 30, why: "same last name" };
  }

  return { person, score: 0, why: "" };
}

export function matchPerson(printedName: string | null | undefined, people: readonly TicketPerson[]): PersonMatch {
  const printed = nameWords(printedName ?? "");

  if (printed.length === 0) {
    return { candidates: [], person: null, reason: "No name could be read on the ticket.", status: "unmatched" };
  }

  const scored = people
    .map((person) => scoreName(printed, person))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.person.fullName.localeCompare(b.person.fullName));
  const candidates = scored.slice(0, 6).map((entry) => entry.person);
  const exact = scored.filter((entry) => entry.score === 100);

  if (exact.length === 1) {
    return { candidates, person: exact[0].person, reason: "The name matches exactly one person.", status: "matched" };
  }

  if (exact.length > 1) {
    return {
      candidates,
      person: exact[0].person,
      reason: `${exact.length} people have exactly this name. Choose the right one.`,
      status: "suggested",
    };
  }

  const best = scored[0];

  if (best && best.score >= 30) {
    const tied = scored.filter((entry) => entry.score === best.score).length;

    return {
      candidates,
      person: best.person,
      reason:
        tied > 1
          ? `The ticket says "${printedName}", which fits more than one person (${best.why}).`
          : `The ticket says "${printedName}": ${best.why}.`,
      status: "suggested",
    };
  }

  return {
    candidates,
    person: null,
    reason: `Nobody in the app matches "${printedName}". They may need adding first.`,
    status: "unmatched",
  };
}
