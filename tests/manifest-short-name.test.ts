import { describe, expect, it } from "vitest";
import { shortName } from "@/app/manifest";

// The label under the home-screen icon. It has to identify the company on a phone
// full of icons, which a bare first word does not: "Speed" could be anything.
describe("home screen label", () => {
  it("keeps a two word company name whole", () => {
    expect(shortName("Speed Logistics")).toBe("Speed Logistics");
    expect(shortName("Core Pathways")).toBe("Core Pathways");
  });

  it("trims a long legal name to whole leading words", () => {
    expect(shortName("Crude Master Transport Inc.")).toBe("Crude Master");
  });

  it("never cuts a word in half", () => {
    for (const name of ["Speed Logistics", "Crude Master Transport Inc.", "Northwind Energy Services"]) {
      for (const word of shortName(name).split(" ")) {
        expect(name.split(/\s+/)).toContain(word);
      }
    }
  });

  it("survives a one word name and stray spacing", () => {
    expect(shortName("Speedlogistics")).toBe("Speedlogistics");
    expect(shortName("  Speed   Logistics  ")).toBe("Speed Logistics");
  });
});
