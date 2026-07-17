// Maps every question in AMTA's published COR audit instrument to the evidence
// document that answers it, how an auditor verifies it, and where that document
// lives in Resources. Drives the per-element question view and the auditor-ready
// export in /admin/cor. Other certifying partners' crosswalks live in sibling
// files and are registered in COR_CROSSWALKS below.
//
// This is the map, not the territory: it names the documents an audit expects, it
// does not contain them. Writing those documents for a specific company and trade
// is the work the map cannot do for you.

import { ACSA_CROSSWALK } from "@/lib/cor-crosswalk-acsa";
import { AASP_CROSSWALK } from "@/lib/cor-crosswalk-aasp";
import { IHSA_CROSSWALK } from "@/lib/cor-crosswalk-ihsa";

export type CorCrosswalkMethod = "documentation" | "interview" | "observation";
export type CorCrosswalkLocation = "Policies" | "Safety Manual" | "Forms" | "App";

export type CorCrosswalkQuestion = {
  id: string;
  element: number;
  question: string;
  method: CorCrosswalkMethod;
  evidence: string;
  location: CorCrosswalkLocation;
};

export const COR_CROSSWALK: CorCrosswalkQuestion[] = [
  { id: "1.1", element: 1, question: "Written H&S policy signed by senior manager", method: "documentation", evidence: "Health and Safety Policy", location: "Policies" },
  { id: "1.2", element: 1, question: "Policy readily available to employees", method: "observation", evidence: "Health and Safety Policy, posted and on the worker app", location: "Policies" },
  { id: "1.3", element: 1, question: "Policy communicated to employees", method: "interview", evidence: "New Worker Orientation, Safety Meetings", location: "Safety Manual" },
  { id: "1.4", element: 1, question: "Employees aware of the policy content", method: "interview", evidence: "Orientation Topics, posted policy", location: "Safety Manual" },
  { id: "1.5", element: 1, question: "Responsibilities written for all levels", method: "documentation", evidence: "Roles and Responsibilities", location: "Safety Manual" },
  { id: "1.6", element: 1, question: "Employees understand their rights and responsibilities", method: "interview", evidence: "Orientation Topics 01 to 03 and 05, Roles and Responsibilities", location: "Safety Manual" },
  { id: "1.7", element: 1, question: "Managers and supervisors understand their responsibility", method: "interview", evidence: "Roles and Responsibilities", location: "Safety Manual" },
  { id: "1.8", element: 1, question: "Employees evaluated on H&S accountabilities", method: "interview", evidence: "Safety Accountability Evaluation form", location: "Forms" },
  { id: "1.9", element: 1, question: "Senior management communicates commitment annually", method: "interview", evidence: "Annual Program Review, Safety Meetings", location: "Forms" },
  { id: "1.10", element: 1, question: "Senior management participates in H&S activities", method: "interview", evidence: "Safety Meetings attendance, Annual Program Review", location: "Forms" },
  { id: "1.11", element: 1, question: "Current legislation readily available at work sites", method: "observation", evidence: "OHS Legislation Reference, plus the OHS Act, Regulation, and Code in the Resource Library", location: "Policies" },
  { id: "1.12", element: 1, question: "Management participates in meetings where H&S is discussed", method: "documentation", evidence: "Safety Meeting minutes with attendance", location: "Forms" },
  { id: "1.13", element: 1, question: "Employer provides resources to improve H&S", method: "interview", evidence: "HSMS Administration, Annual Program Review", location: "Policies" },
  { id: "2.1", element: 2, question: "All jobs and positions identified", method: "documentation", evidence: "Position and Task Inventory", location: "Forms" },
  { id: "2.2", element: 2, question: "List of tasks for each position", method: "documentation", evidence: "Position and Task Inventory", location: "Forms" },
  { id: "2.3", element: 2, question: "Health and safety hazards identified", method: "documentation", evidence: "Formal Hazard Assessment", location: "Forms" },
  { id: "2.4", element: 2, question: "Hazards evaluated by risk", method: "documentation", evidence: "Formal Hazard Assessment (risk matrix), Hazard Assessment procedure", location: "Forms" },
  { id: "2.5", element: 2, question: "Senior management knows the highest hazard tasks", method: "interview", evidence: "Hazard Assessment procedure, Orientation 06 High Risk Hazards", location: "Safety Manual" },
  { id: "2.6", element: 2, question: "Required parties participate in formal hazard assessment", method: "interview", evidence: "Formal and Field-Level Hazard Assessment procedure", location: "Safety Manual" },
  { id: "2.7", element: 2, question: "Workers participated in development or review", method: "interview", evidence: "Formal Hazard Assessment (worker signature)", location: "Forms" },
  { id: "2.8", element: 2, question: "Assessment leads are trained", method: "documentation", evidence: "Hazard Assessment Training certificate (Certification Types)", location: "App" },
  { id: "2.9", element: 2, question: "Written policy or process to review assessments", method: "documentation", evidence: "Formal and Field-Level Hazard Assessment procedure (review)", location: "Safety Manual" },
  { id: "2.10", element: 2, question: "Assessments reviewed per the policy", method: "interview", evidence: "Dated assessments, review procedure", location: "Forms" },
  { id: "2.11", element: 2, question: "Process for site-specific hazard assessment", method: "documentation", evidence: "Formal and Field-Level Hazard Assessment procedure (FLHA)", location: "Safety Manual" },
  { id: "2.12", element: 2, question: "Site-specific assessments completed", method: "documentation", evidence: "Field-Level Hazard Assessment", location: "Forms" },
  { id: "2.13", element: 2, question: "Controls identified on site-specific assessments", method: "documentation", evidence: "Field-Level Hazard Assessment", location: "Forms" },
  { id: "2.14", element: 2, question: "Site-specific assessments involve affected employees", method: "interview", evidence: "Field-Level Hazard Assessment", location: "Forms" },
  { id: "2.15", element: 2, question: "System for workers to report new hazards", method: "interview", evidence: "Hazard Identification and Reporting policy, Hazard Report, Orientation 07", location: "Policies" },
  { id: "3.1", element: 3, question: "Controls identified for formal assessment hazards", method: "documentation", evidence: "Formal Hazard Assessment, Safe Work Procedure Template", location: "Forms" },
  { id: "3.2", element: 3, question: "Engineering controls implemented", method: "observation", evidence: "Hazard assessments, Equipment module", location: "App" },
  { id: "3.3", element: 3, question: "Administrative controls implemented", method: "documentation", evidence: "Safe work procedures, policies", location: "Safety Manual" },
  { id: "3.4", element: 3, question: "PPE controls implemented", method: "observation", evidence: "PPE Policy (PPE in use on site)", location: "Policies" },
  { id: "3.5", element: 3, question: "Changes to controls communicated", method: "interview", evidence: "Management of Change, Safety Meetings", location: "Safety Manual" },
  { id: "3.6", element: 3, question: "Employees using the established controls", method: "interview", evidence: "Safe work procedures, PPE Policy", location: "Safety Manual" },
  { id: "3.7", element: 3, question: "Managers enforce the use of controls", method: "interview", evidence: "Safety Enforcement and Discipline policy", location: "Policies" },
  { id: "3.8", element: 3, question: "Preventative maintenance process exists", method: "documentation", evidence: "Preventative Maintenance policy", location: "Policies" },
  { id: "3.9", element: 3, question: "Preventative maintenance process in use", method: "documentation", evidence: "Equipment module maintenance records", location: "App" },
  { id: "3.10", element: 3, question: "Defective equipment taken out of service", method: "interview", evidence: "Preventative Maintenance policy, Pre-Trip Inspection", location: "Forms" },
  { id: "3.11", element: 3, question: "Violence Prevention Plan meets requirements", method: "documentation", evidence: "Harassment and Violence Prevention policy", location: "Policies" },
  { id: "3.12", element: 3, question: "Harassment Prevention Plan meets requirements", method: "documentation", evidence: "Harassment and Violence Prevention policy", location: "Policies" },
  { id: "3.13", element: 3, question: "Violence and harassment plans reviewed", method: "documentation", evidence: "Harassment and Violence Prevention policy (review), Annual Program Review", location: "Policies" },
  { id: "4.1", element: 4, question: "Terms of reference include legislated requirements", method: "documentation", evidence: "Terms of Reference", location: "Policies" },
  { id: "4.2", element: 4, question: "Committee established per requirements", method: "documentation", evidence: "Terms of Reference", location: "Policies" },
  { id: "4.3", element: 4, question: "HS representative designated per requirements", method: "interview", evidence: "Terms of Reference, posted contact", location: "Policies" },
  { id: "4.4", element: 4, question: "Duties written for the committee or representative", method: "documentation", evidence: "Roles and Responsibilities (Element 4)", location: "Safety Manual" },
  { id: "4.5", element: 4, question: "Committee or representative trained", method: "documentation", evidence: "Committee or HS Representative Training certificate (Certification Types)", location: "App" },
  { id: "4.6", element: 4, question: "Members understand their duties", method: "interview", evidence: "Roles and Responsibilities (Element 4)", location: "Safety Manual" },
  { id: "4.7", element: 4, question: "Members participate in H&S activities", method: "interview", evidence: "Meeting minutes, inspection records", location: "Forms" },
  { id: "4.8", element: 4, question: "Policy to address employee concerns", method: "documentation", evidence: "Roles and Responsibilities, Health and Safety Recommendation", location: "Safety Manual" },
  { id: "4.9", element: 4, question: "How employees bring concerns forward", method: "interview", evidence: "Orientation, Hazard Reporting, Recommendation form", location: "Forms" },
  { id: "4.10", element: 4, question: "Process to make recommendations", method: "interview", evidence: "Health and Safety Recommendation", location: "Forms" },
  { id: "4.11", element: 4, question: "Concerns resolved in a timely manner", method: "documentation", evidence: "Health and Safety Recommendation (tracking)", location: "Forms" },
  { id: "4.12", element: 4, question: "Committee holds meetings per terms of reference", method: "documentation", evidence: "Meeting Agenda and Minutes", location: "Forms" },
  { id: "4.13", element: 4, question: "Committee reviews inspection documentation", method: "documentation", evidence: "Meeting Agenda (standing item), inspection records", location: "Forms" },
  { id: "4.14", element: 4, question: "Names and contact readily available", method: "observation", evidence: "Posted contact, Terms of Reference", location: "Policies" },
  { id: "5.1", element: 5, question: "Process to ensure workers are qualified", method: "documentation", evidence: "New Worker Orientation, Training and Certification Log, Competency Assessment", location: "Safety Manual" },
  { id: "5.2", element: 5, question: "Orientation covers OHS rights and critical info", method: "documentation", evidence: "New Worker Orientation Checklist, Orientation Topics 01 to 09", location: "Forms" },
  { id: "5.3", element: 5, question: "Orientations conducted before regular duties", method: "interview", evidence: "New Worker Orientation procedure, signed checklist", location: "Safety Manual" },
  { id: "5.4", element: 5, question: "Managers and supervisors provided training", method: "documentation", evidence: "Supervisor and Manager Safety Training certificate (Certification Types)", location: "App" },
  { id: "5.5", element: 5, question: "Job-specific training includes hazards and a practical demo", method: "documentation", evidence: "Worker Competency Assessment, training log", location: "Forms" },
  { id: "5.6", element: 5, question: "Job-specific training on new tasks or changes", method: "interview", evidence: "New Worker Orientation, Management of Change", location: "Safety Manual" },
  { id: "5.7", element: 5, question: "Process to assess competency", method: "documentation", evidence: "Worker Competency Assessment", location: "Forms" },
  { id: "5.8", element: 5, question: "Competency assessments conducted", method: "interview", evidence: "Worker Competency Assessment records", location: "Forms" },
  { id: "5.9", element: 5, question: "Refresher training provided", method: "documentation", evidence: "Training and Certification Log, Certifications module", location: "App" },
  { id: "6.1", element: 6, question: "Process to protect others not under the employer's direction", method: "documentation", evidence: "Other Parties policy, Visitors policy", location: "Policies" },
  { id: "6.2", element: 6, question: "Criteria for evaluating and selecting other employers", method: "documentation", evidence: "Contractor Pre-Qualification", location: "Forms" },
  { id: "6.3", element: 6, question: "System to monitor and address non-compliance", method: "documentation", evidence: "Contractor Orientation (monitoring), Other Parties policy", location: "Forms" },
  { id: "6.4", element: 6, question: "Orientations provided to contractors and visitors", method: "documentation", evidence: "Contractor Orientation, Visitor Log", location: "App" },
  { id: "6.5", element: 6, question: "Communicate with external work site parties", method: "interview", evidence: "Other Parties policy, Contractor Orientation", location: "Policies" },
  { id: "6.6", element: 6, question: "H&S information available to external parties", method: "interview", evidence: "Other Parties policy, Resource Library", location: "Policies" },
  { id: "7.1", element: 7, question: "Inspection process states frequency", method: "documentation", evidence: "Inspections policy (schedule)", location: "Policies" },
  { id: "7.2", element: 7, question: "Checklists or forms used for formal inspections", method: "documentation", evidence: "Worksite and Shop Inspection, Pre-Trip Inspection", location: "Forms" },
  { id: "7.3", element: 7, question: "Inspection leads trained", method: "documentation", evidence: "Inspection Training certificate (Certification Types)", location: "App" },
  { id: "7.4", element: 7, question: "Inspections carried out per the policy", method: "documentation", evidence: "Inspection submissions, Inspections policy", location: "App" },
  { id: "7.5", element: 7, question: "Management inspections include employee observation", method: "interview", evidence: "Inspections policy", location: "Policies" },
  { id: "7.6", element: 7, question: "System to correct deficiencies", method: "interview", evidence: "Worksite and Shop Inspection (corrective actions), Workflow Station", location: "App" },
  { id: "7.7", element: 7, question: "Deficiencies corrected", method: "observation", evidence: "Inspection records, Workflow Station", location: "App" },
  { id: "8.1", element: 8, question: "Written emergency response plans developed", method: "documentation", evidence: "Emergency Response Plan", location: "Safety Manual" },
  { id: "8.2", element: 8, question: "Plans include the required content", method: "documentation", evidence: "Emergency Response Plan, Site-Specific ERP", location: "Safety Manual" },
  { id: "8.3", element: 8, question: "Employees received emergency response training", method: "interview", evidence: "Orientation 04 Emergency Response, Orientation Checklist", location: "Safety Manual" },
  { id: "8.4", element: 8, question: "Employees understand their ERP responsibilities", method: "interview", evidence: "Orientation 04 Emergency Response", location: "Safety Manual" },
  { id: "8.5", element: 8, question: "Emergency drills conducted", method: "documentation", evidence: "Emergency Drill Record", location: "Forms" },
  { id: "8.6", element: 8, question: "Drill deficiencies corrected", method: "documentation", evidence: "Emergency Drill Record (improvements)", location: "Forms" },
  { id: "8.7", element: 8, question: "Real-emergency deficiencies corrected", method: "documentation", evidence: "Incident Investigation, Emergency Drill Record", location: "Forms" },
  { id: "8.8", element: 8, question: "First aiders meet legislated requirements", method: "documentation", evidence: "Emergency Contact List and First Aiders", location: "Forms" },
  { id: "8.9", element: 8, question: "First aid equipment, supplies, facilities meet requirements", method: "observation", evidence: "Worksite Inspection (first aid checks), first aider list", location: "Forms" },
  { id: "9.1", element: 9, question: "Process requires reporting incidents and near misses", method: "documentation", evidence: "Incident Investigation policy, Orientation 08", location: "Policies" },
  { id: "9.2", element: 9, question: "Employees can explain the reporting procedure", method: "interview", evidence: "Orientation 08 Incident Reporting", location: "Safety Manual" },
  { id: "9.3", element: 9, question: "Employees reporting incidents, illnesses, refusals", method: "documentation", evidence: "Incidents module, Incident Report form", location: "App" },
  { id: "9.4", element: 9, question: "Employees reporting near misses", method: "documentation", evidence: "Near Miss / Close Call Report", location: "Forms" },
  { id: "9.5", element: 9, question: "Procedure for investigating incidents", method: "documentation", evidence: "Incident Investigation procedure", location: "Safety Manual" },
  { id: "9.6", element: 9, question: "Investigators trained", method: "documentation", evidence: "Incident Investigation Training certificate (Certification Types)", location: "App" },
  { id: "9.7", element: 9, question: "Managers participate in investigations", method: "interview", evidence: "Incident Investigation procedure", location: "Safety Manual" },
  { id: "9.8", element: 9, question: "Workers participate in investigations", method: "interview", evidence: "Incident Investigation procedure", location: "Safety Manual" },
  { id: "9.9", element: 9, question: "Investigations find root cause", method: "documentation", evidence: "Incident Report and Investigation (5 Whys)", location: "Forms" },
  { id: "9.10", element: 9, question: "Corrective actions implemented", method: "documentation", evidence: "Incident Report form, Workflow Station", location: "App" },
  { id: "9.11", element: 9, question: "Investigations completed in a timely manner", method: "documentation", evidence: "Incidents module records", location: "App" },
  { id: "9.12", element: 9, question: "Managers ensure investigations are complete", method: "documentation", evidence: "Incident Investigation procedure", location: "Safety Manual" },
  { id: "9.13", element: 9, question: "Results communicated to employees", method: "interview", evidence: "Safety Meetings, Incident Investigation procedure", location: "Forms" },
  { id: "10.1", element: 10, question: "System to confirm records are kept", method: "interview", evidence: "HSMS Administration policy", location: "Policies" },
  { id: "10.2", element: 10, question: "H&S information readily available to employees", method: "interview", evidence: "Resource Library", location: "App" },
  { id: "10.3", element: 10, question: "Records and statistics analyzed at least annually", method: "documentation", evidence: "Annual Program Review, Analytics module", location: "App" },
  { id: "10.4", element: 10, question: "Senior management accountable for the system", method: "interview", evidence: "HSMS Administration, Annual Program Review", location: "Policies" },
  { id: "10.5", element: 10, question: "System evaluation or action plan completed annually", method: "documentation", evidence: "Annual Program Review", location: "Forms" },
  { id: "10.6", element: 10, question: "Evaluation results communicated to employees", method: "interview", evidence: "Safety Meetings, Annual Program Review", location: "Forms" },
  { id: "10.7", element: 10, question: "Plan to address deficiencies from the previous evaluation", method: "documentation", evidence: "Annual Program Review (targets)", location: "Forms" },
  { id: "10.8", element: 10, question: "The plan has been implemented", method: "documentation", evidence: "Annual Program Review, Workflow Station", location: "App" },
];

export function crosswalkForElement(element: number): CorCrosswalkQuestion[] {
  return COR_CROSSWALK.filter((q) => q.element === element);
}

export function crosswalkElementNumberFromSlot(slotKey: string): number {
  const parsed = Number.parseInt(slotKey.replace("element_", ""), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

// Per-certifying-partner crosswalks. A partner with a crosswalk shows the
// question-by-question evidence view in /admin/cor and the auditor export; the
// rest show their elements and tracked evidence without the question detail.
export const COR_CROSSWALKS: Record<string, CorCrosswalkQuestion[]> = {
  amta: COR_CROSSWALK,
  acsa: ACSA_CROSSWALK,
  aasp: AASP_CROSSWALK,
  ihsa: IHSA_CROSSWALK,
};

export function hasCrosswalk(code: string | null | undefined): boolean {
  return Boolean(code && COR_CROSSWALKS[code]?.length);
}

export function crosswalkForPartnerElement(code: string | null | undefined, element: number): CorCrosswalkQuestion[] {
  return (COR_CROSSWALKS[code ?? ""] ?? []).filter((q) => q.element === element);
}
