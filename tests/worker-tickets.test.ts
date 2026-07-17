import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readSource("src/app/admin/actions.ts");
const appActions = readSource("src/app/actions.ts");
const adminShell = readSource("src/app/admin/_components/AdminShell.tsx");
const certificationTypesPage = readSource("src/app/admin/certification-types/page.tsx");
const webPage = readSource("src/app/web/page.tsx");
const workerTicketForm = readSource("src/app/web/_components/WorkerCertificationTicketForm.tsx");
const workerTicketsPage = readSource("src/app/admin/worker-tickets/page.tsx");

function readSource(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function actionBody(source: string, name: string) {
  const marker = `export async function ${name}`;
  const start = source.indexOf(marker);
  expect(start, `${name} should be exported`).toBeGreaterThanOrEqual(0);

  const next = source.indexOf("\nexport async function ", start + marker.length);

  return source.slice(start, next === -1 ? source.length : next);
}

describe("worker ticket uploads", () => {
  it("uses server-side storage for admin and worker ticket file uploads", () => {
    const adminUpload = actionBody(adminActions, "createWorkerCertification");
    const workerUpload = actionBody(appActions, "uploadWorkerCertificationTicket");

    expect(adminUpload).toContain("const storageSupabase = createSupabaseAdminClient() ?? supabase");
    expect(adminActions).toContain('"image/heic"');
    expect(adminActions).toContain('"image/heif"');
    expect(adminUpload).toContain('storageSupabase.storage.from("tenant-documents").upload');
    expect(adminUpload).toContain('storageSupabase.storage.from("tenant-documents").remove');
    expect(adminUpload).toContain('revalidatePath("/admin/worker-tickets")');
    expect(workerUpload).toContain("const storageSupabase = createSupabaseAdminClient() ?? supabase");
    expect(appActions).toContain('"image/heic"');
    expect(appActions).toContain('"image/heif"');
    expect(workerUpload).toContain('storageSupabase.storage.from("tenant-documents").upload');
    expect(workerUpload).toContain('storageSupabase.storage.from("tenant-documents").remove');
    expect(workerUpload).toContain('revalidatePath("/admin/worker-tickets")');
    expect(webPage).toContain("const storageSupabase = createSupabaseAdminClient() ?? supabase");
    expect(webPage).toContain('storageSupabase.storage.from("tenant-documents").createSignedUrl');
  });

  it("keeps the employee-side ticket form camera-ready", () => {
    expect(workerTicketForm).toContain('accept="image/*,.pdf,application/pdf"');
    expect(workerTicketForm).toContain('capture="environment"');
    expect(workerTicketForm).toContain('name="attachment"');
    expect(workerTicketForm).toContain("Upload Ticket");
  });

  it("exposes all worker tickets as a dedicated admin register", () => {
    expect(adminShell).toContain('{ href: "/admin/worker-tickets", label: "Employee Tickets", icon: IdCard }');
    expect(certificationTypesPage).toContain('href="/admin/worker-tickets"');
    expect(workerTicketsPage).toContain('title="Employee Tickets"');
    expect(workerTicketsPage).toContain('from("certifications")');
    expect(workerTicketsPage).toContain('from("worker_profiles")');
    expect(workerTicketsPage).toContain('from("users")');
    expect(workerTicketsPage).toContain('createSupabaseAdminClient() ?? supabase');
    expect(workerTicketsPage).toContain('name="returnTo" type="hidden" value="/admin/worker-tickets"');
  });
});
