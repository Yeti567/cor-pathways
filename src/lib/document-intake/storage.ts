// Where intake files live while they wait, and the checks on paths the browser chose.
//
// The browser uploads straight to storage (a Server Action body is capped at 1 MB) and then
// tells the server the paths. The server trusts none of it: a path counts only when it sits
// directly inside this tenant's own intake folder for this batch, with a plain filename.
// That is the same rule parseUploadedEquipmentAttachmentPaths applies to a unit's folder,
// and it stops a tampered request pointing an intake row at someone else's file.

import { sanitizeStorageFilename } from "@/lib/document-control";
import { equipmentAttachmentBucket, equipmentAttachmentMaxBytes } from "@/lib/equipment";

export const INTAKE_BUCKET = equipmentAttachmentBucket;
export const INTAKE_MAX_BYTES = equipmentAttachmentMaxBytes;

/**
 * What can be uploaded. HEIC is deliberately absent: the reader cannot open it, and
 * accepting a file that is then always sent to review would look like a fault. Phone
 * photos arrive as JPEG from a browser file picker on every current device.
 */
export const INTAKE_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"] as const;

/** Most files one registration call will take, so a request body stays small. */
export const INTAKE_MAX_FILES_PER_REGISTRATION = 500;

export function intakeStoragePrefix(input: { batchId: string; tenantId: string }) {
  return `${input.tenantId}/intake/${input.batchId}/`;
}

export function buildIntakeStoragePath(input: { batchId: string; fileName: string; index: number; tenantId: string }) {
  return `${intakeStoragePrefix(input)}${Date.now()}-${input.index}-${sanitizeStorageFilename(input.fileName)}`;
}

export type UploadedIntakeFile = {
  name: string;
  path: string;
  size: number;
  type: string;
};

export type RejectedIntakeFile = {
  name: string;
  reason: string;
};

/**
 * Splits what the browser says it uploaded into files worth queueing and files that are not,
 * with a reason for each rejection so nothing disappears silently.
 */
export function validateUploadedIntakeFiles(
  files: readonly UploadedIntakeFile[],
  location: { batchId: string; tenantId: string },
): { accepted: UploadedIntakeFile[]; rejected: RejectedIntakeFile[] } {
  const prefix = intakeStoragePrefix(location);
  const accepted: UploadedIntakeFile[] = [];
  const rejected: RejectedIntakeFile[] = [];
  const seen = new Set<string>();

  for (const file of files) {
    const name = typeof file.name === "string" && file.name.trim() ? file.name.trim() : "unnamed file";
    const path = typeof file.path === "string" ? file.path.trim() : "";

    if (!path.startsWith(prefix)) {
      rejected.push({ name, reason: "The file was not uploaded to this company's intake folder." });
      continue;
    }

    const fileName = path.slice(prefix.length);

    if (!/^[\w.-]+$/.test(fileName) || /^\.+$/.test(fileName)) {
      rejected.push({ name, reason: "The stored file name is not valid." });
      continue;
    }

    if (seen.has(path)) {
      continue;
    }

    if (!(INTAKE_MIME_TYPES as readonly string[]).includes(file.type)) {
      rejected.push({ name, reason: "Only PDF, JPEG, PNG and WebP files can be read." });
      continue;
    }

    if (!Number.isFinite(file.size) || file.size <= 0 || file.size > INTAKE_MAX_BYTES) {
      rejected.push({ name, reason: "The file is empty or larger than 10 MB. Rescan it at a lower quality." });
      continue;
    }

    seen.add(path);
    accepted.push({ name, path, size: file.size, type: file.type });
  }

  return { accepted, rejected };
}
