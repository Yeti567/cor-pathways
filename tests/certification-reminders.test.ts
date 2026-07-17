import { describe, expect, it } from "vitest";
import { buildCertificationDeficiencySummaries, buildCertificationReminderNotifications } from "@/lib/certification-reminders";
import type { Database } from "@/types/database";

type Certification = Pick<
  Database["public"]["Tables"]["certifications"]["Row"],
  "expires_on" | "id" | "name" | "tenant_id" | "worker_profile_id"
>;
type Profile = Pick<Database["public"]["Tables"]["worker_profiles"]["Row"], "id" | "title" | "user_id">;
type User = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;

const worker: User = {
  active: true,
  app_access: "app_access",
  email: "worker@example.com",
  full_name: "Wendy Worker",
  id: "worker-1",
  power_level: "worker",
};

const manager: User = {
  active: true,
  app_access: "admin_access",
  email: "manager@example.com",
  full_name: "Manny Manager",
  id: "manager-1",
  power_level: "manager",
};

const profile: Profile = {
  id: "profile-1",
  title: "Operator",
  user_id: worker.id,
};

function certification(expiresOn: string): Certification {
  return {
    expires_on: expiresOn,
    id: `cert-${expiresOn}`,
    name: "First Aid",
    tenant_id: "tenant-1",
    worker_profile_id: profile.id,
  };
}

describe("certification reminders", () => {
  it("sends 30 day reminders only to the worker", () => {
    const notifications = buildCertificationReminderNotifications({
      certifications: [certification("2026-06-20")],
      createdAt: "2026-05-22T12:00:00.000Z",
      now: new Date("2026-05-22T12:00:00"),
      profiles: [profile],
      tenantId: "tenant-1",
      users: [worker, manager],
    });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      title: "Certification due in 30 days: First Aid",
      user_id: worker.id,
    });
  });

  it("sends two week reminders to worker and manager", () => {
    const notifications = buildCertificationReminderNotifications({
      certifications: [certification("2026-06-01")],
      createdAt: "2026-05-22T12:00:00.000Z",
      now: new Date("2026-05-22T12:00:00"),
      profiles: [profile],
      tenantId: "tenant-1",
      users: [worker, manager],
    });

    expect(notifications.map((notification) => notification.user_id).sort()).toEqual([manager.id, worker.id]);
    expect(notifications.every((notification) => notification.title === "Certification due in 14 days: First Aid")).toBe(
      true,
    );
  });

  it("marks expired certifications as deficiencies for worker and manager", () => {
    const notifications = buildCertificationReminderNotifications({
      certifications: [certification("2026-05-21")],
      createdAt: "2026-05-22T12:00:00.000Z",
      now: new Date("2026-05-22T12:00:00"),
      profiles: [profile],
      tenantId: "tenant-1",
      users: [worker, manager],
    });

    expect(notifications.map((notification) => notification.title)).toEqual([
      "Certification deficiency: First Aid",
      "Certification deficiency: First Aid",
    ]);
    expect(notifications.every((notification) => notification.body.includes("certification deficiency"))).toBe(true);
  });

  it("summarizes current certification deficiencies for admin review", () => {
    expect(
      buildCertificationDeficiencySummaries({
        certifications: [
          certification("2026-05-21"),
          certification("2026-06-01"),
        ],
        now: new Date("2026-05-24T12:00:00"),
        profiles: [profile],
        users: [worker, manager],
      }),
    ).toEqual([
      {
        certificationId: "cert-2026-05-21",
        daysExpired: 3,
        expiresOn: "2026-05-21",
        name: "First Aid",
        workerName: "Wendy Worker",
        workerUserId: worker.id,
      },
    ]);
  });
});
