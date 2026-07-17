import { describe, expect, it } from "vitest";
import {
  canAccessEquipmentByReach,
  canAccessLocationByReach,
  canManagePowerLevel,
  canUseAdminPanel,
  canUseDesktopMonitor,
  canUseWebApp,
  formatAccessLevel,
} from "@/lib/access-control";

describe("access-control helpers", () => {
  it("allows the web app for every active non-zero access tier", () => {
    expect(canUseWebApp({ active: true, app_access: "app_access", power_level: "worker" })).toBe(true);
    expect(canUseWebApp({ active: true, app_access: "no_access", power_level: "worker" })).toBe(false);
  });

  it("limits the admin panel to admin access tiers and super admins", () => {
    expect(canUseAdminPanel({ active: true, app_access: "admin_access", power_level: "admin" })).toBe(true);
    expect(canUseAdminPanel({ active: true, app_access: "app_access", power_level: "worker" })).toBe(false);
    expect(canUseAdminPanel({ active: true, app_access: "app_access", power_level: "super_admin" })).toBe(true);
  });

  it("limits the desktop monitor to managers and above", () => {
    expect(canUseDesktopMonitor({ active: true, app_access: "app_access", power_level: "super_admin" })).toBe(true);
    expect(canUseDesktopMonitor({ active: true, app_access: "app_access", power_level: "admin" })).toBe(true);
    expect(canUseDesktopMonitor({ active: true, app_access: "app_access", power_level: "manager" })).toBe(true);
    expect(canUseDesktopMonitor({ active: true, app_access: "admin_access", power_level: "supervisor" })).toBe(false);
    expect(canUseDesktopMonitor({ active: true, app_access: "app_access", power_level: "worker" })).toBe(false);
    expect(canUseDesktopMonitor({ active: true, app_access: "no_access", power_level: "manager" })).toBe(false);
    expect(canUseDesktopMonitor({ active: false, app_access: "super_admin_access", power_level: "super_admin" })).toBe(false);
  });

  it("keeps consultants out of tenant role assignment", () => {
    expect(canManagePowerLevel("super_admin", "admin")).toBe(true);
    expect(canManagePowerLevel("super_admin", "consultant")).toBe(false);
    expect(canManagePowerLevel("admin", "worker")).toBe(false);
  });

  it("scopes specific-location users to assigned and all-worker locations", () => {
    const assignedLocationIds = new Set(["yard"]);

    expect(canAccessLocationByReach({ assignedLocationIds, locationId: "yard", reachType: "specific_locations" })).toBe(true);
    expect(canAccessLocationByReach({ assignedLocationIds, locationId: "shop", reachType: "specific_locations" })).toBe(false);
    expect(
      canAccessLocationByReach({
        assignedLocationIds,
        includeAllWorkersLocations: true,
        locationId: "orientation",
        reachType: "specific_locations",
        visibilityRule: "all_workers",
      }),
    ).toBe(true);
    expect(
      canAccessLocationByReach({
        assignedLocationIds,
        locationId: "closed",
        reachType: "all_locations",
        visibilityRule: "inactive",
      }),
    ).toBe(false);
  });

  it("scopes equipment to assigned locations while keeping directly assigned unlocated units visible", () => {
    const assignedLocationIds = new Set(["yard"]);

    expect(
      canAccessEquipmentByReach({
        assignedLocationIds,
        assignedTo: null,
        locationId: "yard",
        reachType: "specific_locations",
        userId: "worker-1",
      }),
    ).toBe(true);
    expect(
      canAccessEquipmentByReach({
        assignedLocationIds,
        assignedTo: null,
        locationId: "shop",
        reachType: "specific_locations",
        userId: "worker-1",
      }),
    ).toBe(false);
    expect(
      canAccessEquipmentByReach({
        assignedLocationIds,
        assignedTo: "worker-1",
        locationId: null,
        reachType: "specific_locations",
        userId: "worker-1",
      }),
    ).toBe(true);
    expect(
      canAccessEquipmentByReach({
        assignedLocationIds,
        assignedTo: "worker-2",
        locationId: null,
        reachType: "specific_locations",
        userId: "worker-1",
      }),
    ).toBe(false);
  });

  it("formats app access labels for the admin grid", () => {
    expect(formatAccessLevel("super_admin_access")).toBe("Super Admin Access");
  });
});
