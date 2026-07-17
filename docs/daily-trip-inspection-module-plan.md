# Daily Trip Inspection (DVIR) Module: Multi-Province Plan

**Working name:** Daily Trip Inspection Checker (a.k.a. DVI / DVIR / "CVOR / NSC Daily Log Checker")
**Status:** PLANNED (research complete 2026-06-05)
**Packaging goal:** standalone, separately priced add-on. Must work without the full Transport module being enabled.
**Launch jurisdictions:** British Columbia, Alberta, Ontario. Engine built so other provinces drop in later.

**Locked decisions (2026-06-05):** (1) pricing is a **flat add-on per month** (single boolean entitlement, no metering); (2) built **fresh and standalone**, with NO dependency on the Transport module's existing Alberta inspection code. The new module owns its own inspection flow, defect routing, and out-of-service handling end to end. Where the existing Alberta automation has a proven pattern (corrective-action creation, out-of-service flag), we copy the pattern, not the coupling.

---

## 1. Why this exists (the demand thesis)

Every Canadian commercial carrier running vehicles over the provincial weight threshold must complete a written or electronic trip inspection every 24 hours, carry it in the cab, and keep the records for at least 6 months. Roadside enforcement (CVSE in BC, Alberta Transportation peace officers, MTO in Ontario) checks for it at scale houses and on patrol. Missing or invalid inspection reports lead to vehicles detained at roadside, fines, and demerit-style points on the carrier's safety record that can suspend or cancel the carrier's operating authority (CVOR in Ontario, Safety Fitness Certificate elsewhere).

The pain is real, recurring, daily, and identical across thousands of small fleets. That is exactly the shape of a sellable standalone module.

---

## 2. The regulatory baseline: NSC Standard 13

All three provinces build their trip-inspection law on the same national document: **National Safety Code Standard 13, Trip Inspections** (CCMTA). The shared rules:

- **Frequency:** a trip inspection report is required every 24 hours, even when no defect is found.
- **Validity:** a completed inspection is valid for 24 hours from completion.
- **Schedules (the checklist that defines what to inspect and what is a defect):**
  - **Schedule 1:** trucks, tractors, trailers (the common case, 23 inspection items).
  - **Schedule 2:** buses and trailers drawn by buses.
  - **Schedule 3:** motor coaches (adds long-haul items: climate control, restroom, intercom).
  - (Schedule 4 exists in some jurisdictions for specialized vehicles.)
- **Carry rule:** the driver must carry, in the cab, both the current inspection report AND the applicable inspection schedule (the list of items and defect definitions). Electronic copies are accepted.
- **Defect handling:**
  - **Minor defect:** record it on the report, notify the carrier, may keep driving; carrier repairs before the next inspection cycle.
  - **Major defect:** record it, notify the carrier, take the vehicle OUT OF SERVICE immediately. Driving with a major defect is prohibited.
- **En-route duty:** the driver must monitor the vehicle's condition throughout the trip and record any defect that appears while driving.
- **Retention:** the carrier keeps the original reports in chronological order, per vehicle, for at least 6 months.

Because the schedules are shared nationally, roughly 95% of the inspection checklist content is identical across BC, AB, and ON. The differences are in the wrapper: who must do it (weight thresholds), pre-trip vs pre + post-trip, exact report fields, retention routing, and the enforcement/penalty regime. That wrapper is what the province rule engine encodes.

---

## 3. Province-by-province matrix (the engine config)

| Dimension | British Columbia | Alberta | Ontario |
|---|---|---|---|
| Governing rule | Motor Vehicle Act Regs, Division 37 (37.60 / 37.61); adopts NSC Std 13 | Commercial Vehicle Safety Regulation; adopts NSC Std 13 | Highway Traffic Act, O. Reg. 199/07 (Commercial Motor Vehicle Inspections) |
| Enforcement body | CVSE (Commercial Vehicle Safety and Enforcement) | Alberta Transportation / peace officers | MTO; tracked under CVOR |
| Operator credential | NSC Safety Fitness Certificate | NSC Safety Fitness Certificate | **CVOR certificate** (Ontario-specific) |
| Weight threshold (trucks) | licensed GVW over **5,000 kg** + attached trailers | registered **11,794 kg** or more (verified: CVSR AR121/2009) + buses 11+ passengers | GVW/RGW over **4,500 kg** |
| Buses | written report required | included under NSC | Schedule 2 (buses) / Schedule 3 (motor coaches) |
| Pre vs post trip | **pre-trip AND post-trip** emphasized; multi-day trips re-checked no later than the first rest stop each subsequent day | daily pre-trip per Schedule 1; monitor en route | daily inspection within the prior 24h; monitor en route |
| Schedules used | NSC Schedule 1 / 2 / 3 | NSC Schedule 1 / 2 / 3 | O. Reg 199/07 Schedule 1 (trucks), Schedule 2 (buses), Schedule 3 (motor coaches) |
| Inspection valid for | 24 hours | 24 hours | 24 hours |
| Driver must carry | current report + applicable schedule | current report + complete Schedule (producible to peace officer) | current report + applicable schedule (electronic OK) |
| Report retention | carrier retains | driver to carrier within 20 days; carrier to head office within 30 days; keep 6 months chronological | carrier retains 6 months |
| Penalties (illustrative) | $311 fail to maintain / correct defect; $138 no report; can be detained for full Level 1 inspection if no valid Schedule 1 at scale | out of service for major defect; carrier safety-rating impact | $200 to $2,000 per offence (HTA); roadside out-of-service for Schedule 1 defect; **CVOR points**, possible CVOR suspension/cancellation |
| Voluntary bypass program | weigh-in-motion / AVI transponder bypass | Partners in Compliance (PIC) | weigh-station bypass for good ratings |

> All three launch thresholds are now verified against primary sources. Alberta's 11,794 kg figure is the documented-trip-inspection-report threshold under the Commercial Vehicle Safety Regulation AR121/2009 (the Registrar's Exemption under s.40(1) relieves vehicles registered for under 11,794 kg from preparing/carrying a report and carrying the schedule). Note that lighter regulated vehicles (4,501 to 11,793 kg) may still inspect; it is simply not legally required to be documented. BC 5,000 kg and Ontario 4,500 kg are confirmed in the cited sources.

**Key product implications from the matrix:**

1. A vehicle's province + weight + body type decides *whether* an inspection is required and *which schedule* applies. This is pure config; build it as a data-driven rule engine, not hardcoded per province.
2. Ontario needs a **CVOR number** field on the carrier profile; BC and Alberta need a **Safety Fitness Certificate number**. The "credential at risk" message in the UI differs by province.
3. BC needs an explicit **post-trip** inspection type, not just pre-trip.
4. The retention clock and routing differs (Alberta's 20-day / 30-day forwarding rule is the strictest); the app's record-keeping satisfies all three by simply storing immutably for 6 months or more and timestamping.

---

## 4. The inspection content: NSC Schedule 1 (trucks, tractors, trailers)

This is the exact 23-item checklist, with each item's ordinary defect (minor) and major defect criteria. This becomes the seed data for the Schedule 1 template. Schedule 2 (buses) and Schedule 3 (motor coaches) follow the same structure with added items and are seeded the same way.

| # | Item | Defect (minor) examples | Major defect examples |
|---|---|---|---|
| 1 | Air brake system | audible air leak; slow air pressure build-up | pushrod stroke exceeds adjustment limit; air loss over limit; inoperative tractor protection; low-air warning fails/active; inoperative service, parking or emergency brake |
| 2 | Cab | occupant door fails to open | cab or sleeper door fails to close securely |
| 3 | Cargo securement | insecure/improper load covering | insecure cargo; missing/failed/deteriorated securement device or load covering |
| 4 | Coupling devices | coupler/mounting has loose or missing fastener | coupler insecure or over tolerance; coupling/locking mechanism damaged or fails to lock; defective/incorrect/missing safety chain or cable |
| 5 | Dangerous goods | (none listed) | TDG Regulations requirements not met |
| 6 | Driver controls | accelerator, clutch, gauges, indicators fail to function | (escalates to general unsafe) |
| 7 | Driver seat | seat damaged or won't stay in position | seatbelt/tether insecure, missing or malfunctions |
| 8 | Electric brake system | loose/insecure wiring or connection | inoperative breakaway device; inoperative brake |
| 9 | Emergency equipment and safety devices | equipment missing, damaged or defective | (per requirement) |
| 10 | Exhaust system | exhaust leak | leak that lets exhaust gas enter the occupant compartment |
| 11 | Frame and cargo body | damaged frame or cargo body | visibly shifted, cracked, collapsing or sagging frame member(s) |
| 12 | Fuel system | missing fuel tank cap | insecure fuel tank; dripping fuel leak |
| 13 | General | (none) | serious damage/deterioration noticeable and may affect safe operation |
| 14 | Glass and mirrors | required mirror/glass cracked, broken, damaged, missing, maladjusted; broken attachments | (view obstruction escalates) |
| 15 | Heater/defroster | control or system failure | defroster fails to provide unobstructed view through windshield |
| 16 | Horn | (none) | vehicle has no operative horn |
| 17 | Hydraulic brake system | brake fluid below minimum | parking brake inoperative; no power assist; fluid leak; pedal fade/insufficient reserve; activated warning device; reservoir under 1/4 full |
| 18 | Lamps and reflectors | required lamp not working; reflector missing/partial | when lamps required: both low-beams or both rearmost tail lamps fail; at all times: rearmost turn-indicator fails, both rearmost brake lamps fail |
| 19 | Steering | steering free-play greater than normal | steering wheel insecure or won't respond normally; free-play exceeds limit |
| 20 | Suspension | air leak; broken spring leaf; loose/missing/broken fastener | damaged/deflated air bag; cracked/broken main leaf or more than 1 broken leaf; spring/suspension part missing or shifted; loose U-bolt |
| 21 | Tires | damaged tread or sidewall; tire leaking | flat tire / audible or felt leak; tread below wear limit; tire contacting another tire or component; marked "Not for highway use"; exposed cords |
| 22 | Wheels, hubs and fasteners | hub oil below minimum (sight glass) | loose/missing/ineffective fastener; damaged/cracked/broken wheel or rim; imminent wheel/hub/bearing failure; leaking wheel seal |
| 23 | Windshield wiper/washer | control malfunction; wiper blade damaged/missing | (in prevailing weather) wiper/washer fails to clear the driver's side swept area |

Source of truth: NSC Standard 13 Schedule 1 (CCMTA), as published by provincial transport ministries. Ontario's O. Reg 199/07 Schedule 1 is congruent with this list; we tag each seeded item with the matching regulatory citation per province so a printed report can cite the right authority.

---

## 5. Product scope

### 5.1 Driver flow (mobile-first, works offline)
1. Driver opens the app, selects the vehicle (and trailer, if any) from the existing Equipment fleet.
2. **Province dropdown** (Alberta / Ontario / British Columbia) pre-filled with the carrier's default province. The selected province drives everything downstream: threshold, schedule, inspection types, report fields, printout citation, and the credential named in any warning. A driver crossing a border changes the dropdown and the correct rules load. The app then serves the correct schedule (1 / 2 / 3) for the body type.
3. Inspection type: pre-trip (all provinces) or post-trip (required emphasis in BC; available everywhere).
4. Walkthrough checklist: each of the applicable items, marked Pass / Minor defect / Major defect, with optional photo and note per defect.
5. Odometer / hubometer capture (reuses the existing meter-reading + requireMeter pattern already in the app).
6. Driver declaration + signature.
7. On submit:
   - **No defects:** a clean dated report is stored and becomes the valid-for-24h record.
   - **Minor defect:** report stored; the module opens its own corrective action routed to the maintenance owner (same pattern as the existing Alberta automation, but self-contained in this module).
   - **Major defect:** report stored; the vehicle is flagged OUT OF SERVICE by this module and removed from the available-to-dispatch list until cleared (own out-of-service handling, not the Transport module's).
8. The completed report + the schedule are available offline in the cab as the carry documents.

### 5.2 Admin / carrier flow
- **Compliance dashboard:** which vehicles have a valid (within 24h) inspection right now, which are stale, which are out of service, open defects by severity and age.
- **Province rule view:** see, per vehicle, which province rule applies, which schedule, the threshold logic, and the credential at risk (CVOR vs SFC).
- **Records vault:** immutable chronological store per vehicle, 6-month minimum retention, exportable for an audit or a roadside request.
- **Printable / PDF report:** matches the regulator-expected fields and cites the right authority per province (reuses the existing print-report footer + numbering settings).
- **Reminders:** "no valid inspection logged today" nudge to driver and manager (reuses the certification-reminders cron).

### 5.3 The province rule engine (the differentiator)
**Selection UX:** a province dropdown (Alberta / Ontario / British Columbia) is the single control that activates a jurisdiction's ruleset. It exists in two places: a carrier **default province** in module settings (set once), and a **per-inspection override** on the driver screen pre-filled from that default (for interprovincial trips). The dropdown is data-driven from the engine's province list, so adding Saskatchewan later is a config entry, not a UI change.

A pure, tested config module (mirrors the existing `src/lib/transport-registry.ts` and `src/lib/hos-rules.ts` pattern: rules in code, not a DB table, with optional tenant override later). It answers:
- `isInspectionRequired(vehicle, province) -> bool` (weight threshold + body type).
- `applicableSchedule(vehicle, province) -> 1 | 2 | 3`.
- `requiredInspectionTypes(province) -> ['pre'] | ['pre','post']`.
- `validityHours(province) -> 24`.
- `carryDocuments(province) -> ['current_report','schedule']`.
- `retention(province) -> { months: 6, forwarding?: {driverDays:20, headOfficeDays:30} }`.
- `credentialAtRisk(province) -> 'CVOR' | 'SFC'`.
- `reportFields(province)` and `citation(scheduleItem, province)` for the printout.

---

## 6. Data model (new tables, all tenant-scoped, RLS via authz.*)

- `dti_inspection` (header): tenant_id, equipment_id (vehicle), trailer_equipment_id (nullable), driver_user_id, province, schedule_no, inspection_type (pre/post), odometer, location, started_at, completed_at, overall_result (clean/minor/major), valid_until (completed_at + 24h), signature, source (app/offline/import). Immutable after submit.
- `dti_inspection_item`: inspection_id, item_no, item_label, status (pass/minor/major), note, photo_path.
- Schedule 1/2/3 inspection content lives in CODE (`src/lib/dti-schedules.ts`), not a seeded table, matching this codebase's convention for standard reference catalogues (the Transport module keeps its requirement catalogue in `src/lib/transport-registry.ts` by explicit decision). Per-province citation is computed by the rule engine's `scheduleCitation()`. Tenant-level schedule overrides remain a post-foundation item; if they land, they become a small override table layered over this code baseline.
- Reuse existing: Equipment (vehicles/trailers), corrective actions / inspection-defect automation, out-of-service flag, meter logs, tenant-documents storage, notifications/cron.
- Carrier profile additions: `default_inspection_province` (drives the dropdown default), `cvor_number` (Ontario), reuse existing `safety_fitness_cert_number` (BC/AB). The chosen province is also stamped on every `dti_inspection` row so each report is self-describing for an audit.

Follows the established migration + `apply_migration` MCP workflow; toggle column mirrors `change_orders_module_toggle` / `transport_enabled`.

---

## 7. Packaging and pricing (standalone)

This module is sold **independently of the Transport module**. It needs only core (Equipment + Workers), which every tenant has.

- **Entitlement:** new tenant toggle `daily_inspection_enabled`, gated by its own plan entitlement (separate from `transport_enabled`), so it can be sold a la carte. Reuse the `tenant_plan` + `enforce_subscription_active` machinery.
- **Price model (LOCKED): flat add-on per month.** A fixed monthly price per tenant regardless of fleet or crew size. Simplest to sell and explain, predictable for the customer. Entitlement is a single boolean, no per-seat or per-vehicle metering needed.
- **Positioning hooks:** "Never get detained at a scale again." "One tap, every truck, every province." "Audit-ready records for 6 months, automatically." Avoid promising legal compliance; promise the tool that makes compliance easy (see disclaimers).
- **Upsell path:** DTI is the cheap, daily-habit wedge; Transport (DQ files, HOS, ELD, COR audit) is the upsell once they trust the daily flow.

---

## 8. Build slices (foundation first, mirrors prior module cadence)

1. **Toggle + entitlement.** ✅ BUILT (not yet applied/committed). `daily_inspection_enabled` tenant column (migration `20260605180000_daily_inspection_module_toggle.sql`), `daily_inspection` Pro-tier feature in `entitlements.ts`, `updateDailyInspectionSetting` action (requireFormManager + guardFeature), Setup module card, nav entry ("Trip Inspections"), a placeholder module home at `/admin/daily-inspection`, and tests (entitlements + access-matrix). tsc + 502 tests + build all green. PENDING: apply migration via Supabase MCP, then commit/push.
2. **Province rule engine.** `src/lib/dti-rules.ts`, pure + unit tested, with BC/AB/ON config. No UI.
3. **Schedule content.** `src/lib/dti-schedules.ts` (code, not a table): full NSC Schedule 1 (23 items, exact minor/major defect text); Schedule 2/3 defined but flagged incomplete until their item lists are pulled. Unit tested.
4. **Driver inspection flow.** Vehicle pick, province/schedule resolution, checklist, meter, signature, submit; clean/minor/major branching with the module's own corrective-action + out-of-service handling (self-contained).
5. **Records vault + printable report.** Immutable store, 6-month retention, province-correct PDF, roadside/export view.
6. **Admin compliance dashboard + reminders.** Valid/stale/out-of-service board; "no inspection today" cron nudges.
7. **Post-foundation:** Schedule 2/3 full content; offline-first cab copy; tenant-level schedule overrides; additional provinces (SK, MB, NS, QC).

After each slice: tsc + `npm test` + `npm run build`, then wait for your go-ahead to commit (main auto-deploys to prod; migrations applied via Supabase MCP).

---

## 9. Compliance disclaimer (important)

The module is a record-keeping and workflow tool. It helps carriers create, carry, and retain NSC-style trip inspection reports and routes defects correctly. It does not replace the driver's legal judgment, the regulation text, or a peace officer's authority. The seeded schedules and thresholds must be reviewed against current provincial regulation before go-live and re-checked periodically, because thresholds, penalty amounts, and schedule wording change. Surface a short in-app "this is a tool, you remain responsible for compliance" notice and keep a per-province "schedule last reviewed" date.

---

## 10. Sources

- NSC Standard 13 (CCMTA): https://www.ccmta.ca/web/default/files/PDF/Standard_13_March_2009.pdf and Schedule 1 item list (Nova Scotia Transportation copy): https://novascotia.ca/tran/trucking/Schedule%201%20Truck,%20Tractor,%20or%20Trailer%20Daily%20Inspections.pdf
- NSC Standard 13 compliance guide (schedules, retention, provincial differences): https://pti4you.com/blog/articles/canadian-nsc-standard-13-compliance-guide
- J. J. Keller, Daily Trip Inspection (Canada) and per-province pages: https://jjkellercompliancenetwork.com/regsense/daily-trip-inspection-pre-trip-canada
- Alberta sample safety and maintenance program / Schedule 1 retention: https://www.alberta.ca/system/files/custom_downloaded_images/tr-sample-safety-provincial-truck-tractor-trailer.pdf
- Ontario O. Reg 199/07 (CanLII): https://www.canlii.org/en/on/laws/regu/o-reg-199-07/latest/o-reg-199-07.html and MTO truck handbook daily trip inspection: https://www.ontario.ca/document/official-ministry-transportation-mto-truck-handbook/daily-trip-inspection-classes-and-d
- Ontario CVOR requirements / penalties: https://compliancelettering.ca/guides/cvor-requirements-ontario/
- BC trip inspection report standards (DriveSmartBC) and CVSE NSC course: https://www.drivesmartbc.ca/commercial-vehicles/trip-inspection-report-standards and https://www.cvse.ca/national_safety_code.htm
