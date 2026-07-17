import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ProductionReadinessStatus = "ready" | "needs_setup" | "verify";

export type ProductionReadinessItem = {
  detail: string;
  id: string;
  missingEnv: string[];
  status: ProductionReadinessStatus;
  title: string;
};

type ProductionReadinessInput = {
  appliedMigrationNames?: string[] | null;
  certificationCronConfigReady?: boolean;
  env?: Partial<NodeJS.ProcessEnv>;
  pwaIconExists?: boolean;
  manifestExists?: boolean;
  repoMigrationNames?: string[];
  serviceWorkerExists?: boolean;
  tenantDocumentsStorageReady?: boolean;
};

const certificationReminderCronPath = "/api/cron/certification-reminders";
const vercelConfigPath = "vercel.json";
const migrationsDir = "supabase/migrations";
// The whole schema is one generated baseline. The bucket and its policies live
// outside the public schema, so they are declared explicitly at the end of it;
// this check is what catches them going missing.
const schemaMigrationPath = "supabase/migrations/20260716000000_initial_schema.sql";

function envConfigured(env: Partial<NodeJS.ProcessEnv>, key: string) {
  return Boolean(env[key]?.trim());
}

function missingRequiredEnv(env: Partial<NodeJS.ProcessEnv>, keys: string[]) {
  return keys.filter((key) => !envConfigured(env, key));
}

function missingAnyEnv(env: Partial<NodeJS.ProcessEnv>, keys: string[]) {
  return keys.some((key) => envConfigured(env, key)) ? [] : keys;
}

function envItem(input: {
  detail: string;
  env: Partial<NodeJS.ProcessEnv>;
  id: string;
  oneOf?: string[];
  required?: string[];
  title: string;
}) {
  const missingEnv = [
    ...missingRequiredEnv(input.env, input.required ?? []),
    ...(input.oneOf ? missingAnyEnv(input.env, input.oneOf) : []),
  ];

  return {
    detail: input.detail,
    id: input.id,
    missingEnv,
    status: missingEnv.length > 0 ? "needs_setup" : "ready",
    title: input.title,
  } satisfies ProductionReadinessItem;
}

function manualItem(input: { detail: string; id: string; title: string }) {
  return {
    detail: input.detail,
    id: input.id,
    missingEnv: [],
    status: "verify",
    title: input.title,
  } satisfies ProductionReadinessItem;
}

const supabaseMigrationsDetail =
  "Apply all Supabase migrations in production, including tenant audit, equipment, document control, and notification delivery.";

// The applied migration record stores the name without the leading timestamp,
// so derive the same name from each repo file to compare the two sets.
function migrationNameFromFile(file: string) {
  const base = file.replace(/\.sql$/i, "");
  const separator = base.indexOf("_");

  return separator === -1 ? base : base.slice(separator + 1);
}

function readRepoMigrationNames() {
  const dir = join(process.cwd(), migrationsDir);

  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .filter((file) => file.toLowerCase().endsWith(".sql"))
    .map(migrationNameFromFile);
}

function supabaseMigrationsItem(input: {
  appliedMigrationNames: string[] | null | undefined;
  repoMigrationNames: string[];
}) {
  // Fall back to a manual "verify" prompt when we cannot read either side of the
  // comparison (e.g. the RPC is unavailable or the migration files were not
  // bundled into the deployment), rather than reporting a false "ready".
  if (input.appliedMigrationNames == null || input.repoMigrationNames.length === 0) {
    return manualItem({ detail: supabaseMigrationsDetail, id: "supabase-migrations", title: "Supabase migrations" });
  }

  const applied = new Set(input.appliedMigrationNames);
  const missing = input.repoMigrationNames.filter((name) => !applied.has(name));

  return {
    detail: supabaseMigrationsDetail,
    id: "supabase-migrations",
    missingEnv: missing,
    status: missing.length === 0 ? "ready" : "needs_setup",
    title: "Supabase migrations",
  } satisfies ProductionReadinessItem;
}

function hasTenantDocumentsStorageMigration() {
  const migrationPath = join(process.cwd(), schemaMigrationPath);

  if (!existsSync(migrationPath)) {
    return false;
  }

  // pg_dump writes UPPERCASE keywords and "quoted"."identifiers"; normalise so these
  // snippets read the way the SQL was originally written.
  const schema = readFileSync(migrationPath, "utf8").toLowerCase().replace(/"/g, "");

  return [
    "insert into storage.buckets",
    "'tenant-documents'",
    "function authz.can_access_storage_tenant_path(object_name text)",
    "create policy tenant_documents_select",
    "create policy tenant_documents_insert",
    "create policy tenant_documents_update",
    "create policy tenant_documents_delete",
    "authz.can_access_storage_tenant_path(name)",
  ].every((snippet) => schema.includes(snippet));
}

function hasCertificationCronConfig() {
  const configPath = join(process.cwd(), vercelConfigPath);

  if (!existsSync(configPath)) {
    return false;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      crons?: { path?: unknown; schedule?: unknown }[];
    };

    return Boolean(
      config.crons?.some(
        (cron) =>
          cron.path === certificationReminderCronPath &&
          typeof cron.schedule === "string" &&
          Boolean(cron.schedule.trim()),
      ),
    );
  } catch {
    return false;
  }
}

export function buildProductionReadinessChecklist(input: ProductionReadinessInput = {}) {
  const env = input.env ?? process.env;
  const certificationCronConfigReady = input.certificationCronConfigReady ?? hasCertificationCronConfig();
  const pwaIconExists = input.pwaIconExists ?? existsSync(join(process.cwd(), "public/icons/icon.svg"));
  const serviceWorkerExists =
    input.serviceWorkerExists ?? existsSync(join(process.cwd(), "src/app/sw.js/route.ts"));
  const manifestExists = input.manifestExists ?? existsSync(join(process.cwd(), "public/manifest.webmanifest"));
  const tenantDocumentsStorageReady = input.tenantDocumentsStorageReady ?? hasTenantDocumentsStorageMigration();
  const repoMigrationNames = input.repoMigrationNames ?? readRepoMigrationNames();
  const certificationCronMissing = [
    ...missingRequiredEnv(env, ["CRON_SECRET"]),
    ...(certificationCronConfigReady ? [] : [`${vercelConfigPath}:${certificationReminderCronPath}`]),
  ];
  const pwaMissing = [
    ...(serviceWorkerExists ? [] : ["src/app/sw.js/route.ts"]),
    ...(manifestExists ? [] : ["public/manifest.webmanifest"]),
    ...(pwaIconExists ? [] : ["public/icons/icon.svg"]),
  ];

  return [
    envItem({
      detail: "Public Supabase URL and publishable key are required before any route can authenticate users.",
      env,
      id: "supabase-public",
      oneOf: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
      required: ["NEXT_PUBLIC_SUPABASE_URL"],
      title: "Supabase public client",
    }),
    envItem({
      detail: "Worker invite/import flows, cron work, and server-only maintenance use the Supabase service role key.",
      env,
      id: "supabase-service-role",
      required: ["SUPABASE_SERVICE_ROLE_KEY"],
      title: "Supabase service role",
    }),
    envItem({
      detail: "Auth callbacks, worker invites, and login redirects need the production app URL instead of the local fallback.",
      env,
      id: "app-url",
      required: ["NEXT_PUBLIC_APP_URL"],
      title: "Application URL",
    }),
    envItem({
      detail: "The SSO login button needs a supported Supabase OAuth provider such as azure, workos, or a custom provider id.",
      env,
      id: "sso-provider",
      required: ["NEXT_PUBLIC_SSO_PROVIDER"],
      title: "SSO provider",
    }),
    {
      detail: "Scheduled certification reminders require a bearer secret and a Vercel cron entry for the reminder endpoint.",
      id: "certification-cron",
      missingEnv: certificationCronMissing,
      status: certificationCronMissing.length === 0 ? "ready" : "needs_setup",
      title: "Certification reminder cron",
    } satisfies ProductionReadinessItem,
    envItem({
      detail: "Document AI needs project, location, processor, and one credential source for PDF-to-form extraction.",
      env,
      id: "document-ai",
      oneOf: ["GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_APPLICATION_CREDENTIALS_JSON", "GOOGLE_APPLICATION_CREDENTIALS_BASE64"],
      required: ["GCP_PROJECT_ID", "GCP_DOCAI_LOCATION", "GCP_DOCAI_PROCESSOR_ID"],
      title: "Google Document AI",
    }),
    envItem({
      detail: "OpenRouter Gemini turns extracted document text into form-builder field schema suggestions.",
      env,
      id: "openrouter",
      required: ["OPENROUTER_API_KEY", "OPENROUTER_FORM_IMPORT_MODEL"],
      title: "OpenRouter Gemini",
    }),
    envItem({
      detail: "Auto-share email delivery needs a webhook target, sender identity, and shared secret when the email integration is enabled.",
      env,
      id: "email-delivery",
      required: ["EMAIL_DELIVERY_WEBHOOK_URL", "EMAIL_DELIVERY_FROM", "EMAIL_DELIVERY_WEBHOOK_SECRET"],
      title: "Email delivery webhook",
    }),
    {
      detail: "The worker app needs the web manifest, app icon, and service worker available from the production public assets.",
      id: "pwa-assets",
      missingEnv: pwaMissing,
      status: pwaMissing.length > 0 ? "needs_setup" : "ready",
      title: "PWA assets",
    } satisfies ProductionReadinessItem,
    supabaseMigrationsItem({
      appliedMigrationNames: input.appliedMigrationNames,
      repoMigrationNames,
    }),
    {
      detail: "The tenant-documents storage bucket and tenant-scoped object policies must be declared in the Supabase storage migration.",
      id: "tenant-documents-bucket",
      missingEnv: tenantDocumentsStorageReady
        ? []
        : [schemaMigrationPath],
      status: tenantDocumentsStorageReady ? "ready" : "needs_setup",
      title: "Tenant document storage",
    } satisfies ProductionReadinessItem,
  ] satisfies ProductionReadinessItem[];
}

export function productionReadinessCounts(items: ProductionReadinessItem[]) {
  return {
    needsSetup: items.filter((item) => item.status === "needs_setup").length,
    ready: items.filter((item) => item.status === "ready").length,
    total: items.length,
    verify: items.filter((item) => item.status === "verify").length,
  };
}
