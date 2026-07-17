# Hours of Service & ELD Integration — Research + Implementation Plan

Status: planning only (no code written). Registry 2 ("Hours of Service & Duty Status") is currently "Coming soon".
Last updated: 2026-05-31.

## 1. Key scoping finding: ELD is NOT mandatory for most Alberta-only carriers

Alberta's own ELD FAQ confirms the **federal ELD mandate (SOR/2005-313) exempts "all provincially regulated carriers."**
The mandate binds only **federally regulated** carriers (interprovincial / cross-border).

For a typical Alberta company (say a concrete contractor, mostly intra-provincial):
- Some trucks may run **certified ELDs** (federal operation or voluntary adoption).
- Many may legitimately run **paper logs** or non-certified e-logs and remain Alberta-HOS compliant.

**Design consequence:** the HOS module must NOT assume ELD. It supports two ingestion paths in parallel:
1. **Live ELD pull** (API) for connected drivers.
2. **Manual / document-slot logs** (existing pattern) for paper-log drivers.

This lets us build on the existing doc-slot HOS scaffolding and layer ELD on top, rather than replacing it.

## 2. Alberta NSC Hours of Service rules the engine must enforce

Per SOR/2005-313 (Alberta mirrors these for its HOS ruleset):
- **Duty statuses:** Off-duty, Sleeper berth, Driving, On-duty (not driving).
- **Daily limits:** 13 h driving max; 14 h on-duty max; no driving after 16 h elapsed from coming on duty; 10 h off-duty/day (8 consecutive + 2).
- **Cycles:** Cycle 1 = 70 h / 7 days; Cycle 2 = 120 h / 14 days (mandatory 24 h off after 70 h).
- **Cycle switching:** 36 consecutive h off to go 1->2; 72 consecutive h off to go 2->1.
- **Special cases (defer to later):** North of 60, oil-well service, team drivers differ. Do not hard-code single-driver assumptions.

These are pure, testable rules — same style as `src/lib/transport-registry.ts` `computeDeficiencies()`.

## 3. ELD API landscape — two paths

### Path A: Direct provider APIs (confirmed live)
| Provider | HOS API | Auth | Notes |
|----------|---------|------|-------|
| Geotab (MyGeotab) | `DutyStatusLog`, `DutyStatusAvailability` | Session (user/pwd/db) or API key | Canadian market leader; free API for customers |
| Samsara | `getHosLogs`, `getHosClocks`, `setCurrentDutyStatus` | API token or OAuth 2.0 (marketplace) | Clean REST, well documented |
| Motive (ex-KeepTruckin) | HOS / duty-status endpoints | API key / OAuth | Common in trades |
| Isaac Instruments | API | per-partner | Canadian, large operations |

Each is a separate integration to build and maintain.

### Path B: Universal aggregator API ("Plaid for ELDs") — recommended
- **Terminal** (withterminal.com): one API, normalized models that explicitly include **Hours of Service, Drivers, Vehicles, Safety Events**. 100+ integrations including the Canada-relevant ones (Geotab, Samsara, Motive, Isaac, Fleet Complete, BigRoad). Ships a drop-in "Connect" modal so the customer links their ELD account inside our app.
- Alternatives: **Axle**, My Fleet AI (S.A.F.E.), Fatigue Science Universal API.

**Recommendation:** aggregator-first for broad coverage in weeks, then add a **direct Geotab connector** later to cut cost on the highest-volume provider. Trade-off: per-connection subscription cost (sales-gated quote) and third-party dependency.

## 4. Architecture (fits the existing transport module)

```
ELD provider(s)
   |  (aggregator OR direct)
   v
[Connector layer]  src/lib/eld/*  — provider-agnostic interface
   |  normalize -> internal duty-status model
   v
[Sync engine]  /api/cron/eld-sync  +  optional webhooks
   |  upsert logs, recompute clocks/violations
   v
[Supabase]  hos_* tables (RLS via authz.*, subscription-gated)
   |
   v
[UI]  HOS registry page · driver-detail HOS panel · hub snapshot
```

Reuse existing patterns: `authz.*` RLS, `enforce_subscription_active`, subject-tenant-match triggers, request-cached context, and the **medical-vault encryption pattern** for ELD API tokens/OAuth secrets (service-role only, never sent to the client).

## 5. Data model (new Supabase tables)
- `eld_connection` — per tenant+provider: provider id, status, encrypted credentials/OAuth tokens, last_sync_at.
- `eld_driver_link` — maps provider driver id -> existing `transport_driver`.
- `hos_duty_status_event` — normalized status changes (driver, vehicle, status, start/end, source, location, origin: eld|manual|edit).
- `hos_daily_log` — per driver per day: driving/on-duty/off totals, cycle, certified flag, violations[].
- `hos_clock_snapshot` — latest drive/shift/cycle remaining for the live dashboard.
- `hos_violation` — type (13h, 14h, cycle, missing log), severity, timestamp, resolved.

All tenant-scoped, RLS-gated, subscription-enforced.

## 6. HOS compliance engine (pure, unit-tested)
`src/lib/hos-rules.ts`: Alberta cycle 1/2 limits, daily caps, the 16 h window, cycle resets/switches, plus `computeHosViolations(events, cycle)` and `computeAvailability(events)` returning drive/shift/cycle remaining. Pure functions + Vitest, same as `transport-registry.ts`. Runs on BOTH ELD-sourced and manually entered events, so paper-log drivers get the same checks.

## 7. UI
- **HOS registry card:** flip "Coming soon" -> "Available"; fleet-wide HOS dashboard (status, today's violations, missing/uncertified logs, near-limit drivers).
- **Driver detail HOS panel:** live clocks, daily log grid (24 h status graph), violations, "Connect ELD / enter manual log" by driver type.
- **Connection setup** under transport settings: aggregator Connect modal or direct-provider credentials, gated by `requireTransportManager`.
- **Hub snapshot:** add HOS violations / drivers-near-limit to the existing compliance snapshot.

## 8. Security, privacy, compliance
- ELD tokens encrypted at rest (pgsodium/vault), service-role-only, never exposed to the browser.
- Per-tenant isolation via `authz.*` RLS (reuse equipment/transport template).
- HOS logs are the legal record of duty status: treat ELD data as a read-mirror; record manual edits with an audit trail (certified-log annotation model), do not silently overwrite.
- Audit every connection, sync, and manual edit via `recordTenantAuditEvent`.

## 9. Phased build (slice methodology)
| Slice | Scope | Outcome |
|-------|-------|---------|
| 0 — Spike | Validate aggregator coverage + auth (Terminal/Axle sandbox) and a MyGeotab trial; confirm Canadian HOS fields | Go/no-go on aggregator vs direct |
| 1 | `hos-rules.ts` engine + tests; manual duty-status entry on driver detail; HOS card -> Available | Paper-log drivers fully supported, violations computed; value with zero ELD dependency |
| 2 | Data model + `eld_connection`/sync scaffolding; encrypted token storage | Foundation for live data |
| 3 | First connector (aggregator OR direct Geotab) + `/api/cron/eld-sync`; normalize -> `hos_duty_status_event` | Live logs flowing |
| 4 | Driver-detail HOS panel (clocks + daily grid) + hub snapshot | Operational dashboard |
| 5 | Connection UI (Connect modal), multi-provider, violation alerts in the reminder engine | Self-serve onboarding + proactive alerts |

Slices 0–1 deliver value immediately and de-risk the rest.

## 10. Effort, cost, risk
- **Effort:** ~6–10 focused slices; engine + manual path is small; connector + sync is the bulk.
- **Cost:** aggregators charge per connected vehicle/driver/month (Terminal/Axle pricing sales-gated — needs a quote). Direct Geotab API is free but only covers Geotab customers.
- **Risks:** aggregator per-seat cost at scale; ELD coverage gaps (validate slice 0); HOS edge cases (oil-well, north of 60, team) — scope explicitly; legal-record integrity (do not overwrite ELD data).

## 11. Recommended order
1. Save this plan (done).
2. Build slice 1 (rules engine + manual entry) — lowest-risk, additive, gated by `transport_enabled`, no external dependency or cost.
3. Run slice 0 spike in parallel to get an aggregator quote and confirm Canadian ELD coverage.
4. Only then proceed to slices 2–5 (live ELD), aggregator-first.

## Sources
- SOR/2005-313 Commercial Vehicle Drivers Hours of Service Regulations (laws-lois.justice.gc.ca)
- Alberta Federal ELD Mandate FAQ (alberta.ca) — provincially regulated carriers exempt
- Alberta HOS ruleset / Module 9 Cycles (transportation.alberta.ca; Geotab Alberta ruleset)
- Geotab Developers: DutyStatusLog, DutyStatusAvailability (developers.geotab.com)
- Samsara Developers: getHosLogs, getHosClocks, setCurrentDutyStatus, OAuth 2.0 (developers.samsara.com)
- Terminal — Universal API for Telematics & ELDs (withterminal.com)
