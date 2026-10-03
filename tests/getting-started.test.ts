import { describe, expect, it } from "vitest";
import { buildGettingStarted, SEEDED_FORM_CODES } from "@/lib/getting-started";

const empty = { ownForms: 0, people: 1, tickets: { people: 1, withTicket: 0 }, units: { finished: 0, total: 0 } };

describe("buildGettingStarted", () => {
  it("starts with nothing done, in the playbook's order", () => {
    const steps = buildGettingStarted(empty);

    expect(steps.map((step) => [step.key, step.done])).toEqual([
      ["people", false],
      ["units", false],
      ["tickets", false],
      ["forms", false],
    ]);
  });

  it("does not count the person setting the app up as having added their people", () => {
    expect(buildGettingStarted(empty)[0].done).toBe(false);
    expect(buildGettingStarted({ ...empty, people: 2 })[0]).toMatchObject({ done: true, progress: "2 people in the app" });
  });

  it("sends a company with no units to the drop box, and one with units to Finish Your Units", () => {
    expect(buildGettingStarted(empty)[1].href).toBe("/admin/intake");

    const units = buildGettingStarted({ ...empty, units: { finished: 2, total: 180 } })[1];

    expect(units).toMatchObject({ done: false, href: "/admin/equipment/finish", percent: 1, progress: "2 of 180 units have everything on file" });
    expect(buildGettingStarted({ ...empty, units: { finished: 180, total: 180 } })[1].done).toBe(true);
  });

  it("counts tickets per person, and forms that are the client's own", () => {
    const steps = buildGettingStarted({ ...empty, ownForms: 1, tickets: { people: 120, withTicket: 90 } });

    expect(steps[2]).toMatchObject({ done: false, percent: 75, progress: "90 of 120 people have a ticket on file" });
    expect(steps[3]).toMatchObject({ done: true, progress: "1 of your own form in the app" });
  });

  it("knows the forms every company is given", () => {
    expect(SEEDED_FORM_CODES.has("TT-TRIP")).toBe(true);
    expect(SEEDED_FORM_CODES.has("NWT-PRETRIP")).toBe(false);
  });
});
