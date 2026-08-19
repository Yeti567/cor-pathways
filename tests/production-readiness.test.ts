import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProductionReadinessChecklist, productionReadinessCounts } from "@/lib/production-readiness";

const readyEnv = {
  CRON_SECRET: "cron-secret",
  EMAIL_DELIVERY_FROM: "forms@example.test",
  EMAIL_DELIVERY_WEBHOOK_SECRET: "email-secret",
  EMAIL_DELIVERY_WEBHOOK_URL: "https://email.example.test/send",
  GCP_DOCAI_LOCATION: "us",
  GCP_DOCAI_PROCESSOR_ID: "processor-1",
  GCP_PROJECT_ID: "project-1",
  GOOGLE_APPLICATION_CREDENTIALS_JSON: "{}",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_APP_URL: "https://app.example.test",
  NEXT_PUBLIC_SSO_PROVIDER: "azure",
  OPENROUTER_API_KEY: "openrouter",
  OPENROUTER_FORM_IMPORT_MODEL: "google/gemini-3.5-flash",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

describe("production readiness checklist", () => {
  it("reports production dependencies and manual verification items", () => {
    const checklist = buildProductionReadinessChecklist({
      env: readyEnv,
      manifestExists: true,
      serviceWorkerExists: true,
    });

    expect(checklist.map((item) => item.id)).toEqual([
      "supabase-public",
      "supabase-service-role",
      "app-url",
      "sso-provider",
      "certification-cron",
      "document-ai",
      "openrouter",
      "email-delivery",
      "pwa-assets",
      "supabase-migrations",
      "tenant-documents-bucket",
    ]);
    expect(productionReadinessCounts(checklist)).toEqual({
      needsSetup: 0,
      ready: 10,
      total: 11,
      verify: 1,
    });
  });

  it("marks Supabase migrations ready when every repo migration is applied", () => {
    const checklist = buildProductionReadinessChecklist({
      env: readyEnv,
      appliedMigrationNames: ["foundation", "equipment_inventory"],
      repoMigrationNames: ["foundation", "equipment_inventory"],
    });

    expect(checklist.find((item) => item.id === "supabase-migrations")).toMatchObject({
      missingEnv: [],
      status: "ready",
    });
  });

  it("flags unapplied Supabase migrations without false readiness", () => {
    const checklist = buildProductionReadinessChecklist({
      env: readyEnv,
      appliedMigrationNames: ["foundation"],
      repoMigrationNames: ["foundation", "equipment_inventory", "medical_vault"],
    });

    expect(checklist.find((item) => item.id === "supabase-migrations")).toMatchObject({
      missingEnv: ["equipment_inventory", "medical_vault"],
      status: "needs_setup",
    });
  });

  it("keeps Supabase migrations as a manual verify when applied names are unavailable", () => {
    const unknownApplied = buildProductionReadinessChecklist({
      env: readyEnv,
      appliedMigrationNames: null,
      repoMigrationNames: ["foundation"],
    });
    const noRepoFiles = buildProductionReadinessChecklist({
      env: readyEnv,
      appliedMigrationNames: ["foundation"],
      repoMigrationNames: [],
    });

    expect(unknownApplied.find((item) => item.id === "supabase-migrations")?.status).toBe("verify");
    expect(noRepoFiles.find((item) => item.id === "supabase-migrations")?.status).toBe("verify");
  });

  it("tracks missing env vars without exposing secret values", () => {
    const checklist = buildProductionReadinessChecklist({
      env: {
        EMAIL_DELIVERY_WEBHOOK_URL: "https://email.example.test/send",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        OPENROUTER_FORM_IMPORT_MODEL: "google/gemini-3.5-flash",
      },
      certificationCronConfigReady: false,
      manifestExists: false,
      pwaIconExists: false,
      serviceWorkerExists: true,
      tenantDocumentsStorageReady: false,
    });

    expect(checklist.find((item) => item.id === "supabase-public")).toMatchObject({
      missingEnv: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
      status: "needs_setup",
    });
    expect(checklist.find((item) => item.id === "app-url")).toMatchObject({
      missingEnv: ["NEXT_PUBLIC_APP_URL"],
      status: "needs_setup",
    });
    expect(checklist.find((item) => item.id === "sso-provider")).toMatchObject({
      missingEnv: ["NEXT_PUBLIC_SSO_PROVIDER"],
      status: "needs_setup",
    });
    expect(checklist.find((item) => item.id === "certification-cron")).toMatchObject({
      missingEnv: ["CRON_SECRET", "vercel.json:/api/cron/certification-reminders"],
      status: "needs_setup",
    });
    expect(checklist.find((item) => item.id === "email-delivery")).toMatchObject({
      missingEnv: ["EMAIL_DELIVERY_FROM", "EMAIL_DELIVERY_WEBHOOK_SECRET"],
      status: "needs_setup",
    });
    expect(checklist.find((item) => item.id === "document-ai")?.missingEnv).toEqual([
      "GCP_PROJECT_ID",
      "GCP_DOCAI_LOCATION",
      "GCP_DOCAI_PROCESSOR_ID",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_APPLICATION_CREDENTIALS_JSON",
      "GOOGLE_APPLICATION_CREDENTIALS_BASE64",
    ]);
    expect(checklist.find((item) => item.id === "pwa-assets")).toMatchObject({
      missingEnv: ["src/app/manifest.ts", "public/icons/icon.svg"],
      status: "needs_setup",
    });
    expect(checklist.find((item) => item.id === "tenant-documents-bucket")).toMatchObject({
      missingEnv: ["supabase/migrations/20260716000000_initial_schema.sql"],
      status: "needs_setup",
    });
  });

  it("surfaces the checklist from setup and documents required environment placeholders", () => {
    const setupPage = readFileSync(join(process.cwd(), "src/app/admin/setup/page.tsx"), "utf8");
    const envExample = readFileSync(join(process.cwd(), ".env.example"), "utf8");

    expect(setupPage).toContain("buildProductionReadinessChecklist");
    expect(setupPage).toContain("Production Readiness");
    expect(setupPage).toContain("Missing: {item.missingEnv.join");
    expect(readFileSync(join(process.cwd(), "src/app/manifest.ts"), "utf8")).toContain("/icons/icon.svg");
    expect(envExample).toContain("NEXT_PUBLIC_SSO_PROVIDER=");
    expect(envExample).toContain("NEXT_PUBLIC_APP_URL=");
    expect(envExample).toContain("CRON_SECRET=");
    expect(envExample).toContain("EMAIL_DELIVERY_WEBHOOK_URL=");
    expect(envExample).toContain("EMAIL_DELIVERY_FROM=");
    expect(envExample).toContain("EMAIL_DELIVERY_WEBHOOK_SECRET=");
  });
});
