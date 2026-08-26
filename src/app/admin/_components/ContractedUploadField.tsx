"use client";

import { Loader2, Paperclip, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import {
  buildContractedStoragePath,
  CONTRACTED_ATTACHMENT_MAX_BYTES,
  CONTRACTED_ATTACHMENT_MIME_TYPES,
  CONTRACTED_DOCUMENTS_BUCKET,
  type ContractedStorageLocation,
} from "@/lib/contracted-equipment";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

// Scans go browser to storage, never through the Server Action. A Server Action body is
// capped at 1 MB by Next, which a phone photo or a multi-page scan clears easily, and
// the framework rejects it with a raw 413 before any application code runs, so there is
// no way to turn it into a message anyone can act on. The form posts only the paths.
//
// Same component for contracted units and contracted drivers: the only difference is the
// folder, which the caller supplies as a location.

type UploadedAttachment = {
  name: string;
  path: string;
};

type Props = {
  fieldName?: string;
  hint?: string;
  inputClass: string;
  label: string;
  location: ContractedStorageLocation;
  /** Single file, for a driver ticket which stores one attachment_path. */
  single?: boolean;
  submitClass: string;
  submitIcon: ReactNode;
  submitLabel: string;
};

function describeSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ContractedUploadField({
  fieldName = "uploadedAttachmentPaths",
  hint,
  inputClass,
  label,
  location,
  single = false,
  submitClass,
  submitIcon,
  submitLabel,
}: Props) {
  const [attachments, setAttachments] = useState<UploadedAttachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFiles(fileList: FileList | null) {
    const files = Array.from(fileList ?? []).filter((file) => file.size > 0);

    if (files.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);

    const supabase = createSupabaseBrowserClient();
    const uploaded: UploadedAttachment[] = [];

    try {
      for (const [index, file] of files.entries()) {
        // Say which file and why, so a rejected scan does not read as the whole batch
        // failing when the rest went up fine.
        if (!(CONTRACTED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
          setError(`${file.name} is not a supported file type. Choose a PDF or a photo.`);
          break;
        }

        if (file.size > CONTRACTED_ATTACHMENT_MAX_BYTES) {
          setError(
            `${file.name} is ${describeSize(file.size)}. The limit is ${describeSize(CONTRACTED_ATTACHMENT_MAX_BYTES)} — rescan it at a lower quality and try again.`,
          );
          break;
        }

        const path = buildContractedStoragePath({ ...location, fileName: file.name, index });
        const { error: uploadError } = await supabase.storage
          .from(CONTRACTED_DOCUMENTS_BUCKET)
          .upload(path, file, {
            contentType: file.type || "application/octet-stream",
            upsert: false,
          });

        if (uploadError) {
          setError(`${file.name} was not uploaded. ${uploadError.message}`);
          break;
        }

        uploaded.push({ name: file.name, path });
      }
    } finally {
      if (uploaded.length > 0) {
        setAttachments((current) => (single ? uploaded.slice(-1) : [...current, ...uploaded]));
      }

      // Clearing the picker lets the same file be chosen again after a failure.
      if (inputRef.current) {
        inputRef.current.value = "";
      }

      setBusy(false);
    }
  }

  async function removeAttachment(path: string) {
    setAttachments((current) => current.filter((attachment) => attachment.path !== path));

    // Best effort: the record never referenced this file, so a leftover object is untidy
    // rather than wrong, and a failed cleanup must not block the save.
    try {
      await createSupabaseBrowserClient().storage.from(CONTRACTED_DOCUMENTS_BUCKET).remove([path]);
    } catch {
      // Ignored on purpose.
    }
  }

  return (
    <>
      <label className="space-y-2">
        <span className="text-sm font-medium text-[var(--ink)]">{label}</span>
        <input
          accept=".pdf,image/*"
          className={inputClass}
          disabled={busy}
          multiple={!single}
          onChange={(event) => void handleFiles(event.target.files)}
          ref={inputRef}
          type="file"
        />
        {hint ? <span className="block text-xs text-[var(--ink-muted)]">{hint}</span> : null}
      </label>

      {attachments.map((attachment) => (
        <input key={attachment.path} name={fieldName} type="hidden" value={attachment.path} />
      ))}

      {busy ? (
        <p className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-muted)]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          Uploading...
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-[var(--danger)] px-3 py-2 text-xs font-semibold text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {attachments.length > 0 ? (
        <ul className="space-y-1">
          {attachments.map((attachment) => (
            <li
              className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 py-1 text-xs text-[var(--ink)]"
              key={attachment.path}
            >
              <span className="flex min-w-0 items-center gap-1">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--primary)]" aria-hidden="true" />
                <span className="truncate">{attachment.name}</span>
              </span>
              <button
                aria-label={`Remove ${attachment.name}`}
                className="shrink-0 rounded p-1 text-[var(--ink-muted)] transition hover:text-[var(--danger)]"
                onClick={() => void removeAttachment(attachment.path)}
                type="button"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        Held shut while an upload is in flight. Submitting mid-upload would save the
        record with the attachment silently missing, which is the one failure this
        pattern exists to prevent.
      */}
      <button className={submitClass} disabled={busy} type="submit">
        {submitIcon}
        {busy ? "Uploading..." : submitLabel}
      </button>
    </>
  );
}
