"use client";

import { useSyncExternalStore } from "react";
import { AlertCircle, Camera, ClipboardList, Clock, ListChecks, MapPin, Package, Route, WifiOff, Wrench } from "lucide-react";
import {
  addWorkOrderEquipment,
  addWorkOrderFieldLog,
  addWorkOrderMaterial,
  addWorkOrderNote,
  clockOffWorkOrder,
  clockOnWorkOrder,
  toggleWorkOrderTask,
  updateAssignedWorkOrder,
  updateWorkOrderEquipmentFlag,
} from "@/app/actions";
import { WorkOrderSignOff } from "@/app/web/_components/WorkOrderSignOff";
import {
  equipmentConditionLabel,
  workOrderStatusBadge,
  workOrderStatusLabel,
  workTypeLabel,
} from "@/lib/trades";

type WorkOrderTask = {
  id: string;
  label: string;
  done: boolean;
};

type WorkOrderEquipment = {
  id: string;
  title: string;
  condition: "good" | "monitor" | "needs_replacement" | null;
  needs_follow_up: boolean;
};

type WorkOrderItem = {
  id: string;
  title: string;
  status: "open" | "scheduled" | "in_progress" | "completed" | "cancelled";
  work_type: "service_call" | "project";
  customer_name: string;
  address: string | null;
  schedule: string | null;
  tasks: WorkOrderTask[];
  equipment: WorkOrderEquipment[];
};

const CONDITION_OPTIONS: { value: "good" | "monitor" | "needs_replacement"; label: string }[] = [
  { value: "good", label: "Good" },
  { value: "monitor", label: "Monitor" },
  { value: "needs_replacement", label: "Needs replacement" },
];

function subscribeOnlineStatus(onStoreChange: () => void) {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

// Crew-facing list of the worker's own assigned jobs. The worker app shell and its
// last-loaded page are cached by the service worker, so this list stays readable
// on site with no signal. Updates (start, complete, notes) need a connection, so
// those controls are disabled with a banner while offline.
export function MyWorkOrdersPanel({
  clockedOnWorkOrderId,
  workOrders,
}: {
  clockedOnWorkOrderId: string | null;
  workOrders: WorkOrderItem[];
}) {
  const isOnline = useSyncExternalStore(
    subscribeOnlineStatus,
    () => navigator.onLine,
    () => true,
  );
  const offline = !isOnline;

  return (
    <section className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="my-work">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <ClipboardList className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">My work</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Your assigned jobs. Tap Start when you arrive and Mark complete when you are done.
          </p>
        </div>
      </div>

      {offline ? (
        <p className="mt-4 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm font-semibold text-[var(--warning)]">
          <WifiOff className="h-4 w-4" aria-hidden="true" />
          You are offline. This is your last-loaded job list; reconnect to start, complete, or add notes.
        </p>
      ) : null}

      {workOrders.length === 0 ? (
        <p className="mt-4 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-center text-sm text-[var(--ink-muted)]">
          No jobs assigned to you right now.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {workOrders.map((workOrder) => {
            const clockedHere = clockedOnWorkOrderId === workOrder.id;
            const clockedElsewhere = Boolean(clockedOnWorkOrderId) && !clockedHere;

            return (
            <li className="rounded-md border border-[var(--border)] bg-white p-4" key={workOrder.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--ink)]">{workOrder.title}</p>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {[workOrder.customer_name, workTypeLabel(workOrder.work_type), workOrder.schedule]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {workOrder.address ? (
                    <p className="mt-1 flex items-center gap-1 text-sm text-[var(--ink-muted)]">
                      <MapPin className="h-4 w-4 shrink-0 text-[var(--primary)]" aria-hidden="true" />
                      {workOrder.address}
                    </p>
                  ) : null}
                </div>
                <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${workOrderStatusBadge(workOrder.status)}`}>
                  {workOrderStatusLabel(workOrder.status)}
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {clockedHere ? (
                  <form action={clockOffWorkOrder}>
                    <input name="workOrderId" type="hidden" value={workOrder.id} />
                    <button
                      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-[var(--warning)] bg-amber-50 px-4 text-sm font-semibold text-[var(--warning)] transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={offline}
                      type="submit"
                    >
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      Clock off
                    </button>
                  </form>
                ) : (
                  <form action={clockOnWorkOrder}>
                    <input name="workOrderId" type="hidden" value={workOrder.id} />
                    <button
                      className="inline-flex h-11 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={offline || clockedElsewhere}
                      title={clockedElsewhere ? "Clock off your other job first" : undefined}
                      type="submit"
                    >
                      <Clock className="h-4 w-4" aria-hidden="true" />
                      Clock on
                    </button>
                  </form>
                )}
                {workOrder.status !== "in_progress" ? (
                  <form action={updateAssignedWorkOrder}>
                    <input name="workOrderId" type="hidden" value={workOrder.id} />
                    <input name="status" type="hidden" value="in_progress" />
                    <button
                      className="inline-flex h-11 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={offline}
                      type="submit"
                    >
                      Start
                    </button>
                  </form>
                ) : null}
                <WorkOrderSignOff disabled={offline} workOrderId={workOrder.id} />
              </div>

              {workOrder.tasks.length > 0 ? (
                <div className="mt-3 rounded-md border border-[var(--border)] bg-white p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                    <ListChecks className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                    Checklist
                    <span className="text-xs font-normal text-[var(--ink-muted)]">
                      {workOrder.tasks.filter((task) => task.done).length} of {workOrder.tasks.length} done
                    </span>
                  </p>
                  <ul className="mt-2 space-y-1">
                    {workOrder.tasks.map((task) => (
                      <li key={task.id}>
                        <form action={toggleWorkOrderTask}>
                          <input name="workOrderId" type="hidden" value={workOrder.id} />
                          <input name="taskId" type="hidden" value={task.id} />
                          <input name="done" type="hidden" value={task.done ? "false" : "true"} />
                          <button
                            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={offline}
                            type="submit"
                          >
                            <span
                              aria-hidden="true"
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border text-xs font-bold ${
                                task.done
                                  ? "border-[var(--success)] bg-emerald-50 text-[var(--success)]"
                                  : "border-[var(--border)] text-transparent"
                              }`}
                            >
                              ✓
                            </span>
                            <span className={task.done ? "text-[var(--ink-muted)] line-through" : "text-[var(--ink)]"}>
                              {task.label}
                            </span>
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {workOrder.equipment.length > 0 ? (
                <div className="mt-3 rounded-md border border-[var(--border)] bg-white p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                    <Wrench className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
                    Equipment at this site
                  </p>
                  <ul className="mt-2 space-y-2">
                    {workOrder.equipment.map((unit) => (
                      <li className="rounded-md border border-[var(--border)] p-2" key={unit.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-[var(--ink)]">{unit.title}</span>
                          {unit.condition ? (
                            <span className="rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--ink-muted)]">
                              {equipmentConditionLabel(unit.condition)}
                            </span>
                          ) : null}
                          {unit.needs_follow_up ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--danger)]">
                              <AlertCircle className="h-3 w-3" aria-hidden="true" />
                              Follow-up
                            </span>
                          ) : null}
                        </div>
                        <details className="mt-1">
                          <summary className="cursor-pointer text-xs font-semibold text-[var(--primary)]">
                            Set condition / flag
                          </summary>
                          <form action={updateWorkOrderEquipmentFlag} className="mt-2 grid gap-2">
                            <input name="workOrderId" type="hidden" value={workOrder.id} />
                            <input name="equipmentId" type="hidden" value={unit.id} />
                            <select
                              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              defaultValue={unit.condition ?? ""}
                              disabled={offline}
                              name="condition"
                            >
                              <option value="">Condition not set</option>
                              {CONDITION_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                              <input
                                className="h-4 w-4 accent-[var(--primary)]"
                                defaultChecked={unit.needs_follow_up}
                                disabled={offline}
                                name="needsFollowUp"
                                type="checkbox"
                                value="true"
                              />
                              Flag for office follow-up
                            </label>
                            <input
                              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                              disabled={offline}
                              name="followUpNote"
                              placeholder="Follow-up note (optional)"
                              type="text"
                            />
                            <button
                              className="inline-flex h-10 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                              disabled={offline}
                              type="submit"
                            >
                              Save
                            </button>
                          </form>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <details className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold text-[var(--primary)]">
                  <Camera className="h-4 w-4" aria-hidden="true" />
                  Add note or photo
                </summary>
                <form action={addWorkOrderNote} className="grid gap-2 border-t border-[var(--border)] p-3" encType="multipart/form-data">
                  <input name="workOrderId" type="hidden" value={workOrder.id} />
                  <textarea
                    className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    disabled={offline}
                    name="note"
                    placeholder="What you found or did on site"
                  />
                  <input
                    accept="image/png,image/jpeg,image/webp"
                    className="block w-full text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--ink)]"
                    disabled={offline}
                    name="photo"
                    type="file"
                  />
                  <button
                    className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={offline}
                    type="submit"
                  >
                    Save note
                  </button>
                </form>
              </details>

              <details className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold text-[var(--primary)]">
                  <Route className="h-4 w-4" aria-hidden="true" />
                  Log hours &amp; travel
                </summary>
                <form action={addWorkOrderFieldLog} className="grid gap-2 border-t border-[var(--border)] p-3">
                  <input name="workOrderId" type="hidden" value={workOrder.id} />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Hours worked</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        inputMode="decimal"
                        min="0"
                        name="hours"
                        placeholder="0.0"
                        step="0.25"
                        type="number"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Date</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        name="entryDate"
                        type="date"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Travel (km)</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        inputMode="decimal"
                        min="0"
                        name="travelKm"
                        placeholder="0"
                        step="0.1"
                        type="number"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Travel (min)</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        min="0"
                        name="travelMinutes"
                        placeholder="0"
                        step="1"
                        type="number"
                      />
                    </label>
                  </div>
                  <input
                    className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    disabled={offline}
                    name="note"
                    placeholder="Note (optional)"
                    type="text"
                  />
                  <button
                    className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={offline}
                    type="submit"
                  >
                    Save hours &amp; travel
                  </button>
                </form>
              </details>

              <details className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold text-[var(--primary)]">
                  <Package className="h-4 w-4" aria-hidden="true" />
                  Log materials used
                </summary>
                <form action={addWorkOrderMaterial} className="grid gap-2 border-t border-[var(--border)] p-3">
                  <input name="workOrderId" type="hidden" value={workOrder.id} />
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Part or material</span>
                    <input
                      className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      disabled={offline}
                      name="name"
                      placeholder="e.g. 3/4in copper elbow"
                      type="text"
                    />
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <label className="col-span-1 space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Qty</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        defaultValue={1}
                        disabled={offline}
                        inputMode="decimal"
                        min="0"
                        name="quantity"
                        step="0.01"
                        type="number"
                      />
                    </label>
                    <label className="col-span-1 space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Unit</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        name="unit"
                        placeholder="ea"
                        type="text"
                      />
                    </label>
                    <label className="col-span-1 space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Date</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        name="entryDate"
                        type="date"
                      />
                    </label>
                  </div>
                  <input
                    className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    disabled={offline}
                    name="note"
                    placeholder="Note (optional)"
                    type="text"
                  />
                  <button
                    className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={offline}
                    type="submit"
                  >
                    Save material
                  </button>
                </form>
              </details>

              <details className="mt-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)]">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-semibold text-[var(--primary)]">
                  <Wrench className="h-4 w-4" aria-hidden="true" />
                  Log equipment serviced
                </summary>
                <form action={addWorkOrderEquipment} className="grid gap-2 border-t border-[var(--border)] p-3" encType="multipart/form-data">
                  <input name="workOrderId" type="hidden" value={workOrder.id} />
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Equipment type</span>
                    <input
                      className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      disabled={offline}
                      name="equipmentType"
                      placeholder="e.g. Furnace, AC, water heater"
                      type="text"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Make</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        name="make"
                        placeholder="Carrier"
                        type="text"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Model</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        name="model"
                        placeholder="59TP6B"
                        type="text"
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Serial</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        name="serial"
                        placeholder="Serial #"
                        type="text"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Installed</span>
                      <input
                        className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        disabled={offline}
                        name="installedOn"
                        type="date"
                      />
                    </label>
                  </div>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Location on site</span>
                    <input
                      className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      disabled={offline}
                      name="locationNote"
                      placeholder="e.g. Basement, rooftop unit 2"
                      type="text"
                    />
                  </label>
                  <input
                    className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    disabled={offline}
                    name="notes"
                    placeholder="Note (optional)"
                    type="text"
                  />
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Condition</span>
                    <select
                      className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      defaultValue=""
                      disabled={offline}
                      name="condition"
                    >
                      <option value="">Not set</option>
                      {CONDITION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-[var(--ink)]">
                    <input className="h-4 w-4 accent-[var(--primary)]" disabled={offline} name="needsFollowUp" type="checkbox" value="true" />
                    Flag for office follow-up
                  </label>
                  <input
                    className="h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                    disabled={offline}
                    name="followUpNote"
                    placeholder="Follow-up note (e.g. recommend replacement)"
                    type="text"
                  />
                  <label className="space-y-1">
                    <span className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Nameplate photo</span>
                    <input
                      accept="image/png,image/jpeg,image/webp"
                      className="block w-full text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--ink)]"
                      disabled={offline}
                      name="photo"
                      type="file"
                    />
                  </label>
                  <button
                    className="inline-flex h-11 items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={offline}
                    type="submit"
                  >
                    Save equipment
                  </button>
                </form>
              </details>
            </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
