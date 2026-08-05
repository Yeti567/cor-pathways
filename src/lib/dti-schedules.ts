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
  // What the driver physically does to inspect this item. The regulation lists
  // only what counts as a defect, which leaves an item like "Cab" reading as a
  // bare word next to a pass button. These are the checks behind the word, so a
  // driver declares work they actually did rather than clicking pass on a label.
  // Not regulation text: operational guidance built from the defect list.
  checks: string[];
};

export type ScheduleDefinition = {
  scheduleNo: ScheduleNo;
  title: string;
  appliesTo: string;
  // False while the item list is still a stub awaiting authoritative content.
  isComplete: boolean;
  items: ScheduleItem[];
};

// The checks behind each item label, keyed by the label itself because the same
// component is inspected the same way whether it is on a truck, a bus, or a motor
// coach. Attached to every schedule's items by withChecks() below, so a label that
// appears in two schedules cannot drift apart.
const ITEM_CHECKS: Record<string, string[]> = {
  "Accessibility devices": [
    "Cycle the lift, ramp, or kneeling system through its full travel and confirm it returns and stows",
    "Confirm the interlock holds the vehicle while the device is deployed",
    "Confirm the movement alarm sounds",
  ],
  "Air brake system": [
    "Build system pressure to governor cut-out and confirm the compressor cuts out at the correct pressure",
    "Run the leak-down test: engine off, brakes released, confirm the pressure drop stays inside the allowed rate, then apply and hold and confirm the applied drop is also inside limits",
    "Fan the pressure down and confirm the low-air warning light and buzzer come on before pressure falls below the warning threshold, and keep fanning to confirm the tractor protection valve and parking brakes apply",
    "Confirm the pushrod stroke on every brake is within its adjustment limit, and that slack adjusters and chambers are secure",
    "Drain the tanks and confirm no water or oil is carrying over",
    "Confirm the service, parking, and emergency brakes each hold",
  ],
  Cab: [
    "Open and close every occupant compartment door from inside and outside and confirm each latches securely",
    "Confirm the cab and sleeper doors, steps, and grab handles are secure and undamaged",
  ],
  "Cargo securement": [
    "Walk the load and confirm nothing has shifted",
    "Count the tiedowns against what the load needs and confirm each is rated, undamaged, and tensioned",
    "Confirm any required covering is the right type, secure, and not flapping",
  ],
  "Coupling devices": [
    "Confirm the fifth wheel or pintle is locked, with the jaws closed around the kingpin and the release handle stowed",
    "Confirm the mounting bolts and plate are tight, with no loose or missing fasteners and no cracks",
    "Tug test against the locked coupling and confirm it holds",
    "Confirm safety chains or cables are the right rating, attached, and undamaged",
    "Confirm air and electrical lines are connected, secure, and not chafing or stretched",
  ],
  "Dangerous goods": [
    "Confirm placards are correct for the load, in place on all required sides, and legible",
    "Confirm the shipping document is in the required location and matches the load",
    "Confirm the emergency response plan reference and any required equipment are on board",
  ],
  "Doors and emergency exits": [
    "Open and close each door, window, and hatch and confirm it latches securely",
    "Confirm every required emergency exit releases and its alarm sounds",
  ],
  "Driver controls": [
    "With the ignition on, confirm every warning light and telltale illuminates during the bulb check and then goes out as it should",
    "Confirm the air or oil pressure, temperature, voltage, and fuel gauges all read and are not stuck",
    "Confirm the accelerator returns freely to idle and the clutch and gear selector work normally",
    "Test every switch you rely on: lights, wipers, washers, heater, defroster, mirrors, and any auxiliary control",
  ],
  "Driver seat": [
    "Confirm the seat locks in position and does not slide or drop",
    "Confirm the seatbelt latches, retracts, and is not cut, frayed, or twisted, and that its anchors are secure",
  ],
  "Electric brake system": [
    "Confirm the wiring and connectors are secure and not chafed",
    "Confirm the breakaway device is connected and its battery is charged",
    "Confirm the brakes apply from the controller",
  ],
  "Emergency equipment and safety devices": [
    "Confirm the fire extinguisher is present, charged, in date, and secure",
    "Confirm the warning triangles or flares are present and complete",
    "Confirm the first aid kit and any spare fuses are present and complete",
  ],
  "Exhaust system": [
    "Confirm the system is secure, with no leaks at the manifold, joints, or muffler",
    "Confirm no exhaust is entering the cab or sleeper",
  ],
  "Exterior body": [
    "Walk the unit and confirm every body panel and compartment door is secure and closed",
  ],
  "Exterior body and frame": [
    "Walk the unit and confirm every body panel and compartment door is secure and closed",
    "Confirm no frame member is cracked, shifted, sagging, or collapsing",
  ],
  "Frame and cargo body": [
    "Walk both rails and confirm no frame member is cracked, shifted, sagging, or collapsing",
    "Confirm crossmembers, body mounts, and the deck or box are secure and undamaged",
  ],
  "Fuel system": [
    "Confirm the tanks and straps are secure",
    "Confirm the caps are present and sealed",
    "Look under the tanks and lines and confirm there is no dripping leak",
  ],
  General: [
    "Walk the whole unit and confirm nothing is damaged or deteriorated in a way that would affect safe operation",
  ],
  "Glass and mirrors": [
    "Confirm the windshield and windows are not cracked or discoloured in the driver's field of view",
    "Confirm every required mirror is present, undamaged, securely mounted, and adjusted to give the required view",
  ],
  "Heater/defroster": [
    "Run the defroster and confirm it clears the windshield",
    "Confirm the fan and temperature controls work through their range",
  ],
  Horn: ["Sound the horn and confirm it works"],
  "Hydraulic brake system": [
    "Confirm the reservoir is above the minimum mark and at least a quarter full",
    "Press and hold the pedal and confirm it does not fade or sink, and that there is adequate reserve travel",
    "Confirm the power assist works and no warning lamp stays on",
    "Look at the lines, hoses, and around each wheel and confirm there is no fluid leak",
    "Confirm the parking brake holds",
  ],
  "Lamps and reflectors": [
    "Walk around with the lights on and confirm the headlamps on low and high beam, tail lamps, brake lamps, turn indicators, hazards, clearance and marker lamps, and licence plate lamp all work",
    "Confirm every required reflector is present, clean, and undamaged",
  ],
  "Passenger compartment": [
    "Confirm the steps and floor are sound and the stanchion padding is intact",
    "Confirm the overhead racks and compartments are secure",
    "Confirm every occupied seat is secure and its restraints and mobility device restraints work",
  ],
  Steering: [
    "Turn the wheel and confirm free play is within limit and the front wheels respond immediately",
    "Confirm the steering wheel and column are secure",
    "Confirm the linkage, box, and power steering are secure with no leak or damage",
  ],
  Suspension: [
    "Confirm the air bags are inflated, undamaged, and securely mounted, and that the system is not leaking",
    "Confirm no spring leaf is cracked, broken, shifted, or missing",
    "Confirm the U-bolts, hangers, shackles, and torque rods are tight and undamaged",
  ],
  "Suspension system": [
    "Confirm the air bags are inflated, undamaged, and securely mounted, and that the system is not leaking",
    "Confirm no spring leaf is cracked, broken, shifted, or missing",
    "Confirm the U-bolts, hangers, shackles, and torque rods are tight and undamaged",
  ],
  Tires: [
    "Check the inflation pressure on every tire, including the inside duals, with a gauge; a thump does not read pressure and a flat inside dual is carried by its partner until that one fails too",
    "Confirm the tread depth on every tire is above the wear limit",
    "Confirm no tire has a cut, bulge, exposed cord, or sidewall damage, and that none is marked not for highway use",
    "Confirm no tire touches another tire or any part of the vehicle other than a mud flap",
  ],
  "Wheels, hubs and fasteners": [
    "Confirm the hub oil is above the minimum line in every sight glass and that the cap and seal are not leaking; a hub that runs out of oil seizes the bearing and the wheel can leave the vehicle",
    "Confirm every wheel nut is present and tight, and look for rust streaks, shiny threads, or a shifted nut as a sign one has been working loose",
    "Confirm no wheel, rim, or attaching part is cracked, bent, or broken",
    "Feel the hubs for excessive heat and look for grease or oil thrown onto the tire or backing plate",
  ],
  "Windshield wiper/washer": [
    "Run the wipers through every speed and confirm they clear the driver's field of view",
    "Confirm the blades are intact and the washer sprays and has fluid",
  ],
};

// Attach the checks to a schedule's items. An item with no entry gets an empty
// list rather than a wrong one, so a new item shows up as content to write.
function withChecks(items: Omit<ScheduleItem, "checks">[]): ScheduleItem[] {
  return items.map((item) => ({ ...item, checks: ITEM_CHECKS[item.label] ?? [] }));
}

// NSC Standard 13, Schedule 1: Truck, Tractor, or Trailer Daily Inspection.
const SCHEDULE_1_ITEMS: Omit<ScheduleItem, "checks">[] = [
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
const SCHEDULE_2_ITEMS: Omit<ScheduleItem, "checks">[] = [
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
const SCHEDULE_3_ITEMS: Omit<ScheduleItem, "checks">[] = [
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
    items: withChecks(SCHEDULE_1_ITEMS),
  },
  2: {
    scheduleNo: 2,
    title: "Bus Daily Inspection",
    appliesTo: "Buses and trailers drawn by buses",
    isComplete: true,
    items: withChecks(SCHEDULE_2_ITEMS),
  },
  3: {
    scheduleNo: 3,
    title: "Motor Coach Daily Inspection",
    appliesTo: "Motor coaches",
    isComplete: true,
    items: withChecks(SCHEDULE_3_ITEMS),
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
