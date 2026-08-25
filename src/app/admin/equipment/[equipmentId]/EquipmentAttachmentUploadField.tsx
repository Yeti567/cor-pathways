"use client";

import { Loader2, Paperclip, X } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import {
  buildEquipmentAttachmentStoragePath,
  equipmentAttachmentBucket,
  equipmentAttachmentMaxBytes,
  type EquipmentAttachmentFolder,
} from "@/lib/equipment";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type UploadedAttachment = {
  name: string;
  path: string;
};

type Props = {
  accept: string;
  allowedMimeTypes: readonly string[];
  equipmentId: string;
  fieldName?: string;
  folder: EquipmentAttachmentFolder;
  hint?: string;
  inputClass: string;
  label: string;
  submitClass: string;
  submitIcon: ReactNode;
  submitLabel: string;
  tenantId: string;
};

function describeSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function EquipmentAttachmentUploadField({
  accept,
  allowedMimeTypes,
  equipmentId,
  fieldName = "uploadedAttachmentPaths",
  folder,
  hint,
  inputClass,
  label,
  submitClass,
  submitIcon,
  submitLabel,
  tenantId,
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
        // Say which file and why, so a rejected scan does not read as the whole
        // batch failing when the rest went up fine.
        if (!allowedMimeTypes.includes(file.type)) {
          setError(`${file.name} is not a supported file type. Choose a PDF or a photo.`);
          break;
        }

        if (file.size > equipmentAttachmentMaxBytes) {
          setError(
            `${file.name} is ${describeSize(file.size)}. The limit is ${describeSize(equipmentAttachmentMaxBytes)} — rescan it at a lower quality and try again.`,
          );
          break;
        }

        const path = buildEquipmentAttachmentStoragePath({ equipmentId, fileName: file.name, folder, index, tenantId });
        const { error: uploadError } = await supabase.storage.from(equipmentAttachmentBucket).upload(path, file, {
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
        setAttachments((current) => [...current, ...uploaded]);
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

    // Best effort: the record never referenced this file, so a leftover object is
    // untidy rather than wrong, and a failed cleanup must not block the save.
    try {
      await createSupabaseBrowserClient().storage.from(equipmentAttachmentBucket).remove([path]);
    } catch {
      // Ignored on purpose.
    }
  }

  return (
    <>
      <label className="space-y-2">
        <span className="text-sm font-medium text-[var(--ink)]">{label}</span>
        <input
          accept={accept}
          className={inputClass}
          disabled={busy}
          multiple
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
        <p className="rounded-md border border-[var(--danger)] bg-[var(--danger-soft,transparent)] px-3 py-2 text-xs font-semibold text-[var(--danger)]">
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
        change must not introduce.
      */}
      <button className={submitClass} disabled={busy} type="submit">
        {submitIcon}
        {busy ? "Uploading..." : submitLabel}
      </button>
    </>
  );
}
