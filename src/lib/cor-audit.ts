// COR audit readiness.
//
// The COR audit (conducted by a licensed auditor in the certifying partner's tool)
// scores a set of elements. Every certifying partner covers the same backbone, so
// this app organizes evidence by the CANONICAL backbone element and renders it
// through the tenant's chosen partner framework (its numbering and names).
//
// Evidence is hybrid: manual evidence is the tracked documents and forms an admin
// filed against an element, and auto evidence is gathered from the modules that
// naturally satisfy an element (training tickets, equipment maintenance, visitor
// records). An element counts as documented when it has either kind.

import { type CorCanonicalElement, elementCovers, elementDisplay, getCorFramework } from "@/lib/cor-frameworks";

// Human-readable app modules that feed each canonical element, shown as guidance.
const AUTO_SOURCES_BY_CANONICAL: Record<CorCanonicalElement, string[]> = {
  management_commitment: ["Resource Library, signed H&S policy", "Worker rights acknowledgements in Documents"],
  senior_management_leadership: ["Safety meeting attendance and the annual program review"],
  hazard_assessment: ["Hazard assessment and FLHA form submissions"],
  hazard_control: ["Safe work procedures in the Resource Library", "Controls from hazard assessments"],
  committees_reps: ["Committee or HS representative minutes filed in Documents"],
  training: ["Worker certifications, training tickets, and orientation records"],
  other_parties: ["Visitor log and contractor orientation records"],
  inspections: ["Worksite and shop inspection submissions"],
  preventative_maintenance: ["Equipment maintenance and scheduled service"],
  emergency_response: ["Emergency response plans and drills in the Resource Library"],
  first_aid: ["First aider list and first aid equipment checks"],
  investigations: ["Incident, near-miss, and collision investigations"],
  program_administration: ["Safety meeting records, statistics in Analytics, and the annual review"],
  company_rules: ["Company rules and safe work practices in the Resource Library"],
  ppe: ["PPE policy and PPE inspection records"],
  legislation: ["Legislation reference and the OHS Act, Regulation, and Code in the Resource Library"],
};

export type CorAuditElementStatus = {
  canonical: CorCanonicalElement;
  covers: CorCanonicalElement[];
  number: number; // the chosen partner's element number
  label: string; // "N. Partner element name"
  name: string;
  description?: string;
  autoSources: string[];
  manualEvidenceCount: number;
  autoEvidenceCount: number;
  evidenceCount: number;
  documented: boolean;
};

export type CorAuditReadiness = {
  elements: CorAuditElementStatus[];
  documentedCount: number;
  total: number;
  readinessPercent: number;
  gaps: CorAuditElementStatus[];
};

/**
 * Build per-element statuses and an overall readiness summary for a certifying
 * partner. Evidence counts are keyed by canonical element; the elements are
 * returned in the partner framework's own order and numbering. An element is
 * documented when it has any evidence; readiness is the share documented.
 */
export function buildAuditReadiness(
  frameworkCode: string,
  manualByCanonical: Partial<Record<CorCanonicalElement, number>>,
  autoByCanonical: Partial<Record<CorCanonicalElement, number>>,
): CorAuditReadiness {
  const framework = getCorFramework(frameworkCode);

  const elements = framework.elements.map((element) => {
    const covers = elementCovers(element);
    // A coarse element aggregates every canonical key it covers; covers are
    // disjoint across a framework's elements, so there is no double counting.
    const manualEvidenceCount = covers.reduce((sum, key) => sum + (manualByCanonical[key] ?? 0), 0);
    const autoEvidenceCount = covers.reduce((sum, key) => sum + (autoByCanonical[key] ?? 0), 0);
    const evidenceCount = manualEvidenceCount + autoEvidenceCount;
    const autoSources = [...new Set(covers.flatMap((key) => AUTO_SOURCES_BY_CANONICAL[key] ?? []))];

    return {
      canonical: element.canonical,
      covers,
      number: element.number,
      label: `${elementDisplay(element)}. ${element.name}`,
      name: element.name,
      description: element.description,
      autoSources,
      manualEvidenceCount,
      autoEvidenceCount,
      evidenceCount,
      documented: evidenceCount > 0,
    } satisfies CorAuditElementStatus;
  });

  const documentedCount = elements.filter((element) => element.documented).length;
  const total = elements.length;

  return {
    elements,
    documentedCount,
    total,
    readinessPercent: total === 0 ? 0 : Math.round((documentedCount / total) * 100),
    gaps: elements.filter((element) => !element.documented),
  };
}
