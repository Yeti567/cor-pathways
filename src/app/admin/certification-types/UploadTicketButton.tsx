"use client";

import { useFormStatus } from "react-dom";
import { FileUp } from "lucide-react";

export function UploadTicketButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--ink-muted)] disabled:opacity-70"
      disabled={disabled || pending}
      type="submit"
    >
      <FileUp className="h-4 w-4" aria-hidden="true" />
      {pending ? "Uploading Ticket" : "Upload Ticket"}
    </button>
  );
}
