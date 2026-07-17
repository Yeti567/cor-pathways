# Provincial Hours of Service monitoring (no ELD)

How to monitor hours of service and equipment for provincially regulated carriers
whose drivers do not use ELDs and keep paper records. Targets Alberta intraprovincial
carriers (the app's focus). This is the plan; build it in slices.

## The problem

Half of the client base is provincially regulated and does not run ELDs. Two gaps:

1. **The HOS engine only models federal limits.** `src/lib/hos-rules.ts` is source-agnostic
   (ELD and paper drivers run through the same calculator) but hardcodes the federal ruleset, so
   a provincial driver is measured against the wrong limits and flagged incorrectly.
2. **There is no non-ELD way to capture duty hours.** Drivers fill paper logs (or, under the
   160 km exemption, just keep time records). We need a digital capture path that feeds the engine.

Equipment monitoring is already largely covered: the mandatory pre-trip odometer (built earlier)
updates the unit's `current_meter`, which drives the service schedule. The gap is HOS.

## Regulatory findings (verified)

Sources: Alberta Drivers' Hours of Service Regulation **AR 317/2002** (CanLII); Alberta
"Commercial Vehicle Safety Compliance" Module 8 (Provincial HOS) and the carrier-training Module 3;
Transport Canada HOS Application Guide; CCMTA HoS Application Guide (federal SOR/2005-313).

### Federal (interprovincial) vs Alberta provincial (intraprovincial)

| Rule | Federal (SOR/2005-313) | Alberta provincial (AR 317/2002) |
|---|---|---|
| Max driving / day | 13 h | 13 h |
| On-duty limit | 14 h on-duty in the shift | **no driving after 15 consecutive hours on duty** |
| Elapsed window | 16 h | **none** |
| Min off-duty | 10 h (8 consecutive + 2) | **8 consecutive hours** |
| Cumulative cycle | Cycle 1 = 70 h / 7 days, Cycle 2 = 120 h / 14 days | **none** (no weekly/cycle limit) |

So Alberta provincial is **simpler**: 13 h driving, stop driving at 15 h on duty, 8 h off to reset.
No window, no cycle. A provincial driver legally working a 15 h shift is wrongly flagged today.

### The 160 km radius exemption (the common case)

A **daily log is not required** when all hold (AR 317/2002):
- the driver does not operate beyond **160 km from the home terminal**,
- the work shift does not exceed **15 hours** and the driver starts/ends at the home terminal, and
- the carrier keeps **accurate time records for 6 months**.

The carrier's required record is light: the time the driver **reports to work** and the time
**released from work** (per day), retained 6 months. Alberta's training also lists: date and driver
name, start/end location, cycle, start/end times per duty status, and 14-day on/off-duty totals.

### Daily log (record of duty status) fields, for drivers beyond 160 km

Driver name, date, co-drivers, day start time, cycle, **starting odometer**, prior-14-day totals,
unit number, carrier name, home-terminal and business addresses, plus the duty-status grid.

## Build plan (slices)

1. **Provincial ruleset in the engine (foundation). DONE.** `hos-rules.ts` is parameterized by
   `HosRegime` (`federal` | `provincial_ab`) via `HOS_RULESETS`; `computeHosViolations` /
   `computeAvailability` take an optional regime (default federal, so existing behaviour is unchanged)
   and skip the elapsed-window and cycle checks for provincial. `transport_driver.hos_regime`
   (migration `20260602210000`) selects it; the regime is threaded through the driver file, HOS
   dashboard, hub, and reminders; the driver file has a Regime selector (and hides the Cycle selector
   plus the window/cycle clocks for provincial drivers). Pure + tested.

   Original scope: Parameterize `hos-rules.ts` by jurisdiction:
   a `federal` ruleset (unchanged behaviour) and a `provincial_ab` ruleset (13 h drive, 15 h on-duty,
   no window, no cycle, 8 h off). Add `hos_regime` to the driver; thread the regime through every
   `computeHosViolations` / `computeAvailability` call site; the driver file lets you pick the regime
   and hides the window/cycle clocks for provincial drivers. Pure and fully tested.
2. **160 km local-driver time record. DONE.** Captured as the driver's on-duty span: a "Log local
   day (160 km exemption)" form on the driver file takes the report time and release time (plus
   start/end location) and writes an `on_duty` event at report and an `off_duty` event at release,
   labelled `source = time_record` (migration `20260602220000`). Pure `buildTimeRecordEvents` builds
   and validates the pair. Because these are duty-status events, the day flows through the HOS engine,
   the dashboard, and the reminders with no extra threading, and the events are the retained record.

   Original scope: A lightweight daily entry: report time, release time,
   start/end location, cycle, daily on/off-duty totals. Satisfies the exemption's record-keeping
   (6-month retention) and feeds the hours math. Highest coverage for least effort.
3. **Structured in-app daily log. DONE (admin view).** A "Daily log" panel on the driver file groups
   the captured duty events into a per-day record of duty status: a pure, tested `buildDailyLog`
   splits segments at midnight and totals Off / Sleeper / Driving / On-duty per calendar day, rendered
   with a 24 h status strip and a legend. Entry uses the existing per-event and 160 km day forms. Still
   to do (Slice 3b): a multi-segment day-entry UX. (UTC day bucketing for now; tenant-timezone is a
   refinement.) Worker-app self-logging DONE: a "My hours" panel on the worker app
   (`WorkerHosPanel`) lets a worker whose account is linked to a `transport_driver` tap their current
   duty status and see their remaining hours (provincial-aware), via the `logMyDutyStatus` action
   (self only, online). The status change writes a duty event, so it flows through the same engine.

   Original scope: Driver records duty-status changes (or segment times) on their
   phone; writes `transport_duty_status_event` rows, which the engine already consumes. For drivers
   beyond 160 km. No OCR risk.
4. **Photo + AI extraction (assist). DONE.** On the driver file, "Scan a paper log (AI assist)"
   uploads a photo to `/api/transport/hos-ocr`, which sends it to the OpenRouter vision model
   (`OPENROUTER_HOS_OCR_MODEL`, falling back to the form-import model) and returns proposed duty
   segments via the pure, tested `parseDutyLogSegments`. The `HosLogScan` client component shows the
   proposal as editable rows that the manager MUST review/correct before `saveDutyLogSegments` writes
   them as duty events (`source = ocr`, migration `20260602230000`). Degrades gracefully when the
   provider is not configured. Times are normalized to UTC (tenant-timezone is a refinement); never
   auto-saves.

   Original scope: Driver photographs a paper log; Gemini vision (existing
   Document AI + Gemini infra) pre-fills the duty segments/totals; the driver **must review and
   confirm** before save. Never the source of truth for compliance. Handwriting + graph grids are
   unreliable, so confirmation is mandatory; the 160 km time record is far more OCR-friendly than a
   full grid.

## Notes

- Alberta only for now (matches the module's scope). Other provinces have their own intraprovincial
  rules; the ruleset structure makes adding them a data change.
- The engine stays source-agnostic, so ELD-fed and paper/manual drivers share one calculator.
- **Tenant timezone DONE.** `src/lib/timezone.ts` provides DST-aware Intl helpers; `buildDailyLog`
  buckets days by the tenant's local midnight and the OCR parser resolves `HH:MM` log times in the
  tenant zone (both read `company_settings.timezone`). Falls back to UTC when no zone is set.
