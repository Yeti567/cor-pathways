import {
  Camera,
  CheckCircle2,
  ClipboardList,
  FileText,
  Flag,
  PenLine,
  Upload,
} from "lucide-react";
import {
  coerceEquipmentPickerScope,
  coerceWorkerPickerScope,
  formatFormFieldType,
  getFormItemSettingString,
  isFormItemAdminOnly,
} from "@/lib/form-templates";
import { getOfflineFieldOptions, type OfflineFormItem, type OfflineFormSummary } from "@/lib/offline/form-model";
import { GpsPreviewButton } from "./GpsPreviewButton";

type FormTemplatePreviewProps = {
  form: OfflineFormSummary;
  workers: PreviewWorkerOption[];
};

export type PreviewWorkerOption = {
  fullName: string;
  id: string;
  title: string | null;
};

function inputClass() {
  return "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink-muted)]";
}

function visibleItems(items: OfflineFormItem[]) {
  return items.filter((item) => !isFormItemAdminOnly(item.settings));
}

function renderOptionCheckboxes(item: OfflineFormItem) {
  const options = getOfflineFieldOptions(item);

  if (options.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
        Options will appear here when configured.
      </p>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => (
        <label
          className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink-muted)]"
          key={option}
        >
          <input className="h-4 w-4 accent-[var(--primary)]" disabled type="checkbox" />
          {option}
        </label>
      ))}
    </div>
  );
}

function renderSelect(item: OfflineFormItem, options: string[]) {
  return (
    <select className={inputClass()} defaultValue="" disabled>
      <option value="">No answer</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function renderWorkerMultiSelect(workers: PreviewWorkerOption[]) {
  if (workers.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
        No active workers available.
      </p>
    );
  }

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {workers.map((worker) => (
        <label
          className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink-muted)]"
          key={worker.id}
        >
          <input className="h-4 w-4 accent-[var(--primary)]" disabled type="checkbox" />
          {worker.fullName}
          {worker.title ? ` - ${worker.title}` : ""}
        </label>
      ))}
    </div>
  );
}

function renderPreviewControl(item: OfflineFormItem, workers: PreviewWorkerOption[]) {
  const options = getOfflineFieldOptions(item);

  switch (item.fieldType) {
    case "long_text":
      return <textarea className="min-h-24 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink-muted)]" disabled />;
    case "text_info":
      return (
        <div className="rounded-md border border-[var(--border)] bg-white p-3 text-sm text-[var(--ink-muted)]">
          {item.helperText ?? item.label}
        </div>
      );
    case "number":
      return <input className={inputClass()} disabled inputMode="decimal" type="number" />;
    case "date":
      return (
        <input
          className="h-10 w-full cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          title="Click to pick a date"
          type="date"
        />
      );
    case "time":
      return (
        <input
          className="h-10 w-full cursor-pointer rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          title="Click to pick a time"
          type="time"
        />
      );
    case "yes_no_na":
      return renderSelect(item, ["Yes", "No", "N/A"]);
    case "pass_fail_na":
      return renderSelect(item, ["Pass", "Fail", "N/A"]);
    case "single_select":
    case "dropdown_select_one":
      return renderSelect(item, options);
    case "multi_select":
    case "dropdown_select_multiple":
      return renderOptionCheckboxes(item);
    case "checkbox":
      return options.length > 0 ? (
        renderOptionCheckboxes(item)
      ) : (
        <label className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink-muted)]">
          <input className="h-4 w-4 accent-[var(--primary)]" disabled type="checkbox" />
          Checked
        </label>
      );
    case "worker_select": {
      const workerScope = coerceWorkerPickerScope(getFormItemSettingString(item.settings, "workerPickerScope"));
      return renderSelect(item, workerScope === "current_worker" ? workers.slice(0, 1).map((worker) => worker.fullName) : workers.map((worker) => worker.fullName));
    }
    case "workers_select": {
      const workerScope = coerceWorkerPickerScope(getFormItemSettingString(item.settings, "workerPickerScope"));
      const workerLabels = workerScope === "current_worker" ? workers.slice(0, 1) : workers;

      return renderWorkerMultiSelect(workerLabels);
    }
    case "equipment_select": {
      const equipmentScope = coerceEquipmentPickerScope(getFormItemSettingString(item.settings, "equipmentPickerScope"));
      const equipmentLabel =
        equipmentScope === "assigned_to_worker"
          ? "Worker-assigned equipment"
          : equipmentScope === "current_location"
            ? "Location equipment unit"
            : "Equipment unit";

      return renderSelect(item, [equipmentLabel]);
    }
    case "photo":
      return (
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink-muted)]" disabled type="button">
          <Camera className="h-4 w-4" aria-hidden="true" />
          Add Photo
        </button>
      );
    case "signature":
      return (
        <div className="rounded-md border border-[var(--border)] bg-white p-3">
          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-[var(--border)] text-sm text-[var(--ink-muted)]">
            <PenLine className="mr-2 h-4 w-4" aria-hidden="true" />
            Signature
          </div>
        </div>
      );
    case "gps_coordinates":
      return <GpsPreviewButton />;
    case "pdf_insert":
      return (
        <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink-muted)]" disabled type="button">
          <FileText className="h-4 w-4" aria-hidden="true" />
          Attach PDF
        </button>
      );
    case "image_view":
    case "pdf_view": {
      const url = getFormItemSettingString(item.settings, "sourceUrl") || getFormItemSettingString(item.settings, "url");
      const sourceLabel = getFormItemSettingString(item.settings, "sourceLabel");

      return url ? (
        <a
          className="inline-flex h-10 max-w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          href={url}
          rel="noreferrer"
          target="_blank"
        >
          <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{sourceLabel || "Open Reference"}</span>
        </a>
      ) : (
        <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
          Reference file is not attached to this field yet.
        </p>
      );
    }
    default:
      return <input className={inputClass()} disabled type="text" />;
  }
}

function PreviewItem({ item, workers }: { item: OfflineFormItem; workers: PreviewWorkerOption[] }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <label className="text-sm font-semibold text-[var(--ink)]" htmlFor={`preview-${item.id}`}>
            {item.label}
          </label>
          <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">{formatFormFieldType(item.fieldType)}</p>
          {item.helperText && item.fieldType !== "text_info" ? <p className="mt-1 text-sm text-[var(--ink-muted)]">{item.helperText}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {item.required ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-[var(--success)]">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Required
            </span>
          ) : null}
          {item.flaggable ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-[var(--warning)]">
              <Flag className="h-3.5 w-3.5" aria-hidden="true" />
              Flag
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-3" id={`preview-${item.id}`}>
        {renderPreviewControl(item, workers)}
      </div>
    </div>
  );
}

export function FormTemplatePreview({ form, workers }: FormTemplatePreviewProps) {
  return (
    <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Worker Preview</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {form.sections.length} sections
          </p>
        </div>
        <ClipboardList className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
      </div>

      {form.sections.length > 0 ? (
        <div className="divide-y divide-[var(--border)]">
          {form.sections.map((section) => {
            const sectionItems = visibleItems(section.items);

            return (
              <section className="p-4" key={section.id}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="font-semibold text-[var(--ink)]">{section.title}</h3>
                    <p className="text-sm text-[var(--ink-muted)]">
                      {sectionItems.length} fields
                      {section.repeatable ? ", 1 entry" : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {section.collapsible ? (
                      <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-[var(--primary)]">Collapsible</span>
                    ) : null}
                    {section.repeatable ? (
                      <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-[var(--warning)]">Repeatable</span>
                    ) : null}
                  </div>
                </div>

                {sectionItems.length > 0 ? (
                  <div className="mt-4 grid gap-4">
                    {section.repeatable ? (
                      <div className="rounded-md border border-[var(--border)] bg-white p-3">
                        <p className="text-sm font-semibold text-[var(--ink)]">Entry 1</p>
                        <div className="mt-3 grid gap-4">
                          {sectionItems.map((item) => (
                            <PreviewItem item={item} key={item.id} workers={workers} />
                          ))}
                        </div>
                      </div>
                    ) : (
                      sectionItems.map((item) => <PreviewItem item={item} key={item.id} workers={workers} />)
                    )}
                  </div>
                ) : (
                  <p className="mt-4 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                    No worker-visible fields in this section yet.
                  </p>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <div className="px-4 py-12 text-center">
          <ClipboardList className="mx-auto h-8 w-8 text-[var(--primary)]" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-semibold text-[var(--ink)]">No sections yet</h2>
        </div>
      )}
    </section>
  );
}
