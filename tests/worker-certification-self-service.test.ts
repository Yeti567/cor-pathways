import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeIdentifier } from "@/lib/duplicate-check";

// Worker self-service on certifications is the one place in the app where a
// non-admin updates a compliance record. The guarantee that matters is that a
// worker can only ever touch their OWN ticket, and it is enforced in two places:
// the row-level policies in the migration, and an explicit check in the action so
// the worker gets a sentence rather than a silent no-op.
//
// Neither layer has a natural unit test (one is SQL, the other is IO against
// Supabase), and both are the kind of thing a later refactor removes without
// noticing. These assertions are the regression guard, in the same source-reading
// style as tests/access-permission-matrix.test.ts.

const workerActions = readSource("src/app/actions.ts");
const migration = readSource("supabase/migrations/20260814000000_certification_worker_self_service.sql");

function readSource(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function actionBody(name: string) {
  const marker = `export async function ${name}`;
  const start = workerActions.indexOf(marker);

  expect(start, `${name} is not exported from src/app/actions.ts`).toBeGreaterThan(-1);

  const next = workerActions.indexOf("\nexport async function ", start + marker.length);
  return workerActions.slice(start, next === -1 ? undefined : next);
}

describe("renewWorkerCertification", () => {
  const body = actionBody("renewWorkerCertification");

  it("resolves the caller's own worker profile from their session, never from the form", () => {
    // Taking a worker profile id off the submitted form would let anyone renew
    // anyone's ticket by editing one hidden field.
    expect(body).toContain('.eq("user_id", context.appUser.id)');
    expect(body).not.toContain('stringValue(formData, "workerProfileId")');
  });

  it("refuses a ticket that belongs to someone else", () => {
    expect(body).toContain("certification.worker_profile_id !== workerProfile.id");
  });

  it("scopes every read and the write to the caller's tenant", () => {
    const tenantScopes = body.match(/\.eq\("tenant_id", context\.appUser\.tenant_id\)/g) ?? [];

    expect(tenantScopes.length).toBeGreaterThanOrEqual(3);
  });

  it("updates the existing row instead of inserting a second ticket", () => {
    // A renewal filed as a new record leaves the old one expired on the worker's
    // file forever, reporting a deficiency on a qualification they hold.
    expect(body).toContain(".update({");
    expect(body).not.toContain(".insert(");
  });

  it("checks that a row was actually affected", () => {
    // An UPDATE that matches nothing under RLS returns success with zero rows.
    expect(body).toContain("!updated?.id");
  });

  it("removes the uploaded file when the write does not land", () => {
    expect(body).toContain('.remove([attachmentPath])');
  });

  it("keeps the previous card in the audit trail rather than deleting it", () => {
    expect(body).toContain("previous_attachment_path");
    expect(body).toContain('action: "certification.worker_renewal"');
  });

  it("falls back to the recorded dates, so supplying only a photo is enough", () => {
    expect(body).toContain("expiresOn ?? certification.expires_on");
    expect(body).toContain("issuedOn ?? certification.issued_on");
  });
});

describe("uploadWorkerCertificationTicket", () => {
  const body = actionBody("uploadWorkerCertificationTicket");

  it("stops a worker filing a second copy of a ticket they already hold", () => {
    expect(body).toContain("normalizeIdentifier(name)");
    expect(body).toContain("Use Renew on that ticket");
  });

  it("treats the spellings of one ticket name as the same ticket", () => {
    expect(normalizeIdentifier("First Aid")).toBe(normalizeIdentifier("first-aid"));
    expect(normalizeIdentifier("H2S Alive")).not.toBe(normalizeIdentifier("H2S"));
  });
});

describe("certification row-level policies", () => {
  it("lets an administrator manage anyone's certifications", () => {
    expect(migration).toContain('create or replace function "authz"."can_manage_certifications"()');
    // Must match canUseAdminPanel in src/lib/access-control.ts.
    expect(migration).toContain("u.app_access in ('admin_access', 'super_admin_access')");
    expect(migration).toContain("u.power_level in ('super_admin', 'consultant')");
  });

  it("recognises a worker's own profile, tenant included", () => {
    expect(migration).toContain('create or replace function "authz"."owns_worker_profile"');
    expect(migration).toContain("wp.user_id = auth.uid()");
    expect(migration).toContain("wp.tenant_id = authz.current_user_tenant_id()");
  });

  it("does not leave the security definer functions callable by anon", () => {
    expect(migration).toContain('revoke all on function "authz"."can_manage_certifications"() from public');
    expect(migration).toContain(
      'revoke all on function "authz"."owns_worker_profile"("target_worker_profile_id" "uuid") from public',
    );
  });

  it("scopes insert and update to an administrator or the worker themselves", () => {
    for (const command of ["insert", "update"]) {
      const policy = migration.slice(
        migration.indexOf(`create policy "certifications_tenant_${command}"`),
        migration.indexOf(`create policy "certifications_tenant_${command}"`) + 900,
      );

      expect(policy, `${command} policy`).toContain('"authz"."can_manage_certifications"()');
      expect(policy, `${command} policy`).toContain('"authz"."owns_worker_profile"("worker_profile_id")');
    }
  });

  it("gives update a WITH CHECK, so a ticket cannot be moved onto another worker", () => {
    const updatePolicy = migration.slice(migration.indexOf('create policy "certifications_tenant_update"'));

    expect(updatePolicy).toContain("with check");
  });

  it("keeps deleting a compliance record an administrative act", () => {
    const deletePolicy = migration.slice(migration.indexOf('create policy "certifications_tenant_delete"'));

    expect(deletePolicy).toContain('"authz"."can_manage_certifications"()');
    expect(deletePolicy).not.toContain('"authz"."owns_worker_profile"');
  });
});
