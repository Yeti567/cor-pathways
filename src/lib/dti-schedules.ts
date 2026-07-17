// Daily Trip Inspection schedules (NSC Standard 13 content).
//
// The inspection checklist itself: what a driver looks at and what counts as a
// defect vs a major defect. This is stable national-standard content shared
// across British Columbia, Alberta, and Ontario, so it lives in code (like the
// Transport module's requirement catalogue in transport-registry.ts) rather than
// a seeded table. The province-specific wrapper (thresholds, validity, citation)
// lives in dti-rules.ts; this file is the province-agnostic item list.
//
// Schedule 1 (trucks/tractors/trailers) is reproduced verbatim from NSC Standard
// 13 Schedule 1. Schedule 2 (buses) and Schedule 3 (motor coaches) follow the
// same shape and are flagged incomplete until their authoritative item lists are
// captured; callers should check `isComplete` before relying on them.

import type { ScheduleNo } from "@/lib/dti-rules";

export type ScheduleItem = {
  // Item number within the schedule (1-based), matching the regulation.
  no: number;
  label: string;
  // "Defects" in the regulation: record and report, may keep driving.
  minorDefects: string[];
  // "Major defects": record, report, and take the vehicle out of service.
  majorDefects: string[];
};

export type ScheduleDefinition = {
  scheduleNo: ScheduleNo;
  title: string;
  appliesTo: string;
  // False while the item list is still a stub awaiting authoritative content.
  isComplete: boolean;
  items: ScheduleItem[];
};

// NSC Standard 13, Schedule 1: Truck, Tractor, or Trailer Daily Inspection.
const SCHEDULE_1_ITEMS: ScheduleItem[] = [
  {
    no: 1,
    label: "Air brake system",
    minorDefects: ["Audible air leak", "Slow air pressure build-up rate"],
    majorDefects: [
      "Pushrod stroke of any brake exceeds adjustment limit",
      "Air loss rate exceeds prescribed limit",
      "Inoperative towing vehicle (tractor) protection system",
      "Low air warning system fails or system activated",
      "Inoperative service, parking or emergency brake",
    ],
  },
  {
    no: 2,
    label: "Cab",
    minorDefects: ["Occupant compartment door fails to open"],
    majorDefects: ["Cab or sleeper door fails to close securely"],
  },
  {
    no: 3,
    label: "Cargo securement",
    minorDefects: [
      "Insecure or improper load covering, such as wrong type of covering or covering flapping in wind",
    ],
    majorDefects: [
      "Insecure cargo",
      "Absence, failure, malfunction or deterioration of required cargo securement device or load covering",
    ],
  },
  {
    no: 4,
    label: "Coupling devices",
    minorDefects: ["Coupler or mounting has loose or missing fastener"],
    majorDefects: [
      "Coupler insecure or movement exceeds the maximum of tolerance allowed",
      "Coupling or locking mechanism damaged or fails to lock",
      "Defective, incorrect or missing safety chain/cable",
    ],
  },
  {
    no: 5,
    label: "Dangerous goods",
    minorDefects: [],
    majorDefects: ["Requirements of Transportation of Dangerous Goods Regulations not met"],
  },
  {
    no: 6,
    label: "Driver controls",
    minorDefects: [
      "Accelerator pedal, clutch, gauges, audible and visual indicators or instruments fail to function properly",
    ],
    majorDefects: [],
  },
  {
    no: 7,
    label: "Driver seat",
    minorDefects: ["Seat damaged or fails to remain in set position"],
    majorDefects: ["Seatbelt or tether belt insecure, missing or malfunctions"],
  },
  {
    no: 8,
    label: "Electric brake system",
    minorDefects: ["Loose or insecure wiring or electrical connection"],
    majorDefects: ["Inoperative breakaway device", "Inoperative brake"],
  },
  {
    no: 9,
    label: "Emergency equipment and safety devices",
    minorDefects: ["Emergency equipment missing, damaged or defective"],
    majorDefects: [],
  },
  {
    no: 10,
    label: "Exhaust system",
    minorDefects: ["Exhaust leak"],
    majorDefects: ["Leak that causes exhaust gas to enter the occupant compartment"],
  },
  {
    no: 11,
    label: "Frame and cargo body",
    minorDefects: ["Damaged frame or cargo body"],
    majorDefects: ["Visibly shifted, cracked, collapsing or sagging frame member(s)"],
  },
  {
    no: 12,
    label: "Fuel system",
    minorDefects: ["Missing fuel tank cap"],
    majorDefects: ["Insecure fuel tank", "Dripping fuel leak"],
  },
  {
    no: 13,
    label: "General",
    minorDefects: [],
    majorDefects: ["Serious damage or deterioration that is noticeable and may affect vehicle's safe operation"],
  },
  {
    no: 14,
    label: "Glass and mirrors",
    minorDefects: [
      "Required mirror or window glass fails to provide required view to driver as a result of being cracked, broken, damaged, missing or maladjusted",
      "Broken or damaged attachments of required mirror or glass to vehicle body",
    ],
    majorDefects: [],
  },
  {
    no: 15,
    label: "Heater/defroster",
    minorDefects: ["Control or system failure"],
    majorDefects: ["Defroster fails to provide unobstructed view through windshield"],
  },
  {
    no: 16,
    label: "Horn",
    minorDefects: [],
    majorDefects: ["Vehicle has no operative horn"],
  },
  {
    no: 17,
    label: "Hydraulic brake system",
    minorDefects: ["Brake fluid level below indicated minimum level"],
    majorDefects: [
      "Parking brake inoperative",
      "Brake boost or power assist not operative",
      "Brake fluid leak",
      "Brake pedal fade or insufficient brake pedal reserve",
      "Activated (other than ABS) warning device",
      "Brake fluid reservoir less than 1/4 full",
    ],
  },
  {
    no: 18,
    label: "Lamps and reflectors",
    minorDefects: ["Required lamp does not function as intended", "Required reflector missing or partially missing"],
    majorDefects: [
      "When lamps required: failure of both low-beam headlamps",
      "When lamps required: failure of both rearmost tail lamps",
      "At all times: failure of rearmost turn-indicator lamp",
      "At all times: failure of both rearmost brake lamps",
    ],
  },
  {
    no: 19,
    label: "Steering",
    minorDefects: ["Steering wheel lash (free-play) greater than normal"],
    majorDefects: [
      "Steering wheel insecure, or does not respond normally",
      "Steering wheel lash (free-play) exceeds required limit",
    ],
  },
  {
    no: 20,
    label: "Suspension",
    minorDefects: [
      "Air leak in air suspension system",
      "Broken spring leaf",
      "Suspension fastener loose, missing or broken",
    ],
    majorDefects: [
      "Damaged (including patched, cut, bruised, cracked to braid), insecurely mounted, or deflated air bag",
      "Cracked or broken main spring leaf or more than 1 broken spring leaf",
      "Part of spring leaf or suspension missing, shifted out of place or in contact with another vehicle component",
      "Loose U-bolt",
    ],
  },
  {
    no: 21,
    label: "Tires",
    minorDefects: [
      "Damaged tread or sidewall of tire",
      "Tire leaking (other than tire leak classified as major defect)",
    ],
    majorDefects: [
      "Flat tire including tire leak that can be felt or heard",
      "Tire tread depth less than wear limit",
      "Tire in contact with another tire or any vehicle component other than mud-flap",
      "Tire is marked \"Not for highway use\"",
      "Tire has exposed cords in the tread or outer side wall area",
    ],
  },
  {
    no: 22,
    label: "Wheels, hubs and fasteners",
    minorDefects: ["Hub oil below minimum level (when fitted with sight glass)"],
    majorDefects: [
      "Wheel has loose, missing or ineffective fastener",
      "Damaged, cracked or broken wheel, rim or attaching part",
      "Evidence of imminent wheel, hub or bearing failure",
      "Leaking wheel seal",
    ],
  },
  {
    no: 23,
    label: "Windshield wiper/washer",
    minorDefects: [
      "Control or system malfunction",
      "Wiper blade damaged, missing or fails to adequately clear driver's field of vision",
    ],
    majorDefects: [
      "When necessary for prevailing weather: wiper or washer fails to adequately clear driver's field of vision in area swept by driver's side wiper",
    ],
  },
];

// NSC Standard 13, Schedule 2: Bus Daily Inspection.
const SCHEDULE_2_ITEMS: ScheduleItem[] = [
  {
    no: 1,
    label: "Accessibility devices",
    minorDefects: ["Alarm fails to operate", "Equipment malfunctions", "Interlock system malfunctions"],
    majorDefects: [
      "Vehicle fails to return to normal level after \"kneeling\"",
      "Extendable lift, ramp or other passenger-loading device fails to retract",
    ],
  },
  {
    no: 2,
    label: "Air brake system",
    minorDefects: ["Audible air leak", "Slow air pressure build-up rate"],
    majorDefects: [
      "Pushrod stroke of any brake exceeds adjustment limit",
      "Air loss rate exceeds prescribed limit",
      "Inoperative towing vehicle (tractor) protection system",
      "Low air warning system fails or system activated",
      "Inoperative service, parking or emergency brake",
    ],
  },
  {
    no: 3,
    label: "Cargo securement",
    minorDefects: ["Insecure or improper load covering"],
    majorDefects: [
      "Insecure cargo",
      "Absence, failure, malfunction or deterioration of required cargo securement device or load covering",
    ],
  },
  {
    no: 4,
    label: "Coupling devices",
    minorDefects: ["Coupler or mounting has loose or missing fastener"],
    majorDefects: [
      "Coupler insecure or movement exceeds prescribed limit",
      "Coupling or locking mechanism damaged or fails to lock",
      "Defective, incorrect or missing safety chain/cable",
    ],
  },
  {
    no: 5,
    label: "Dangerous goods",
    minorDefects: [],
    majorDefects: ["Requirements of Transportation of Dangerous Goods Regulations not met"],
  },
  {
    no: 6,
    label: "Doors and emergency exits",
    minorDefects: ["Door, window or hatch fails to open or close securely", "Alarm inoperative"],
    majorDefects: ["Required emergency exit fails to function as intended"],
  },
  {
    no: 7,
    label: "Driver controls",
    minorDefects: [
      "Accelerator pedal, clutch, gauges, audible and visual indicators or instruments fail to function properly",
    ],
    majorDefects: ["Accelerator sticks and engine fails to return to idle"],
  },
  {
    no: 8,
    label: "Driver seat",
    minorDefects: ["Seat damaged or fails to remain in set position"],
    majorDefects: ["Seatbelt or tether belt insecure, missing or malfunctions"],
  },
  {
    no: 9,
    label: "Electric brake system",
    minorDefects: ["Loose or insecure wiring or electrical connection"],
    majorDefects: ["Inoperative breakaway device", "Inoperative brake"],
  },
  {
    no: 10,
    label: "Emergency equipment and safety devices",
    minorDefects: ["Emergency equipment missing, damaged or defective"],
    majorDefects: [],
  },
  {
    no: 11,
    label: "Exhaust system",
    minorDefects: ["Exhaust leak"],
    majorDefects: ["Leak that causes exhaust gas to enter the occupant compartment"],
  },
  {
    no: 12,
    label: "Exterior body and frame",
    minorDefects: [
      "Insecure or missing body parts",
      "Insecure or missing compartment door",
      "Damaged frame or body",
    ],
    majorDefects: ["Visibly shifted, cracked, collapsing or sagging frame member(s)"],
  },
  {
    no: 13,
    label: "Fuel system",
    minorDefects: [],
    majorDefects: ["Missing fuel tank cap", "Insecure fuel tank", "Dripping fuel leak"],
  },
  {
    no: 14,
    label: "General",
    minorDefects: [],
    majorDefects: ["Serious damage or deterioration that is noticeable and may affect the vehicle's safe operation"],
  },
  {
    no: 15,
    label: "Glass and mirrors",
    minorDefects: [
      "Required mirror or window glass fails to provide required view to driver as a result of being cracked, broken, damaged, missing or maladjusted",
      "Broken or damaged attachments of required mirror or glass to vehicle body",
    ],
    majorDefects: ["Driver's view of the road obstructed in area swept by windshield wipers"],
  },
  {
    no: 16,
    label: "Heater/defroster",
    minorDefects: ["Control or system failure"],
    majorDefects: ["Defroster fails to provide unobstructed view through the windshield"],
  },
  {
    no: 17,
    label: "Horn",
    minorDefects: [],
    majorDefects: ["Vehicle has no operative horn"],
  },
  {
    no: 18,
    label: "Hydraulic brake system",
    minorDefects: ["Brake fluid level is below indicated minimum level"],
    majorDefects: [
      "Parking brake is inoperative",
      "Brake boost or power assist is not operative",
      "Brake fluid leak",
      "Brake pedal fade or insufficient brake pedal reserve",
      "Activated (other than ABS) warning device",
      "Brake fluid reservoir is less than 1/4 full",
    ],
  },
  {
    no: 19,
    label: "Lamps and reflectors",
    minorDefects: [
      "Required lamp does not function as intended",
      "Required reflector is missing or partially missing",
      "Passenger safety or access lamp does not function",
    ],
    majorDefects: [
      "When lamps are required: failure of both low-beam headlamps",
      "When lamps are required: failure of both rearmost tail lamps",
      "At all times: failure of a rearmost turn-indicator lamp",
      "At all times: failure of both rearmost brake lamps",
    ],
  },
  {
    no: 20,
    label: "Passenger compartment",
    minorDefects: [
      "Stanchion padding is damaged",
      "Damaged steps or floor",
      "Insecure or damaged overhead luggage rack or compartment",
    ],
    majorDefects: [
      "When affected position is occupied: malfunction or absence of required passenger or mobility device restraints",
      "When affected position is occupied: passenger seat is insecure",
    ],
  },
  {
    no: 21,
    label: "Steering",
    minorDefects: ["Steering wheel lash (free-play) greater than normal"],
    majorDefects: [
      "Steering wheel insecure, or does not respond normally",
      "Steering wheel lash (free-play) exceeds required limit",
    ],
  },
  {
    no: 22,
    label: "Suspension system",
    minorDefects: [
      "Air leak in air suspension system",
      "Broken spring leaf",
      "Suspension fastener loose, missing or broken",
    ],
    majorDefects: [
      "Air bag damaged (including patched, cut, bruised, cracked to braid), insecurely mounted or deflated",
      "Cracked or broken main spring leaf or more than 1 broken spring leaf",
      "Part of spring leaf or suspension missing, shifted out of place or in contact with another vehicle component",
      "Loose U-bolt",
    ],
  },
  {
    no: 23,
    label: "Tires",
    minorDefects: ["Damaged tread or sidewall of tire", "Tire leaking"],
    majorDefects: [
      "Flat tire",
      "Tire tread depth less than wear limit",
      "Tire in contact with another tire or any vehicle component other than mud-flap",
      "Tire marked \"Not for highway use\"",
      "Tire has exposed cords in tread or outer side wall area",
    ],
  },
  {
    no: 24,
    label: "Wheels, hubs and fasteners",
    minorDefects: ["Hub oil below minimum level (when fitted with sight glass)", "Leaking wheel seal"],
    majorDefects: [
      "Wheel has loose, missing or ineffective fastener",
      "Damaged, cracked or broken wheel, rim or attaching part",
      "Evidence of imminent wheel, hub or bearing failure",
    ],
  },
  {
    no: 25,
    label: "Windshield wiper/washer",
    minorDefects: [
      "Control or system malfunction",
      "Wiper blade damaged, missing or fails to adequately clear driver's field of vision",
    ],
    majorDefects: [
      "When necessary for prevailing weather: wiper or washer fails to adequately clear driver's field of vision in area swept by driver's side wiper",
    ],
  },
];

// NSC Standard 13, Schedule 3: Motor Coach Daily Inspection.
const SCHEDULE_3_ITEMS: ScheduleItem[] = [
  {
    no: 1,
    label: "Accessibility devices",
    minorDefects: ["Alarm fails to operate", "Equipment malfunctions", "Interlock system malfunctions"],
    majorDefects: [
      "Vehicle fails to return to normal level after \"kneeling\"",
      "Extendable lift, ramp or other passenger-loading device fails to retract",
    ],
  },
  {
    no: 2,
    label: "Air brake system",
    minorDefects: ["Audible air leak", "Slow air pressure build-up rate"],
    majorDefects: [
      "Any indication of brake adjustment problem",
      "Air loss rate exceeds prescribed limit",
      "Inoperative towing vehicle (tractor) protection system",
      "Low air warning system fails or system activated",
      "Inoperative service, parking or emergency brake",
    ],
  },
  {
    no: 3,
    label: "Coupling devices",
    minorDefects: ["Coupler or mounting has loose or missing fastener"],
    majorDefects: [
      "Coupler insecure or movement exceeds prescribed limit",
      "Coupling or locking mechanism damaged or fails to lock",
      "Defective, incorrect or missing safety chain/cable",
    ],
  },
  {
    no: 4,
    label: "Dangerous goods",
    minorDefects: [],
    majorDefects: ["Requirements of Transportation of Dangerous Goods Regulations not met"],
  },
  {
    no: 5,
    label: "Doors and emergency exits",
    minorDefects: ["Door, window or hatch fails to open or close securely", "Alarm inoperative"],
    majorDefects: ["Required emergency exit fails to function as intended"],
  },
  {
    no: 6,
    label: "Driver controls",
    minorDefects: [
      "Accelerator pedal, clutch, gauges, audible and visual indicators or instruments fail to function properly",
    ],
    majorDefects: ["Accelerator sticks and engine fails to return to idle"],
  },
  {
    no: 7,
    label: "Driver seat",
    minorDefects: ["Seat damaged or fails to remain in set position"],
    majorDefects: [],
  },
  {
    no: 8,
    label: "Emergency equipment and safety devices",
    minorDefects: ["Emergency equipment missing, damaged or defective"],
    majorDefects: [],
  },
  {
    no: 9,
    label: "Exhaust system",
    minorDefects: ["Exhaust leak"],
    majorDefects: ["Leak that causes exhaust gas to enter occupant compartment"],
  },
  {
    no: 10,
    label: "Exterior body",
    minorDefects: ["Insecure or missing body parts", "Insecure or missing compartment door"],
    majorDefects: [],
  },
  {
    no: 11,
    label: "Fuel system",
    minorDefects: [],
    majorDefects: ["Missing fuel tank cap", "Insecure fuel tank", "Dripping fuel leak"],
  },
  {
    no: 12,
    label: "General",
    minorDefects: [],
    majorDefects: ["Serious damage or deterioration that is noticeable and may affect vehicle's safe operation"],
  },
  {
    no: 13,
    label: "Glass and mirrors",
    minorDefects: [
      "Required mirror or window glass fails to provide required view to driver as a result of being cracked, broken, damaged, missing or maladjusted",
      "Broken or damaged attachments of required mirror or glass to vehicle body",
    ],
    majorDefects: ["Driver's view of road obstructed in area swept by windshield wipers"],
  },
  {
    no: 14,
    label: "Heater/defroster",
    minorDefects: ["Control or system failure"],
    majorDefects: ["Defroster fails to provide unobstructed view through windshield"],
  },
  {
    no: 15,
    label: "Horn",
    minorDefects: [],
    majorDefects: ["Vehicle has no operative horn"],
  },
  {
    no: 16,
    label: "Lamps and reflectors",
    minorDefects: [
      "Required lamp does not function as intended",
      "Passenger safety or access lamp does not function",
    ],
    majorDefects: [
      "When lamps are required: failure of both low-beam headlamps",
      "When lamps are required: failure of both rearmost tail lamps",
      "At all times: failure of rearmost turn-indicator lamp",
      "At all times: failure of both rearmost brake lamps",
    ],
  },
  {
    no: 17,
    label: "Passenger compartment",
    minorDefects: [
      "Stanchion padding damaged",
      "Damaged steps or floor",
      "Insecure or damaged overhead luggage rack or compartment",
      "Malfunction or absence of required passenger or mobility device restraints",
      "Passenger seat insecure",
    ],
    majorDefects: [
      "When affected position is occupied: malfunction or absence of required passenger or mobility device restraints",
      "When affected position is occupied: passenger seat insecure",
    ],
  },
  {
    no: 18,
    label: "Steering",
    minorDefects: ["Steering wheel lash (free-play) greater than normal"],
    majorDefects: [
      "Steering wheel insecure, or does not respond normally",
      "Steering wheel lash (free-play) exceeds required limit",
    ],
  },
  {
    no: 19,
    label: "Suspension system",
    minorDefects: ["Air leak in air suspension system"],
    majorDefects: ["Air bag damaged (patched, cut, bruised, cracked to braid), mounted insecurely or deflated"],
  },
  {
    no: 20,
    label: "Tires",
    minorDefects: [
      "Damaged tread or sidewall of tire",
      "Tire leaking (other than leak classified as major defect)",
    ],
    majorDefects: [
      "Flat tire or tire leak that can be felt or heard",
      "Tire tread depth less than wear limit",
      "Tire in contact with another tire or any vehicle component other than mud-flap",
      "Tire marked \"Not for highway use\"",
      "Tire has exposed cords in tread or outer side wall area",
    ],
  },
  {
    no: 21,
    label: "Wheels, hubs and fasteners",
    minorDefects: ["Hub oil below minimum level (when fitted with sight glass)", "Leaking wheel seal"],
    majorDefects: [
      "Wheel has loose, missing or ineffective fastener",
      "Damaged, cracked or broken wheel, rim or attaching part",
      "Evidence of imminent wheel, hub or bearing failure",
    ],
  },
  {
    no: 22,
    label: "Windshield wiper/washer",
    minorDefects: [
      "Control or system malfunction",
      "Wiper blade damaged, missing or fails to adequately clear driver's field of vision",
    ],
    majorDefects: [
      "When necessary for prevailing weather conditions: wiper or washer fails to adequately clear driver's field of vision in area swept by driver's side wiper",
    ],
  },
];

const SCHEDULES: Record<ScheduleNo, ScheduleDefinition> = {
  1: {
    scheduleNo: 1,
    title: "Truck, Tractor, or Trailer Daily Inspection",
    appliesTo: "Trucks, tractors, and trailers",
    isComplete: true,
    items: SCHEDULE_1_ITEMS,
  },
  2: {
    scheduleNo: 2,
    title: "Bus Daily Inspection",
    appliesTo: "Buses and trailers drawn by buses",
    isComplete: true,
    items: SCHEDULE_2_ITEMS,
  },
  3: {
    scheduleNo: 3,
    title: "Motor Coach Daily Inspection",
    appliesTo: "Motor coaches",
    isComplete: true,
    items: SCHEDULE_3_ITEMS,
  },
};

/** The full schedule definition for a schedule number. */
export function getSchedule(scheduleNo: ScheduleNo): ScheduleDefinition {
  return SCHEDULES[scheduleNo];
}

/** The inspection items for a schedule (empty for schedules not yet captured). */
export function scheduleItems(scheduleNo: ScheduleNo): ScheduleItem[] {
  return SCHEDULES[scheduleNo].items;
}
