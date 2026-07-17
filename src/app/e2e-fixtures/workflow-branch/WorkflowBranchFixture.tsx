"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, GitBranch, Route, UserRound } from "lucide-react";
import {
  describeWorkflowBranchResolution,
  formatWorkflowComparator,
  type WorkflowConditionLike,
  type WorkflowStepLike,
} from "@/lib/workflow-station";
import type { Json } from "@/types/database";

type WorkflowBranchFixtureProps = {
  runId: string;
};

type MedicalAidAnswer = "yes" | "no";

const workerName = "Blake Cowan";
const steps: WorkflowStepLike[] = [
  { form_id: "incident-form", id: "incident-step", sort_order: 10 },
  { form_id: "medical-follow-up-form", id: "medical-follow-up-step", sort_order: 20 },
];
const conditions: WorkflowConditionLike[] = [
  {
    comparator: "equals",
    expected_value: "yes",
    next_step_id: "medical-follow-up-step",
    source_item_id: "medical-aid-required",
    workflow_step_id: "incident-step",
  },
  {
    comparator: "equals",
    expected_value: "no",
    next_step_id: null,
    source_item_id: "medical-aid-required",
    workflow_step_id: "incident-step",
  },
];
const formNames = new Map([
  ["incident-form", "Step A Incident Report"],
  ["medical-follow-up-form", "Medical Aid Follow-up"],
]);
const conditionNames = new Map([
  ["yes", "Medical aid required"],
  ["no", "No aid required"],
]);

function answerLabel(answer: MedicalAidAnswer) {
  return answer === "yes" ? "Yes" : "No";
}

function stepName(stepId: string) {
  const step = steps.find((candidate) => candidate.id === stepId);
  return step?.form_id ? (formNames.get(step.form_id) ?? "Unknown form") : "Unknown form";
}

function conditionLabel(condition: WorkflowConditionLike) {
  const expected = String(condition.expected_value).toLowerCase();
  return conditionNames.get(expected) ?? "Branch condition";
}

export function WorkflowBranchFixture({ runId }: WorkflowBranchFixtureProps) {
  const [answer, setAnswer] = useState<MedicalAidAnswer>("yes");
  const [incidentSubmitted, setIncidentSubmitted] = useState(false);
  const [medicalCompleted, setMedicalCompleted] = useState(false);
  const submittedValues = useMemo<Record<string, Json>>(() => {
    const values: Record<string, Json> = {};

    if (incidentSubmitted) {
      values["medical-aid-required"] = answerLabel(answer);
    }

    return values;
  }, [answer, incidentSubmitted]);
  const branchResolution = describeWorkflowBranchResolution({
    completedStep: steps[0],
    conditions,
    steps,
    values: submittedValues,
  });
  const medicalAssigned = incidentSubmitted && branchResolution.nextStepIds.includes("medical-follow-up-step");
  const runComplete = incidentSubmitted && (!medicalAssigned || medicalCompleted);
  const resolvedRoute =
    branchResolution.nextStepIds.length > 0
      ? `Resolved route: Step 2 ${stepName(branchResolution.nextStepIds[0])}.`
      : branchResolution.stoppedReason === "matched_stop"
        ? "Resolved route: matched stop condition; no follow-up step assigned."
        : "Resolved route: no matching condition; no follow-up step assigned.";

  function submitIncident() {
    setIncidentSubmitted(true);
    setMedicalCompleted(false);
  }

  function resetRun() {
    setIncidentSubmitted(false);
    setMedicalCompleted(false);
  }

  return (
    <main className="min-h-screen bg-[var(--background)] p-4">
      <section className="mx-auto grid max-w-6xl gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-[var(--ink-muted)]">E2E Fixture</p>
            <h1 className="text-2xl font-bold text-[var(--ink)]">Workflow Branch Fixture</h1>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Run {runId}</p>
          </div>
          <p
            className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-semibold ${
              runComplete ? "bg-emerald-50 text-[var(--success)]" : "bg-amber-50 text-[var(--warning)]"
            }`}
          >
            {runComplete ? "Run completed" : "Run open"}
          </p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(360px,1fr)]">
          <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
                <GitBranch className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[var(--ink)]">Step A Incident Report</h2>
                <p className="text-sm text-[var(--ink-muted)]">Assigned to {workerName}</p>
              </div>
            </div>

            <label className="mt-5 block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Medical aid required</span>
              <select
                className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm"
                disabled={incidentSubmitted}
                onChange={(event) => setAnswer(event.target.value as MedicalAidAnswer)}
                value={answer}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>

            <div className="mt-5 flex flex-wrap gap-2">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={incidentSubmitted}
                onClick={submitIncident}
                type="button"
              >
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                Submit Step A
              </button>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                onClick={resetRun}
                type="button"
              >
                Reset run
              </button>
            </div>

            <div className="mt-5 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--ink-muted)]">
              {incidentSubmitted ? `Step A submitted with answer ${answerLabel(answer)}.` : "Step A is pending submission."}
            </div>
          </section>

          <section aria-label="Worker Assignments" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
              <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Worker Assignments</h2>
              <UserRound className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            </div>
            <div className="p-4">
              {medicalAssigned ? (
                <article
                  aria-label="Worker Assignment - Medical Aid Follow-up"
                  className="rounded-md border border-[var(--border)] bg-white p-4"
                >
                  <p className="text-sm font-semibold text-[var(--ink)]">Medical Aid Follow-up</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">Assigned to {workerName}</p>
                  <p className="mt-2 inline-flex rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-[var(--warning)]">
                    {medicalCompleted ? "Completed" : "Pending"}
                  </p>
                  <button
                    className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={medicalCompleted}
                    onClick={() => setMedicalCompleted(true)}
                    type="button"
                  >
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                    Complete Step B
                  </button>
                </article>
              ) : (
                <p className="rounded-md border border-dashed border-[var(--border)] p-4 text-sm text-[var(--ink-muted)]">
                  {incidentSubmitted ? "No follow-up assignment created." : "No assigned follow-up yet."}
                </p>
              )}
            </div>
          </section>
        </div>

        <section aria-label="Run Monitor" className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <div className="flex items-center gap-3 border-b border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3">
            <Route className="h-5 w-5 text-[var(--primary)]" aria-hidden="true" />
            <h2 className="text-sm font-semibold uppercase text-[var(--ink-muted)]">Run Monitor</h2>
          </div>
          <div className="grid gap-3 p-4 md:grid-cols-3">
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Step A</p>
              <p className="mt-1 font-semibold text-[var(--ink)]">
                {incidentSubmitted ? "Step A submitted" : "Step A pending"}
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Step B</p>
              <p className="mt-1 font-semibold text-[var(--ink)]">
                {medicalCompleted ? "Step B completed" : medicalAssigned ? "Step B assigned" : "Step B not assigned"}
              </p>
            </div>
            <div className="rounded-md border border-[var(--border)] bg-white p-3">
              <p className="text-xs font-semibold uppercase text-[var(--ink-muted)]">Run context</p>
              <p className="mt-1 font-semibold text-[var(--ink)]">{incidentSubmitted ? resolvedRoute : "Waiting for Step A"}</p>
            </div>
          </div>
          {incidentSubmitted ? (
            <div className="border-t border-[var(--border)] p-4">
              <div className="grid gap-2 md:grid-cols-2">
                {branchResolution.conditionResults.map((result) => {
                  const outcomeText =
                    result.outcome === "assign_step"
                      ? "Matched condition"
                      : result.outcome === "stop_branch"
                        ? "Stopped condition"
                        : "Skipped condition";
                  const outcomeClass =
                    result.outcome === "assign_step"
                      ? "bg-emerald-50 text-[var(--success)]"
                      : result.outcome === "stop_branch"
                        ? "bg-amber-50 text-[var(--warning)]"
                        : "bg-[var(--surface-muted)] text-[var(--ink-muted)]";

                  return (
                    <article className="rounded-md border border-[var(--border)] bg-white p-3" key={String(result.condition.expected_value)}>
                      <p className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${outcomeClass}`}>
                        {outcomeText}: {conditionLabel(result.condition)}
                      </p>
                      <p className="mt-2 text-sm text-[var(--ink-muted)]">
                        {formatWorkflowComparator(result.condition.comparator)} {String(result.condition.expected_value)}. Answer:{" "}
                        {answerLabel(answer)}.
                      </p>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}
