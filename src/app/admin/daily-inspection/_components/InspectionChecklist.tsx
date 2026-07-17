"use client";

import { useState } from "react";
import { coerceScheduleNo, SCHEDULE_OPTIONS } from "@/lib/daily-inspection";
import type { ScheduleNo } from "@/lib/dti-rules";
import { getSchedule, scheduleItems } from "@/lib/dti-schedules";

const selectClass =
  "h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";
const noteClass =
  "mt-2 h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

// Vehicle-type picker + the matching NSC schedule checklist. Client component so
// the rendered items switch when the operator changes the vehicle type; only the
// visible schedule's fields submit, and the chosen schedule_no rides along.
export function InspectionChecklist() {
  const [scheduleNo, setScheduleNo] = useState<ScheduleNo>(1);
  const schedule = getSchedule(scheduleNo);
  const items = scheduleItems(scheduleNo);

  return (
    <div className="space-y-4">
      <label className="block space-y-1 sm:max-w-sm">
        <span className="text-sm font-medium text-[var(--ink)]">Vehicle type</span>
        <select
          className={selectClass}
          name="schedule_no"
          onChange={(event) => setScheduleNo(coerceScheduleNo(event.target.value))}
          value={String(scheduleNo)}
        >
          {SCHEDULE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="rounded-md border border-[var(--border)] bg-white" key={scheduleNo}>
        <div className="border-b border-[var(--border)] p-3">
          <h3 className="text-sm font-semibold text-[var(--ink)]">{schedule.title} checklist</h3>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {schedule.appliesTo}. Mark each item; anything left as Pass is recorded as no defect.
          </p>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {items.map((item) => (
            <div className="p-3" key={item.no}>
              <p className="text-sm font-semibold text-[var(--ink)]">
                {item.no}. {item.label}
              </p>
              {item.majorDefects.length > 0 ? (
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                  Major if: {item.majorDefects[0].toLowerCase()}
                  {item.majorDefects.length > 1 ? ", ..." : ""}
                </p>
              ) : null}
              <div className="mt-2 flex items-center gap-4 text-sm">
                {(["pass", "minor", "major"] as const).map((status) => (
                  <label className="inline-flex items-center gap-1.5" key={status}>
                    <input defaultChecked={status === "pass"} name={`status_${item.no}`} type="radio" value={status} />
                    <span
                      className={
                        status === "major"
                          ? "text-[var(--danger)]"
                          : status === "minor"
                            ? "text-[var(--warning)]"
                            : "text-[var(--ink-muted)]"
                      }
                    >
                      {status === "pass" ? "Pass" : status === "minor" ? "Minor" : "Major"}
                    </span>
                  </label>
                ))}
              </div>
              <input className={noteClass} name={`note_${item.no}`} placeholder="Note (optional)" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
