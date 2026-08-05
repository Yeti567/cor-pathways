"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  CalendarClock,
  Camera,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FilePlus2,
  Flag,
  Gauge,
  LocateFixed,
  MapPin,
  PenLine,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Truck,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import {
  cacheOfflineForms,
  createDraftSubmission,
  getCachedOfflineForms,
  saveOfflineDraftSubmission,
} from "@/lib/offline/forms";
import type { OfflineCorrectiveActionDrafts, OfflineEvidencePhotos } from "@/lib/offline/follow-ups";
import { getOfflineFieldOptions, type OfflineFormItem, type OfflineFormSummary } from "@/lib/offline/form-model";
import {
  coerceEquipmentPickerScope,
  coerceWorkerPickerScope,
  getFormItemSettingString,
  isFormItemAdminOnly,
} from "@/lib/form-templates";
import {
  getCachedOfflineEquipmentLibrary,
  type OfflineEquipmentSummary,
} from "@/lib/offline/equipment";
import { flushQueuedMutations } from "@/lib/offline/sync";
import { listDraftSubmissions } from "@/lib/offline/sync-queue";
import type { OfflineDraftSubmission, OfflineSubmissionSourceAssignment } from "@/lib/offline/db";
import type { Json } from "@/types/database";

type OfflineWorkerOption = {
  fullName: string;
  id: string;
  title: string | null;
};

type OfflineLocationOption = {
  code: string | null;
  id: string;
  name: string;
};

type AssignedFormsPanelProps = {
  equipment: OfflineEquipmentSummary[];
  initialForms: OfflineFormSummary[];
  locations: OfflineLocationOption[];
  maintenanceContactUserId?: string | null;
  offlineSyncDays: number;
  scheduledAssignments?: ScheduledFormAssignment[];
  tenantId: string;
  userId: string;
  workflowAssignments?: WorkflowFormAssignment[];
  workers: OfflineWorkerOption[];
};

type ScheduledFormAssignment = {
  displayStatus: string;
  dueAt: string;
  formId: string;
  locationId: string | null;
  scheduleName: string;
  taskId: string;
};

type WorkflowFormAssignment = {
  displayStatus: string;
  dueAt: string | null;
  formId: string;
  locationId: string | null;
  runStepId: string;
  workflowName: string;
};

type FormAssignmentSummary = {
  displayStatus: string;
  dueAt: string | null;
  formId: string;
  locationId: string | null;
  name: string;
  source: "scheduled" | "workflow";
  sourceId: string;
};

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDraftStatus(status: OfflineDraftSubmission["status"]) {
  switch (status) {
    case "synced":
      return "Synced";
    case "syncing":
      return "Syncing";
    case "failed":
      return "Failed";
    case "queued":
      return "Queued";
    default:
      return "Draft";
  }
}

function formatAssignmentDueAt(value: string | null | undefined) {
  if (!value) {
    return "No due date";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function isDueToday(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  const dueDate = new Date(value);
  const today = new Date();

  return (
    dueDate.getFullYear() === today.getFullYear() &&
    dueDate.getMonth() === today.getMonth() &&
    dueDate.getDate() === today.getDate()
  );
}

function assignmentSourceLabel(source: FormAssignmentSummary["source"]) {
  return source === "workflow" ? "Workflow" : "Scheduled";
}

function assignmentSourceClass(source: FormAssignmentSummary["source"]) {
  return source === "workflow" ? "bg-blue-50 text-[var(--primary)]" : "bg-amber-50 text-[var(--warning)]";
}

function assignmentStatusLabel(assignment: Pick<FormAssignmentSummary, "displayStatus" | "dueAt">) {
  if (assignment.displayStatus === "overdue") {
    return "Overdue";
  }

  if (isDueToday(assignment.dueAt)) {
    return "Due today";
  }

  if (assignment.displayStatus === "completed") {
    return "Completed";
  }

  if (assignment.displayStatus === "pending" || assignment.displayStatus === "due" || assignment.displayStatus === "open") {
    return "Due";
  }

  return assignment.displayStatus;
}

function assignmentStatusClass(assignment: Pick<FormAssignmentSummary, "displayStatus" | "dueAt">) {
  if (assignment.displayStatus === "overdue") {
    return "bg-red-50 text-[var(--danger)]";
  }

  if (assignment.displayStatus === "completed") {
    return "bg-emerald-50 text-[var(--success)]";
  }

  if (isDueToday(assignment.dueAt)) {
    return "bg-amber-50 text-[var(--warning)]";
  }

  return "bg-amber-50 text-[var(--warning)]";
}

function assignmentDueLabel(assignment: Pick<FormAssignmentSummary, "displayStatus" | "dueAt">) {
  if (!assignment.dueAt) {
    return "No due date";
  }

  return `${assignmentStatusLabel(assignment)} - ${formatAssignmentDueAt(assignment.dueAt)}`;
}

function assignmentActionLabel(assignment: FormAssignmentSummary) {
  return assignment.source === "workflow" ? "Start Workflow Step" : "Start Scheduled Task";
}

function assignmentKey(assignment: Pick<FormAssignmentSummary, "source" | "sourceId">) {
  return `${assignment.source}:${assignment.sourceId}`;
}

function requestedAssignmentFromUrl(): OfflineSubmissionSourceAssignment | null {
  if (typeof window === "undefined") {
    return null;
  }

  const params = new URLSearchParams(window.location.search);
  const source = params.get("assignmentSource");
  const sourceId = params.get("assignmentId");

  if ((source === "scheduled" || source === "workflow") && sourceId) {
    return { source, sourceId };
  }

  return null;
}

function isRecord(value: Json | undefined): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueAsString(value: Json | undefined) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  return "";
}

function valueAsStringArray(value: Json | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string");
}

function valueAsBoolean(value: Json | undefined) {
  return typeof value === "boolean" ? value : false;
}

// The NSC Schedule 1 default severity tagged onto inspection items by migration.
// Only present on the vehicle/equipment inspection forms; returns null elsewhere,
// which is how we know an item should not show the major/minor severity prompt.
function defaultDefectSeverity(item: OfflineFormItem): "major" | "minor" | null {
  const settings = item.settings;

  if (settings && typeof settings === "object" && !Array.isArray(settings)) {
    const tagged = (settings as Record<string, Json | undefined>).defect_severity;

    if (tagged === "major" || tagged === "minor") {
      return tagged;
    }
  }

  return null;
}

function settingString(settings: Json, key: string) {
  if (!isRecord(settings)) {
    return "";
  }

  const value = settings[key];
  return typeof value === "string" ? value : "";
}

function formatLocationValue(value: Json | undefined) {
  if (!isRecord(value) || typeof value.latitude !== "number" || typeof value.longitude !== "number") {
    return "No coordinates captured";
  }

  return `${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}`;
}

function requiredValueMissing(value: Json | undefined) {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (typeof value === "boolean") {
    return !value;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (isRecord(value)) {
    if (value.type === "gps") {
      return typeof value.latitude !== "number" || typeof value.longitude !== "number";
    }

    if (value.type === "equipment") {
      return typeof value.equipmentId !== "string" || value.equipmentId.trim().length === 0;
    }

    if (value.type === "signature" || value.type === "photo" || value.type === "pdf") {
      return typeof value.dataUrl !== "string" || value.dataUrl.length === 0;
    }

    return Object.keys(value).length === 0;
  }

  return false;
}

// Inspection forms (pre-trip, trip) can require the worker to log the unit's
// odometer/hours so the meter stays current. The flag lives on the equipment_select
// item settings as requireMeter.
function requiresEquipmentMeter(item: OfflineFormItem) {
  return item.fieldType === "equipment_select" && isRecord(item.settings) && item.settings.requireMeter === true;
}

function equipmentMeterMissing(value: Json | undefined) {
  if (!isRecord(value) || value.type !== "equipment") {
    return true;
  }

  const reading = value.meterReading;

  if (typeof reading === "number") {
    return !Number.isFinite(reading);
  }

  if (typeof reading === "string") {
    const trimmed = reading.trim();
    return trimmed.length === 0 || !Number.isFinite(Number(trimmed));
  }

  return true;
}

function repeatErrorKey(itemId: string, repeatIndex: number) {
  return `${itemId}:${repeatIndex}`;
}

function repeatValues(value: Json | undefined) {
  return Array.isArray(value) ? value : [];
}

function visibleFormItems(items: OfflineFormItem[]) {
  return items.filter((item) => !isFormItemAdminOnly(item.settings));
}

export function repeatableSectionInstanceCount(sectionItems: OfflineFormItem[], values: Record<string, Json>) {
  return Math.max(1, ...sectionItems.map((item) => repeatValues(values[item.id]).length));
}

function buildRepeatInstances(form: OfflineFormSummary, values: Record<string, Json>) {
  return Object.fromEntries(
    form.sections
      .filter((section) => section.repeatable)
      .map((section) => {
        const count = repeatableSectionInstanceCount(visibleFormItems(section.items), values);
        return [section.id, Array.from({ length: count }, (_, index) => `${section.id}-${index}`)];
      }),
  );
}

function requiredErrorsForForm(
  form: OfflineFormSummary,
  values: Record<string, Json>,
  repeatInstances: Record<string, string[]> = {},
) {
  const errors: Record<string, string> = {};

  for (const section of form.sections) {
    const sectionItems = visibleFormItems(section.items);

    if (section.repeatable) {
      const instanceCount = Math.max(
        repeatableSectionInstanceCount(sectionItems, values),
        repeatInstances[section.id]?.length ?? 0,
      );

      for (let index = 0; index < instanceCount; index += 1) {
        for (const item of sectionItems) {
          const repeatValue = repeatValues(values[item.id])[index];

          if (item.required && item.fieldType !== "text_info" && requiredValueMissing(repeatValue)) {
            errors[repeatErrorKey(item.id, index)] = "Required";
            continue;
          }

          if (requiresEquipmentMeter(item) && equipmentMeterMissing(repeatValue)) {
            errors[repeatErrorKey(item.id, index)] = "Odometer or hours reading required";
          }
        }
      }

      continue;
    }

    for (const item of sectionItems) {
      if (item.required && item.fieldType !== "text_info" && requiredValueMissing(values[item.id])) {
        errors[item.id] = "Required";
        continue;
      }

      if (requiresEquipmentMeter(item) && equipmentMeterMissing(values[item.id])) {
        errors[item.id] = "Odometer or hours reading required";
      }
    }
  }

  return errors;
}

function answeredValueCount(values: Record<string, Json>) {
  return Object.values(values).reduce<number>((count, value) => {
    if (Array.isArray(value)) {
      return count + value.filter((entry) => !requiredValueMissing(entry)).length;
    }

    return requiredValueMissing(value) ? count : count + 1;
  }, 0);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("File could not be read.")));
    reader.readAsDataURL(file);
  });
}

const EVIDENCE_PHOTO_EXCLUDED_TYPES = new Set<string>([
  "text_info",
  "photo",
  "signature",
  "image_view",
  "gps_coordinates",
  "pdf_view",
  "pdf_insert",
  "date",
  "time",
  "worker_select",
  "workers_select",
  "equipment_select",
]);

function isEvidenceRecord(value: Json | undefined): value is Record<string, Json | undefined> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shouldShowEvidencePhoto(item: OfflineFormItem) {
  if (EVIDENCE_PHOTO_EXCLUDED_TYPES.has(item.fieldType)) {
    return isEvidenceRecord(item.settings) && item.settings.allowEvidencePhotos === true;
  }

  if (isEvidenceRecord(item.settings) && item.settings.allowEvidencePhotos === false) {
    return false;
  }

  return true;
}

function EvidencePhotoControl({
  evidence,
  onCapture,
  onRemove,
}: {
  evidence: OfflineEvidencePhotos[string] | undefined;
  onCapture: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  return (
    <div className="mt-3 rounded-md border border-[var(--border)] bg-white p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-[var(--ink)]">Evidence photo</p>
          <p className="text-xs text-[var(--ink-muted)]">Optional. Attach a photo to back up your answer.</p>
        </div>
        <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]">
          <Camera className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          {evidence?.dataUrl ? "Retake" : "Add Photo"}
          <input
            accept="image/*"
            capture="environment"
            className="sr-only"
            onChange={(event) => {
              onCapture(event.target.files?.[0] ?? undefined);
              event.target.value = "";
            }}
            type="file"
          />
        </label>
      </div>
      {evidence?.dataUrl ? (
        <div className="mt-3 grid gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="Evidence attached to field"
            className="max-h-56 rounded-md border border-[var(--border)] object-contain"
            src={evidence.dataUrl}
          />
          <button
            className="inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            onClick={onRemove}
            type="button"
          >
            <Trash2 className="h-4 w-4 text-[var(--danger)]" aria-hidden="true" />
            Remove Photo
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SignatureField({
  defaultSignerName,
  onChange,
  value,
}: {
  defaultSignerName: string;
  onChange: (value: Json) => void;
  value: Json | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const existing = isRecord(value) ? value : {};
  const [signerName, setSignerName] = useState(
    typeof existing.signerName === "string" && existing.signerName.trim() ? existing.signerName : defaultSignerName,
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.lineWidth = 2.5;
    context.lineCap = "round";
    context.strokeStyle = "#182024";

    if (typeof existing.dataUrl === "string" && existing.dataUrl.startsWith("data:image/")) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = existing.dataUrl;
    }
  }, [existing.dataUrl]);

  function pointFromEvent(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;

    if (!canvas) {
      return { x: 0, y: 0 };
    }

    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function persistSignature() {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    onChange({
      dataUrl: canvas.toDataURL("image/png"),
      signedAt: new Date().toISOString(),
      signerName,
      type: "signature",
    });
  }

  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
  }

  function draw(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context || !drawingRef.current || !lastPointRef.current) {
      return;
    }

    const nextPoint = pointFromEvent(event);
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(nextPoint.x, nextPoint.y);
    context.stroke();
    lastPointRef.current = nextPoint;
  }

  function stopDrawing() {
    if (!drawingRef.current) {
      return;
    }

    drawingRef.current = false;
    lastPointRef.current = null;
    persistSignature();
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, canvas.width, canvas.height);
    onChange(null);
  }

  return (
    <div className="mt-2 grid gap-3">
      <label className="space-y-2">
        <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Signer name</span>
        <input
          className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          onBlur={persistSignature}
          onChange={(event) => setSignerName(event.target.value)}
          value={signerName}
        />
      </label>
      <canvas
        className="h-40 w-full touch-none rounded-md border border-[var(--border)] bg-white"
        height={200}
        onPointerCancel={stopDrawing}
        onPointerDown={startDrawing}
        onPointerLeave={stopDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        ref={canvasRef}
        width={640}
      />
      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
          onClick={persistSignature}
          type="button"
        >
          <PenLine className="h-4 w-4" aria-hidden="true" />
          Save Signature
        </button>
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
          onClick={clearSignature}
          type="button"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Clear
        </button>
      </div>
    </div>
  );
}

function PhotoField({ onChange, value }: { onChange: (value: Json) => void; value: Json | undefined }) {
  const existing = isRecord(value) ? value : {};
  const dataUrl = typeof existing.dataUrl === "string" ? existing.dataUrl : "";

  async function capturePhoto(file: File | undefined) {
    if (!file) {
      return;
    }

    const nextDataUrl = await readFileAsDataUrl(file);
    onChange({
      capturedAt: new Date().toISOString(),
      caption: typeof existing.caption === "string" ? existing.caption : "",
      dataUrl: nextDataUrl,
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      type: "photo",
    });
  }

  function updateCaption(caption: string) {
    onChange({
      ...existing,
      caption,
      type: "photo",
    });
  }

  return (
    <div className="mt-2 grid gap-3">
      <input
        accept="image/*"
        capture="environment"
        className="block w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
        onChange={(event) => capturePhoto(event.target.files?.[0]).catch(() => undefined)}
        type="file"
      />
      {dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt="Captured form attachment" className="max-h-64 rounded-md border border-[var(--border)] object-contain" src={dataUrl} />
      ) : null}
      <input
        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
        onChange={(event) => updateCaption(event.target.value)}
        placeholder="Photo caption"
        value={typeof existing.caption === "string" ? existing.caption : ""}
      />
    </div>
  );
}

function formatGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied. Allow location for this site in your phone settings, then tap Use Current Location again.";
    case error.POSITION_UNAVAILABLE:
      return "Could not determine your location. Step outside or check that GPS is on, then try again.";
    case error.TIMEOUT:
      return "Location request timed out. Try again with a clearer view of the sky.";
    default:
      return error.message || "GPS capture failed.";
  }
}

function GpsField({ onChange, value }: { onChange: (value: Json) => void; value: Json | undefined }) {
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function captureLocation() {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setStatus("GPS is not available on this device.");
      return;
    }

    if (typeof window !== "undefined" && window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      setStatus("GPS requires a secure (HTTPS) connection. Reload the app over HTTPS.");
      return;
    }

    setStatus("Capturing location...");
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange({
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          type: "gps",
        });
        setStatus(`Captured to within ${Math.round(position.coords.accuracy)} m.`);
        setBusy(false);
      },
      (error) => {
        setStatus(formatGeolocationError(error));
        setBusy(false);
      },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
  }

  return (
    <div className="mt-2 grid gap-2">
      <button
        className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
        disabled={busy}
        onClick={captureLocation}
        type="button"
      >
        <LocateFixed className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
        {busy ? "Capturing..." : value ? "Recapture Location" : "Use Current Location"}
      </button>
      <p className="text-sm text-[var(--ink-muted)]">{status || formatLocationValue(value)}</p>
    </div>
  );
}

function FileAttachmentField({
  accept,
  label,
  onChange,
  value,
}: {
  accept: string;
  label: string;
  onChange: (value: Json) => void;
  value: Json | undefined;
}) {
  const existing = isRecord(value) ? value : {};

  async function captureFile(file: File | undefined) {
    if (!file) {
      return;
    }

    onChange({
      capturedAt: new Date().toISOString(),
      dataUrl: await readFileAsDataUrl(file),
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      type: "pdf",
    });
  }

  return (
    <div className="mt-2 grid gap-2">
      <input
        accept={accept}
        className="block w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
        onChange={(event) => captureFile(event.target.files?.[0]).catch(() => undefined)}
        type="file"
      />
      <p className="text-sm text-[var(--ink-muted)]">
        {typeof existing.fileName === "string" ? `${label}: ${existing.fileName}` : `No ${label.toLowerCase()} attached`}
      </p>
    </div>
  );
}

function EquipmentSelectField({
  activeLocationId,
  equipment,
  onChange,
  requireMeter = false,
  scope,
  userId,
  value,
}: {
  activeLocationId: string;
  equipment: OfflineEquipmentSummary[];
  onChange: (value: Json) => void;
  requireMeter?: boolean;
  scope: ReturnType<typeof coerceEquipmentPickerScope>;
  userId: string;
  value: Json | undefined;
}) {
  const existing = isRecord(value) ? value : {};
  const selectedEquipmentId = typeof existing.equipmentId === "string" ? existing.equipmentId : "";
  const [query, setQuery] = useState("");
  const scopedEquipment = useMemo(() => {
    if (scope === "assigned_to_worker") {
      return equipment.filter((item) => item.assignedTo === userId);
    }

    if (scope === "current_location") {
      return activeLocationId ? equipment.filter((item) => item.locationId === activeLocationId) : [];
    }

    return equipment;
  }, [activeLocationId, equipment, scope, userId]);
  const filteredEquipment = useMemo(() => {
    const terms = query
      .trim()
      .toLowerCase()
      .split(/\s+/g)
      .filter(Boolean);

    if (terms.length === 0) {
      return scopedEquipment;
    }

    return scopedEquipment.filter((item) => {
      const searchText = [item.unitNumber, item.name, item.make, item.model, item.vinOrSerial, item.status]
        .filter((entry): entry is string => Boolean(entry?.trim()))
        .join(" ")
        .toLowerCase();

      return terms.every((term) => searchText.includes(term));
    });
  }, [scopedEquipment, query]);
  const selectedEquipment = scopedEquipment.find((item) => item.id === selectedEquipmentId) ?? null;

  function equipmentLabel(item: OfflineEquipmentSummary) {
    return `${item.unitNumber}${item.name ? `, ${item.name}` : ""}${item.status === "down" ? " (Down)" : ""}`;
  }

  function updateSelectedEquipment(equipmentId: string) {
    const selected = scopedEquipment.find((item) => item.id === equipmentId);

    if (!selected) {
      onChange(null);
      return;
    }

    onChange({
      equipmentId: selected.id,
      name: selected.name,
      trackingMode: selected.trackingMode,
      type: "equipment",
      unitNumber: selected.unitNumber,
      ...(typeof existing.meterReading === "string" || typeof existing.meterReading === "number"
        ? { meterReading: existing.meterReading }
        : {}),
    });
  }

  function updateMeterReading(meterReading: string) {
    if (!selectedEquipment) {
      return;
    }

    onChange({
      equipmentId: selectedEquipment.id,
      meterReading,
      meterRecordedAt: new Date().toISOString(),
      name: selectedEquipment.name,
      trackingMode: selectedEquipment.trackingMode,
      type: "equipment",
      unitNumber: selectedEquipment.unitNumber,
    });
  }

  return (
    <div className="mt-2 grid gap-3">
      <label className="relative block">
        <span className="sr-only">Search equipment</span>
        <Truck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" aria-hidden="true" />
        <input
          className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-9 pr-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search unit, name, serial"
          type="search"
          value={query}
        />
      </label>
      <select
        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
        onChange={(event) => updateSelectedEquipment(event.target.value)}
        value={selectedEquipmentId}
      >
        <option value="">No equipment selected</option>
        {filteredEquipment.map((item) => (
          <option key={item.id} value={item.id}>
            {equipmentLabel(item)}
          </option>
        ))}
      </select>
      {selectedEquipment ? (
        <label className="space-y-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
            <Gauge className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Meter reading ({selectedEquipment.trackingMode === "hours" ? "hours" : "mileage"})
            {requireMeter ? <span className="text-[var(--danger)]">*</span> : null}
          </span>
          <input
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            inputMode="decimal"
            min="0"
            onChange={(event) => updateMeterReading(event.target.value)}
            placeholder={requireMeter ? "Required" : "Optional"}
            required={requireMeter}
            step="0.1"
            type="number"
            value={typeof existing.meterReading === "string" || typeof existing.meterReading === "number" ? String(existing.meterReading) : ""}
          />
        </label>
      ) : null}
      {scopedEquipment.length === 0 ? (
        <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
          No matching equipment is cached on this device yet.
        </p>
      ) : null}
    </div>
  );
}

export function AssignedFormsPanel({
  equipment,
  initialForms,
  locations,
  maintenanceContactUserId = null,
  offlineSyncDays,
  scheduledAssignments = [],
  tenantId,
  userId,
  workflowAssignments = [],
  workers,
}: AssignedFormsPanelProps) {
  const router = useRouter();
  const [forms, setForms] = useState(initialForms);
  const [equipmentOptions, setEquipmentOptions] = useState(equipment);
  const [drafts, setDrafts] = useState<OfflineDraftSubmission[]>([]);
  const [activeForm, setActiveForm] = useState<OfflineFormSummary | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, Json>>({});
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [correctiveActions, setCorrectiveActions] = useState<OfflineCorrectiveActionDrafts>({});
  const [defectSeverities, setDefectSeverities] = useState<Record<string, string>>({});
  const [evidencePhotos, setEvidencePhotos] = useState<OfflineEvidencePhotos>({});
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const defaultLocationId = useMemo(() => (locations.length === 1 ? locations[0].id : ""), [locations]);
  const [activeLocationId, setActiveLocationId] = useState(defaultLocationId);
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [draftNotice, setDraftNotice] = useState("");
  const [repeatInstances, setRepeatInstances] = useState<Record<string, string[]>>({});
  const [workingFormId, setWorkingFormId] = useState<string | null>(null);
  const [activeAssignment, setActiveAssignment] = useState<OfflineSubmissionSourceAssignment | null>(null);
  const handledRequestedAssignmentRef = useRef<string | null>(null);
  const expiresAt = useMemo(() => addDays(new Date(), offlineSyncDays).toISOString(), [offlineSyncDays]);
  const locationById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);
  const formAssignmentsByFormId = useMemo(() => {
    const assignmentsByFormId = new Map<string, FormAssignmentSummary[]>();

    for (const assignment of scheduledAssignments) {
      const formAssignments = assignmentsByFormId.get(assignment.formId) ?? [];
      formAssignments.push({
        displayStatus: assignment.displayStatus,
        dueAt: assignment.dueAt,
        formId: assignment.formId,
        locationId: assignment.locationId,
        name: assignment.scheduleName,
        source: "scheduled",
        sourceId: assignment.taskId,
      });
      assignmentsByFormId.set(assignment.formId, formAssignments);
    }

    for (const assignment of workflowAssignments) {
      const formAssignments = assignmentsByFormId.get(assignment.formId) ?? [];
      formAssignments.push({
        displayStatus: assignment.displayStatus,
        dueAt: assignment.dueAt,
        formId: assignment.formId,
        locationId: assignment.locationId,
        name: assignment.workflowName,
        source: "workflow",
        sourceId: assignment.runStepId,
      });
      assignmentsByFormId.set(assignment.formId, formAssignments);
    }

    for (const assignments of assignmentsByFormId.values()) {
      assignments.sort((left, right) => {
        const leftTime = left.dueAt ? new Date(left.dueAt).getTime() : Number.POSITIVE_INFINITY;
        const rightTime = right.dueAt ? new Date(right.dueAt).getTime() : Number.POSITIVE_INFINITY;

        if (leftTime !== rightTime) {
          return leftTime - rightTime;
        }

        return left.name.localeCompare(right.name);
      });
    }

    return assignmentsByFormId;
  }, [scheduledAssignments, workflowAssignments]);
  const orderedForms = useMemo(
    () =>
      [...forms].sort((left, right) => {
        const leftAssignment = formAssignmentsByFormId.get(left.id)?.[0];
        const rightAssignment = formAssignmentsByFormId.get(right.id)?.[0];
        const leftDueAt = leftAssignment?.dueAt;
        const rightDueAt = rightAssignment?.dueAt;

        if (leftDueAt && rightDueAt) {
          return new Date(leftDueAt).getTime() - new Date(rightDueAt).getTime();
        }

        if (leftDueAt) {
          return -1;
        }

        if (rightDueAt) {
          return 1;
        }

        if (leftAssignment && rightAssignment) {
          return leftAssignment.name.localeCompare(rightAssignment.name);
        }

        if (leftAssignment) {
          return -1;
        }

        if (rightAssignment) {
          return 1;
        }

        return left.name.localeCompare(right.name);
      }),
    [forms, formAssignmentsByFormId],
  );
  const activeAssignmentSummary = useMemo(() => {
    if (!activeForm || !activeAssignment) {
      return null;
    }

    return (
      formAssignmentsByFormId
        .get(activeForm.id)
        ?.find((assignment) => assignment.source === activeAssignment.source && assignment.sourceId === activeAssignment.sourceId) ?? null
    );
  }, [activeAssignment, activeForm, formAssignmentsByFormId]);

  useEffect(() => {
    let active = true;

    async function hydrateOfflineForms() {
      if (initialForms.length > 0) {
        await cacheOfflineForms(initialForms, expiresAt);
      }

      const [cachedForms, cachedDrafts] = await Promise.all([
        getCachedOfflineForms(tenantId),
        listDraftSubmissions({ tenantId, userId }),
      ]);

      if (!active) {
        return;
      }

      setForms(cachedForms.length > 0 ? cachedForms : initialForms);
      setDrafts(cachedDrafts);
    }

    hydrateOfflineForms().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [expiresAt, initialForms, tenantId, userId]);

  useEffect(() => {
    let active = true;

    async function hydrateEquipmentOptions() {
      const cached = await getCachedOfflineEquipmentLibrary(tenantId);

      if (!active) {
        return;
      }

      setEquipmentOptions(equipment.length > 0 ? equipment : cached.equipment);
    }

    hydrateEquipmentOptions().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [equipment, tenantId]);

  function updateDraftValue(itemId: string, value: Json) {
    setDraftValues((current) => ({
      ...current,
      [itemId]: value,
    }));
    clearValidationError(itemId);
  }

  function clearValidationError(key: string) {
    setValidationErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function updateRepeatDraftValue(itemId: string, repeatIndex: number, value: Json) {
    setDraftValues((current) => {
      const nextValues = [...repeatValues(current[itemId])];
      nextValues[repeatIndex] = value;

      return {
        ...current,
        [itemId]: nextValues,
      };
    });
    clearValidationError(repeatErrorKey(itemId, repeatIndex));
  }

  function updateCorrectiveAction(itemId: string, action: Partial<OfflineCorrectiveActionDrafts[string]>) {
    setCorrectiveActions((current) => ({
      ...current,
      [itemId]: {
        assignedTo: current[itemId]?.assignedTo ?? userId,
        description: current[itemId]?.description ?? "",
        enabled: current[itemId]?.enabled ?? false,
        ...action,
      },
    }));
  }

  async function captureCorrectiveActionPhoto(correctiveKey: string, file: File | undefined) {
    if (!file) {
      return;
    }

    updateCorrectiveAction(correctiveKey, {
      enabled: true,
      photo: {
        capturedAt: new Date().toISOString(),
        dataUrl: await readFileAsDataUrl(file),
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
        type: "photo",
      },
    });
  }

  const openForm = useCallback((form: OfflineFormSummary, draft?: OfflineDraftSubmission, assignment?: FormAssignmentSummary) => {
    const matchingAssignmentDraft = assignment
      ? drafts.find(
          (candidate) =>
            candidate.formId === form.id &&
            candidate.status === "draft" &&
            candidate.sourceAssignment?.source === assignment.source &&
            candidate.sourceAssignment.sourceId === assignment.sourceId,
        )
      : undefined;
    const existingDraft =
      draft ?? matchingAssignmentDraft ?? (!assignment ? drafts.find((candidate) => candidate.formId === form.id && candidate.status === "draft") : undefined);
    const values = existingDraft?.values ?? {};
    const assignmentLabel = assignment ? `${assignmentSourceLabel(assignment.source)} assignment` : "Assigned task";
    const sourceAssignment =
      existingDraft?.sourceAssignment ??
      (assignment
        ? {
            source: assignment.source,
            sourceId: assignment.sourceId,
          }
        : null);

    setActiveForm(form);
    setCollapsedSections({});
    setDraftValues(values);
    setValidationErrors({});
    setCorrectiveActions(existingDraft?.correctiveActions ?? {});
    setDefectSeverities(existingDraft?.defectSeverities ?? {});
    setEvidencePhotos(existingDraft?.evidencePhotos ?? {});
    setActiveDraftId(existingDraft?.id ?? null);
    setActiveAssignment(sourceAssignment);
    setActiveLocationId(existingDraft?.locationId ?? assignment?.locationId ?? defaultLocationId);
    setDraftNotice(
      existingDraft
        ? "Draft loaded from this device."
        : assignment
          ? `${assignmentLabel} loaded: ${assignment.name}. ${assignmentDueLabel(assignment)}.`
          : "",
    );
    setRepeatInstances(buildRepeatInstances(form, values));
  }, [defaultLocationId, drafts]);

  useEffect(() => {
    const requestedAssignment = requestedAssignmentFromUrl();

    if (!requestedAssignment) {
      return;
    }

    const requestedKey = assignmentKey(requestedAssignment);

    if (handledRequestedAssignmentRef.current === requestedKey) {
      return;
    }

    let targetForm: OfflineFormSummary | null = null;
    let targetAssignment: FormAssignmentSummary | null = null;
    let targetDraft: OfflineDraftSubmission | undefined;

    for (const form of forms) {
      const assignment = formAssignmentsByFormId
        .get(form.id)
        ?.find((candidate) => candidate.source === requestedAssignment.source && candidate.sourceId === requestedAssignment.sourceId);

      if (!assignment) {
        continue;
      }

      targetForm = form;
      targetAssignment = assignment;
      targetDraft = drafts.find(
        (candidate) =>
          candidate.formId === form.id &&
          candidate.status === "draft" &&
          candidate.sourceAssignment?.source === assignment.source &&
          candidate.sourceAssignment.sourceId === assignment.sourceId,
      );
      break;
    }

    if (!targetForm || !targetAssignment) {
      return;
    }

    handledRequestedAssignmentRef.current = requestedKey;
    const timeoutId = window.setTimeout(() => openForm(targetForm, targetDraft, targetAssignment), 0);

    return () => window.clearTimeout(timeoutId);
  }, [drafts, formAssignmentsByFormId, forms, openForm]);

  function closeActiveForm() {
    setActiveForm(null);
    setActiveDraftId(null);
    setCollapsedSections({});
    setDraftValues({});
    setValidationErrors({});
    setCorrectiveActions({});
    setDefectSeverities({});
    setEvidencePhotos({});
    setActiveAssignment(null);
    setActiveLocationId(defaultLocationId);
    setDraftNotice("");
    setRepeatInstances({});
  }

  function toggleSection(sectionId: string) {
    setCollapsedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }

  function addRepeatInstance(sectionId: string) {
    setRepeatInstances((current) => {
      const instances = current[sectionId] ?? [`${sectionId}-0`];

      return {
        ...current,
        [sectionId]: [...instances, `${sectionId}-${Date.now()}-${instances.length}`],
      };
    });
  }

  function removeRepeatInstance(sectionId: string, repeatIndex: number, items: OfflineFormItem[]) {
    setRepeatInstances((current) => {
      const instances = current[sectionId] ?? [];

      if (instances.length <= 1) {
        return current;
      }

      return {
        ...current,
        [sectionId]: instances.filter((_, index) => index !== repeatIndex),
      };
    });
    setDraftValues((current) => {
      const next = { ...current };

      for (const item of items) {
        const values = repeatValues(current[item.id]);
        next[item.id] = values.filter((_, index) => index !== repeatIndex);
      }

      return next;
    });
    setValidationErrors((current) => {
      const next = { ...current };

      for (const item of items) {
        const prefix = `${item.id}:`;

        for (const key of Object.keys(current)) {
          if (!key.startsWith(prefix)) {
            continue;
          }

          const index = Number(key.slice(prefix.length));

          if (index === repeatIndex) {
            delete next[key];
          } else if (index > repeatIndex) {
            next[repeatErrorKey(item.id, index - 1)] = current[key];
            delete next[key];
          }
        }
      }

      return next;
    });
    setCorrectiveActions((current) => {
      const next = { ...current };

      for (const item of items) {
        const prefix = `${item.id}:`;

        for (const key of Object.keys(current)) {
          if (!key.startsWith(prefix)) {
            continue;
          }

          const index = Number(key.slice(prefix.length));

          if (index === repeatIndex) {
            delete next[key];
          } else if (index > repeatIndex) {
            next[repeatErrorKey(item.id, index - 1)] = current[key];
            delete next[key];
          }
        }
      }

      return next;
    });
    setEvidencePhotos((current) => {
      const next = { ...current };

      for (const item of items) {
        const prefix = `${item.id}:`;

        for (const key of Object.keys(current)) {
          if (!key.startsWith(prefix)) {
            continue;
          }

          const index = Number(key.slice(prefix.length));

          if (index === repeatIndex) {
            delete next[key];
          } else if (index > repeatIndex) {
            next[`${item.id}:${index - 1}`] = current[key];
            delete next[key];
          }
        }
      }

      return next;
    });
  }

  async function captureEvidencePhoto(itemKey: string, file: File | undefined) {
    if (!file) {
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);

    setEvidencePhotos((current) => ({
      ...current,
      [itemKey]: {
        capturedAt: new Date().toISOString(),
        dataUrl,
        fileName: file.name,
        mimeType: file.type,
        size: file.size,
      },
    }));
  }

  function removeEvidencePhoto(itemKey: string) {
    setEvidencePhotos((current) => {
      if (!(itemKey in current)) {
        return current;
      }

      const next = { ...current };
      delete next[itemKey];
      return next;
    });
  }

  async function saveInProgressDraft(form: OfflineFormSummary) {
    setWorkingFormId(form.id);

    try {
      const draft = await saveOfflineDraftSubmission({
        correctiveActions,
        defectSeverities,
        draftId: activeDraftId,
        evidencePhotos,
        form,
        locationId: activeLocationId || null,
        sourceAssignment: activeAssignment,
        userId,
        values: draftValues,
      });

      setActiveDraftId(draft.id);
      setDrafts(await listDraftSubmissions({ tenantId, userId }));
      setDraftNotice("Draft saved on this device.");
    } finally {
      setWorkingFormId(null);
    }
  }

  async function submitForm(form: OfflineFormSummary) {
    if (locations.length > 1 && !activeLocationId) {
      setDraftNotice("Choose a location before submitting.");
      return;
    }

    const errors = requiredErrorsForForm(form, draftValues, repeatInstances);

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    setWorkingFormId(form.id);

    try {
      await createDraftSubmission({
        correctiveActions,
        defectAssigneeUserId: maintenanceContactUserId,
        defectSeverities,
        draftId: activeDraftId,
        evidencePhotos,
        form,
        locationId: activeLocationId || null,
        sourceAssignment: activeAssignment,
        userId,
        values: draftValues,
      });

      if (navigator.onLine) {
        await flushQueuedMutations();
        // Refresh server data so freshly-created corrective actions show up in
        // Outstanding Work without requiring the worker to navigate away.
        router.refresh();
      }

      setDrafts(await listDraftSubmissions({ tenantId, userId }));
      closeActiveForm();
    } finally {
      setWorkingFormId(null);
    }
  }

  function renderField(item: OfflineFormItem, value: Json | undefined, onChange: (value: Json) => void) {
    const options = getOfflineFieldOptions(item);
    const inputClass =
      "mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
    const textAreaClass =
      "mt-2 min-h-24 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
    const selected = valueAsStringArray(value);
    const renderOptionCheckboxes = () => (
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {options.length > 0 ? (
          options.map((option) => (
            <label
              className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
              key={option}
            >
              <input
                checked={selected.includes(option)}
                className="h-4 w-4 accent-[var(--primary)]"
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option]
                    : selected.filter((selectedOption) => selectedOption !== option);
                  onChange(next);
                }}
                type="checkbox"
              />
              {option}
            </label>
          ))
        ) : (
          <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
            No options configured.
          </p>
        )}
      </div>
    );

    switch (item.fieldType) {
      case "text_info":
        return (
          <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm leading-6 text-[var(--ink-muted)]">
            {item.helperText || settingString(item.settings, "body") || "Information block"}
          </div>
        );
      case "long_text":
        return (
          <textarea
            className={textAreaClass}
            onChange={(event) => onChange(event.target.value)}
            value={valueAsString(value)}
          />
        );
      case "number":
      case "pass_fail_total":
        return (
          <input
            className={inputClass}
            inputMode="decimal"
            onChange={(event) => onChange(event.target.value)}
            type="number"
            value={valueAsString(value)}
          />
        );
      case "date":
        return (
          <input
            className={inputClass}
            onChange={(event) => onChange(event.target.value)}
            type="date"
            value={valueAsString(value)}
          />
        );
      case "time":
        return (
          <input
            className={inputClass}
            onChange={(event) => onChange(event.target.value)}
            type="time"
            value={valueAsString(value)}
          />
        );
      case "yes_no":
      case "yes_no_na":
        return (
          <select
            className={inputClass}
            onChange={(event) => onChange(event.target.value)}
            value={valueAsString(value)}
          >
            <option value="">No answer</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
            {item.fieldType === "yes_no_na" ? <option value="na">N/A</option> : null}
          </select>
        );
      case "pass_fail_na": {
        const defaultSeverity = defaultDefectSeverity(item);
        const isFailed = valueAsString(value) === "fail";
        const chosenSeverity = defectSeverities[item.id] ?? defaultSeverity;

        return (
          <div className="grid gap-2">
            <select
              className={inputClass}
              onChange={(event) => {
                const next = event.target.value;
                onChange(next);
                // Seed the default severity the moment an item is failed so the
                // worker sees the Schedule 1 recommendation pre-selected.
                if (next === "fail" && defaultSeverity && !defectSeverities[item.id]) {
                  setDefectSeverities((current) => ({ ...current, [item.id]: defaultSeverity }));
                }
              }}
              value={valueAsString(value)}
            >
              <option value="">No answer</option>
              <option value="pass">Pass</option>
              <option value="fail">Fail</option>
              <option value="na">N/A</option>
            </select>
            {isFailed && defaultSeverity ? (
              <div className="rounded-md border border-[var(--warning)] bg-amber-50 p-2.5">
                <p className="text-xs font-semibold text-[var(--ink)]">Defect severity</p>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  A major defect takes the unit out of service until the repair is verified. Minor defects are repaired
                  within the allowed window.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(["major", "minor"] as const).map((severity) => (
                    <label
                      className={`flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold ${
                        chosenSeverity === severity
                          ? "border-[var(--primary)] bg-white text-[var(--ink)]"
                          : "border-[var(--border)] bg-white text-[var(--ink-muted)]"
                      }`}
                      key={severity}
                    >
                      <input
                        checked={chosenSeverity === severity}
                        className="sr-only"
                        name={`severity-${item.id}`}
                        onChange={() => setDefectSeverities((current) => ({ ...current, [item.id]: severity }))}
                        type="radio"
                        value={severity}
                      />
                      {severity === "major" ? "Major (out of service)" : "Minor (repair soon)"}
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        );
      }
      case "single_select":
      case "dropdown_select_one":
        return (
          <select
            className={inputClass}
            onChange={(event) => onChange(event.target.value)}
            value={valueAsString(value)}
          >
            <option value="">No answer</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      case "multi_select":
      case "dropdown_select_multiple":
        return renderOptionCheckboxes();
      case "checkbox":
        return options.length > 0 ? (
          renderOptionCheckboxes()
        ) : (
          <label className="mt-2 flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]">
            <input
              checked={valueAsBoolean(value)}
              className="h-4 w-4 accent-[var(--primary)]"
              onChange={(event) => onChange(event.target.checked)}
              type="checkbox"
            />
            Checked
          </label>
        );
      case "photo":
        return <PhotoField onChange={onChange} value={value} />;
      case "signature":
        return (
          <SignatureField
            defaultSignerName={workers.find((worker) => worker.id === userId)?.fullName ?? "Worker"}
            onChange={onChange}
            value={value}
          />
        );
      case "gps_coordinates":
        return <GpsField onChange={onChange} value={value} />;
      case "worker_select": {
        const workerScope = coerceWorkerPickerScope(getFormItemSettingString(item.settings, "workerPickerScope"));
        const workerOptions = workerScope === "current_worker" ? workers.filter((worker) => worker.id === userId) : workers;

        return (
          <select
            className={inputClass}
            onChange={(event) => onChange(event.target.value)}
            value={valueAsString(value)}
          >
            <option value="">No worker selected</option>
            {workerOptions.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.fullName}
              </option>
            ))}
          </select>
        );
      }
      case "equipment_select":
        return (
          <EquipmentSelectField
            activeLocationId={activeLocationId}
            equipment={equipmentOptions}
            onChange={onChange}
            requireMeter={requiresEquipmentMeter(item)}
            scope={coerceEquipmentPickerScope(getFormItemSettingString(item.settings, "equipmentPickerScope"))}
            userId={userId}
            value={value}
          />
        );
      case "workers_select": {
        const selectedWorkers = valueAsStringArray(value);
        const workerScope = coerceWorkerPickerScope(getFormItemSettingString(item.settings, "workerPickerScope"));
        const workerOptions = workerScope === "current_worker" ? workers.filter((worker) => worker.id === userId) : workers;

        if (workerOptions.length === 0) {
          return (
            <p className="mt-2 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
              No active workers available.
            </p>
          );
        }

        return (
          <div className="mt-2 grid gap-2">
            {workerOptions.map((worker) => (
              <label
                className="flex min-h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)]"
                key={worker.id}
              >
                <input
                  checked={selectedWorkers.includes(worker.id)}
                  className="h-4 w-4 accent-[var(--primary)]"
                  onChange={(event) => {
                    const next = event.target.checked
                      ? Array.from(new Set([...selectedWorkers, worker.id]))
                      : selectedWorkers.filter((id) => id !== worker.id);
                    onChange(next);
                  }}
                  type="checkbox"
                />
                {worker.fullName}
                {worker.title ? ` - ${worker.title}` : ""}
              </label>
            ))}
          </div>
        );
      }
      case "pdf_insert":
        return (
          <FileAttachmentField
            accept="application/pdf,.pdf"
            label="PDF"
            onChange={onChange}
            value={value}
          />
        );
      case "image_view":
      case "pdf_view": {
        const url = getFormItemSettingString(item.settings, "sourceUrl") || getFormItemSettingString(item.settings, "url");
        const sourceLabel = getFormItemSettingString(item.settings, "sourceLabel");

        return url ? (
          <a
            className="mt-2 inline-flex h-10 max-w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            <Upload className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{sourceLabel || "Open Reference"}</span>
          </a>
        ) : (
          <p className="mt-2 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
            Reference file is not attached to this field yet.
          </p>
        );
      }
      default:
        return (
          <input
            className={inputClass}
            onChange={(event) => onChange(event.target.value)}
            type="text"
            value={valueAsString(value)}
          />
        );
    }
  }

  function renderFormItem({
    correctiveKey,
    item,
    onChange,
    validationKey,
    value,
  }: {
    correctiveKey: string;
    item: OfflineFormItem;
    onChange: (value: Json) => void;
    validationKey: string;
    value: Json | undefined;
  }) {
    return (
      <div
        className={`block rounded-md border p-3 ${
          validationErrors[validationKey] ? "border-[var(--danger)] bg-red-50/40" : "border-[var(--border)]"
        }`}
        key={validationKey}
      >
        <span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--ink)]">
          {item.label}
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
        </span>
        {/* whitespace-pre-line so multi-line guidance (the pre-trip checks and
            defect definitions, for one) keeps its line breaks instead of
            collapsing into a wall of text. */}
        {item.helperText && item.fieldType !== "text_info" ? (
          <span className="mt-1 block whitespace-pre-line text-sm text-[var(--ink-muted)]">{item.helperText}</span>
        ) : null}
        {renderField(item, value, onChange)}
        {validationErrors[validationKey] ? (
          <p className="mt-2 text-sm font-semibold text-[var(--danger)]">{validationErrors[validationKey]}</p>
        ) : null}
        {shouldShowEvidencePhoto(item) ? (
          <EvidencePhotoControl
            evidence={evidencePhotos[correctiveKey]}
            onCapture={(file) => captureEvidencePhoto(correctiveKey, file).catch(() => undefined)}
            onRemove={() => removeEvidencePhoto(correctiveKey)}
          />
        ) : null}
        {item.flaggable ? (
          <div className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
              <input
                checked={Boolean(correctiveActions[correctiveKey]?.enabled)}
                className="h-4 w-4 accent-[var(--primary)]"
                onChange={(event) =>
                  updateCorrectiveAction(correctiveKey, {
                    assignedTo: correctiveActions[correctiveKey]?.assignedTo ?? userId,
                    enabled: event.target.checked,
                  })
                }
                type="checkbox"
              />
              Create corrective action
            </label>
            {correctiveActions[correctiveKey]?.enabled ? (
              <div className="mt-3 grid gap-3">
                <textarea
                  className="min-h-20 w-full resize-y rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  onChange={(event) =>
                    updateCorrectiveAction(correctiveKey, {
                      description: event.target.value,
                    })
                  }
                  placeholder="What needs to be corrected?"
                  value={correctiveActions[correctiveKey]?.description ?? ""}
                />
                <label className="space-y-2">
                  <span className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                    <UserRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                    Assign To
                  </span>
                  <select
                    className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    onChange={(event) =>
                      updateCorrectiveAction(correctiveKey, {
                        assignedTo: event.target.value,
                      })
                    }
                    value={correctiveActions[correctiveKey]?.assignedTo ?? userId}
                  >
                    {workers.length > 0 ? (
                      workers.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.fullName}
                          {worker.title ? ` - ${worker.title}` : ""}
                        </option>
                      ))
                    ) : (
                      <option value={userId}>Current worker</option>
                    )}
                  </select>
                </label>
                <div className="rounded-md border border-[var(--border)] bg-white p-3">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-[var(--ink)]">Evidence photo</p>
                      <p className="text-xs text-[var(--ink-muted)]">Attach the on-site condition for sign-off review.</p>
                    </div>
                    <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]">
                      <Upload className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      Add Photo
                      <input
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        onChange={(event) => captureCorrectiveActionPhoto(correctiveKey, event.target.files?.[0]).catch(() => undefined)}
                        type="file"
                      />
                    </label>
                  </div>
                  {correctiveActions[correctiveKey]?.photo?.dataUrl ? (
                    <div className="mt-3 grid gap-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        alt="Corrective action evidence"
                        className="max-h-56 rounded-md border border-[var(--border)] object-contain"
                        src={correctiveActions[correctiveKey]?.photo?.dataUrl}
                      />
                      <button
                        className="inline-flex h-9 w-fit items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                        onClick={() =>
                          updateCorrectiveAction(correctiveKey, {
                            photo: undefined,
                          })
                        }
                        type="button"
                      >
                        <Trash2 className="h-4 w-4 text-[var(--danger)]" aria-hidden="true" />
                        Remove Photo
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Assigned Forms</h2>
          <p className="text-sm text-[var(--ink-muted)]">{forms.length} cached</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <ClipboardList className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      {forms.length > 0 ? (
        <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
          {orderedForms.map((form) => {
            const inProgressDraft = drafts.find((draft) => draft.formId === form.id && draft.status === "draft");
            const queuedDraft = drafts.find((draft) => draft.formId === form.id && ["failed", "queued", "syncing"].includes(draft.status));
            const formAssignments = formAssignmentsByFormId.get(form.id) ?? [];
            const nextAssignment = formAssignments[0];

            return (
              <div className="grid gap-3 p-3 sm:grid-cols-[1fr_auto] sm:items-start" key={form.id}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold text-[var(--ink)]">{form.name}</p>
                    {nextAssignment ? (
                      <span className={`rounded-md px-2 py-1 text-xs font-semibold ${assignmentStatusClass(nextAssignment)}`}>
                        {assignmentStatusLabel(nextAssignment)}
                      </span>
                    ) : null}
                    {formAssignments.length > 1 ? (
                      <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                        {formAssignments.length} assignments
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-[var(--ink-muted)]">{form.code}</p>
                  {nextAssignment ? (
                    <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-[var(--ink)]">
                      <CalendarClock className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                      Next due: {assignmentSourceLabel(nextAssignment.source)} - {nextAssignment.name},{" "}
                      {assignmentDueLabel(nextAssignment)}
                    </p>
                  ) : null}
                  {inProgressDraft ? (
                    <p className="mt-1 text-xs font-semibold text-[var(--primary)]">Draft saved on this device</p>
                  ) : queuedDraft ? (
                    <p className="mt-1 text-xs font-semibold text-[var(--ink-muted)]">{formatDraftStatus(queuedDraft.status)}</p>
                  ) : null}
                  {formAssignments.length > 0 ? (
                    <div className="mt-3 grid gap-2">
                      {formAssignments.map((assignment) => {
                        const assignmentLocation = assignment.locationId ? locationById.get(assignment.locationId) : null;
                        const matchingDraft = drafts.find(
                          (draft) =>
                            draft.formId === form.id &&
                            draft.status === "draft" &&
                            draft.sourceAssignment?.source === assignment.source &&
                            draft.sourceAssignment.sourceId === assignment.sourceId,
                        );

                        return (
                          <div
                            className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 md:grid-cols-[1fr_auto] md:items-center"
                            key={assignmentKey(assignment)}
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${assignmentSourceClass(assignment.source)}`}>
                                  {assignmentSourceLabel(assignment.source)}
                                </span>
                                <span className={`rounded-md px-2 py-1 text-xs font-semibold ${assignmentStatusClass(assignment)}`}>
                                  {assignmentStatusLabel(assignment)}
                                </span>
                              </div>
                              <p className="mt-2 truncate text-sm font-semibold text-[var(--ink)]">{assignment.name}</p>
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                {assignmentDueLabel(assignment)}
                                {assignmentLocation ? ` at ${assignmentLocation.name}` : " at any location"}
                              </p>
                              {matchingDraft ? (
                                <p className="mt-1 text-xs font-semibold text-[var(--primary)]">Draft saved for this assignment</p>
                              ) : null}
                            </div>
                            <button
                              className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                              disabled={workingFormId === form.id}
                              onClick={() => openForm(form, matchingDraft, assignment)}
                              type="button"
                            >
                              {workingFormId === form.id ? (
                                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                              ) : (
                                <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                              )}
                              {matchingDraft ? "Resume Assignment" : assignmentActionLabel(assignment)}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
                <button
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={workingFormId === form.id}
                  onClick={() => openForm(form, inProgressDraft, nextAssignment)}
                  type="button"
                >
                  {workingFormId === form.id ? (
                    <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                  )}
                  {inProgressDraft ? "Resume Draft" : nextAssignment ? "Start Next Due" : "Open"}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
          No assigned forms are due.
        </div>
      )}

      {activeForm ? (
        <div className="mt-5 rounded-md border border-[var(--border)] bg-white">
          <div className="flex flex-col gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] p-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="font-semibold text-[var(--ink)]">{activeForm.name}</h3>
              <p className="text-sm text-[var(--ink-muted)]">
                {activeForm.code} - {activeForm.sections.length} sections
              </p>
              {activeAssignmentSummary ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${assignmentSourceClass(activeAssignmentSummary.source)}`}>
                    {assignmentSourceLabel(activeAssignmentSummary.source)}
                  </span>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${assignmentStatusClass(activeAssignmentSummary)}`}>
                    {assignmentStatusLabel(activeAssignmentSummary)}
                  </span>
                  <span className="text-xs font-semibold text-[var(--ink-muted)]">
                    {activeAssignmentSummary.name} - {assignmentDueLabel(activeAssignmentSummary)}
                  </span>
                </div>
              ) : activeAssignment ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${assignmentSourceClass(activeAssignment.source)}`}>
                    {assignmentSourceLabel(activeAssignment.source)}
                  </span>
                  <span className="text-xs font-semibold text-[var(--ink-muted)]">Assignment loaded</span>
                </div>
              ) : null}
              {Object.keys(validationErrors).length > 0 ? (
                <p className="mt-2 text-sm font-semibold text-[var(--danger)]">
                  Complete the required fields before submitting.
                </p>
              ) : null}
            </div>
            <button
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
              onClick={closeActiveForm}
              title="Close form"
              type="button"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              <span className="sr-only">Close form</span>
            </button>
          </div>

          {activeForm.sections.length > 0 ? (
            <>
              {locations.length > 0 ? (
                <div className="border-b border-[var(--border)] p-4">
                  <label className="block space-y-2">
                    <span className="flex items-center gap-2 text-sm font-medium text-[var(--ink)]">
                      <MapPin className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                      Location
                    </span>
                    <select
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      onChange={(event) => {
                        setActiveLocationId(event.target.value);
                        setDraftNotice("");
                      }}
                      value={activeLocationId}
                    >
                      <option value="">Choose location</option>
                      {locations.map((location) => (
                        <option key={location.id} value={location.id}>
                          {location.name}
                          {location.code ? ` (${location.code})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
              <div className="divide-y divide-[var(--border)]">
              {activeForm.sections.map((section) => {
                const isCollapsed = Boolean(collapsedSections[section.id]);
                const sectionItems = visibleFormItems(section.items);
                const sectionInstances =
                  repeatInstances[section.id] ??
                  Array.from({ length: repeatableSectionInstanceCount(sectionItems, draftValues) }, (_, index) => `${section.id}-${index}`);

                return (
                  <section className="p-4" key={section.id}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-2">
                        {section.collapsible ? (
                          <button
                            className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
                            onClick={() => toggleSection(section.id)}
                            title={isCollapsed ? "Expand section" : "Collapse section"}
                            type="button"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <ChevronDown className="h-4 w-4" aria-hidden="true" />
                            )}
                            <span className="sr-only">{isCollapsed ? "Expand section" : "Collapse section"}</span>
                          </button>
                        ) : null}
                        <div className="min-w-0">
                          <h4 className="font-semibold text-[var(--ink)]">{section.title}</h4>
                          <p className="text-sm text-[var(--ink-muted)]">
                            {sectionItems.length} fields
                            {section.repeatable ? `, ${sectionInstances.length} entries` : ""}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {section.repeatable ? (
                          <button
                            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                            onClick={() => addRepeatInstance(section.id)}
                            type="button"
                          >
                            <Plus className="h-4 w-4" aria-hidden="true" />
                            Add Entry
                          </button>
                        ) : null}
                        {section.repeatable ? (
                          <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                            Repeatable
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {!isCollapsed && sectionItems.length > 0 && !section.repeatable ? (
                      <div className="mt-4 grid gap-4">
                        {sectionItems.map((item) =>
                          renderFormItem({
                            correctiveKey: item.id,
                            item,
                            onChange: (nextValue) => updateDraftValue(item.id, nextValue),
                            validationKey: item.id,
                            value: draftValues[item.id],
                          }),
                        )}
                      </div>
                    ) : null}

                    {!isCollapsed && sectionItems.length > 0 && section.repeatable ? (
                      <div className="mt-4 grid gap-4">
                        {sectionInstances.map((instanceId, repeatIndex) => (
                          <div className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3" key={instanceId}>
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-[var(--ink)]">Entry {repeatIndex + 1}</p>
                              {sectionInstances.length > 1 ? (
                                <button
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-white text-[var(--ink-muted)] transition hover:bg-red-50 hover:text-[var(--danger)]"
                                  onClick={() => removeRepeatInstance(section.id, repeatIndex, sectionItems)}
                                  title="Remove entry"
                                  type="button"
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                  <span className="sr-only">Remove entry</span>
                                </button>
                              ) : null}
                            </div>
                            <div className="mt-3 grid gap-4">
                              {sectionItems.map((item) => {
                                const validationKey = repeatErrorKey(item.id, repeatIndex);

                                return renderFormItem({
                                  correctiveKey: validationKey,
                                  item,
                                  onChange: (nextValue) => updateRepeatDraftValue(item.id, repeatIndex, nextValue),
                                  validationKey,
                                  value: repeatValues(draftValues[item.id])[repeatIndex],
                                });
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {!isCollapsed && sectionItems.length === 0 ? (
                      <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                        No worker-visible fields are configured in this section.
                      </div>
                    ) : null}
                  </section>
                );
              })}
              </div>
            </>
          ) : (
            <div className="p-6 text-center text-sm text-[var(--ink-muted)]">
              This form does not have sections yet.
            </div>
          )}

          <div className="flex flex-col gap-3 border-t border-[var(--border)] p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm text-[var(--ink-muted)]">
                {answeredValueCount(draftValues)} answers,{" "}
                {Object.values(correctiveActions).filter((action) => action.enabled).length} corrective actions
              </p>
              {draftNotice ? <p className="mt-1 text-sm font-semibold text-[var(--primary)]">{draftNotice}</p> : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={workingFormId === activeForm.id}
                onClick={() => saveInProgressDraft(activeForm)}
                type="button"
              >
                {workingFormId === activeForm.id ? (
                  <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-4 w-4" aria-hidden="true" />
                )}
                Save Draft
              </button>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={workingFormId === activeForm.id}
                onClick={() => submitForm(activeForm)}
                type="button"
              >
                {workingFormId === activeForm.id ? (
                  <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-4 w-4" aria-hidden="true" />
                )}
                Submit Form
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {drafts.length > 0 ? (
        <div className="mt-5">
          <h3 className="text-sm font-semibold text-[var(--ink)]">Drafts and Queued Submissions</h3>
          <div className="mt-3 divide-y divide-[var(--border)] rounded-md border border-[var(--border)]">
            {drafts.map((draft) => {
              const draftForm = forms.find((form) => form.id === draft.formId);

              return (
                <div className="flex items-center justify-between gap-3 p-3" key={draft.id}>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--ink)]">{draft.formName}</p>
                    <p className="truncate text-xs text-[var(--ink-muted)]">{draft.formCode}</p>
                    <p className="mt-1 text-xs text-[var(--ink-muted)]">
                      {answeredValueCount(draft.values)} answers,{" "}
                      {Object.values(draft.correctiveActions ?? {}).filter((action) => action.enabled).length} actions
                    </p>
                  </div>
                  {draft.status === "draft" && draftForm ? (
                    <button
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                      onClick={() => openForm(draftForm, draft)}
                      type="button"
                    >
                      <FilePlus2 className="h-4 w-4" aria-hidden="true" />
                      Resume
                    </button>
                  ) : (
                    <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                      {formatDraftStatus(draft.status)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {workers.length > 0 ? (
        <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
          <p className="inline-flex items-center gap-2 text-sm text-[var(--ink-muted)]">
            <UserRound className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
            Worker pickers can use {workers.length} active workers.
          </p>
        </div>
      ) : null}
    </div>
  );
}
