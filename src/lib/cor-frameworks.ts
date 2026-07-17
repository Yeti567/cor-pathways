// COR certifying-partner frameworks.
//
// Alberta's COR program is governed centrally by Partnerships, but each Certifying
// Partner (CP) builds and owns its own audit instrument. Every instrument covers
// the same health-and-safety-management-system backbone, but each CP numbers,
// names, and groups the elements differently (e.g. Hazard Assessment is AMTA
// element 2 but ACSA element 5).
//
// To stay portable across CPs, evidence is tagged to a CANONICAL element key (the
// stable backbone identity) and rendered through the selected CP's framework (its
// own number, name, and order). Switching CP then re-labels and re-groups without
// misfiling anything.
//
// Phase 1 establishes this taxonomy and the AMTA + ACSA frameworks. Other CPs are
// listed in the directory so the dropdown is complete; their full element
// frameworks are added as their instruments are confirmed.

// The shared HSMS backbone, at the FINEST grain used by any certifying partner.
// These keys never change and are what evidence is tagged to. Most CPs use ten
// elements, but some (e.g. MHSA) split a few of them finer: management into policy
// vs senior leadership, inspections into worksite vs preventative maintenance, and
// emergency into preparedness vs first aid. Those finer splits are separate keys so
// the finest CP keeps full fidelity; a coarser CP's element simply `covers` more
// than one of these keys (see CorFrameworkElement.covers).
export type CorCanonicalElement =
  | "management_commitment"
  | "senior_management_leadership"
  | "hazard_assessment"
  | "hazard_control"
  | "committees_reps"
  | "training"
  | "other_parties"
  | "inspections"
  | "preventative_maintenance"
  | "emergency_response"
  | "first_aid"
  | "investigations"
  | "program_administration"
  // Topics some standards (e.g. the national COR 2020) treat as their own
  // elements; Alberta partners fold these into hazard control or administration.
  | "company_rules"
  | "ppe"
  | "legislation";

export const CANONICAL_ELEMENTS: CorCanonicalElement[] = [
  "management_commitment",
  "senior_management_leadership",
  "hazard_assessment",
  "hazard_control",
  "committees_reps",
  "training",
  "other_parties",
  "inspections",
  "preventative_maintenance",
  "emergency_response",
  "first_aid",
  "investigations",
  "program_administration",
  "company_rules",
  "ppe",
  "legislation",
];

// Neutral, CP-agnostic labels, used as a fallback and for cross-CP reporting.
export const CANONICAL_ELEMENT_LABELS: Record<CorCanonicalElement, string> = {
  management_commitment: "Management Policy and Commitment",
  senior_management_leadership: "Senior Management Leadership",
  hazard_assessment: "Hazard Assessment",
  hazard_control: "Hazard Control",
  committees_reps: "Health and Safety Committees and Representatives",
  training: "Qualifications, Orientation and Training",
  other_parties: "Other Parties (Public, Visitors, Contractors)",
  inspections: "Inspections",
  preventative_maintenance: "Preventative Maintenance",
  emergency_response: "Emergency Response",
  first_aid: "First Aid",
  investigations: "Incident Investigation",
  program_administration: "Program Administration",
  company_rules: "Company Rules",
  ppe: "Personal Protective Equipment",
  legislation: "Legislation and Other Requirements",
};

const CANONICAL_SET = new Set<string>(CANONICAL_ELEMENTS);

export function isCanonicalElement(value: string | null | undefined): value is CorCanonicalElement {
  return CANONICAL_SET.has(value ?? "");
}

export function canonicalElementLabel(key: string | null | undefined): string {
  return key && isCanonicalElement(key) ? CANONICAL_ELEMENT_LABELS[key] : "";
}

// A single element within a CP's audit instrument.
export type CorFrameworkElement = {
  number: number; // ordering position (1..N); also the AMTA crosswalk key for AMTA
  // How the CP labels the element (e.g. "A" for Energy Safety Canada). Defaults to
  // the number as a string.
  display?: string;
  name: string; // the CP's own element name
  description: string;
  // The PRIMARY canonical key this element tags evidence to (the picker value).
  // Unique within a framework so picker options never collide.
  canonical: CorCanonicalElement;
  // Every canonical key this element accounts for in readiness/display. A coarse
  // element (e.g. AMTA "Inspections") covers finer keys a stricter CP splits out
  // (worksite inspections + preventative maintenance). Defaults to [canonical].
  covers?: CorCanonicalElement[];
};

// All canonical keys an element accounts for (its primary plus any it aggregates).
export function elementCovers(element: CorFrameworkElement): CorCanonicalElement[] {
  return element.covers ?? [element.canonical];
}

// The CP's own label for an element (a letter for some CPs, otherwise its number).
export function elementDisplay(element: CorFrameworkElement): string {
  return element.display ?? String(element.number);
}

export type CorFramework = {
  code: string;
  name: string;
  // Plain-language scoring note for the CP's certification audit.
  scoring: string;
  elements: CorFrameworkElement[];
};

// The AMTA framework reproduces the original ten elements exactly, so existing
// AMTA tenants see no change.
const AMTA_FRAMEWORK: CorFramework = {
  code: "amta",
  name: "Alberta Motor Transport Association",
  scoring: "Pass at 80% overall with at least 50% on every element.",
  elements: [
    { number: 1, name: "Management Leadership and Organizational Commitment", canonical: "management_commitment", covers: ["management_commitment", "senior_management_leadership"], description: "Senior-management-signed health and safety policy, defined responsibilities for all levels, and worker awareness of OHS rights." },
    { number: 2, name: "Hazard Assessment", canonical: "hazard_assessment", description: "Inventory of every position and task, formal hazard assessments with worker participation, and field-level hazard assessments before work begins." },
    { number: 3, name: "Hazard Control", canonical: "hazard_control", description: "Controls applied by the hierarchy (elimination, engineering, administrative, PPE), written into safe work procedures, and enforced." },
    { number: 4, name: "Joint Health and Safety Committees and Health and Safety Representatives", canonical: "committees_reps", description: "Committee or representative structure for the company size, defined roles, meeting frequency, and documented minutes and recommendations." },
    { number: 5, name: "Qualifications, Orientation and Training", canonical: "training", description: "New and reassigned worker orientation before work, job-specific training, competency evaluation, and training records." },
    { number: 6, name: "Other Parties at or in the Vicinity of the Work Site", canonical: "other_parties", description: "Orientation and monitoring of contractors, self-employed persons, and visitors, and public protection." },
    { number: 7, name: "Inspections", canonical: "inspections", covers: ["inspections", "preventative_maintenance"], description: "Routine, documented inspections of premises, jobsites, and equipment on a defined frequency, plus preventative maintenance, with deficiencies corrected." },
    { number: 8, name: "Emergency Response", canonical: "emergency_response", covers: ["emergency_response", "first_aid"], description: "Written emergency response plans, regular drills, trained first aiders, first aid equipment, and a current contact list." },
    { number: 9, name: "Incident Investigation", canonical: "investigations", description: "Reporting and investigating near-misses and incidents to root cause by a trained investigator, with corrective actions tracked to closure." },
    { number: 10, name: "System Administration", canonical: "program_administration", description: "Maintaining and reviewing the management system: safety meetings, statistics, annual review, and a drug and alcohol policy." },
  ],
};

// The ACSA framework, from the ACSA 2023 COR Audit Instrument. Same backbone as
// AMTA but renumbered and renamed (e.g. Hazard Assessment is element 5 here).
const ACSA_FRAMEWORK: CorFramework = {
  code: "acsa",
  name: "Alberta Construction Safety Association",
  scoring: "Certification audit passes at 80% overall with at least 50% on every element; maintenance audit at 60% overall.",
  elements: [
    { number: 1, name: "Management Commitment", canonical: "management_commitment", covers: ["management_commitment", "senior_management_leadership"], description: "Written, senior-management-signed health and safety policy, defined responsibilities, and demonstrated leadership commitment." },
    { number: 2, name: "Public, Visitors and Contracted Employers", canonical: "other_parties", description: "Protection and orientation of the public, visitors, self-employed persons, and contracted employers affected by the work." },
    { number: 3, name: "Health and Safety Committees/Health and Safety Representatives", canonical: "committees_reps", description: "Committee or representative structure, defined duties, training, meetings, and a process for employee concerns." },
    { number: 4, name: "Training", canonical: "training", description: "Worker orientation, job-specific and supervisor training, competency assessment, and training records." },
    { number: 5, name: "Hazard Assessment", canonical: "hazard_assessment", description: "Inventory of positions and tasks, formal hazard assessments, and site-specific (field-level) hazard assessments." },
    { number: 6, name: "Hazard Control", canonical: "hazard_control", description: "Controls selected by the hierarchy, written into safe work practices and procedures, communicated, and enforced." },
    { number: 7, name: "Inspections & Maintenance", canonical: "inspections", covers: ["inspections", "preventative_maintenance"], description: "Scheduled, documented inspections and preventative maintenance, with deficiencies corrected." },
    { number: 8, name: "Emergency Response", canonical: "emergency_response", covers: ["emergency_response", "first_aid"], description: "Written emergency response plans, drills, first aid coverage, and trained responders." },
    { number: 9, name: "Investigations", canonical: "investigations", description: "Reporting and investigating incidents and near-misses to root cause, with corrective actions implemented." },
    { number: 10, name: "Program Administration", canonical: "program_administration", description: "Maintaining records, analyzing statistics, and completing an annual evaluation of the management system." },
  ],
};

// The AASP framework (Alberta Association for Safety Partnerships, the all-industry
// CP). Same backbone, renumbered again: Inspections is element 5 and Training is
// element 7.
const AASP_FRAMEWORK: CorFramework = {
  code: "aasp",
  name: "Alberta Association for Safety Partnerships",
  scoring: "Pass at 80% overall with at least 50% on every element.",
  elements: [
    { number: 1, name: "Management, Leadership, and Organizational Commitment", canonical: "management_commitment", covers: ["management_commitment", "senior_management_leadership"], description: "Senior-management-signed health and safety policy, defined responsibilities at all levels, and demonstrated leadership commitment." },
    { number: 2, name: "Hazard Assessment", canonical: "hazard_assessment", description: "Inventory of jobs and tasks, formal hazard assessments with worker participation, and site-specific assessments." },
    { number: 3, name: "Hazard Control", canonical: "hazard_control", covers: ["hazard_control", "preventative_maintenance"], description: "Controls selected by the hierarchy, preventative maintenance of equipment and facilities, and violence and harassment prevention." },
    { number: 4, name: "Joint Worksite Health and Safety Committees and Representatives", canonical: "committees_reps", description: "Committee or representative structure, terms of reference, defined duties, meetings, and a process for employee concerns." },
    { number: 5, name: "Qualifications, Orientation, and Training", canonical: "training", description: "Worker orientation before regular duties, job-specific and supervisor training, competency assessment, and refresher training." },
    { number: 6, name: "Other Parties at the Work Site", canonical: "other_parties", description: "Protection, orientation, and monitoring of contractors, visitors, and others in the vicinity of the work." },
    { number: 7, name: "Inspections", canonical: "inspections", description: "Scheduled, documented formal inspections of all areas by all employee levels, with deficiencies corrected." },
    { number: 8, name: "Emergency Response", canonical: "emergency_response", covers: ["emergency_response", "first_aid"], description: "Written emergency response plans, drills, first aid coverage, and trained responders." },
    { number: 9, name: "Incident Investigation", canonical: "investigations", description: "Reporting and investigating incidents and near misses to root cause, with corrective actions implemented." },
    { number: 10, name: "System Administration", canonical: "program_administration", description: "Maintaining records, analyzing statistics for trends, and completing an annual evaluation of the management system." },
  ],
};

// The MHSA framework (Manufacturers' Health & Safety Association). MHSA uses a
// finer 13-element instrument: management is split into policy/responsibility (1)
// and senior leadership (12), inspections into preventative maintenance (7) and
// worksite inspections (8), and emergency into preparedness (10) and first aid
// (11). Each element maps 1:1 to a fine canonical key.
const MHSA_FRAMEWORK: CorFramework = {
  code: "mhsa",
  name: "Manufacturers' Health & Safety Association",
  scoring: "Pass at 80% overall with at least 50% on every element.",
  elements: [
    { number: 1, name: "Health and Safety Policy & Responsibility", canonical: "management_commitment", description: "Written, senior-management-signed health and safety policy and defined responsibilities for all levels." },
    { number: 2, name: "Hazard Assessment", canonical: "hazard_assessment", description: "Formal and field-level hazard assessments covering every position and task, with worker participation." },
    { number: 3, name: "Hazard Controls", canonical: "hazard_control", description: "Controls selected by the hierarchy, written into safe work practices and procedures, and enforced." },
    { number: 4, name: "Joint Health and Safety Committee or Representative", canonical: "committees_reps", description: "Committee or representative structure for the company size, defined duties, meetings, and recommendations." },
    { number: 5, name: "Training and Competency", canonical: "training", description: "Worker orientation, job-specific and supervisor training, and competency assessment, with records." },
    { number: 6, name: "Other Parties at or in the Vicinity of the Worksite", canonical: "other_parties", description: "Protection and orientation of contractors, visitors, and the public affected by the work." },
    { number: 7, name: "Preventative Maintenance", canonical: "preventative_maintenance", description: "A documented preventative maintenance program for equipment and tools, carried out on schedule." },
    { number: 8, name: "Worksite Inspections", canonical: "inspections", description: "Scheduled, documented inspections of the worksite, with deficiencies corrected." },
    { number: 9, name: "Incident Investigation", canonical: "investigations", description: "Reporting and investigating incidents and near-misses to root cause, with corrective actions implemented." },
    { number: 10, name: "Emergency Preparedness", canonical: "emergency_response", description: "Written emergency response plans and regular drills, with deficiencies corrected." },
    { number: 11, name: "First Aid", canonical: "first_aid", description: "First aid equipment, supplies, facilities, and trained first aiders to the legislated schedule." },
    { number: 12, name: "Senior Management Leadership", canonical: "senior_management_leadership", description: "Demonstrated senior-management leadership and participation in the health and safety system." },
    { number: 13, name: "System Administration", canonical: "program_administration", description: "Maintaining and reviewing the management system: statistics, annual review, and continual improvement." },
  ],
};

// The AFPA framework (Alberta Forest Products Association). A standard ten-element
// Partnerships instrument; names and order from AFPA's 2026 Standard Health and
// Safety Audit. Inspection element folds in maintenance; emergency folds in first
// aid (covers), like the other ten-element partners.
const AFPA_FRAMEWORK: CorFramework = {
  code: "forest_products",
  name: "Alberta Forest Products Association",
  scoring: "Pass at 80% overall with at least 50% on every element.",
  elements: [
    { number: 1, name: "Leadership Commitment", canonical: "management_commitment", covers: ["management_commitment", "senior_management_leadership"], description: "Senior-management-signed health and safety policy, defined responsibilities, and demonstrated leadership commitment." },
    { number: 2, name: "Hazard Assessment", canonical: "hazard_assessment", description: "Inventory of positions and tasks, formal hazard assessments with worker participation, and site-specific assessments." },
    { number: 3, name: "Hazard Control", canonical: "hazard_control", description: "Controls selected by the hierarchy, hazardous-product handling, written into safe work practices, and enforced." },
    { number: 4, name: "Qualifications, Orientation and Training", canonical: "training", description: "Worker orientation, job-specific and supervisor training, competency assessment, and training records." },
    { number: 5, name: "Work Site and Other Parties", canonical: "other_parties", description: "Protection and orientation of contractors, self-employed persons, visitors, and the public affected by the work." },
    { number: 6, name: "Regular Inspection and Monitoring", canonical: "inspections", covers: ["inspections", "preventative_maintenance"], description: "Scheduled, documented inspections and equipment maintenance, with deficiencies corrected." },
    { number: 7, name: "Emergency Response", canonical: "emergency_response", covers: ["emergency_response", "first_aid"], description: "Written emergency response plans, drills, first aid equipment and trained first aiders, and a contact list." },
    { number: 8, name: "Incident Investigation", canonical: "investigations", description: "Reporting and investigating incidents and near-misses to root cause, with corrective actions implemented." },
    { number: 9, name: "Health and Safety Committee", canonical: "committees_reps", description: "Committee or representative structure, defined duties, meetings with available minutes, and recommendations." },
    { number: 10, name: "System Review", canonical: "program_administration", description: "Maintaining records, analyzing statistics, and completing an annual evaluation of the management system." },
  ],
};

// The Energy Safety Canada framework (oil and gas). A standard ten-element
// instrument, but lettered A-J; names from the Energy Safety Canada COR Audit
// Protocol (2023). Inspections folds in maintenance; emergency folds in first aid.
const ENERGY_SAFETY_FRAMEWORK: CorFramework = {
  code: "energy_safety",
  name: "Energy Safety Canada",
  scoring: "Pass at 80% overall with at least 50% on every element.",
  elements: [
    { number: 1, display: "A", name: "Management, Leadership and Organizational Commitment", canonical: "management_commitment", covers: ["management_commitment", "senior_management_leadership"], description: "Senior-management-signed health and safety policy, defined responsibilities, and demonstrated leadership commitment." },
    { number: 2, display: "B", name: "Hazard Assessment", canonical: "hazard_assessment", description: "Inventory of positions and tasks, formal hazard assessments with worker participation, and field-level assessments." },
    { number: 3, display: "C", name: "Hazard Control", canonical: "hazard_control", description: "Controls selected by the hierarchy, written into safe work practices and procedures, communicated, and enforced." },
    { number: 4, display: "D", name: "Inspections", canonical: "inspections", covers: ["inspections", "preventative_maintenance"], description: "Scheduled, documented inspections and equipment maintenance, with deficiencies corrected." },
    { number: 5, display: "E", name: "Qualifications, Orientation and Training", canonical: "training", description: "Worker orientation, job-specific and supervisor training, competency assessment, and training records." },
    { number: 6, display: "F", name: "Emergency Response", canonical: "emergency_response", covers: ["emergency_response", "first_aid"], description: "Written emergency response plans, drills, first aid equipment and trained first aiders, and a contact list." },
    { number: 7, display: "G", name: "Incident Reporting and Investigation", canonical: "investigations", description: "Reporting and investigating incidents and near-misses to root cause, with corrective actions implemented." },
    { number: 8, display: "H", name: "System Administration", canonical: "program_administration", description: "Maintaining records, analyzing statistics, and completing an annual evaluation of the management system." },
    { number: 9, display: "I", name: "Other Affected Parties", canonical: "other_parties", description: "Protection and orientation of contractors, self-employed persons, visitors, and the public affected by the work." },
    { number: 10, display: "J", name: "Joint Health and Safety Committee and Representative", canonical: "committees_reps", description: "Committee or representative structure, defined duties, meetings, and a process for employee concerns." },
  ],
};

// The IHSA framework: the national COR 2020 standard (Ontario), a different and
// finer instrument than Alberta's Partnerships audits, with 14 elements including
// dedicated Company Rules, PPE, and Legislation elements. Names from the IHSA COR
// 2020 Audit Tool. Each element maps 1:1 to a canonical key.
const IHSA_FRAMEWORK: CorFramework = {
  code: "ihsa",
  name: "IHSA (COR 2020)",
  scoring: "National COR 2020: pass at 80% overall with at least 50% on every element.",
  elements: [
    { number: 1, name: "Health and Safety Policy", canonical: "management_commitment", description: "Written, senior-management-signed health and safety policy, with document and record control." },
    { number: 2, name: "Hazard Assessment, Analysis and Control", canonical: "hazard_assessment", description: "Written procedure for assessing, prioritizing, and updating workplace and job-specific hazards with worker involvement." },
    { number: 3, name: "Controls", canonical: "hazard_control", description: "Controls developed by the hierarchy of controls, documented, communicated, available at point of use, and complied with." },
    { number: 4, name: "Procurement and Contractor Management", canonical: "other_parties", description: "OHS criteria for selecting, monitoring, and evaluating contractors and service providers." },
    { number: 5, name: "Company Rules", canonical: "company_rules", description: "Written company rules, posted or provided to each employee, understood, and enforced." },
    { number: 6, name: "Personal Protective Equipment", canonical: "ppe", description: "Required PPE documented per activity, selected, fitted, provided, inspected, and used." },
    { number: 7, name: "Preventative Maintenance", canonical: "preventative_maintenance", description: "Inventory and schedule of items to maintain, performed as planned, with defective items removed from service." },
    { number: 8, name: "Training and Communication", canonical: "training", description: "Training and communication policy and procedure: orientation, job-specific training, and competency." },
    { number: 9, name: "Workplace Inspections", canonical: "inspections", description: "Workplace inspection policy and procedure, conducted on schedule, with deficiencies corrected." },
    { number: 10, name: "Investigations and Reporting", canonical: "investigations", description: "Policy and procedure for reporting and investigating incidents to root cause, with corrective actions." },
    { number: 11, name: "Emergency Preparedness", canonical: "emergency_response", description: "Emergency preparedness policy and procedure, plans, drills, and first aid coverage." },
    { number: 12, name: "Statistics and Records", canonical: "program_administration", description: "Statistics and records policy and procedure: collecting, analyzing, and retaining health and safety data." },
    { number: 13, name: "Legislation and Other Requirements", canonical: "legislation", description: "Policy and procedure to identify, access, and comply with applicable legislation and other requirements." },
    { number: 14, name: "Management Review", canonical: "senior_management_leadership", description: "Senior management review of the management system and a management-of-change procedure." },
  ],
};

export const COR_FRAMEWORKS: Record<string, CorFramework> = {
  amta: AMTA_FRAMEWORK,
  acsa: ACSA_FRAMEWORK,
  aasp: AASP_FRAMEWORK,
  mhsa: MHSA_FRAMEWORK,
  forest_products: AFPA_FRAMEWORK,
  energy_safety: ENERGY_SAFETY_FRAMEWORK,
  ihsa: IHSA_FRAMEWORK,
};

export const DEFAULT_CERTIFYING_PARTNER = "amta";

// The full directory of Alberta Certifying Partners (alberta.ca), for the picker.
// `supported` means a full element framework is defined above; the rest are listed
// so the choice is complete and are added as their instruments are confirmed.
export type CertifyingPartnerInfo = {
  code: string;
  name: string;
  industries: string;
  supported: boolean;
};

export const CERTIFYING_PARTNERS: CertifyingPartnerInfo[] = [
  { code: "aasp", name: "Alberta Association for Safety Partnerships", industries: "All industries", supported: true },
  { code: "acsa", name: "Alberta Construction Safety Association", industries: "Construction industries", supported: true },
  { code: "amta", name: "Alberta Motor Transport Association", industries: "Trucking and transport", supported: true },
  { code: "mhsa", name: "Manufacturers' Health & Safety Association", industries: "Manufacturing, machine, and fabrication shops", supported: true },
  { code: "amhsa", name: "Alberta Municipal Health and Safety Association", industries: "Municipalities", supported: false },
  { code: "energy_safety", name: "Energy Safety Canada", industries: "Oil and gas", supported: true },
  { code: "food_processors", name: "Alberta Food Processors Association", industries: "Food processing", supported: false },
  { code: "forest_products", name: "Alberta Forest Products Association", industries: "Forestry", supported: true },
  { code: "continuing_care", name: "Continuing Care Safety Association", industries: "Continuing care", supported: false },
  { code: "ihsa", name: "IHSA COR 2020 (Ontario)", industries: "Ontario: construction, transportation, utilities (national COR 2020)", supported: true },
];

const PARTNER_CODES = new Set(CERTIFYING_PARTNERS.map((partner) => partner.code));

export function isKnownCertifyingPartner(value: string | null | undefined): boolean {
  return PARTNER_CODES.has(value ?? "");
}

// Normalize a stored value to a supported framework, falling back to the default.
export function coerceCertifyingPartner(value: string | null | undefined): string {
  return value && COR_FRAMEWORKS[value] ? value : DEFAULT_CERTIFYING_PARTNER;
}

export function certifyingPartnerName(code: string | null | undefined): string {
  const partner = CERTIFYING_PARTNERS.find((item) => item.code === (code ?? ""));
  return partner?.name ?? (code ?? "");
}

// The framework for a CP, falling back to AMTA so callers always get a framework.
export function getCorFramework(code: string | null | undefined): CorFramework {
  return COR_FRAMEWORKS[code ?? ""] ?? AMTA_FRAMEWORK;
}

export function frameworkElements(code: string | null | undefined): CorFrameworkElement[] {
  return getCorFramework(code).elements;
}

export function frameworkElementByNumber(code: string | null | undefined, number: number): CorFrameworkElement | undefined {
  return getCorFramework(code).elements.find((element) => element.number === number);
}

export function canonicalForElementNumber(code: string | null | undefined, number: number): CorCanonicalElement | null {
  return frameworkElementByNumber(code, number)?.canonical ?? null;
}

export function elementNumberForCanonical(code: string | null | undefined, canonical: CorCanonicalElement): number | null {
  const elements = getCorFramework(code).elements;
  // Prefer the element whose primary key matches; fall back to the element that
  // covers this key (a coarse element aggregating a finer topic).
  const primary = elements.find((element) => element.canonical === canonical);
  if (primary) {
    return primary.number;
  }
  return elements.find((element) => elementCovers(element).includes(canonical))?.number ?? null;
}

// The CP's own label (letter or number) for the element that owns/covers a key.
export function elementDisplayForCanonical(code: string | null | undefined, canonical: CorCanonicalElement): string | null {
  const elements = getCorFramework(code).elements;
  const element =
    elements.find((el) => el.canonical === canonical) ??
    elements.find((el) => elementCovers(el).includes(canonical));
  return element ? elementDisplay(element) : null;
}

// Convenience for the AMTA numbering specifically, used by the data migration and
// the current AMTA-numbered tag writers in Phase 1.
export function canonicalForAmtaElement(number: number): CorCanonicalElement | null {
  return canonicalForElementNumber("amta", number);
}
