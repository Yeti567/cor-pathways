import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every module toggle and company setting writes to public.tenants, but row-level
// security allows only a super admin to update that row while the actions admit any
// form manager. A lesser role therefore matches no row: PostgREST reports no error and
// changes nothing, so the caller gets "Trades module enabled." and nothing happens.
//
// That failure is invisible from the outside, which is what makes it expensive: the
// person who hits it goes looking for a bug in the module, not in permissions. Every
// tenant write must go through applyTenantSettingsPatch, which asks for the affected
// rows back and turns silence into a message.
const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");

describe("applyTenantSettingsPatch", () => {
  const helper = adminActions.slice(
    adminActions.indexOf("async function applyTenantSettingsPatch"),
    adminActions.indexOf("async function recordEquipmentAuditEvent"),
  );

  it("asks for the affected rows back", () => {
    expect(helper).toContain('.select("id")');
  });

  it("treats a zero-row update as a failure rather than a success", () => {
    expect(helper).toContain("if (!data || data.length === 0)");
    expect(helper).toContain("Only a Super Admin can change company settings");
  });

  it("surfaces a genuine database error separately from the permission case", () => {
    expect(helper).toContain("if (error) {");
    expect(helper).toContain("encodeURIComponent(error.message)");
  });

  it("scopes the write to the tenant it was handed", () => {
    expect(helper).toContain('.eq("id", tenantId)');
  });
});

describe("tenant writes in admin actions", () => {
  // Anything matching this is a direct update to the tenants table. The helper's own
  // body is the single legitimate hit; everything else must call the helper.
  const directTenantUpdates = [...adminActions.matchAll(/\.from\("tenants"\)\s*\n?\s*\.update\(/g)];

  it("routes every settings write through the helper", () => {
    // The consultant-access action is the deliberate exception: it checks
    // power_level !== "super_admin" itself and redirects, which is the same guarantee
    // reached a different way. Ignore that one, and the helper is the only other writer.
    const consultantAccessGuard = 'redirect("/admin/consultant-access?error=Only%20a%20Super%20Admin';
    expect(adminActions).toContain(consultantAccessGuard);

    // One direct update inside the helper, one inside the self-guarding consultant
    // action. Any further direct write is a settings action that skipped the check.
    expect(directTenantUpdates).toHaveLength(2);
  });

  it("leaves only the self-guarding consultant action writing tenants directly", () => {
    // Destructuring only `error` from a tenants update is the exact shape of the bug:
    // no error, no rows, cheerful redirect. Exactly one such write is allowed, and only
    // because it checks the caller's power level itself a few lines earlier.
    const uncheckedShape = /const \{ error \} = await supabase\s*\n\s*\.from\("tenants"\)\s*\n\s*\.update\(\{ consultant_access_revoked/g;
    expect([...adminActions.matchAll(uncheckedShape)]).toHaveLength(1);

    const anyUncheckedShape = /const \{ error \} = await supabase\s*\n\s*\.from\("tenants"\)\s*\n\s*\.update\(/g;
    expect([...adminActions.matchAll(anyUncheckedShape)]).toHaveLength(1);
  });
});
