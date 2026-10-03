"use client";

import { FolderUp, Loader2, UploadCloud } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { unzipSync } from "fflate";
import {
  buildIntakeStoragePath,
  INTAKE_BUCKET,
  INTAKE_MAX_BYTES,
  INTAKE_MIME_TYPES,
  type UploadedIntakeFile,
} from "@/lib/document-intake/storage";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { registerIntakeFiles } from "./actions";

// One drop, any shape: loose files, a whole folder, or a zip. Nothing has to be sorted or
// named first, because the app reads each file and works out what it is and which unit it
// belongs to. Files go from the browser straight to storage (a Server Action body is capped
// at 1 MB), are registered, and are then read by the processing route in parallel lanes.

type Props = {
  /** Files already waiting from an earlier visit, so reloading the page resumes the work. */
  queuedCount: number;
  readerConfigured: boolean;
  /** Unit paperwork (default) or people's tickets: decides the reader and the wording. */
  subject?: "unit" | "ticket";
  tenantId: string;
};

const WORDING = {
  ticket: {
    body: "Tickets for anyone: your own staff and your carriers' drivers, in any order. A zip, a folder or a pile of phone photos all work. Nothing needs sorting or renaming first.",
    warning: "Tickets only. Do not include medicals, drug test results, licences, abstracts or hiring forms.",
  },
  unit: {
    body: "Registrations, insurance cards, CVIP certificates, permits and inspection certificates, for any units, in any order. A zip, a folder or a pile of photos all work. Nothing needs sorting or renaming first.",
    warning: "Unit paperwork only. Do not include driver medicals or personal driver records.",
  },
} as const;

type Candidate = { file: File; name: string; type: string };
/** A picked or dropped file and where it sat in the folder it came from. */
type Picked = { file: File; path: string };

const UPLOAD_LANES = 4;
// Each lane makes one processing call at a time and each call reads several files at once.
const READ_LANES = 3;
const MIME_BY_EXTENSION: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  pdf: "application/pdf",
  png: "image/png",
  webp: "image/webp",
};
const IGNORED_ENTRY = /(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db|desktop\.ini)(\/|$)|(^|\/)\._/i;

function extensionOf(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function describeSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function fromPicker(list: FileList | null): Picked[] {
  return Array.from(list ?? []).map((file) => ({
    file,
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // readEntries hands back at most about 100 entries a call; an empty batch is the end.
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
        } else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function walkEntry(entry: FileSystemEntry, into: Picked[]) {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    into.push({ file, path: entry.fullPath.replace(/^\//, "") });
    return;
  }

  if (entry.isDirectory) {
    for (const child of await readAllEntries((entry as FileSystemDirectoryEntry).createReader())) {
      await walkEntry(child, into);
    }
  }
}

// A folder dragged onto the page arrives in dataTransfer.files as one empty item with no
// type, so it used to be skipped as "only PDF and photos can be read". The entries API
// walks into it instead. The entries must be taken synchronously, inside the drop event.
function fromDrop(transfer: DataTransfer): Promise<Picked[]> {
  const entries = Array.from(transfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() ?? null);

  if (entries.length === 0 || entries.some((entry) => entry === null)) {
    return Promise.resolve(fromPicker(transfer.files));
  }

  return (async () => {
    const picked: Picked[] = [];

    for (const entry of entries) {
      await walkEntry(entry as FileSystemEntry, picked);
    }

    return picked;
  })();
}

// Expands zips in the browser, so unpacking costs the server nothing and each file is
// validated and uploaded on its own.
async function expand(files: Picked[]): Promise<{ candidates: Candidate[]; skipped: string[] }> {
  const candidates: Candidate[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  function add(file: File, name: string, type: string) {
    if (IGNORED_ENTRY.test(name)) {
      return;
    }

    const key = `${name}|${file.size}`;

    if (seen.has(key)) {
      return;
    }

    seen.add(key);

    if (!(INTAKE_MIME_TYPES as readonly string[]).includes(type)) {
      skipped.push(`${name} (only PDF and photos can be read)`);
      return;
    }

    if (file.size === 0 || file.size > INTAKE_MAX_BYTES) {
      skipped.push(`${name} (${file.size === 0 ? "empty" : `${describeSize(file.size)}, the limit is 10 MB`})`);
      return;
    }

    candidates.push({ file, name, type });
  }

  for (const { file, path: relative } of files) {
    if (extensionOf(file.name) === "zip" || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
      try {
        const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), {
          filter: (entry) => !entry.name.endsWith("/") && !IGNORED_ENTRY.test(entry.name),
        });

        for (const [entryName, data] of Object.entries(entries)) {
          const type = MIME_BY_EXTENSION[extensionOf(entryName)] ?? "";
          const copy = new Uint8Array(data);
          add(new File([copy], entryName.split("/").pop() ?? entryName, { type }), `${file.name}/${entryName}`, type);
        }
      } catch {
        skipped.push(`${file.name} (the zip could not be opened)`);
      }

      continue;
    }

    add(file, relative, file.type || MIME_BY_EXTENSION[extensionOf(file.name)] || "");
  }

  return { candidates, skipped };
}

export function IntakeUploader({ queuedCount, readerConfigured, subject = "unit", tenantId }: Props) {
  const wording = WORDING[subject];
  const router = useRouter();
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const resumedRef = useRef(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "reading" | "done">("idle");
  const [uploaded, setUploaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  // Reading is a set of lanes calling the processing route until the queue is empty. The
  // route does the claiming, so any number of lanes (or tabs) can run without reading a
  // file twice.
  const runReading = useCallback(
    async (batchId: string | null) => {
      setPhase("reading");
      let notConfigured = false;
      let signedOut = false;

      async function lane() {
        let idle = 0;

        while (!notConfigured && !signedOut && idle < 15) {
          let response: Response;

          try {
            response = await fetch("/api/document-intake/process", {
              body: JSON.stringify({ batchId }),
              headers: { "content-type": "application/json" },
              method: "POST",
            });
          } catch {
            idle += 1;
            await sleep(3000);
            continue;
          }

          if (response.status === 503) {
            notConfigured = true;
            return;
          }

          if (response.status === 401) {
            signedOut = true;
            return;
          }

          if (!response.ok) {
            idle += 1;
            await sleep(3000);
            continue;
          }

          const result = (await response.json()) as { processed: number; remaining: number };
          setRemaining(result.remaining);

          if (result.remaining === 0) {
            return;
          }

          // Nothing for this lane to take but work is still in flight in another lane.
          if (result.processed === 0) {
            idle += 1;
            await sleep(4000);
          } else {
            idle = 0;
          }
        }
      }

      await Promise.all(Array.from({ length: READ_LANES }, lane));

      if (notConfigured) {
        setMessage("The document reader is not set up yet, so the files are waiting. Ask your administrator to add the API key.");
      } else if (signedOut) {
        setMessage("You were signed out. Sign in again; the files are waiting.");
      }

      setPhase("done");
      router.refresh();
    },
    [router],
  );

  // Resume reading whatever an earlier visit left queued.
  useEffect(() => {
    if (!resumedRef.current && readerConfigured && queuedCount > 0) {
      resumedRef.current = true;
      void runReading(null);
    }
  }, [queuedCount, readerConfigured, runReading]);

  async function handleFiles(pending: Picked[] | Promise<Picked[]>) {
    if (phase === "uploading" || phase === "reading") {
      return;
    }

    const files = await pending;

    if (files.length === 0) {
      return;
    }

    setMessage(null);
    setSkipped([]);
    setUploaded(0);
    setRemaining(null);
    setPhase("uploading");

    const { candidates, skipped: notTaken } = await expand(files);
    setSkipped(notTaken);
    setTotal(candidates.length);

    if (candidates.length === 0) {
      setPhase("idle");
      setMessage("Nothing in that selection can be read. Choose PDFs or photos.");
      return;
    }

    const batchId = crypto.randomUUID();
    const supabase = createSupabaseBrowserClient();
    const done: UploadedIntakeFile[] = [];
    const failed: string[] = [];
    let cursor = 0;

    async function lane() {
      while (cursor < candidates.length) {
        const index = cursor++;
        const { file, name, type } = candidates[index];
        const path = buildIntakeStoragePath({ batchId, fileName: file.name, index, tenantId });
        const { error } = await supabase.storage.from(INTAKE_BUCKET).upload(path, file, { contentType: type, upsert: false });

        if (error) {
          failed.push(`${name} (${error.message})`);
        } else {
          done.push({ name, path, size: file.size, type });
        }

        setUploaded((count) => count + 1);
      }
    }

    await Promise.all(Array.from({ length: UPLOAD_LANES }, lane));

    const rejected: string[] = [...failed];
    let queued = 0;

    // Registered in chunks so one request body stays small however big the drop was.
    for (let start = 0; start < done.length; start += 200) {
      const result = await registerIntakeFiles({ batchId, files: done.slice(start, start + 200), subject });
      queued += result.queued;
      rejected.push(...result.rejected.map((entry) => `${entry.name} (${entry.reason})`));
    }

    setSkipped((current) => [...current, ...rejected]);

    if (queued === 0) {
      setPhase("idle");
      setMessage("No files were queued.");
      return;
    }

    if (!readerConfigured) {
      setPhase("done");
      setMessage(`${queued} files are uploaded and waiting. The document reader is not set up yet.`);
      router.refresh();
      return;
    }

    await runReading(batchId);
  }

  const busy = phase === "uploading" || phase === "reading";

  return (
    <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <div
        className={`rounded-lg border-2 border-dashed p-8 text-center transition ${
          dragging ? "border-[var(--primary)] bg-[var(--surface-muted)]" : "border-[var(--border)]"
        }`}
        onDragLeave={() => setDragging(false)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFiles(fromDrop(event.dataTransfer));
        }}
      >
        <UploadCloud className="mx-auto h-9 w-9 text-[var(--primary)]" aria-hidden="true" />
        <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">Drop everything here</h2>
        <p className="mx-auto mt-1 max-w-xl text-sm text-[var(--ink-muted)]">{wording.body}</p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
          <button
            className="inline-flex items-center gap-2 rounded-md bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            disabled={busy}
            onClick={() => filesRef.current?.click()}
            type="button"
          >
            <UploadCloud className="h-4 w-4" aria-hidden="true" />
            Choose files or a zip
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-md border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-60"
            disabled={busy}
            onClick={() => folderRef.current?.click()}
            type="button"
          >
            <FolderUp className="h-4 w-4" aria-hidden="true" />
            Choose a folder
          </button>
        </div>

        <input
          accept=".pdf,.zip,image/jpeg,image/png,image/webp"
          className="hidden"
          multiple
          onChange={(event) => {
            void handleFiles(fromPicker(event.target.files));
            event.target.value = "";
          }}
          ref={filesRef}
          type="file"
        />
        <input
          className="hidden"
          multiple
          onChange={(event) => {
            void handleFiles(fromPicker(event.target.files));
            event.target.value = "";
          }}
          ref={folderRef}
          type="file"
          // Not in React's typings, but the attribute is what makes the picker take a folder.
          {...({ webkitdirectory: "" } as Record<string, string>)}
        />

        <p className="mt-4 text-xs font-semibold text-[var(--warning)]">{wording.warning}</p>
      </div>

      {phase === "uploading" ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Uploading {uploaded} of {total}…
        </p>
      ) : null}

      {phase === "reading" ? (
        <p className="mt-4 flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Reading documents{remaining !== null ? `, ${remaining} to go` : ""}… Keep this page open. You can leave it and
          come back; anything unread picks up where it left off.
        </p>
      ) : null}

      {phase === "done" ? (
        <p className="mt-4 text-sm font-semibold text-[var(--ink)]">
          {message ?? "Finished reading. The results are below."}
        </p>
      ) : null}

      {message && phase !== "done" ? (
        <p className="mt-4 rounded-md border border-[var(--warning)] px-3 py-2 text-sm text-[var(--ink)]">{message}</p>
      ) : null}

      {skipped.length > 0 ? (
        <details className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">
          <summary className="cursor-pointer font-semibold text-[var(--ink)]">
            {skipped.length} file{skipped.length === 1 ? " was" : "s were"} not taken
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--ink-muted)]">
            {skipped.slice(0, 100).map((entry) => (
              <li key={entry}>{entry}</li>
            ))}
            {skipped.length > 100 ? <li>and {skipped.length - 100} more</li> : null}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
