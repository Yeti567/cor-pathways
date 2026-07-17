import { describe, expect, it } from "vitest";
import {
  buildVisitorRoster,
  buildVisitorRosterCsv,
  formatVisitorRosterDuration,
  type VisitorRosterLocation,
  type VisitorRosterVisitor,
  type VisitorRosterWorker,
} from "@/lib/visitor-roster";

const locations: VisitorRosterLocation[] = [
  { code: "YARD", id: "location-yard", name: "Main Yard" },
  { code: "SHOP", id: "location-shop", name: "Shop" },
];

function visitor(input: Partial<VisitorRosterVisitor> & Pick<VisitorRosterVisitor, "id" | "location_id" | "signed_in_at">): VisitorRosterVisitor {
  return {
    full_name: "Visitor Name",
    organization: null,
    signed_out_at: null,
    visit_reason: "Site meeting",
    ...input,
  };
}

function worker(input: Partial<VisitorRosterWorker> & Pick<VisitorRosterWorker, "id" | "location_id" | "signed_in_at" | "worker_user_id">): VisitorRosterWorker {
  return {
    note: null,
    signed_out_at: null,
    worker_email: "worker@example.com",
    worker_full_name: "Worker Name",
    ...input,
  };
}

describe("visitor roster helpers", () => {
  it("groups active visitors by location and keeps empty muster locations visible", () => {
    const roster = buildVisitorRoster({
      locations,
      now: new Date("2026-05-24T13:00:00.000Z"),
      visitors: [
        visitor({ full_name: "New Visitor", id: "new", location_id: "location-yard", signed_in_at: "2026-05-24T12:30:00.000Z" }),
        visitor({ full_name: "Old Visitor", id: "old", location_id: "location-yard", signed_in_at: "2026-05-24T10:00:00.000Z" }),
        visitor({
          id: "closed",
          location_id: "location-shop",
          signed_in_at: "2026-05-24T09:00:00.000Z",
          signed_out_at: "2026-05-24T10:00:00.000Z",
        }),
        visitor({ full_name: "Unknown Visitor", id: "unknown", location_id: "missing-location", signed_in_at: "2026-05-24T11:00:00.000Z" }),
      ],
    });

    expect(roster.totalVisitors).toBe(3);
    expect(roster.occupiedLocationCount).toBe(2);
    expect(roster.groups.map((group) => group.locationName)).toEqual(["Main Yard", "Shop", "Unknown location"]);
    expect(roster.groups[0].visitors.map((entry) => entry.id)).toEqual(["old", "new"]);
    expect(roster.groups[0].visitors[0].durationLabel).toBe("3 hrs");
    expect(roster.groups[1].visitors).toEqual([]);
  });

  it("filters the roster to one location", () => {
    const roster = buildVisitorRoster({
      locationId: "location-shop",
      locations,
      now: new Date("2026-05-24T13:00:00.000Z"),
      visitors: [
        visitor({ id: "yard", location_id: "location-yard", signed_in_at: "2026-05-24T12:30:00.000Z" }),
        visitor({ id: "shop", location_id: "location-shop", signed_in_at: "2026-05-24T12:00:00.000Z" }),
      ],
    });

    expect(roster.selectedLocation?.name).toBe("Shop");
    expect(roster.totalVisitors).toBe(1);
    expect(roster.groups).toHaveLength(1);
    expect(roster.groups[0].visitors[0].id).toBe("shop");
  });

  it("groups active workers with visitors for emergency mustering", () => {
    const roster = buildVisitorRoster({
      locations,
      now: new Date("2026-05-24T13:00:00.000Z"),
      visitors: [
        visitor({ id: "visitor-1", location_id: "location-yard", signed_in_at: "2026-05-24T12:00:00.000Z" }),
      ],
      workers: [
        worker({
          id: "presence-1",
          location_id: "location-yard",
          note: "Morning shift",
          signed_in_at: "2026-05-24T11:30:00.000Z",
          worker_full_name: "Alex Worker",
          worker_user_id: "worker-1",
        }),
        worker({
          id: "presence-closed",
          location_id: "location-shop",
          signed_in_at: "2026-05-24T09:00:00.000Z",
          signed_out_at: "2026-05-24T10:00:00.000Z",
          worker_user_id: "worker-2",
        }),
      ],
    });

    expect(roster.totalVisitors).toBe(1);
    expect(roster.totalWorkers).toBe(1);
    expect(roster.totalPeople).toBe(2);
    expect(roster.occupiedLocationCount).toBe(1);
    expect(roster.groups[0].workers.map((entry) => entry.worker_full_name)).toEqual(["Alex Worker"]);
    expect(roster.groups[0].workers[0].durationLabel).toBe("1 hr 30 mins");
  });

  it("formats multi-day visitor durations", () => {
    expect(formatVisitorRosterDuration("2026-05-22T10:00:00.000Z", new Date("2026-05-24T13:30:00.000Z"))).toBe(
      "2 days 3 hrs",
    );
  });

  it("exports a CSV roster with escaped visitor fields", () => {
    const roster = buildVisitorRoster({
      locations,
      now: new Date("2026-05-24T13:00:00.000Z"),
      visitors: [
        visitor({
          full_name: "Riley, Inspector",
          id: "visitor-1",
          location_id: "location-yard",
          organization: "Core \"Partner\"",
          signed_in_at: "2026-05-24T12:00:00.000Z",
          visit_reason: "Audit\nwalkthrough",
        }),
      ],
    });

    expect(
      buildVisitorRosterCsv({
        generatedAt: new Date("2026-05-24T13:00:00.000Z"),
        groups: roster.groups,
        tenantName: "Acme Construction",
      }),
    ).toContain('Visitor,"Riley, Inspector","Core ""Partner""",Audit walkthrough');
  });
});
