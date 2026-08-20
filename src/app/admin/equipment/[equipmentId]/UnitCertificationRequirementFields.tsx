"use client";

import { useState } from "react";
import { ClipboardCheck } from "lucide-react";

type RequirementOption = {
  id: string;
  name: string;
  notes: string | null;
  appliesByDefault: boolean;
  checked: boolean;
};

/**
 * The tick list of inspections one unit is held to.
 *
 * Collapsed until asked for, because the common case is a unit whose list is already
 * right and whose owner came to this page to file a certificate, not to re-plan the
 * requirements. Opening it shows every certification the tenant has, with the ones
 * this unit is held to ticked.
 */
export function UnitCertificationRequirementFields({
  options,
  usingDefaults,
}: {
  options: RequirementOption[];
  usingDefaults: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="mt-4 rounded-md border border-[var(--border)] bg-white p-3">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          <ClipboardCheck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          Choose which inspections this unit needs
        </span>
        <span className="text-xs font-semibold text-[var(--primary)]">{open ? "Close" : "Edit"}</span>
      </button>

      <p className="mt-1 text-xs text-[var(--ink-muted)]">
        {usingDefaults
          ? "This unit has not been set up yet, so it is held to the standard list. Tick the tank and specialty inspections it actually carries."
          : "Only the ticked inspections are expected on this unit. Everything else is ignored for it."}
      </p>

      {open ? (
        <div className="mt-3 grid gap-2">
          {options.map((option) => (
            <label
              className="flex cursor-pointer items-start gap-2.5 rounded-md border border-[var(--border)] p-2.5 hover:bg-[var(--surface-muted)]"
              key={option.id}
            >
              <input
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                defaultChecked={option.checked}
                name="certificationTypeIds"
                type="checkbox"
                value={option.id}
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-[var(--ink)]">{option.name}</span>
                {option.notes ? (
                  <span className="mt-0.5 block text-xs text-[var(--ink-muted)]">{option.notes}</span>
                ) : null}
              </span>
            </label>
          ))}

          {/*
            A submit with every box cleared posts no certificationTypeIds at all, which
            is indistinguishable from "this form was not on the page". This marker says
            the list was actually edited, so clearing everything means held to nothing
            rather than falling back to the defaults.
          */}
          <input name="certificationRequirementsSubmitted" type="hidden" value="1" />

          <button
            className="mt-1 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
            type="submit"
          >
            Save inspection list
          </button>
        </div>
      ) : null}
    </div>
  );
}
