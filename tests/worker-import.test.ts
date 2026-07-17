import { describe, expect, it } from "vitest";
import {
  buildWorkerImportTemplateCsv,
  coerceImportAccessLevel,
  coerceImportPowerLevel,
  coerceImportSyncDays,
  normalizeImportHeader,
  parseCsv,
  parseWorkerImportCsv,
  splitImportList,
  workerImportTemplateFilename,
  workerImportTemplateHeaders,
} from "@/lib/worker-import";

describe("worker CSV import helpers", () => {
  it("parses quoted CSV values and CRLF rows", () => {
    expect(parseCsv('email,full_name,title,locations\r\njane@example.com,"Jane, A.","Operator","Yard; Plant"\r\n')).toEqual([
      ["email", "full_name", "title", "locations"],
      ["jane@example.com", "Jane, A.", "Operator", "Yard; Plant"],
    ]);
  });

  it("normalizes headers and list values", () => {
    expect(normalizeImportHeader(" Employee Number ")).toBe("employee_number");
    expect(splitImportList("Yard, Plant; Shop|Office")).toEqual(["Yard", "Plant", "Shop", "Office"]);
  });

  it("coerces role, access, and sync labels", () => {
    expect(coerceImportPowerLevel("Foreman")).toBe("supervisor");
    expect(coerceImportPowerLevel("Super Admin")).toBe("super_admin");
    expect(coerceImportAccessLevel("Admin Access")).toBe("admin_access");
    expect(coerceImportAccessLevel("No Access")).toBe("no_access");
    expect(coerceImportSyncDays("1 Month")).toBe(30);
    expect(coerceImportSyncDays("365 days")).toBe(365);
  });

  it("builds a blank worker import CSV template", () => {
    expect(workerImportTemplateFilename).toBe("worker-import-template.csv");
    expect(parseCsv(buildWorkerImportTemplateCsv())).toEqual([workerImportTemplateHeaders]);
    expect(workerImportTemplateHeaders).toEqual([
      "email",
      "full_name",
      "title",
      "phone",
      "role",
      "app_access",
      "permission_profile",
      "location_codes",
      "employee_number",
      "hired_on",
      "offline_sync_days",
      "emergency_contact_name",
      "emergency_contact_phone",
      "emergency_contact_relationship",
    ]);
  });

  it("maps aliases into worker import rows", () => {
    const result = parseWorkerImportCsv(
      [
        "Email Address,First Name,Last Name,Position,Mobile,Employee ID,Hire Date,Role,App Access,Permission Profile,Location Codes,Emergency Contact Name,Emergency Contact Phone,Emergency Contact Relationship",
        'sam@example.com,Sam,Smith,Foreman,555-0000,S-7,05/22/2026,Supervisor,Admin Access,App Supervisor,"Yard|Plant",Liz,555-1111,Spouse',
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      {
        appAccess: "admin_access",
        email: "sam@example.com",
        emergencyContactName: "Liz",
        emergencyContactPhone: "555-1111",
        emergencyContactRelationship: "Spouse",
        employeeNumber: "S-7",
        fullName: "Sam Smith",
        hiredOn: "2026-05-22",
        locationKeys: ["Yard", "Plant"],
        offlineSyncDays: 30,
        permissionProfile: "App Supervisor",
        phone: "555-0000",
        powerLevel: "supervisor",
        rowNumber: 2,
        title: "Foreman",
      },
    ]);
  });

  it("reports row level validation errors", () => {
    const result = parseWorkerImportCsv("email,full_name,role,offline_sync\nbad,,boss,5 years\n");

    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([
      "Row 2 needs a valid email.",
      "Row 2 needs a full name.",
      "Row 2 has an unknown role.",
      "Row 2 has an unknown offline sync value.",
    ]);
  });
});
