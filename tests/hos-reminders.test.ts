import { describe, expect, it } from "vitest";
import { buildHosViolationNotifications } from "@/lib/hos-reminders";
import type { DutyStatusEvent } from "@/lib/hos-rules";

const HOUR = 3_600_000;
const BASE = Date.parse("2026-05-01T00:00:00.000Z");

function at(hours: number): string {
  return new Date(BASE + hours * HOUR).toISOString();
}

const manager = {
  id: "mgr-1",
  full_name: "Morgan Manager",
  email: "morgan@example.com",
  active: true,
  power_level: "manager" as const,
  app_access: "admin_access" as const,
};

const linkedUser = {
  id: "user-driver",
  full_name: "Jordan Lee",
  email: "jordan@example.com",
  active: true,
  power_level: "worker" as const,
  app_access: "app_access" as const,
};

const driver = {
  id: "driver-1",
  full_name: "Jordan Lee",
  user_id: "user-driver",
  hos_cycle: "cycle_1" as const,
  hos_regime: "federal" as const,
};

function build(events: DutyStatusEvent[], now: Date) {
  return buildHosViolationNotifications({
    createdAt: now.toISOString(),
    drivers: [driver],
    eventsByDriver: new Map([[driver.id, events]]),
    now,
    tenantId: "tenant-1",
    users: [manager, linkedUser],
  });
}

describe("buildHosViolationNotifications", () => {
  it("notifies the manager and the linked driver of a driving-limit breach", () => {
    // 14 h driving in one shift exceeds the 13 h daily limit.
    const events: DutyStatusEvent[] = [{ status: "driving", startedAt: at(0) }];
    const notifications = build(events, new Date(BASE + 14 * HOUR));

    expect(notifications).toHaveLength(2);
    expect(notifications.map((n) => n.recipient_type).sort()).toEqual(["transport_driver", "transport_manager"]);
    expect(notifications.every((n) => n.title?.includes("2026-05-01"))).toBe(true);
    expect(notifications.every((n) => n.title?.includes("Jordan Lee"))).toBe(true);
    expect(notifications[0].body).toContain("13-hour daily driving limit");
  });

  it("emits nothing for a compliant driver", () => {
    const events: DutyStatusEvent[] = [
      { status: "driving", startedAt: at(0) },
      { status: "off_duty", startedAt: at(8) },
    ];
    expect(build(events, new Date(BASE + 10 * HOUR))).toEqual([]);
  });

  it("emits nothing for a driver with no logged events", () => {
    expect(build([], new Date(BASE + 10 * HOUR))).toEqual([]);
  });

  it("notifies managers only when the driver has no linked worker account", () => {
    const notifications = buildHosViolationNotifications({
      createdAt: new Date(BASE + 14 * HOUR).toISOString(),
      drivers: [{ ...driver, user_id: null }],
      eventsByDriver: new Map([[driver.id, [{ status: "driving", startedAt: at(0) }]]]),
      now: new Date(BASE + 14 * HOUR),
      tenantId: "tenant-1",
      users: [manager, linkedUser],
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0].recipient_type).toBe("transport_manager");
  });

  it("raises distinct alerts for two different violation types", () => {
    // Long single shift: 20 h driving breaches both the 13 h driving limit and
    // the 14 h on-duty limit (and the 16 h window).
    const events: DutyStatusEvent[] = [{ status: "driving", startedAt: at(0) }];
    const notifications = build(events, new Date(BASE + 20 * HOUR));
    const managerTitles = notifications
      .filter((n) => n.recipient_type === "transport_manager")
      .map((n) => n.title);

    expect(new Set(managerTitles).size).toBeGreaterThanOrEqual(2);
  });
});
