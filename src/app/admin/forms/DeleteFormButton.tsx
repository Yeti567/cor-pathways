"use client";

import { Trash2 } from "lucide-react";
import { deleteFormTemplate } from "@/app/admin/actions";

export function DeleteFormButton({ formName }: { formName: string }) {
  return (
    <button
      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--danger)] bg-white px-3 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-[var(--danger)] focus:ring-offset-2"
      formAction={deleteFormTemplate}
      formNoValidate
      onClick={(event) => {
        const confirmed = window.confirm(
          `Delete the form template "${formName}"? Its sections, fields, and schedules will be removed. Forms with submitted records cannot be deleted; archive those instead.`,
        );

        if (!confirmed) {
          event.preventDefault();
        }
      }}
      type="submit"
    >
      <Trash2 className="h-4 w-4" aria-hidden="true" />
      Delete
    </button>
  );
}
