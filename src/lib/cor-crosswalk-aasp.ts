// AASP (Alberta Association for Safety Partnerships) COR audit crosswalk.
//
// The 113 questions of the AASP "Partnerships" Audit Instrument, paraphrased (not
// the CP's verbatim copyrighted text), each mapped to the evidence in this app's
// COR document set, the verification method, and where it lives. A company runs one
// health and safety program, so the evidence is the same library the other Alberta
// crosswalks use; only the instrument that scores it differs. Element numbers and
// element order are AASP's: Management Leadership (1), Hazard Assessment (2), Hazard
// Control (3, includes preventative maintenance and violence/harassment), HSC and
// Representatives (4), Qualifications/Orientation/Training (5), Other Parties (6),
// Inspections (7), Emergency Response (8, includes first aid), Incident
// Investigation (9), System Administration (10).

import type { CorCrosswalkQuestion } from "@/lib/cor-crosswalk";

export const AASP_CROSSWALK: CorCrosswalkQuestion[] = [
  // Element 1: Management, Leadership, and Organizational Commitment
  { id: "1.1", element: 1, method: "documentation", question: "Written health and safety policy signed by the current senior manager", evidence: "Health and Safety Policy", location: "Policies" },
  { id: "1.2", element: 1, method: "observation", question: "Policy readily available to employees", evidence: "Health and Safety Policy (posted)", location: "Policies" },
  { id: "1.3", element: 1, method: "interview", question: "Policy communicated to employees", evidence: "New Worker Orientation, Safety Meetings", location: "Safety Manual" },
  { id: "1.4", element: 1, method: "interview", question: "Employees aware of the policy's content", evidence: "New Worker Orientation, Safety Meetings", location: "Safety Manual" },
  { id: "1.5", element: 1, method: "documentation", question: "Specific responsibilities written for every employee level", evidence: "Roles and Responsibilities", location: "Safety Manual" },
  { id: "1.6", element: 1, method: "interview", question: "Employees understand their OHS rights and their assigned and legislated responsibilities", evidence: "Roles and Responsibilities, Orientation Topics 01 to 03", location: "Safety Manual" },
  { id: "1.7", element: 1, method: "interview", question: "Managers and supervisors understand their responsibility for the workers they supervise", evidence: "Roles and Responsibilities", location: "Safety Manual" },
  { id: "1.8", element: 1, method: "interview", question: "Employees evaluated on their individual health and safety performance", evidence: "Safety Accountability Evaluation form", location: "Forms" },
  { id: "1.9", element: 1, method: "interview", question: "Senior management communicates its commitment to employees at least annually", evidence: "Annual Program Review, Safety Meetings", location: "Forms" },
  { id: "1.10", element: 1, method: "interview", question: "Senior management demonstrates commitment to health and safety", evidence: "Annual Program Review, management site tours", location: "Forms" },
  { id: "1.11", element: 1, method: "observation", question: "Current health and safety legislation readily available at all work sites", evidence: "OHS Legislation Reference, OHS Act, Regulation, and Code in the Resource Library", location: "Policies" },
  { id: "1.12", element: 1, method: "documentation", question: "Management participates in meetings where health and safety is discussed", evidence: "Safety Meeting Agenda and Minutes", location: "Forms" },
  { id: "1.13", element: 1, method: "interview", question: "Employer provides the resources needed to implement and improve health and safety", evidence: "HSMS Administration, Annual Program Review", location: "Policies" },

  // Element 2: Hazard Assessment
  { id: "2.1", element: 2, method: "documentation", question: "Jobs inventoried for the purpose of formal hazard assessments", evidence: "Position and Task Inventory", location: "Forms" },
  { id: "2.2", element: 2, method: "documentation", question: "Tasks associated with each job listed", evidence: "Position and Task Inventory", location: "Forms" },
  { id: "2.3", element: 2, method: "documentation", question: "Health and safety hazards identified for the tasks of each job", evidence: "Formal Hazard Assessment", location: "Forms" },
  { id: "2.4", element: 2, method: "documentation", question: "Identified hazards evaluated according to risk", evidence: "Formal Hazard Assessment (risk matrix)", location: "Forms" },
  { id: "2.5", element: 2, method: "interview", question: "Senior management knowledgeable about the high hazard tasks of their operations", evidence: "Hazard Assessment procedure, Orientation 06 High Risk Hazards", location: "Safety Manual" },
  { id: "2.6", element: 2, method: "interview", question: "Managers and supervisors participate in the formal hazard assessment process", evidence: "Formal Hazard Assessment (signatures)", location: "Forms" },
  { id: "2.7", element: 2, method: "interview", question: "Workers participate in the development and review of formal hazard assessments", evidence: "Formal Hazard Assessment (worker signature)", location: "Forms" },
  { id: "2.8", element: 2, method: "documentation", question: "Employees designated to lead formal hazard assessments are trained", evidence: "Hazard Assessment Training certificate (Certification Types)", location: "App" },
  { id: "2.9", element: 2, method: "documentation", question: "Written policy or process to review formal hazard assessments", evidence: "Formal and Field-Level Hazard Assessment procedure", location: "Safety Manual" },
  { id: "2.10", element: 2, method: "interview", question: "Formal hazard assessments reviewed per the policy or process", evidence: "Formal Hazard Assessment (dated reviews)", location: "Forms" },
  { id: "2.11", element: 2, method: "documentation", question: "Process for site-specific hazard assessments when activities or conditions change", evidence: "Field-Level Hazard Assessment procedure", location: "Safety Manual" },
  { id: "2.12", element: 2, method: "documentation", question: "Site-specific assessments conducted before work and repeated on change", evidence: "Field-Level Hazard Assessment", location: "Forms" },
  { id: "2.13", element: 2, method: "documentation", question: "Controls identified on site-specific hazard assessments", evidence: "Field-Level Hazard Assessment", location: "Forms" },
  { id: "2.14", element: 2, method: "interview", question: "Affected employees involved in site-specific hazard assessments", evidence: "Field-Level Hazard Assessment (worker signatures)", location: "Forms" },
  { id: "2.15", element: 2, method: "interview", question: "System for workers to report newly identified hazards", evidence: "Hazard Identification and Reporting policy, Hazard Report", location: "Policies" },

  // Element 3: Hazard Control (incl. preventative maintenance, violence and harassment)
  { id: "3.1", element: 3, method: "documentation", question: "Controls identified for the hazards in the formal hazard assessments", evidence: "Formal Hazard Assessment, Safe Work Procedure Template", location: "Forms" },
  { id: "3.2", element: 3, method: "observation", question: "Identified engineering controls implemented", evidence: "Hazard assessments, Equipment module", location: "App" },
  { id: "3.3", element: 3, method: "documentation", question: "Identified administrative controls implemented", evidence: "Safe work procedures, policies", location: "Safety Manual" },
  { id: "3.4", element: 3, method: "observation", question: "Identified PPE controls implemented", evidence: "PPE Policy (PPE in use on site)", location: "Policies" },
  { id: "3.5", element: 3, method: "interview", question: "Changes to hazard controls communicated to affected employees", evidence: "Management of Change, Safety Meetings", location: "Safety Manual" },
  { id: "3.6", element: 3, method: "observation", question: "Employees using the established hazard controls", evidence: "Safe work procedures, PPE Policy", location: "Safety Manual" },
  { id: "3.7", element: 3, method: "interview", question: "Managers and supervisors enforce the use of hazard controls", evidence: "Safety Enforcement and Discipline policy", location: "Policies" },
  { id: "3.8", element: 3, method: "documentation", question: "Process for preventative maintenance of equipment, vehicles, facilities, and tools", evidence: "Preventative Maintenance policy", location: "Policies" },
  { id: "3.9", element: 3, method: "documentation", question: "Preventative maintenance process in use", evidence: "Equipment module maintenance records", location: "App" },
  { id: "3.10", element: 3, method: "documentation", question: "System to take defective equipment, vehicles, facilities, and tools out of service", evidence: "Preventative Maintenance policy, Equipment module (out of service)", location: "App" },
  { id: "3.11", element: 3, method: "documentation", question: "Written violence prevention policy per legislation", evidence: "Harassment and Violence Prevention policy", location: "Policies" },
  { id: "3.12", element: 3, method: "documentation", question: "Violence prevention procedures written per legislation", evidence: "Harassment and Violence Prevention procedures", location: "Policies" },
  { id: "3.13", element: 3, method: "interview", question: "Employees trained in the violence prevention plan", evidence: "Orientation, Harassment and Violence Prevention training", location: "Safety Manual" },
  { id: "3.14", element: 3, method: "documentation", question: "Harassment prevention policy per legislation", evidence: "Harassment and Violence Prevention policy", location: "Policies" },
  { id: "3.15", element: 3, method: "documentation", question: "Harassment prevention procedures written per legislation", evidence: "Harassment and Violence Prevention procedures", location: "Policies" },
  { id: "3.16", element: 3, method: "interview", question: "Employees trained in the harassment prevention plan", evidence: "Orientation, Harassment and Violence Prevention training", location: "Safety Manual" },
  { id: "3.17", element: 3, method: "documentation", question: "Violence and harassment policies and procedures reviewed", evidence: "Harassment and Violence Prevention policy (review)", location: "Policies" },

  // Element 4: Joint Worksite Health and Safety Committees and Representatives
  { id: "4.1", element: 4, method: "documentation", question: "Terms of reference for the committee include all legislated requirements", evidence: "Terms of Reference", location: "Policies" },
  { id: "4.2", element: 4, method: "documentation", question: "Policy or procedure includes the legislated requirements for an HS representative", evidence: "Terms of Reference", location: "Policies" },
  { id: "4.3", element: 4, method: "documentation", question: "Committee established as required in the terms of reference", evidence: "Terms of Reference, Meeting Agenda and Minutes", location: "Forms" },
  { id: "4.4", element: 4, method: "documentation", question: "HS representative appointed", evidence: "Terms of Reference", location: "Policies" },
  { id: "4.5", element: 4, method: "documentation", question: "Duties written for the committee and HS representative", evidence: "Roles and Responsibilities, Terms of Reference", location: "Safety Manual" },
  { id: "4.6", element: 4, method: "documentation", question: "Committee members and HS representative trained in their duties", evidence: "Committee or HS Representative Training certificate (Certification Types)", location: "App" },
  { id: "4.7", element: 4, method: "interview", question: "Members understand their duties and responsibilities", evidence: "Roles and Responsibilities", location: "Safety Manual" },
  { id: "4.8", element: 4, method: "interview", question: "Members participate in health and safety activities", evidence: "Meeting Agenda and Minutes, inspection records", location: "Forms" },
  { id: "4.9", element: 4, method: "documentation", question: "Policy or procedure for the committee to address employee concerns and complaints", evidence: "Health and Safety Recommendation, Terms of Reference", location: "Forms" },
  { id: "4.10", element: 4, method: "interview", question: "How employees bring forward health and safety concerns and complaints", evidence: "Health and Safety Recommendation", location: "Forms" },
  { id: "4.11", element: 4, method: "interview", question: "Process for the committee to make recommendations to management", evidence: "Health and Safety Recommendation", location: "Forms" },
  { id: "4.12", element: 4, method: "documentation", question: "Concerns and complaints resolved in a timely manner", evidence: "Health and Safety Recommendation (disposition)", location: "Forms" },
  { id: "4.13", element: 4, method: "documentation", question: "Committee holds meetings as identified in the terms of reference", evidence: "Meeting Agenda and Minutes", location: "Forms" },
  { id: "4.14", element: 4, method: "documentation", question: "Formal inspections completed prior to committee meetings", evidence: "Meeting Agenda and Minutes, inspection records", location: "Forms" },
  { id: "4.15", element: 4, method: "observation", question: "Names and contact information of committee members and HS representative posted", evidence: "Posted contact, Terms of Reference", location: "Policies" },

  // Element 5: Qualifications, Orientation, and Training
  { id: "5.1", element: 5, method: "documentation", question: "Process to ensure employees are qualified for the position", evidence: "Training and Certification Log, Certifications", location: "App" },
  { id: "5.2", element: 5, method: "documentation", question: "Orientation covers OHS rights and critical information before regular duties", evidence: "New Worker Orientation Checklist, Orientation Topics 01 to 09", location: "Forms" },
  { id: "5.3", element: 5, method: "interview", question: "Managers ensure orientations conducted before employees start regular duties", evidence: "New Worker Orientation records", location: "Forms" },
  { id: "5.4", element: 5, method: "documentation", question: "Managers and supervisors provided training to support their role", evidence: "Supervisor and Manager Safety Training certificate (Certification Types)", location: "App" },
  { id: "5.5", element: 5, method: "documentation", question: "Employees receive job-specific training on hire, new tasks, or operational change", evidence: "Worker Competency Assessment, training log", location: "Forms" },
  { id: "5.6", element: 5, method: "interview", question: "Job-specific training includes a practical demonstration", evidence: "Worker Competency Assessment", location: "Forms" },
  { id: "5.7", element: 5, method: "documentation", question: "Process to assess competency of new and re-assigned workers", evidence: "Worker Competency Assessment", location: "Forms" },
  { id: "5.8", element: 5, method: "documentation", question: "Competency assessments conducted", evidence: "Worker Competency Assessment records", location: "Forms" },
  { id: "5.9", element: 5, method: "documentation", question: "Required refresher training provided", evidence: "Training and Certification Log, Certifications module", location: "App" },

  // Element 6: Other Parties at the Work Site
  { id: "6.1", element: 6, method: "documentation", question: "Policy or process to protect others not under the employer's direction", evidence: "Other Parties policy, Visitors policy", location: "Policies" },
  { id: "6.2", element: 6, method: "documentation", question: "Process with criteria for evaluating and selecting other employers and self-employed persons", evidence: "Contractor Pre-Qualification", location: "Forms" },
  { id: "6.3", element: 6, method: "documentation", question: "Process to monitor other employers and self-employed persons", evidence: "Contractor Orientation (monitoring), Other Parties policy", location: "Forms" },
  { id: "6.4", element: 6, method: "documentation", question: "Health and safety orientations provided to visitors and other employers", evidence: "Visitor Log, Contractor Orientation", location: "App" },
  { id: "6.5", element: 6, method: "interview", question: "Communicates with external parties about their responsibilities and site hazards", evidence: "Other Parties policy, Contractor Orientation", location: "Policies" },
  { id: "6.6", element: 6, method: "interview", question: "Health and safety policy communicated to other employers and self-employed persons", evidence: "Other Parties policy, Contractor Orientation", location: "Policies" },
  { id: "6.7", element: 6, method: "documentation", question: "Health and safety information readily available to affected external parties", evidence: "Other Parties policy, Resource Library", location: "App" },
  { id: "6.8", element: 6, method: "documentation", question: "Process to address non-compliance of other employers and self-employed persons", evidence: "Other Parties policy (non-compliance)", location: "Policies" },

  // Element 7: Inspections
  { id: "7.1", element: 7, method: "documentation", question: "Inspection policy or process stating frequency, all areas, and all employee levels", evidence: "Inspections policy (schedule)", location: "Policies" },
  { id: "7.2", element: 7, method: "documentation", question: "Checklists or forms used for formal inspections", evidence: "Worksite and Shop Inspection, Pre-Trip Inspection", location: "Forms" },
  { id: "7.3", element: 7, method: "documentation", question: "Individuals leading formal inspections received training", evidence: "Inspection Training certificate (Certification Types)", location: "App" },
  { id: "7.4", element: 7, method: "documentation", question: "Formal inspections carried out per the policy by managers, supervisors, and workers", evidence: "Inspection submissions, Inspections policy", location: "App" },
  { id: "7.5", element: 7, method: "documentation", question: "System to correct deficiencies found in formal inspections", evidence: "Worksite and Shop Inspection (corrective actions), Workflow Station", location: "App" },
  { id: "7.6", element: 7, method: "observation", question: "Deficiencies found in formal inspections corrected", evidence: "Inspection records, Workflow Station", location: "App" },

  // Element 8: Emergency Response (incl. first aid)
  { id: "8.1", element: 8, method: "documentation", question: "Written emergency response plans developed for potential emergencies", evidence: "Emergency Response Plan", location: "Safety Manual" },
  { id: "8.2", element: 8, method: "documentation", question: "Plans include communication, emergency numbers, personnel, and response", evidence: "Emergency Response Plan", location: "Safety Manual" },
  { id: "8.3", element: 8, method: "interview", question: "Employees received emergency response training for their responsibility", evidence: "Orientation 04 Emergency Response, Orientation Checklist", location: "Safety Manual" },
  { id: "8.4", element: 8, method: "interview", question: "Employees understand their responsibilities under the emergency response plan", evidence: "Orientation 04 Emergency Response", location: "Safety Manual" },
  { id: "8.5", element: 8, method: "documentation", question: "Emergency response drills conducted", evidence: "Emergency Drill Record", location: "Forms" },
  { id: "8.6", element: 8, method: "documentation", question: "Deficiencies identified through a drill corrected", evidence: "Emergency Drill Record (improvements)", location: "Forms" },
  { id: "8.7", element: 8, method: "documentation", question: "Deficiencies identified through an actual emergency corrected", evidence: "Emergency Drill Record, Incident records", location: "Forms" },
  { id: "8.8", element: 8, method: "documentation", question: "Number of trained first aiders meets legislated requirements", evidence: "Emergency Contact List and First Aiders", location: "Forms" },
  { id: "8.9", element: 8, method: "observation", question: "First aid equipment, supplies, and facilities meet legislated requirements", evidence: "Worksite Inspection (first aid checks), first aider list", location: "Forms" },

  // Element 9: Incident Investigation
  { id: "9.1", element: 9, method: "documentation", question: "Policy or process requiring reporting of incidents, near misses, illness, and refusals", evidence: "Incident Investigation policy, Orientation 08", location: "Policies" },
  { id: "9.2", element: 9, method: "interview", question: "Employees can explain the reporting procedures", evidence: "Orientation 08 Incident Reporting", location: "Safety Manual" },
  { id: "9.3", element: 9, method: "interview", question: "Employees report incidents, occupational illness, and work refusals", evidence: "Incidents module, Incident Report form", location: "App" },
  { id: "9.4", element: 9, method: "documentation", question: "Employees report near misses", evidence: "Incidents module (near miss), Incident Report", location: "App" },
  { id: "9.5", element: 9, method: "documentation", question: "Procedure for investigating incidents, near misses, illness, and refusals", evidence: "Incident Investigation procedure", location: "Safety Manual" },
  { id: "9.6", element: 9, method: "documentation", question: "Individuals leading investigations trained in investigation techniques", evidence: "Incident Investigation Training certificate (Certification Types)", location: "App" },
  { id: "9.7", element: 9, method: "interview", question: "Managers and supervisors participate in investigations", evidence: "Incident Report and Investigation", location: "Forms" },
  { id: "9.8", element: 9, method: "interview", question: "Workers participate in the investigation process", evidence: "Incident Report and Investigation", location: "Forms" },
  { id: "9.9", element: 9, method: "documentation", question: "Investigations identify root causes and recommend corrective actions", evidence: "Incident Report and Investigation (5 Whys)", location: "Forms" },
  { id: "9.10", element: 9, method: "documentation", question: "Corrective actions implemented to prevent reoccurrence", evidence: "Incident Report form, Workflow Station", location: "App" },
  { id: "9.11", element: 9, method: "documentation", question: "Investigations completed in a timely manner", evidence: "Incident Report and Investigation (dates)", location: "Forms" },
  { id: "9.12", element: 9, method: "documentation", question: "Managers ensure investigations are complete per the procedures", evidence: "Incident Report and Investigation", location: "Forms" },
  { id: "9.13", element: 9, method: "interview", question: "Completed investigation reports communicated to employees", evidence: "Safety Meetings, Incident Investigation procedure", location: "Forms" },

  // Element 10: System Administration
  { id: "10.1", element: 10, method: "interview", question: "System to confirm two-way communication of health and safety issues", evidence: "Safety Meetings, Health and Safety Recommendation", location: "Forms" },
  { id: "10.2", element: 10, method: "observation", question: "Health and safety information readily available to employees", evidence: "Resource Library", location: "App" },
  { id: "10.3", element: 10, method: "documentation", question: "Records and statistics analyzed for trends at least annually", evidence: "Annual Program Review, Analytics module", location: "App" },
  { id: "10.4", element: 10, method: "interview", question: "Senior management and management held accountable for the management system", evidence: "HSMS Administration, Annual Program Review", location: "Policies" },
  { id: "10.5", element: 10, method: "documentation", question: "Management system evaluation or action plan completed at least annually", evidence: "Annual Program Review", location: "Forms" },
  { id: "10.6", element: 10, method: "interview", question: "Results from the evaluation or action plan communicated to employees", evidence: "Annual Program Review, Safety Meetings", location: "Forms" },
  { id: "10.7", element: 10, method: "documentation", question: "Plan developed to address deficiencies from the previous evaluation", evidence: "Annual Program Review (targets)", location: "Forms" },
  { id: "10.8", element: 10, method: "documentation", question: "Plan implemented", evidence: "Annual Program Review, Workflow Station", location: "App" },
];
