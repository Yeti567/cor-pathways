"use client";

import { useState, type InputHTMLAttributes } from "react";
import { shrinkPhotoFile } from "@/lib/offline/shrink-photo";

// A file input for a <form action={serverAction}> that a phone photo goes through.
//
// A Server Action body is capped at 1 MB and an over-size post is refused with a bare 413
// before any app code runs, so the person sees nothing useful. A phone camera photo is 3 to
// 5 MB, so "photograph your ticket and upload it" failed for almost everyone. A photo is
// shrunk here, on the phone, and swapped into the input before the form is sent. A PDF
// cannot be shrunk, so one over the limit is stopped with a plain message instead.

// Under the 1 MB cap with room for the rest of the form.
const POST_LIMIT_BYTES = 900 * 1024;

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "type">;

export function ShrinkingFileInput(props: Props) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <>
      <input
        {...props}
        aria-busy={busy}
        onChange={async (event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          setNote(null);
          input.setCustomValidity("");

          if (!file) {
            return;
          }

          let chosen = file;

          if (file.type.startsWith("image/")) {
            // Not disabled while it works: a disabled input is left out of the post and
            // skips the required check. A validity message holds the submit instead.
            setBusy(true);
            input.setCustomValidity("The photo is still being prepared. Try again in a moment.");

            try {
              chosen = await shrinkPhotoFile(file);
            } finally {
              input.setCustomValidity("");
              setBusy(false);
            }

            if (chosen !== file) {
              const transfer = new DataTransfer();
              transfer.items.add(chosen);
              input.files = transfer.files;
            }
          }

          if (chosen.size > POST_LIMIT_BYTES) {
            const message = chosen.type.startsWith("image/")
              ? "That photo is still too big to send. Try taking it again a little further back."
              : "That file is too big to send from here (the limit is about 1 MB). Take a photo of it instead.";
            input.setCustomValidity(message);
            input.reportValidity();
            setNote(message);
          }
        }}
        type="file"
      />
      {busy ? <span className="text-xs text-[var(--ink-muted)]">Preparing the photo…</span> : null}
      {note ? <span className="text-xs font-semibold text-[var(--danger)]">{note}</span> : null}
    </>
  );
}
