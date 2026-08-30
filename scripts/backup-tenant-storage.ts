// A restore point for one tenant's FILES, written to a local folder.
//
// WHY THIS EXISTS, and why backup-tenant-data.ts is not enough.
//
// That script exports table rows. This one exports the files those rows point at, and
// they are two different problems with two different failure modes. Supabase is explicit
// that its own backups do not help here:
//
//   "Database backups do not include objects you store via the Storage API, as the
//    database only includes metadata about these objects. Restoring an old backup does
//    not restore objects you deleted after that backup."
//
// That holds on EVERY plan. Moving a project to Pro buys daily backups of the database
// and changes nothing about the files. So a project can be fully backed up by the
// platform's own definition and still lose every ticket scan, licence and abstract, with
// the database left holding rows that confidently point at files that are gone.
//
// For a compliance app that is the whole ballgame. A certification row saying H2S Alive
// expires 2027-05-03 is not evidence. The scan behind it is the evidence, and it is the
// thing an auditor asks to see.
//
// WHAT IT WRITES. Every object under the tenant's prefix, at its real path, plus a
// manifest recording each file's size and SHA-256. The manifest is what makes this a
// backup rather than a pile of files: it is how a later run proves the copy is complete
// and unaltered, and how a restore knows what it is putting back.
//
// THE OUTPUT IS PII -- licences, abstracts, tickets, another company's employees' identity
// documents. It must stay in a local folder outside the repo, never OneDrive, never a
// cloud folder, and it should be deleted once there is a real backup. The default is
// ~/tenant-backups.
//
// Usage:
//   npx tsx scripts/backup-tenant-storage.ts --tenant <uuid> [--out <folder>] [--verify]
//
// --verify re-reads an existing backup folder and checks it against the live bucket
// without downloading anything, so "is my restore point still good" is a cheap question.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/types/database";

/** Minimal .env.local reader, matching backup-tenant-data.ts. Never echoes a value. */
function loadEnv(): void {
  const path = join(process.cwd(), ".env.local");

  if (!existsSync(path)) {
    return;
  }

  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);

    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

/**
 * The buckets a tenant's files live in.
 *
 * medical-vault is DELIBERATELY ABSENT. It holds modified-duty restrictions written by a
 * doctor, exactly one person at this client is permitted to open it, and the whole point
 * of that bucket is that its contents do not spread. Copying it to an unencrypted folder
 * on a consultant's laptop would defeat the access control that was deliberately tightened
 * in 20260826040000_medical_vault_explicit_grant_only.sql. It is empty today and it should
 * stay out of this script even when it is not. If it ever genuinely needs a backup, that
 * is an encrypted one, agreed with the client, not a flag added here.
 *
 * Same reasoning as backup-tenant-data.ts leaving out eld_connection_secret.
 */
const BUCKETS = ["tenant-documents", "subcontractor-documents"] as const;

type StoredObject = { path: string; bucket: string; size: number };

type ManifestEntry = { bucket: string; path: string; bytes: number; sha256: string };

/**
 * Every object under a prefix, walking down through folders.
 *
 * The Storage list API returns one level at a time and marks a folder by giving it a null
 * id, so the only way to see everything is to recurse. Paginated at 100 because a folder
 * with more entries than the page size silently returns a truncated list, and a backup
 * that quietly skips files is worse than no backup.
 */
async function listRecursive(
  supabase: ReturnType<typeof createClient<Database>>,
  bucket: string,
  prefix: string,
): Promise<StoredObject[]> {
  const found: StoredObject[] = [];
  const pageSize = 100;
  let offset = 0;

  for (;;) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });

    if (error) {
      throw new Error(`listing ${bucket}/${prefix}: ${error.message}`);
    }

    const page = data ?? [];

    for (const entry of page) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      // A null id means this is a folder, not a file.
      if (entry.id === null) {
        found.push(...(await listRecursive(supabase, bucket, path)));
      } else {
        found.push({
          bucket,
          path,
          size: Number((entry.metadata as { size?: number } | null)?.size ?? 0),
        });
      }
    }

    if (page.length < pageSize) {
      return found;
    }

    offset += pageSize;
  }
}

function parseArgs(argv: string[]) {
  const read = (flag: string) => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const tenant = read("--tenant");

  if (!tenant) {
    console.error(
      "Usage: npx tsx scripts/backup-tenant-storage.ts --tenant <uuid> [--out <folder>] [--verify]",
    );
    process.exit(1);
  }

  return {
    tenant,
    out: read("--out") ?? join(homedir(), "tenant-backups", `storage-${tenant}`),
    verify: argv.includes("--verify"),
  };
}

async function main(): Promise<void> {
  loadEnv();

  const args = parseArgs(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local.");
    process.exit(1);
  }

  const supabase = createClient<Database>(url, key, { auth: { persistSession: false } });

  console.log(`Tenant:  ${args.tenant}`);
  console.log(`Out:     ${args.out}`);
  console.log(args.verify ? "Mode:    VERIFY, nothing will be downloaded" : "Mode:     download");
  console.log("");

  const manifest: ManifestEntry[] = [];
  const problems: string[] = [];
  let bytes = 0;

  for (const bucket of BUCKETS) {
    const objects = await listRecursive(supabase, bucket, args.tenant);

    console.log(`  ${bucket}: ${objects.length} object(s)`);

    for (const object of objects) {
      const target = join(args.out, bucket, ...object.path.split("/"));

      if (args.verify) {
        if (!existsSync(target)) {
          problems.push(`${bucket}/${object.path}: missing from the backup folder`);
          continue;
        }

        const onDisk = readFileSync(target);

        // Size is what the bucket claims; the local file is what we actually hold. A
        // mismatch means a truncated or altered copy, which is the failure a backup is
        // least able to afford and most likely to hide.
        if (object.size > 0 && onDisk.byteLength !== object.size) {
          problems.push(
            `${bucket}/${object.path}: ${onDisk.byteLength} bytes locally, bucket says ${object.size}`,
          );
          continue;
        }

        manifest.push({
          bucket,
          path: object.path,
          bytes: onDisk.byteLength,
          sha256: createHash("sha256").update(onDisk).digest("hex"),
        });
        bytes += onDisk.byteLength;
        continue;
      }

      const { data, error } = await supabase.storage.from(bucket).download(object.path);

      if (error || !data) {
        problems.push(`${bucket}/${object.path}: download failed, ${error?.message ?? "no data"}`);
        continue;
      }

      const buffer = Buffer.from(await data.arrayBuffer());

      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, buffer);

      manifest.push({
        bucket,
        path: object.path,
        bytes: buffer.byteLength,
        sha256: createHash("sha256").update(buffer).digest("hex"),
      });
      bytes += buffer.byteLength;
    }
  }

  if (!args.verify) {
    mkdirSync(args.out, { recursive: true });
    writeFileSync(
      join(args.out, "manifest.json"),
      JSON.stringify({ tenant: args.tenant, files: manifest.length, bytes, objects: manifest }, null, 2),
      "utf8",
    );
  }

  console.log("");
  console.log(
    `${args.verify ? "Verified" : "Copied"} ${manifest.length} file(s), ${(bytes / 1024 / 1024).toFixed(1)} MB.`,
  );

  if (problems.length > 0) {
    console.error(`\n${problems.length} problem(s):`);
    for (const problem of problems) {
      console.error(`  ! ${problem}`);
    }
    process.exitCode = 1;
  } else if (!args.verify) {
    console.log("");
    console.log("This is an unencrypted copy of personal information: licences, abstracts and");
    console.log("tickets. Keep it off any synced or cloud folder, and delete it once");
    console.log("the project has a real backup.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
