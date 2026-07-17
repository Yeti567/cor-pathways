import {
  defaultPrintFooterNote,
  defaultPreparedByLabel,
  normalizePreparedByLabel,
  normalizePrintFooterNote,
  type CompanySettingsRow,
  type PrintSettingsRow,
} from "@/lib/company-settings";

export type PrintFooterEntry = {
  label: string;
  value: string | null | undefined;
};

type PrintFooterProps = {
  className?: string;
  companySettings: CompanySettingsRow | null;
  entries?: PrintFooterEntry[];
  generatedAt: string;
  mode?: "always" | "print-only";
  preparedByValue?: string | null;
  printSettings: PrintSettingsRow | null;
};

function cleanText(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function resolveFooterNote(printSettings: PrintSettingsRow | null) {
  return normalizePrintFooterNote(printSettings?.footer_note ?? defaultPrintFooterNote);
}

function resolvePreparedByLabel(printSettings: PrintSettingsRow | null) {
  return normalizePreparedByLabel(printSettings?.prepared_by_label ?? defaultPreparedByLabel);
}

export function PrintFooter({
  className = "",
  companySettings,
  entries = [],
  generatedAt,
  mode = "print-only",
  preparedByValue,
  printSettings,
}: PrintFooterProps) {
  const companyId = cleanText(companySettings?.company_id);
  const footerNote = resolveFooterNote(printSettings);
  const showPrintedAt = printSettings?.show_printed_at ?? true;
  const preparedByLabel = resolvePreparedByLabel(printSettings);
  const visibleEntries = [
    preparedByValue ? { label: preparedByLabel, value: preparedByValue } : null,
    companyId ? { label: "Company ID", value: companyId } : null,
    ...entries,
    showPrintedAt ? { label: "Printed", value: formatDateTime(generatedAt) } : null,
  ].filter((entry): entry is PrintFooterEntry => Boolean(entry?.value));

  if (!footerNote && visibleEntries.length === 0) {
    return null;
  }

  return (
    <footer
      className={`${mode === "print-only" ? "hidden print:block" : "block"} mt-8 border-t border-[var(--border)] pt-4 text-xs text-[var(--ink-muted)] print:border-gray-300 print:text-gray-600 ${className}`}
    >
      {footerNote ? <p className="font-medium text-[var(--ink)] print:text-black">{footerNote}</p> : null}
      {visibleEntries.length > 0 ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {visibleEntries.map((entry) => (
            <div className="min-w-0" key={`${entry.label}-${entry.value}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-muted)] print:text-gray-600">
                {entry.label}
              </p>
              <p className="mt-0.5 break-words font-semibold text-[var(--ink)] print:text-black">{entry.value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </footer>
  );
}
