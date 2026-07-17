# Motive ELD data map

How each Motive OAuth scope maps onto our entities (driver, truck, trailer, company)
and our database. This is the plan for extending the integration; today only a fraction
is wired.

## What is wired today

- `src/lib/eld/motive.ts` + `motive-sync.ts` request scopes `users.read vehicles.read hos.read`
  but only call `/v1/users` (drivers) and `/v1/hos_logs` (duty status).
- Drivers are matched to `transport_driver` by **name only**, stored in `eld_driver_link`.
- Duty status lands in `transport_duty_status_event` (source `eld`).
- **No vehicle data is ingested. No `eld_vehicle_link` table. No `external_id` on driver or equipment.**

So before most scopes can land, we need vehicle/asset linking and a stronger matching key.

## Foundations (must come first)

1. **`eld_vehicle_link`** table, mirroring `eld_driver_link`:
   `(tenant_id, provider, external_vehicle_id, equipment_id)`, unique on
   `(tenant_id, provider, external_vehicle_id)`. Trailers are `equipment` too, so the same
   table links assets/trailers via `equipment_id`.
2. **Matching keys.** Vehicles match to `equipment` by VIN (`vin_or_serial`), then plate,
   then unit number. Drivers keep name-matching, add `license_number` as a fallback.
   Optionally store the raw Motive id as `external_id` on each record for display.
3. **Request the scopes.** Expand `MOTIVE_SCOPES` to cover vehicles, assets, inspections,
   safety, and dispatch reads (env-overridable, already supported).
4. **One sync pass per data set.** Extend `syncMotiveConnection` with a step per scope,
   each idempotent (dedupe by natural key like duty events already do).

## Scope to entity map

Legend for "Enabled": Y = checked in your screenshots, N = available but unchecked (worth turning on).

| Motive scope | Enabled | Goes to | Surfaces on | DB table (new unless noted) | Link key |
|---|---|---|---|---|---|
| Drivers and Fleet Managers | Y | Driver + manager | Driver file; Transport hub | `transport_driver` (existing) + `eld_driver_link`; manager ref on driver | name / licence |
| Driver Details | Y | Driver | Driver file header | `transport_driver` (existing): external id, contact, licence, status | name / licence |
| Drivers with Hours of Service | Y | Driver | Driver file HOS panel | `transport_duty_status_event` (existing) | driver link |
| HOS Logs | Y | Driver | Driver file HOS panel | `transport_duty_status_event` (existing) | driver link |
| Drivers with Available Time | Y | Driver | Driver file HOS clocks | `eld_driver_hos_status` (latest available drive/shift/cycle snapshot) | driver link |
| HOS Violations | Y | Driver | Driver file; hub snapshot | `transport_hos_violation` (Motive-authored, vs our computed) | driver link |
| Driver Performance | Y | Driver | Driver file scorecard | `eld_driver_performance` (period metrics) | driver link |
| Speeding Events | Y | Driver + vehicle | Driver file; truck file | `eld_safety_event` (type=speeding) | driver + vehicle link |
| Collision Report | Y | Driver + incident | Driver file; Collision registry / Incidents | `transport_collision` or extend Incidents | driver + vehicle link |
| Vehicles | Y | Truck/Trailer | Truck/Trailer file | `equipment` (existing) + `eld_vehicle_link` | VIN / plate / unit |
| ELDs | Y | Vehicle | Truck file (ELD device card) | `eld_device` (serial, model, firmware, vehicle) | vehicle link |
| ELD Disconnects | Y | Vehicle | Truck file; compliance alert | `eld_disconnect_event` | vehicle link |
| Trips | Y | Vehicle (+driver) | Truck file; auto-updates odometer | `eld_trip` (distance, start/end, locations) -> `equipment.current_meter` | vehicle + driver link |
| Inspection Reports (DVIR) | Y | Vehicle + trailer + driver | Truck/Trailer file; driver file | `eld_inspection` (defects feed maintenance/corrective actions) | vehicle + driver link |
| Geofence Asset Events | Y | Asset/trailer | Trailer file; fleet map | `eld_geofence_event` | vehicle/asset link |
| Dispatches | Y | Company (driver+vehicle+trailer) | New Dispatch view; hub | `eld_dispatch` + load lines | driver + vehicle link |
| OAuth Access Tokens | Y | Connection internals | (none, plumbing) | `eld_connection_secret` (existing) | n/a |
| Fault Codes | N (enable) | Vehicle | Truck file maintenance; alerts | `eld_fault_code` | vehicle link |
| Vehicles w/ Current Location & Driver | N (enable) | Vehicle | Truck file live status; fleet map | `eld_vehicle_status` (lat/lng, current driver) | vehicle + driver link |
| Assets / Asset Gateway Location History | N (optional) | Trailer/asset | Trailer file location/utilization | `eld_asset_location` | asset link |
| Scorecard Summary | N (optional) | Driver | Driver file scorecard | folds into `eld_driver_performance` | driver link |

## Where each file ends up richer

- **Driver file:** identity + manager (Driver Details, Drivers/Fleet Managers), live HOS clocks
  (Available Time), duty logs (HOS Logs), violations (HOS Violations), safety scorecard
  (Driver Performance, Speeding), collisions, and the DVIRs they submitted.
- **Truck file (equipment, vehicle):** the linked Motive vehicle, its ELD device and disconnect
  history, trips that auto-advance the odometer/meter, DVIR defects (feeding maintenance and the
  inspection-deficiency flow), fault codes and live location if enabled.
- **Trailer file (equipment, trailer):** the linked asset, geofence enter/exit events, DVIRs, and
  location history if asset scopes are enabled.
- **Company / fleet ("after that"):** dispatches/loads (driver + truck + trailer together), a fleet
  map from geofence and location events, and a fleet HOS/safety rollup on the Transport hub.

## Suggested build order (slices)

0. **Foundation (DONE):** `eld_vehicle_link` (migration `20260602160000`) + vehicle reconciliation
   (`/v1/vehicles` -> equipment by VIN, then plate, then unit, unique matches only),
   `normalizeMotiveVehicles` + `buildVehicleLinkMatches` (pure, tested), wired into
   `syncMotiveConnection` (returns `matchedVehicles`), and an "ELD linked (Motive)" badge on the
   truck/trailer file.
1. **Driver enrichment: DONE (scoped).** Driver Details + Drivers/Fleet Managers land in
   `eld_driver_profile` (migration `20260602190000`: contact, role, status, manager), parsed from the
   same `/v1/users` response (no extra call) via `normalizeMotiveDriverDetails` +
   `buildEldDriverProfileUpserts`, with an "ELD linked" badge and an "ELD driver details" card on the
   driver file. Available-time clocks and HOS violations were intentionally NOT duplicated: the driver
   file already computes both from the synced duty-status events. (If Motive's authoritative clocks /
   violations are wanted as a separate cross-check, that is a later add.)
2. **Vehicle telematics: DONE.** Trips -> odometer auto-update (migration `20260602170000` adds an
   `eld` meter source; `normalizeMotiveTrips` + pure `buildEldMeterReadings`, forward-only and
   idempotent; meter history shows source "ELD"). ELD device + disconnects + fault codes
   (migration `20260602180000`: `eld_device` state + generic `eld_vehicle_event` for
   `disconnect`/`fault_code`; `normalizeMotiveEldDevices`/`...EldDisconnects`/`...FaultCodes` +
   pure `buildEldDeviceUpserts`/`buildEldVehicleEventInserts`; best-effort fetches via
   `motiveGetSafe` so a disabled scope never fails the sync; an "ELD telematics" card on the truck
   file shows the device, recent disconnects, and fault codes). Fault Codes still needs the Motive
   scope enabled to return data.
3. **Safety: DONE.** Speeding Events + Collision Report land in a generic `eld_driver_event`
   (migration `20260602200000`: speeding | harsh_brake | harsh_accel | collision | other, driver +
   optional vehicle); Driver Performance/Scorecard lands in `eld_driver_performance` (upsert). Pure
   `buildEldDriverEventInserts` / `buildEldDriverPerformanceUpserts` + `normalizeMotiveSpeedingEvents`
   / `...Collisions` / `...DriverPerformance`; best-effort via `motiveGetSafe`. Driver file shows an
   "ELD safety" card (scorecard + recent events). Deeper Collision -> Incidents module integration is
   a later add.
4. **Assets/trailers:** Geofence Asset Events, optional Assets/location history -> trailer file +
   fleet map.
5. **Operations:** Inspection Reports (DVIR) -> truck/trailer/driver and the deficiency flow;
   Dispatches -> a new dispatch view.

## Notes

- Each new event table follows the duty-event pattern: `tenant_id`, the link to driver and/or
  equipment, the event payload, a `source`, and a natural-key dedupe so re-syncs are idempotent.
- Trips updating `equipment.current_meter` ties the ELD straight into the service-schedule engine,
  so meter-based maintenance warnings work without manual readings.
- DVIR defects should route through the existing inspection-deficiency flow (auto corrective action,
  out-of-service on confirmed major defects).
- Only ELDs certified in Canada feed this; Motive is certified.
