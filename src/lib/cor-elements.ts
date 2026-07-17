// AMTA COR audit element labels, used to tag documents and forms so they map into
// the right section of the audit. Numbers are stored on resources.cor_element and
// forms.cor_element.
//
// These are derived from the AMTA framework in cor-frameworks.ts so there is a
// single source of truth for the AMTA element names. (Evidence is also tagged to a
// canonical, cross-partner key via cor_element_key; the integer remains for the
// current AMTA-numbered picker.)

import { getCorFramework } from "@/lib/cor-frameworks";

const AMTA_ELEMENTS = getCorFramework("amta").elements;

export const COR_ELEMENT_LABELS: Record<number, string> = Object.fromEntries(
  AMTA_ELEMENTS.map((element) => [element.number, element.name]),
);

export const COR_ELEMENT_NUMBERS = AMTA_ELEMENTS.map((element) => element.number) as readonly number[];

export function corElementLabel(element: number | null | undefined): string {
  return element ? `Element ${element}: ${COR_ELEMENT_LABELS[element] ?? ""}`.trim() : "";
}
