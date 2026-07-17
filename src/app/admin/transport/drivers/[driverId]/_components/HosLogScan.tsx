"use client";

import { useState } from "react";
import { Camera, Plus, Sparkles, Trash2 } from "lucide-react";
import { saveDutyLogSegments } from "@/app/admin/actions";

type Segment = { status: string; startedAt: string };

const STATUS_OPTIONS: [string, string][] = [
  ["off_duty", "Off duty"],
  ["sleeper_berth", "Sleeper berth"],
  ["driving", "Driving"],
  ["on_duty", "On duty (not driving)"],
];

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

// Treat the datetime-local field as UTC so it stays consistent with the OCR
// parser and the engine's duration math (tenant-timezone is a later refinement).
function isoToInput(iso: string) {
  return iso.slice(0, 16);
}

function inputToIso(value: string) {
  if (!value) {
    return "";
  }
  const ms = Date.parse(`${value}:00Z`);
  return Number.isNaN(ms) ? "" : new Date(ms).toISOString();
}

/**
 * Confirm-required paper-log scan: upload a photo of the daily log, an AI proposes
 * the duty-status changes, and the manager reviews/edits before saving. Never
 * auto-saves: handwriting and graph grids are not reliable enough to trust blind.
 */
export function HosLogScan({ driverId, ready }: { driverId: string; ready: boolean }) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) {
    return (
      <p className="rounded-md border border-dashed border-[var(--border)] bg-white px-3 py-3 text-sm text-[var(--ink-muted)]">
        AI log scanning is not configured. Set OPENROUTER_API_KEY and a vision model (OPENROUTER_HOS_OCR_MODEL) to
        enable photographing a paper log.
      </p>
    );
  }

  async function extract(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/transport/hos-ocr", { method: "POST", body: new FormData(event.currentTarget) });
      const json = (await response.json().catch(() => null)) as { segments?: Segment[]; error?: string } | null;

      if (!response.ok || !json) {
        setError(json?.error ?? "Could not read the log.");
        setSegments([]);
      } else {
        setSegments(Array.isArray(json.segments) ? json.segments : []);
        if (!json.segments?.length) {
          setError("No duty-status changes were detected. Add them by hand below.");
        }
      }
    } catch {
      setError("Could not read the log.");
    } finally {
      setLoading(false);
    }
  }

  function updateSegment(index: number, patch: Partial<Segment>) {
    setSegments((current) => current.map((segment, i) => (i === index ? { ...segment, ...patch } : segment)));
  }

  function removeSegment(index: number) {
    setSegments((current) => current.filter((_, i) => i !== index));
  }

  function addSegment() {
    setSegments((current) => [...current, { status: "on_duty", startedAt: "" }]);
  }

  const saveable = segments.filter((segment) => segment.startedAt);

  return (
    <div className="grid gap-3">
      <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={extract}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Log date</span>
            <input className={inputClass} name="date" type="date" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Photo of the log</span>
            <input accept="image/*" className={inputClass} name="image" required type="file" />
          </label>
        </div>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {loading ? "Reading..." : "Read log"}
        </button>
      </form>

      {error ? <p className="text-sm font-semibold text-[var(--danger)]">{error}</p> : null}

      {segments.length > 0 ? (
        <div className="grid gap-2">
          <p className="text-xs text-[var(--ink-muted)]">
            Review and correct every row before saving. This is an AI suggestion, not a substitute for the driver&apos;s
            log.
          </p>
          {segments.map((segment, index) => (
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center" key={index}>
              <select
                className={inputClass}
                onChange={(event) => updateSegment(index, { status: event.target.value })}
                value={segment.status}
              >
                {STATUS_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                className={inputClass}
                onChange={(event) => updateSegment(index, { startedAt: inputToIso(event.target.value) })}
                type="datetime-local"
                value={isoToInput(segment.startedAt)}
              />
              <button
                className="inline-flex h-10 items-center justify-center gap-1 rounded-md border border-[var(--border)] px-3 text-sm font-semibold text-[var(--ink-muted)] transition hover:text-[var(--danger)]"
                onClick={() => removeSegment(index)}
                type="button"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Remove
              </button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              className="inline-flex h-9 items-center gap-1 rounded-md border border-[var(--border)] px-3 text-sm font-semibold text-[var(--primary)] transition hover:bg-[var(--surface-muted)]"
              onClick={addSegment}
              type="button"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add row
            </button>
            <form action={saveDutyLogSegments}>
              <input name="driverId" type="hidden" value={driverId} />
              <input name="segments" type="hidden" value={JSON.stringify(saveable)} />
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-strong)] disabled:opacity-60"
                disabled={saveable.length === 0}
                type="submit"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                Save {saveable.length} {saveable.length === 1 ? "entry" : "entries"}
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
