import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const cronRoute = readFileSync(join(process.cwd(), "src/app/api/cron/certification-reminders/route.ts"), "utf8");
const workersPage = readFileSync(join(process.cwd(), "src/app/admin/workers/page.tsx"), "utf8");
const vercelConfig = JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8"));

describe("certification reminder cron wiring", () => {
  it("protects the cron route with CRON_SECRET and service role access", () => {
    expect(cronRoute).toContain("process.env.CRON_SECRET");
    expect(cronRoute).toContain('authHeader !== `Bearer ${cronSecret}`');
    expect(cronRoute).toContain("createSupabaseAdminClient");
    expect(cronRoute).toContain("sendCertificationExpiryNotifications(tenant.id, now, supabase,");
    expect(cronRoute).toContain("auditClient: supabase");
    expect(cronRoute).toContain('auditSource: "cron"');
    expect(cronRoute).toContain('action: "certification_reminders.send"');
    expect(cronRoute).toContain('actorRole: "system"');
    expect(cronRoute).toContain("notification_count: result.created");
    expect(cronRoute).toContain("result.error || result.auditError");
  });

  it("schedules the daily certification reminder endpoint", () => {
    expect(vercelConfig.crons).toContainEqual({
      path: "/api/cron/certification-reminders",
      schedule: "0 13 * * *",
    });
  });

  it("surfaces certification deficiencies on the admin workers page", () => {
    expect(workersPage).toContain("buildCertificationDeficiencySummaries");
    expect(workersPage).toContain("Certification Deficiencies");
    expect(workersPage).toContain("Expired {deficiency.daysExpired}");
    expect(workersPage).toContain("?tab=certifications");
  });
});
