import { describe, expect, it } from "vitest";
import { buildEquipmentAttentionNotifications } from "@/lib/equipment-reminders";
import type { Database } from "@/types/database";

type Equipment = Pick<
  Database["public"]["Tables"]["equipment"]["Row"],
  "assigned_to" | "current_meter" | "deleted_at" | "id" | "name" | "status" | "tracking_mode" | "unit_number"
>;
type ScheduledService = Pick<
  Database["public"]["Tables"]["equipment_scheduled_service"]["Row"],
  | "due_date"
  | "due_meter"
  | "window_start_meter"
  | "warn_meter"
  | "date_lead_days"
  | "meter_lead"
  | "equipment_id"
  | "id"
  | "interval_mode"
  | "is_active"
  | "title"
>;
type EquipmentDocument = Pick<
  Database["public"]["Tables"]["equipment_document"]["Row"],
  "equipment_id" | "expiry_date" | "id" | "is_active" | "reminder_lead_days" | "title"
>;
type User = Pick<
  Database["public"]["Tables"]["users"]["Row"],
  "active" | "app_access" | "email" | "full_name" | "id" | "power_level"
>;

const worker: User = {
  active: true,
  app_access: "app_access",
  email: "operator@example.com",
  full_name: "Olivia Operator",
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

const equipment: Equipment = {
  assigned_to: worker.id,
  current_meter: 9000,
  deleted_at: null,
  id: "equipment-1",
  name: "Service truck",
  status: "active",
  tracking_mode: "mileage",
  unit_number: "47",
};

function service(input: Partial<ScheduledService> = {}): ScheduledService {
  return {
    due_date: null,
    due_meter: 8500,
    window_start_meter: null,
    warn_meter: null,
    date_lead_days: null,
    meter_lead: null,
    equipment_id: equipment.id,
    id: "service-1",
    interval_mode: "by_meter",
    is_active: true,
    title: "Oil change",
    ...input,
  };
}

function document(input: Partial<EquipmentDocument> = {}): EquipmentDocument {
  return {
    equipment_id: equipment.id,
    expiry_date: "2026-06-10",
    id: "document-1",
    is_active: true,
    reminder_lead_days: 30,
    title: "Registration",
    ...input,
  };
}

describe("equipment reminders", () => {
  it("notifies assigned worker and managers about overdue service", () => {
    const notifications = buildEquipmentAttentionNotifications({
      createdAt: "2026-05-24T12:00:00.000Z",
      documents: [],
      equipment: [equipment],
      now: new Date("2026-05-24T12:00:00.000Z"),
      scheduledServices: [service()],
      tenantId: "tenant-1",
      users: [worker, manager],
    });

    expect(notifications.map((notification) => notification.user_id).sort()).toEqual([manager.id, worker.id]);
    expect(notifications.every((notification) => notification.title === "Equipment service overdue: Oil change")).toBe(
      true,
    );
    expect(notifications.every((notification) => notification.body.includes("47, Service truck"))).toBe(true);
    expect(notifications.every((notification) => notification.delivery_status === "delivered")).toBe(true);
  });

  it("notifies about expiring equipment documents", () => {
    const notifications = buildEquipmentAttentionNotifications({
      createdAt: "2026-05-24T12:00:00.000Z",
      documents: [document()],
      equipment: [equipment],
      now: new Date("2026-05-24T12:00:00.000Z"),
      scheduledServices: [],
      tenantId: "tenant-1",
      users: [worker, manager],
    });

    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({
      recipient_type: "equipment_assignee",
      title: "Equipment document expiring: Registration",
      user_id: worker.id,
    });
    expect(notifications[1]).toMatchObject({
      recipient_type: "equipment_manager",
      title: "Equipment document expiring: Registration",
      user_id: manager.id,
    });
  });

  it("skips current service and inactive documents", () => {
    const notifications = buildEquipmentAttentionNotifications({
      createdAt: "2026-05-24T12:00:00.000Z",
      documents: [document({ is_active: false })],
      equipment: [equipment],
      now: new Date("2026-05-24T12:00:00.000Z"),
      scheduledServices: [service({ due_meter: 20000 })],
      tenantId: "tenant-1",
      users: [worker, manager],
    });

    expect(notifications).toEqual([]);
  });
});
