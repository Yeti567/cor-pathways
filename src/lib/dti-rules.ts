// Daily Trip Inspection (NSC / CVOR DVIR) province rule engine.
//
// Pure, testable jurisdiction rules for the standalone Daily Trip Inspection
// module. All three launch provinces (British Columbia, Alberta, Ontario) build
// their trip-inspection law on National Safety Code Standard 13, so ~95% of the
// inspection content is shared. What differs is the "wrapper": who must inspect
// (weight / passenger thresholds), pre-trip vs pre-and-post, validity, retention
// routing, the credential at risk, and the regulatory citation on the printout.
// This module encodes that wrapper as data so a province is a config entry, not
// new branching code.
//
// Sources: NSC Standard 13 (CCMTA); BC MVA Reg Division 37 (37.60/37.61); Alberta
// Commercial Vehicle Safety Regulation AR121/2009 (+ Registrar's Exemption s.40(1));
// Ontario O. Reg 199/07 (HTA). All three launch thresholds are verified against
// these sources; `thresholdVerified` stays as a guard for any future province
// added before its figure is confirmed.

export type Province = "BC" | "AB" | "ON";

export const PROVINCES: Province[] = ["BC", "AB", "ON"];

export const PROVINCE_LABELS: Record<Province, string> = {
  BC: "British Columbia",
  AB: "Alberta",
  ON: "Ontario",
};

// Schedule 1 = trucks/tractors/trailers, Schedule 2 = buses, Schedule 3 = motor
// coaches. The numbers align across NSC and Ontario's O. Reg 199/07.
export type ScheduleNo = 1 | 2 | 3;

export type InspectionType = "pre" | "post";

// The provincial credential that a poor inspection record puts at risk. Ontario
// runs its own CVOR (Commercial Vehicle Operator's Registration); BC and Alberta
// use the NSC Safety Fitness Certificate.
export type CredentialKind = "CVOR" | "SFC";

export const CREDENTIAL_LABELS: Record<CredentialKind, string> = {
  CVOR: "CVOR certificate",
  SFC: "Safety Fitness Certificate",
};

// Vehicle body types the engine recognizes. Kept independent of the Equipment
// module's own categories so callers map their record into this minimal shape.
export type VehicleBodyType = "truck" | "tractor" | "trailer" | "bus" | "motor_coach";

export type DtiVehicle = {
  bodyType: VehicleBodyType;
  // Registered or actual gross weight in kilograms (GVW / RGW). Null when unknown.
  registeredWeightKg: number | null;
  // Designed passenger capacity, for buses and motor coaches. Null when unknown.
  passengerCapacity?: number | null;
};

export type RetentionPolicy = {
  months: number;
  // Alberta is the only launch province with an explicit forwarding chain: the
  // driver forwards the report to the carrier within N days, and the carrier
  // forwards it to the principal place of business within M days.
  driverForwardDays?: number;
  headOfficeForwardDays?: number;
};

export type ProvinceRule = {
  province: Province;
  label: string;
  governingRule: string;
  enforcementBody: string;
  credential: CredentialKind;
  // Trucks/tractors/trailers at or above this gross weight (kg) need a daily
  // inspection.
  truckThresholdKg: number;
  // Buses/motor coaches designed for at least this many passengers need a daily
  // inspection. 1 means "any bus".
  busPassengerThreshold: number;
  inspectionTypes: InspectionType[];
  validityHours: number;
  carryDocuments: Array<"current_report" | "schedule">;
  retention: RetentionPolicy;
  // False when the threshold figure still needs confirming against the live reg.
  thresholdVerified: boolean;
};

const RULES: Record<Province, ProvinceRule> = {
  BC: {
    province: "BC",
    label: PROVINCE_LABELS.BC,
    governingRule: "Motor Vehicle Act Regulations, Division 37 (37.60 / 37.61); NSC Standard 13",
    enforcementBody: "CVSE (Commercial Vehicle Safety and Enforcement)",
    credential: "SFC",
    truckThresholdKg: 5000,
    busPassengerThreshold: 1,
    inspectionTypes: ["pre", "post"],
    validityHours: 24,
    carryDocuments: ["current_report", "schedule"],
    retention: { months: 6 },
    thresholdVerified: true,
  },
  AB: {
    province: "AB",
    label: PROVINCE_LABELS.AB,
    governingRule: "Commercial Vehicle Safety Regulation; NSC Standard 13",
    enforcementBody: "Alberta Transportation (peace officers)",
    credential: "SFC",
    // Verified: Commercial Vehicle Safety Regulation AR121/2009. The Registrar's
    // Exemption (s.40(1)) relieves vehicles registered for under 11,794 kg from
    // preparing/carrying a trip inspection report and carrying the NSC Std 13
    // schedule, so the documented-report requirement begins at 11,794 kg. Lighter
    // regulated vehicles (4,501 to 11,793 kg) may still inspect voluntarily; the
    // app allows it, it is just not legally required to be documented.
    truckThresholdKg: 11794,
    busPassengerThreshold: 11,
    inspectionTypes: ["pre"],
    validityHours: 24,
    carryDocuments: ["current_report", "schedule"],
    retention: { months: 6, driverForwardDays: 20, headOfficeForwardDays: 30 },
    thresholdVerified: true,
  },
  ON: {
    province: "ON",
    label: PROVINCE_LABELS.ON,
    governingRule: "Highway Traffic Act, O. Reg 199/07 (Commercial Motor Vehicle Inspections)",
    enforcementBody: "MTO (tracked under CVOR)",
    credential: "CVOR",
    truckThresholdKg: 4500,
    busPassengerThreshold: 1,
    inspectionTypes: ["pre"],
    validityHours: 24,
    carryDocuments: ["current_report", "schedule"],
    retention: { months: 6 },
    thresholdVerified: true,
  },
};

export function isProvince(value: string | null | undefined): value is Province {
  return value === "BC" || value === "AB" || value === "ON";
}

/** The full ruleset for a province. */
export function getProvinceRule(province: Province): ProvinceRule {
  return RULES[province];
}

/** Which NSC schedule applies to a vehicle, by body type. */
export function applicableSchedule(vehicle: DtiVehicle): ScheduleNo {
  switch (vehicle.bodyType) {
    case "motor_coach":
      return 3;
    case "bus":
      return 2;
    default:
      return 1;
  }
}

function isPassengerVehicle(bodyType: VehicleBodyType): boolean {
  return bodyType === "bus" || bodyType === "motor_coach";
}

/**
 * Whether a vehicle needs a daily trip inspection in the given province.
 *
 * Trucks/tractors/trailers qualify at or above the province weight threshold;
 * passenger vehicles qualify at or above the passenger threshold. When the
 * relevant figure is unknown (null) we err toward "required", since the safe
 * default for a compliance tool is to prompt the inspection rather than skip it.
 */
export function isInspectionRequired(vehicle: DtiVehicle, province: Province): boolean {
  const rule = RULES[province];

  if (isPassengerVehicle(vehicle.bodyType)) {
    const capacity = vehicle.passengerCapacity;
    if (capacity == null) {
      return true;
    }
    return capacity >= rule.busPassengerThreshold;
  }

  const weight = vehicle.registeredWeightKg;
  if (weight == null) {
    return true;
  }
  return weight >= rule.truckThresholdKg;
}

/** The inspection types a province expects (Pre only, or Pre and Post for BC). */
export function requiredInspectionTypes(province: Province): InspectionType[] {
  return RULES[province].inspectionTypes;
}

export function requiresPostTrip(province: Province): boolean {
  return RULES[province].inspectionTypes.includes("post");
}

export function validityHours(province: Province): number {
  return RULES[province].validityHours;
}

export function credentialAtRisk(province: Province): CredentialKind {
  return RULES[province].credential;
}

export function retentionPolicy(province: Province): RetentionPolicy {
  return RULES[province].retention;
}

export function carryDocuments(province: Province): Array<"current_report" | "schedule"> {
  return RULES[province].carryDocuments;
}

/**
 * When an inspection completed at `completedAtIso` stops being valid. The report
 * is good for the province validity window (24 h everywhere at launch).
 */
export function inspectionValidUntil(completedAtIso: string, province: Province): Date {
  const completed = new Date(completedAtIso);
  return new Date(completed.getTime() + RULES[province].validityHours * 60 * 60 * 1000);
}

/** Whether an inspection completed at `completedAtIso` is still valid at `nowIso`. */
export function isInspectionValid(completedAtIso: string, province: Province, nowIso: string): boolean {
  return new Date(nowIso).getTime() < inspectionValidUntil(completedAtIso, province).getTime();
}

/** The regulatory citation to print on a report for a province + schedule. */
export function scheduleCitation(province: Province, schedule: ScheduleNo): string {
  switch (province) {
    case "BC":
      return `BC MVA Reg Division 37; NSC Standard 13 Schedule ${schedule}`;
    case "AB":
      return `Commercial Vehicle Safety Regulation; NSC Standard 13 Schedule ${schedule}`;
    case "ON":
      return `O. Reg 199/07 Schedule ${schedule}`;
  }
}
