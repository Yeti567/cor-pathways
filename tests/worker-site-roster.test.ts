import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readSource("src/app/admin/actions.ts");
const appActions = readSource("src/app/actions.ts");
const webPage = readSource("src/app/web/page.tsx");

function readSource(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("worker-visible emergency site roster", () => {
  it("shows the emergency roster in the employee Web App", () => {
    expect(webPage).toContain('{ href: "#site-roster", label: "Roster", icon: UsersRound }');
    expect(webPage).toContain('id="site-roster"');
    expect(webPage).toContain("Emergency Site Roster");
    expect(webPage).toContain("buildVisitorRoster({");
    expect(webPage).toContain('from("visitors")');
    expect(webPage).toContain('from("worker_time_cards")');
    expect(webPage).toContain('is("signed_out_at", null)');
    expect(webPage).toContain('is("clocked_out_at", null)');
    expect(webPage).toContain(".in(\"location_id\", siteRosterLocationIds)");
    expect(webPage).toContain("currentSiteActiveCount");
    expect(webPage).toContain("Current site");
  });

  it("refreshes the worker-visible roster when presence changes", () => {
    expect(appActions).toContain('revalidatePath("/web")');
    expect(appActions).toContain('revalidatePath("/admin/visitors/roster")');
    expect(adminActions).toContain('action: "visitor.sign_in"');
    expect(adminActions).toContain('action: "visitor.sign_out"');
    expect(adminActions).toContain('revalidatePath("/web")');
  });
});
