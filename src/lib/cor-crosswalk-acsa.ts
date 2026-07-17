// ACSA (Alberta Construction Safety Association) COR audit crosswalk.
//
// The 108 questions of the 2023 ACSA Audit Instrument, paraphrased (not the CP's
// verbatim copyrighted text), each mapped to the evidence in this app's COR
// document set, the verification method, and where it lives. A company runs one
// health and safety program, so the evidence is the same library AMTA's crosswalk
// uses; only the instrument that scores it differs. Element numbers are ACSA's.

import type { CorCrosswalkQuestion } from "@/lib/cor-crosswalk";

export const ACSA_CROSSWALK: CorCrosswalkQuestion[] = [
  // Element 1: Management Commitment
  { id: "1.1", element: 1, method: "documentation", question: "Written health and safety policy", evidence: "Health and Safety Policy", location: "Policies" },
  { id: "1.2", element: 1, method: "documentation", question: "Responsibilities written for each employee level", evidence: "Roles and Responsibilities", location: "Safety Manual" },
  { id: "1.3", element: 1, method: "interview", question: "Policy communicated to employees", evidence: "New Worker Orientation, Safety Meetings", location: "Safety Manual" },
  { id: "1.4", element: 1, method: "interview", question: "Senior management demonstrates commitment", evidence: "Annual Program Review, Safety Meeting attendance", location: "Forms" },
  { id: "1.5", element: 1, method: "interview", question: "Employees understand their OHS rights", evidence: "Orientation Topics 01 to 03 and 05", location: "Safety Manual" },
  { id: "1.6", element: 1, method: "interview", question: "Employees understand their assigned responsibilities", evidence: "Roles and Responsibilities, Orientation", location: "Safety Manual" },
  { id: "1.7", element: 1, method: "interview", question: "Employees understand their legislated responsibilities", evidence: "OHS Legislation Reference, Orientation", location: "Safety Manual" },
  { id: "1.8", element: 1, method: "interview", question: "Managers and supervisors understand their responsibilities", evidence: "Roles and Responsibilities", location: "Safety Manual" },
  { id: "1.9", element: 1, method: "interview", question: "Management communicates OHS topics to employees", evidence: "Safety Meetings, Annual Program Review", location: "Forms" },
  { id: "1.10", element: 1, method: "interview", question: "Employer provides resources to manage hazards", evidence: "HSMS Administration, Annual Program Review", location: "Policies" },
  { id: "1.11", element: 1, method: "interview", question: "Senior management accountable for the HSMS", evidence: "HSMS Administration, Annual Program Review", location: "Policies" },
  { id: "1.12", element: 1, method: "observation", question: "Access to current applicable legislation", evidence: "OHS Legislation Reference, OHS Act, Regulation, and Code in the Resource Library", location: "Policies" },

  // Element 2: Public, Visitors and Contracted Employers
  { id: "2.1", element: 2, method: "documentation", question: "Process to protect people not under the employer's direction", evidence: "Other Parties policy, Visitors policy", location: "Policies" },
  { id: "2.2", element: 2, method: "interview", question: "Policy communicated to contracted employers", evidence: "Contractor Orientation, Other Parties policy", location: "Policies" },
  { id: "2.3", element: 2, method: "documentation", question: "Process to manage contracted employers", evidence: "Contractor Pre-Qualification", location: "Forms" },
  { id: "2.4", element: 2, method: "interview", question: "Process to regularly monitor contracted employers", evidence: "Contractor Orientation (monitoring), Other Parties policy", location: "Forms" },
  { id: "2.5", element: 2, method: "interview", question: "Communicates with external worksite parties (contracted employers)", evidence: "Other Parties policy, Contractor Orientation", location: "Policies" },
  { id: "2.6", element: 2, method: "interview", question: "Communicates with external worksite parties (suppliers)", evidence: "Other Parties policy", location: "Policies" },
  { id: "2.7", element: 2, method: "interview", question: "Communicates with external worksite parties (prime contractors)", evidence: "Other Parties policy", location: "Policies" },
  { id: "2.8", element: 2, method: "documentation", question: "Health and safety orientations provided to visitors", evidence: "Visitor Log, Visitors policy", location: "App" },
  { id: "2.9", element: 2, method: "documentation", question: "Health and safety orientations provided to contracted employers", evidence: "Contractor Orientation", location: "App" },
  { id: "2.10", element: 2, method: "observation", question: "H&S information available to external worksite parties", evidence: "Other Parties policy, Resource Library", location: "App" },

  // Element 3: Health and Safety Committees / Representatives
  { id: "3.1", element: 3, method: "documentation", question: "Established system for the H&S committee per legislation", evidence: "Terms of Reference", location: "Policies" },
  { id: "3.2", element: 3, method: "documentation", question: "Policy includes the legislated HS representative requirements", evidence: "Terms of Reference", location: "Policies" },
  { id: "3.3", element: 3, method: "documentation", question: "Committee or representative established per legislation", evidence: "Terms of Reference", location: "Policies" },
  { id: "3.4", element: 3, method: "documentation", question: "Committee members or representative trained", evidence: "Committee or HS Representative Training certificate (Certification Types)", location: "App" },
  { id: "3.5", element: 3, method: "interview", question: "Members understand their duties and responsibilities", evidence: "Roles and Responsibilities", location: "Safety Manual" },
  { id: "3.6", element: 3, method: "interview", question: "System to address and act on employee concerns", evidence: "Health and Safety Recommendation", location: "Forms" },
  { id: "3.7", element: 3, method: "documentation", question: "Required H&S activities conducted per legislation", evidence: "Meeting Agenda and Minutes, inspection records", location: "Forms" },
  { id: "3.8", element: 3, method: "interview", question: "Meeting minutes made available to employees", evidence: "Meeting Agenda and Minutes", location: "Forms" },
  { id: "3.9", element: 3, method: "observation", question: "Member names and contact information available", evidence: "Posted contact, Terms of Reference", location: "Policies" },

  // Element 4: Training
  { id: "4.1", element: 4, method: "documentation", question: "Orientation process covers OHS rights and critical information", evidence: "New Worker Orientation Checklist, Orientation Topics 01 to 09", location: "Forms" },
  { id: "4.2", element: 4, method: "documentation", question: "Orientations provided within an appropriate timeframe", evidence: "New Worker Orientation procedure, signed checklist", location: "Forms" },
  { id: "4.3", element: 4, method: "interview", question: "Managers confirm workers received orientations", evidence: "New Worker Orientation records", location: "Safety Manual" },
  { id: "4.4", element: 4, method: "documentation", question: "Qualifications confirmed before performing the job", evidence: "Training and Certification Log, Certifications", location: "App" },
  { id: "4.5", element: 4, method: "documentation", question: "Process to assess competency of new and re-assigned workers", evidence: "Worker Competency Assessment", location: "Forms" },
  { id: "4.6", element: 4, method: "documentation", question: "Competency assessments conducted", evidence: "Worker Competency Assessment records", location: "Forms" },
  { id: "4.7", element: 4, method: "documentation", question: "Job-specific training on hire, new tasks, or changes", evidence: "Worker Competency Assessment, training log", location: "Forms" },
  { id: "4.8", element: 4, method: "interview", question: "Job-specific training includes a practical demonstration", evidence: "Worker Competency Assessment", location: "Forms" },
  { id: "4.9", element: 4, method: "documentation", question: "Required refresher training provided", evidence: "Training and Certification Log, Certifications module", location: "App" },
  { id: "4.10", element: 4, method: "documentation", question: "System encourages two-way communication", evidence: "Safety Meetings, Health and Safety Recommendation", location: "Forms" },
  { id: "4.11", element: 4, method: "documentation", question: "Two-way communication completed per defined frequency", evidence: "Safety Meeting minutes", location: "Forms" },
  { id: "4.12", element: 4, method: "interview", question: "System for workers to provide feedback on H&S issues", evidence: "Health and Safety Recommendation", location: "Forms" },
  { id: "4.13", element: 4, method: "interview", question: "Employees evaluated on their H&S accountabilities", evidence: "Safety Accountability Evaluation form", location: "Forms" },
  { id: "4.14", element: 4, method: "documentation", question: "Training to lead formal hazard assessments", evidence: "Hazard Assessment Training certificate (Certification Types)", location: "App" },
  { id: "4.15", element: 4, method: "documentation", question: "Training to lead inspections", evidence: "Inspection Training certificate (Certification Types)", location: "App" },
  { id: "4.16", element: 4, method: "documentation", question: "Training to lead investigations", evidence: "Incident Investigation Training certificate (Certification Types)", location: "App" },
  { id: "4.17", element: 4, method: "interview", question: "Supervisors trained appropriate to their role", evidence: "Supervisor and Manager Safety Training certificate (Certification Types)", location: "App" },

  // Element 5: Hazard Assessment
  { id: "5.1", element: 5, method: "documentation", question: "Inventory of all jobs and positions", evidence: "Position and Task Inventory", location: "Forms" },
  { id: "5.2", element: 5, method: "documentation", question: "Tasks identified for each job or position", evidence: "Position and Task Inventory", location: "Forms" },
  { id: "5.3", element: 5, method: "documentation", question: "Health and safety hazards identified for each task", evidence: "Formal Hazard Assessment", location: "Forms" },
  { id: "5.4", element: 5, method: "documentation", question: "Hazards evaluated according to risk", evidence: "Formal Hazard Assessment (risk matrix)", location: "Forms" },
  { id: "5.5", element: 5, method: "interview", question: "Senior management knows the high hazard tasks", evidence: "Hazard Assessment procedure, Orientation 06 High Risk Hazards", location: "Safety Manual" },
  { id: "5.6", element: 5, method: "documentation", question: "Policy to create, review, and revise formal hazard assessments", evidence: "Formal and Field-Level Hazard Assessment procedure", location: "Safety Manual" },
  { id: "5.7", element: 5, method: "documentation", question: "Formal hazard assessments created and reviewed per frequency", evidence: "Formal Hazard Assessment (dated)", location: "Forms" },
  { id: "5.8", element: 5, method: "interview", question: "Employees participate in formal hazard assessments", evidence: "Formal Hazard Assessment (worker signature)", location: "Forms" },
  { id: "5.9", element: 5, method: "documentation", question: "System for site-specific hazard assessments", evidence: "Field-Level Hazard Assessment procedure", location: "Safety Manual" },
  { id: "5.10", element: 5, method: "documentation", question: "Site-specific assessments completed before the task", evidence: "Field-Level Hazard Assessment", location: "Forms" },
  { id: "5.11", element: 5, method: "interview", question: "Site-specific assessments repeated when changes occur", evidence: "Field-Level Hazard Assessment", location: "Forms" },
  { id: "5.12", element: 5, method: "documentation", question: "Affected employees participate in site-specific assessments", evidence: "Field-Level Hazard Assessment", location: "Forms" },
  { id: "5.13", element: 5, method: "interview", question: "System for workers to report newly identified hazards", evidence: "Hazard Identification and Reporting policy, Hazard Report", location: "Policies" },

  // Element 6: Hazard Control
  { id: "6.1", element: 6, method: "documentation", question: "Controls identified for formal assessment hazards", evidence: "Formal Hazard Assessment, Safe Work Procedure Template", location: "Forms" },
  { id: "6.2", element: 6, method: "observation", question: "Engineering controls implemented", evidence: "Hazard assessments, Equipment module", location: "App" },
  { id: "6.3", element: 6, method: "documentation", question: "Administrative controls implemented", evidence: "Safe work procedures, policies", location: "Safety Manual" },
  { id: "6.4", element: 6, method: "observation", question: "PPE controls implemented", evidence: "PPE Policy (PPE in use on site)", location: "Policies" },
  { id: "6.5", element: 6, method: "documentation", question: "Controls identified for site-specific hazards", evidence: "Field-Level Hazard Assessment", location: "Forms" },
  { id: "6.6", element: 6, method: "interview", question: "Changes to controls communicated", evidence: "Management of Change, Safety Meetings", location: "Safety Manual" },
  { id: "6.7", element: 6, method: "interview", question: "Employees using the required controls", evidence: "Safe work procedures, PPE Policy", location: "Safety Manual" },
  { id: "6.8", element: 6, method: "interview", question: "Supervisors enforce the use of controls", evidence: "Safety Enforcement and Discipline policy", location: "Policies" },
  { id: "6.9", element: 6, method: "documentation", question: "Violence Prevention Plan meets requirements", evidence: "Harassment and Violence Prevention policy", location: "Policies" },
  { id: "6.10", element: 6, method: "documentation", question: "Harassment Prevention Plan meets requirements", evidence: "Harassment and Violence Prevention policy", location: "Policies" },
  { id: "6.11", element: 6, method: "documentation", question: "Violence and harassment plans reviewed", evidence: "Harassment and Violence Prevention policy (review)", location: "Policies" },

  // Element 7: Inspections & Maintenance
  { id: "7.1", element: 7, method: "documentation", question: "Process defines formal inspection frequency", evidence: "Inspections policy (schedule)", location: "Policies" },
  { id: "7.2", element: 7, method: "documentation", question: "Process defines inspection responsibilities", evidence: "Inspections policy", location: "Policies" },
  { id: "7.3", element: 7, method: "documentation", question: "Tools used to record formal inspections", evidence: "Worksite and Shop Inspection, Pre-Trip Inspection", location: "Forms" },
  { id: "7.4", element: 7, method: "documentation", question: "Inspections completed following the frequency", evidence: "Inspection submissions, Inspections policy", location: "App" },
  { id: "7.5", element: 7, method: "documentation", question: "System to correct inspection deficiencies", evidence: "Worksite and Shop Inspection (corrective actions), Workflow Station", location: "App" },
  { id: "7.6", element: 7, method: "observation", question: "Inspection deficiencies corrected", evidence: "Inspection records, Workflow Station", location: "App" },
  { id: "7.7", element: 7, method: "interview", question: "Workers participate in the inspection process", evidence: "Inspections policy, inspection records", location: "App" },
  { id: "7.8", element: 7, method: "interview", question: "Managers participate in formal inspections", evidence: "Inspections policy", location: "Policies" },
  { id: "7.9", element: 7, method: "documentation", question: "Preventive maintenance program exists", evidence: "Preventative Maintenance policy", location: "Policies" },
  { id: "7.10", element: 7, method: "observation", question: "All applicable equipment in the maintenance program", evidence: "Equipment module", location: "App" },
  { id: "7.11", element: 7, method: "documentation", question: "Preventive maintenance program followed", evidence: "Equipment module maintenance records", location: "App" },

  // Element 8: Emergency Response
  { id: "8.1", element: 8, method: "documentation", question: "ERP identifies the applicable emergency scenarios", evidence: "Emergency Response Plan", location: "Safety Manual" },
  { id: "8.2", element: 8, method: "observation", question: "Emergency scenarios reflected on site", evidence: "Emergency Response Plan, Site-Specific ERP", location: "Safety Manual" },
  { id: "8.3", element: 8, method: "documentation", question: "ERP includes the legislated required areas", evidence: "Emergency Response Plan", location: "Safety Manual" },
  { id: "8.4", element: 8, method: "interview", question: "Employee ERP responsibilities communicated", evidence: "Orientation 04 Emergency Response", location: "Safety Manual" },
  { id: "8.5", element: 8, method: "interview", question: "Employees trained in their emergency responsibilities", evidence: "Orientation 04 Emergency Response, Orientation Checklist", location: "Safety Manual" },
  { id: "8.6", element: 8, method: "documentation", question: "Policy to evaluate ERP performance", evidence: "Emergency Response Plan (review)", location: "Safety Manual" },
  { id: "8.7", element: 8, method: "documentation", question: "ERP testing process and frequency followed", evidence: "Emergency Drill Record", location: "Forms" },
  { id: "8.8", element: 8, method: "documentation", question: "ERP deficiencies corrected", evidence: "Emergency Drill Record (improvements)", location: "Forms" },
  { id: "8.9", element: 8, method: "documentation", question: "Required number of first aiders trained", evidence: "Emergency Contact List and First Aiders", location: "Forms" },
  { id: "8.10", element: 8, method: "observation", question: "First aid equipment and supplies available", evidence: "Worksite Inspection (first aid checks), first aider list", location: "Forms" },

  // Element 9: Investigations
  { id: "9.1", element: 9, method: "documentation", question: "Reporting process for incidents, near misses, illness, refusals", evidence: "Incident Investigation policy, Orientation 08", location: "Policies" },
  { id: "9.2", element: 9, method: "interview", question: "Employees aware of the reporting procedures", evidence: "Orientation 08 Incident Reporting", location: "Safety Manual" },
  { id: "9.3", element: 9, method: "interview", question: "Incidents and near misses reported", evidence: "Incidents module, Incident Report form", location: "App" },
  { id: "9.4", element: 9, method: "documentation", question: "Investigation procedure exists", evidence: "Incident Investigation procedure", location: "Safety Manual" },
  { id: "9.5", element: 9, method: "interview", question: "Employees participate in the investigation process", evidence: "Incident Investigation procedure", location: "Safety Manual" },
  { id: "9.6", element: 9, method: "documentation", question: "Investigation reports completed per procedure", evidence: "Incident Report and Investigation (5 Whys)", location: "Forms" },
  { id: "9.7", element: 9, method: "documentation", question: "Recommended corrective actions implemented", evidence: "Incident Report form, Workflow Station", location: "App" },
  { id: "9.8", element: 9, method: "observation", question: "Corrective actions implemented on site", evidence: "Incident records, Workflow Station", location: "App" },
  { id: "9.9", element: 9, method: "interview", question: "Investigation results communicated", evidence: "Safety Meetings, Incident Investigation procedure", location: "Forms" },

  // Element 10: Program Administration
  { id: "10.1", element: 10, method: "observation", question: "H&S information readily available to employees", evidence: "Resource Library", location: "App" },
  { id: "10.2", element: 10, method: "documentation", question: "Records and statistics analyzed annually for trends", evidence: "Annual Program Review, Analytics module", location: "App" },
  { id: "10.3", element: 10, method: "documentation", question: "Annual HSMS evaluation or action plan", evidence: "Annual Program Review", location: "Forms" },
  { id: "10.4", element: 10, method: "interview", question: "Previous COR or SECOR results communicated", evidence: "Annual Program Review, Safety Meetings", location: "Forms" },
  { id: "10.5", element: 10, method: "documentation", question: "Action plan developed for previous audit findings", evidence: "Annual Program Review (targets)", location: "Forms" },
  { id: "10.6", element: 10, method: "documentation", question: "Action plan implemented", evidence: "Annual Program Review, Workflow Station", location: "App" },
];
