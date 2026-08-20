import { describe, expect, it } from "vitest";
import {
  parseCertifications,
  parseEmployees,
  parseEquipment,
  parseLocations,
  parseUnitCertifications,
  type RawSheet,
} from "@/lib/client-pack/parse";
import { dateValue, isExampleRow, normalizeHeader } from "@/lib/client-pack/schema";

// These tests are about the file a client actually sends back, not the file we
// sent them. Headers get renamed, the example row survives, dates get typed the
// way people say them, and a dropdown loses its validation the moment someone
// copies the table into a new sheet.

function sheet(header: string[], rows: unknown[][]): RawSheet {
  return { headerRowNumber: 1, header, rows };
}

const EMPLOYEE_HEADER = [
  "Full Name",
  "Work Email (becomes their login)",
  "Job Title",
  "Mobile Phone (optional)",
  "Permission Level",
];

describe("the example row every pack ships with", () => {
  it("catches the shouty marker used on most sheets", () => {
    expect(isExampleRow(["EXAMPLE ROW - delete this row", "YARD", "", "yard", "yes"])).toBe(true);
  });

  it("catches the realistic-looking person used on Employees and Certifications", () => {
    // This is the dangerous one. It looks like a real employee, so a client can
    // leave it in without noticing, and loading it would create a login.
    expect(isExampleRow(["John Doe", "john.doe@yourcompany.ca", "Yard Lead", "780-555-0100", "Worker"])).toBe(true);
  });

  it("does not mistake a real employee for the example", () => {
    expect(isExampleRow(["Sam Rivera", "sam@northwind.test", "Driver", "780-555-0199", "Worker"])).toBe(false);
  });

  it("never creates a login for the sample employee", () => {
    const result = parseEmployees(
      sheet(EMPLOYEE_HEADER, [
        ["John Doe", "john.doe@yourcompany.ca", "Yard Lead", "780-555-0100", "Worker"],
        ["Sam Rivera", "sam@northwind.test", "Driver", "", "Worker"],
      ]),
    );

    expect(result.rows.map((row) => row.email)).toEqual(["sam@northwind.test"]);
    expect(result.skipped).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});

describe("headers as they come back", () => {
  it("ignores case, spacing and punctuation", () => {
    expect(normalizeHeader("Work Email (becomes their login)")).toBe(normalizeHeader("work email becomes their login"));
    expect(normalizeHeader("unit_number")).toBe(normalizeHeader("Unit Number"));
  });

  it("accepts a renamed column", () => {
    const result = parseEmployees(
      sheet(["Name", "Email", "Position", "Cell", "Role"], [["Sam Rivera", "sam@northwind.test", "Driver", "", "Admin"]]),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ fullName: "Sam Rivera", powerLevel: "admin" });
  });

  it("ignores a column the client added", () => {
    const result = parseEmployees(
      sheet([...EMPLOYEE_HEADER, "Notes"], [["Sam Rivera", "sam@northwind.test", "", "", "Worker", "started 2019"]]),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
  });

  it("reports a missing required column once, not once per row", () => {
    const result = parseEmployees(
      sheet(["Full Name", "Job Title"], [["Sam Rivera", "Driver"], ["Jordan Ellis", "Driver"]]),
    );

    expect(result.rows).toHaveLength(0);
    expect(result.errors.map((error) => error.column)).toEqual([
      "Work Email (becomes their login)",
      "Permission Level",
    ]);
  });
});

describe("employees", () => {
  it("names the sheet row so the problem can be sent back to the client", () => {
    const result = parseEmployees(
      sheet(EMPLOYEE_HEADER, [
        ["Sam Rivera", "sam@northwind.test", "", "", "Worker"],
        ["Jordan Ellis", "not-an-email", "", "", "Worker"],
      ]),
    );

    expect(result.rows).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ sheet: "employees", row: 3, column: "Work Email" });
  });

  it("rejects a permission level that is not one of ours", () => {
    const result = parseEmployees(
      sheet(EMPLOYEE_HEADER, [["Sam Rivera", "sam@northwind.test", "", "", "Foreman"]]),
    );

    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].message).toContain("Super Admin, Admin, Manager, Supervisor or Worker");
  });

  it("keeps no part of a row that failed", () => {
    // A half-parsed employee with a name and no login looks fine on a list and
    // breaks the first time they try to sign in.
    const result = parseEmployees(sheet(EMPLOYEE_HEADER, [["Sam Rivera", "", "", "", "Worker"]]));

    expect(result.rows).toHaveLength(0);
  });

  it("lowercases the login, because email is not case sensitive", () => {
    const result = parseEmployees(
      sheet(EMPLOYEE_HEADER, [["Sam Rivera", "Sam@NorthWind.test", "", "", "worker"]]),
    );

    expect(result.rows[0].email).toBe("sam@northwind.test");
  });
});

describe("dates as people type them", () => {
  it("takes ISO, which is what the pack asks for", () => {
    expect(dateValue("2027-05-01")).toBe("2027-05-01");
  });

  it("takes a real Date, which is what a date-formatted cell returns", () => {
    expect(dateValue(new Date(Date.UTC(2027, 4, 1)))).toBe("2027-05-01");
  });

  it("takes an unambiguous day-first date", () => {
    expect(dateValue("31/05/2027")).toBe("2027-05-31");
  });

  it("takes a written month", () => {
    expect(dateValue("01 Jun 2027")).toBe("2027-06-01");
  });

  it("REFUSES an ambiguous date rather than guessing", () => {
    // 05/06/2027 is either 5 June or 6 May. A wrong expiry is a compliance
    // record that lies, so this has to come back to the client.
    expect(dateValue("05/06/2027")).toBeUndefined();
  });

  it("refuses a day that does not exist", () => {
    expect(dateValue("2027-02-31")).toBeUndefined();
    expect(dateValue("2027-06-31")).toBeUndefined();
  });

  it("treats an empty cell as not supplied, not as an error", () => {
    expect(dateValue("")).toBeNull();
    expect(dateValue(null)).toBeNull();
  });
});

describe("equipment", () => {
  const header = [
    "unit_number",
    "type",
    "year",
    "make",
    "model",
    "vin",
    "plate",
    "meter_type",
    "meter_reading",
    "cvip_expiry",
    "registration_expiry",
    "insurance_expiry",
    "commercial",
  ];

  it("reads a filled row", () => {
    const result = parseEquipment(
      sheet(header, [
        ["T-014", "Truck", "2019", "Kenworth", "T880", "1XKYDP9X5KJ123456", "ABC1234", "km", "145,000", "2026-09-30", "2026-12-31", "2026-08-15", "yes"],
      ]),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      unitNumber: "T-014",
      category: "vehicle",
      year: 2019,
      trackingMode: "mileage",
      meterReading: 145000,
      cvipExpiry: "2026-09-30",
      isCommercial: true,
    });
  });

  it("treats a picker truck as a road vehicle, not yard equipment", () => {
    const result = parseEquipment(sheet(header, [["P-01", "Picker Truck", "", "", "", "", "", "none", "", "", "", "", "yes"]]));

    expect(result.rows[0].category).toBe("vehicle");
    expect(result.rows[0].trackingMode).toBeNull();
  });

  it("defaults an unstated unit to commercial, because the safe error is over-flagging", () => {
    // A truck the app forgets to ask about drops out of the NSC requirement model
    // silently. An over-marked pickup is visible and easy to correct.
    const result = parseEquipment(sheet(header, [["T-020", "Truck", "", "", "", "", "", "", "", "", "", "", ""]]));

    expect(result.rows[0].isCommercial).toBe(true);
  });

  it("rejects an unreadable meter reading rather than importing zero", () => {
    const result = parseEquipment(
      sheet(header, [["T-014", "Truck", "", "", "", "", "", "km", "about 145k", "", "", "", "yes"]]),
    );

    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].column).toBe("meter_reading");
  });
});

describe("locations", () => {
  it("treats a blank active column as in use", () => {
    // A client leaving it empty is saying nothing. Defaulting to inactive would
    // quietly hide every site they operate.
    const result = parseLocations(sheet(["code", "name", "active"], [["01", "Main Yard", ""]]));

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ code: "01", name: "Main Yard", active: true });
  });

  it("accepts a site with no code, which is every pack already in the field", () => {
    // The packs clients are holding have no code column at all. Rejecting over
    // it would reject the file we ourselves sent them.
    const result = parseLocations(sheet(["name"], [["Riverbend Yard"]]));

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ code: null, name: "Riverbend Yard" });
  });

  it("ignores an address column a client kept from an older pack", () => {
    const result = parseLocations(
      sheet(["code", "name", "address"], [["01", "Riverbend Yard", "100 Range Road"]]),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].name).toBe("Riverbend Yard");
  });
});

describe("certifications", () => {
  it("reads a worker ticket", () => {
    const result = parseCertifications(
      sheet(
        ["worker_email", "worker_name", "certification_type", "issued_on", "expires_on"],
        [["Sam@northwind.test", "Sam Rivera", "H2S Alive", "2024-05-01", "2027-05-01"]],
      ),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({
      workerEmail: "sam@northwind.test",
      certificationType: "H2S Alive",
      expiresOn: "2027-05-01",
    });
  });

  it("accepts a ticket with no expiry, because some tickets do not expire", () => {
    const result = parseCertifications(
      sheet(["worker_email", "certification_type", "expires_on"], [["sam@northwind.test", "Class 1 Licence", ""]]),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0].expiresOn).toBeNull();
  });
});

describe("unit certifications", () => {
  it("reads a unit ticket", () => {
    const result = parseUnitCertifications(
      sheet(
        ["unit_number", "certification_type", "issued_on", "expires_on"],
        [["TR-88", "B620 Tank Pressure Test", "2024-06-01", "2025-06-01"]],
      ),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.rows[0]).toMatchObject({ unitNumber: "TR-88", expiresOn: "2025-06-01" });
  });

  it("counts a sheet that is nothing but the example as skipped, not as empty and fine", () => {
    const result = parseUnitCertifications(
      sheet(
        ["unit_number", "certification_type", "issued_on", "expires_on"],
        [["EXAMPLE ROW - delete this row", "B620 Tank Pressure Test", "2024-06-01", "2025-06-01"]],
      ),
    );

    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toBe(1);
  });
});

// The columns the tank fleet sheets need. Crude Master's trailers carry CSA B620
// inspections on several different cycles, and four product hoses per unit that
// each expire on their own date, none of which the original pack could express.
describe("tank fleet columns", () => {
  it("reads the tank specification however the fleet writes it", () => {
    const { rows, errors } = parseEquipment(
      sheet(
        ["unit_number", "type", "tank_spec", "insulated"],
        [
          ["802", "Trailer", "406", "no"],
          ["803", "Trailer", "TC-407", "yes"],
          ["804", "Trailer", "mc 406", ""],
        ],
      ),
    );

    expect(errors).toEqual([]);
    expect(rows.map((row) => row.tankSpec)).toEqual(["tc406", "tc407", "tc406"]);
    expect(rows.map((row) => row.isInsulated)).toEqual([false, true, null]);
  });

  it("names the bad cell when a tank specification is not one we know", () => {
    const { rows, errors } = parseEquipment(
      sheet(["unit_number", "tank_spec"], [["802", "TC-412"]]),
    );

    expect(rows).toEqual([]);
    expect(errors[0].column).toBe("tank_spec");
    expect(errors[0].message).toContain("TC-412");
  });

  // Null rather than false on purpose: a tractor is not a non-insulated tank, it
  // is not a tank, and the two must not read the same on a compliance screen.
  it("leaves insulation unknown when the column is blank", () => {
    const { rows } = parseEquipment(sheet(["unit_number"], [["T-014"]]));

    expect(rows[0].isInsulated).toBeNull();
    expect(rows[0].tankSpec).toBeNull();
    expect(rows[0].inspections).toEqual([]);
  });

  it("splits an inspection list on semicolons and new lines", () => {
    const { rows } = parseEquipment(
      sheet(
        ["unit_number", "inspections"],
        [["802", "Product hose; Upper coupler (UC)\nTank thickness (T)"]],
      ),
    );

    expect(rows[0].inspections).toEqual(["Product hose", "Upper coupler (UC)", "Tank thickness (T)"]);
  });

  // The first real fleet load came out with nothing ticked because commas split
  // too. Half these inspections are named after the several checks they bundle,
  // so a comma inside a name is normal and must survive.
  it("keeps a certification name that contains commas in one piece", () => {
    const { rows } = parseEquipment(
      sheet(
        ["unit_number", "inspections"],
        [["802", "PIUC - pressure, internal, upper coupler; Product hose"]],
      ),
    );

    expect(rows[0].inspections).toEqual(["PIUC - pressure, internal, upper coupler", "Product hose"]);
  });

  it("drops the empty entry a trailing separator leaves behind", () => {
    const { rows } = parseEquipment(sheet(["unit_number", "inspections"], [["802", "Product hose;"]]));

    expect(rows[0].inspections).toEqual(["Product hose"]);
  });

  it("keeps each hose serial so four hoses do not collapse into one record", () => {
    const { rows, errors } = parseUnitCertifications(
      sheet(
        ["unit_number", "certification_type", "serial", "expiry_date"],
        [
          ["802", "Product hose", "2868451-1", "2026-08-31"],
          ["802", "Product hose", "2868451-2", "2027-01-15"],
        ],
      ),
    );

    expect(errors).toEqual([]);
    expect(rows.map((row) => row.componentId)).toEqual(["2868451-1", "2868451-2"]);
    expect(rows.map((row) => row.expiresOn)).toEqual(["2026-08-31", "2027-01-15"]);
  });

  it("leaves the serial null for a certificate that covers the whole unit", () => {
    const { rows } = parseUnitCertifications(
      sheet(["unit_number", "certification_type", "expiry_date"], [["802", "Upper coupler (UC)", "2027-03-10"]]),
    );

    expect(rows[0].componentId).toBeNull();
  });
});
