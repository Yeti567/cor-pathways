import type { Database } from "@/types/database";

export type PowerLevel = Database["public"]["Enums"]["power_level"];
export type ReachType = Database["public"]["Enums"]["reach_type"];
export type AppAccessLevel = Database["public"]["Enums"]["app_access_level"];

export type AppProfile = {
  power_level: PowerLevel;
  app_access: AppAccessLevel;
  active: boolean;
};

const powerRank: Record<PowerLevel, number> = {
  consultant: 60,
  super_admin: 50,
  admin: 40,
  manager: 30,
  supervisor: 20,
  worker: 10,
};

export const powerLevelOptions: { value: PowerLevel; label: string }[] = [
  { value: "super_admin", label: "Super Admin" },
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "supervisor", label: "Supervisor" },
  { value: "worker", label: "Worker" },
];

export const appAccessOptions: { value: AppAccessLevel; label: string; detail: string }[] = [
  { value: "no_access", label: "No Access", detail: "Cannot open the app." },
  { value: "app_access", label: "App Access", detail: "Mobile and web app only." },
  { value: "admin_access", label: "Admin Access", detail: "Admin panel plus app." },
  { value: "super_admin_access", label: "Super Admin Access", detail: "Role management plus admin and app." },
];

export const reachOptions: { value: ReachType; label: string }[] = [
  { value: "all_locations", label: "All locations" },
  { value: "specific_locations", label: "Specific locations" },
];

export const offlineSyncOptions = [
  { value: 7, label: "1 Week" },
  { value: 30, label: "1 Month" },
  { value: 90, label: "3 Months" },
  { value: 365, label: "1 Year" },
] as const;

export function formatPowerLevel(powerLevel: PowerLevel) {
  return powerLevel
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function formatAccessLevel(accessLevel: AppAccessLevel) {
  const option = appAccessOptions.find((item) => item.value === accessLevel);
  return option?.label ?? accessLevel;
}

export function formatReachType(reachType: ReachType) {
  const option = reachOptions.find((item) => item.value === reachType);
  return option?.label ?? reachType;
}

export function formatSyncDays(days: number) {
  return offlineSyncOptions.find((item) => item.value === days)?.label ?? `${days} days`;
}

export function canUseWebApp(profile: AppProfile | null | undefined) {
  return Boolean(profile?.active && profile.app_access !== "no_access");
}

export function canUseAdminPanel(profile: AppProfile | null | undefined) {
  return Boolean(
    profile?.active &&
      (profile.app_access === "admin_access" ||
        profile.app_access === "super_admin_access" ||
        profile.power_level === "super_admin" ||
        profile.power_level === "consultant"),
  );
}

export function canUseDesktopMonitor(profile: AppProfile | null | undefined) {
  return Boolean(
    profile?.active &&
      profile.app_access !== "no_access" &&
      (profile.power_level === "super_admin" || profile.power_level === "admin" || profile.power_level === "manager"),
  );
}

export function canManageAccess(profile: AppProfile | null | undefined) {
  return Boolean(profile?.active && (profile.power_level === "super_admin" || profile.power_level === "consultant"));
}

export function profileHasCapability(capabilities: unknown, key: string) {
  return Boolean(
    capabilities &&
      typeof capabilities === "object" &&
      !Array.isArray(capabilities) &&
      (capabilities as Record<string, unknown>)[key] === true,
  );
}

// Who may upload and manage medical/injury vault records: ONLY holders of the
// medical_vault_access capability. The affected worker can view their own records
// (see canViewMedicalVault) but not manage the vault.
//
// Being a super admin is deliberately NOT enough, and that is the whole point of the
// vault. What is in here is a doctor's account of an injured worker's restrictions, and
// the company needs exactly one person able to read it, named on purpose. Every other
// capability is about what somebody can run; this one is about what they can read about
// a colleague's body, so it is granted deliberately or not at all.
//
// The bypass this replaces let anyone with super_admin in, which at one client meant
// three people including the outside safety consultant, who is not an employee and has
// no business in their staff's medical files. Removed 2026-08-26 at his own request.
//
// Consequence worth knowing: a tenant where nobody holds the capability has a vault
// nobody can open. That is the correct failure. Designating a person is a decision the
// company makes, not a default they inherit. Mirrored in
// authz.current_user_can_access_medical_vault -- change both together.
export function canManageMedicalVault(profile: AppProfile | null | undefined, capabilities: unknown) {
  return Boolean(profile?.active && profileHasCapability(capabilities, "medical_vault_access"));
}

// Who may view a driver's medical vault: anyone who can manage it, plus the
// affected worker for their own records. Mirrors the database authz function.
export function canViewMedicalVault(input: {
  profile: AppProfile | null | undefined;
  capabilities: unknown;
  userId: string;
  driverUserId: string | null;
}) {
  if (canManageMedicalVault(input.profile, input.capabilities)) {
    return true;
  }

  return Boolean(input.profile?.active && input.driverUserId && input.userId === input.driverUserId);
}

export function canAccessLocationByReach(input: {
  assignedLocationIds: ReadonlySet<string>;
  includeAllWorkersLocations?: boolean;
  includeUnassignedLocation?: boolean;
  locationId: string | null | undefined;
  reachType: ReachType;
  visibilityRule?: string | null;
}) {
  if (input.visibilityRule === "inactive") {
    return false;
  }

  if (input.reachType === "all_locations") {
    return true;
  }

  if (input.includeAllWorkersLocations && input.visibilityRule === "all_workers") {
    return true;
  }

  if (!input.locationId) {
    return Boolean(input.includeUnassignedLocation);
  }

  return input.assignedLocationIds.has(input.locationId);
}

export function canAccessEquipmentByReach(input: {
  assignedLocationIds: ReadonlySet<string>;
  assignedTo: string | null | undefined;
  locationId: string | null | undefined;
  reachType: ReachType;
  userId: string;
}) {
  if (
    canAccessLocationByReach({
      assignedLocationIds: input.assignedLocationIds,
      locationId: input.locationId,
      reachType: input.reachType,
    })
  ) {
    return true;
  }

  return !input.locationId && input.assignedTo === input.userId;
}

export function canManagePowerLevel(actor: PowerLevel, target: PowerLevel) {
  if (actor === "consultant") {
    return true;
  }

  if (actor !== "super_admin") {
    return false;
  }

  return target !== "consultant";
}

export function isPowerAtLeast(actual: PowerLevel, minimum: PowerLevel) {
  return powerRank[actual] >= powerRank[minimum];
}
