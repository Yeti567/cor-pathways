import { describe, expect, it } from "vitest";
import { canManageMedicalVault, canViewMedicalVault, profileHasCapability } from "@/lib/access-control";

const superAdmin = { power_level: "super_admin", app_access: "super_admin_access", active: true } as const;
const manager = { power_level: "manager", app_access: "admin_access", active: true } as const;
const worker = { power_level: "worker", app_access: "app_access", active: true } as const;

describe("medical vault access", () => {
  it("detects a capability flag only when explicitly true", () => {
    expect(profileHasCapability({ medical_vault_access: true }, "medical_vault_access")).toBe(true);
    expect(profileHasCapability({ medical_vault_access: false }, "medical_vault_access")).toBe(false);
    expect(profileHasCapability({}, "medical_vault_access")).toBe(false);
    expect(profileHasCapability(null, "medical_vault_access")).toBe(false);
  });

  it("lets only capability holders manage the vault", () => {
    expect(canManageMedicalVault(manager, { medical_vault_access: true })).toBe(true);
    expect(canManageMedicalVault(manager, {})).toBe(false);
    expect(canManageMedicalVault(worker, {})).toBe(false);
    expect(canManageMedicalVault({ ...manager, active: false }, { medical_vault_access: true })).toBe(false);
  });

  // The vault is the one place where holding the top role is not enough. What is in it is
  // a doctor's account of an injured worker's restrictions, so the company names one
  // person who may read it rather than letting it follow whoever administers the app. At
  // the client this was written for, the super admins included the outside safety
  // consultant, who is not an employee.
  it("does not let a super admin in on rank alone", () => {
    expect(canManageMedicalVault(superAdmin, {})).toBe(false);
    expect(
      canViewMedicalVault({ profile: superAdmin, capabilities: {}, userId: "u1", driverUserId: "u9" }),
    ).toBe(false);
  });

  // Granting it to a super admin still works. Rank is neither a qualification nor a bar.
  it("lets a super admin in once the capability is granted", () => {
    expect(canManageMedicalVault(superAdmin, { medical_vault_access: true })).toBe(true);
  });

  // A super admin is still a person, and their own file is still theirs.
  it("still lets a super admin see their own records", () => {
    expect(
      canViewMedicalVault({ profile: superAdmin, capabilities: {}, userId: "u1", driverUserId: "u1" }),
    ).toBe(true);
  });

  it("lets the affected worker view their own records but not others'", () => {
    expect(
      canViewMedicalVault({ profile: worker, capabilities: {}, userId: "u1", driverUserId: "u1" }),
    ).toBe(true);
    expect(
      canViewMedicalVault({ profile: worker, capabilities: {}, userId: "u1", driverUserId: "u2" }),
    ).toBe(false);
    expect(
      canViewMedicalVault({ profile: worker, capabilities: {}, userId: "u1", driverUserId: null }),
    ).toBe(false);
  });

  it("lets a vault manager view any driver's records", () => {
    expect(
      canViewMedicalVault({ profile: manager, capabilities: { medical_vault_access: true }, userId: "u1", driverUserId: "u9" }),
    ).toBe(true);
  });
});
