import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import type { GettingStartedStep } from "@/lib/getting-started";

// The checklist on a new client's admin home. Each step ticks itself from the data, so the
// card always says where they are and what is next. It steps aside once every step is done.

export function GettingStartedCard({ steps }: { steps: GettingStartedStep[] }) {
  const done = steps.filter((step) => step.done).length;

  if (done === steps.length) {
    return null;
  }

  const next = steps.find((step) => !step.done);

  return (
    <section className="mb-5 rounded-lg border border-[var(--primary)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold text-[var(--ink)]">Getting started</h2>
        <p className="text-sm font-semibold text-[var(--ink-muted)]">
          {done} of {steps.length} done
        </p>
      </div>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">Four steps to get your company running in the app. Each one ticks itself off when it&rsquo;s done.</p>

      <ol className="mt-4 grid gap-3">
        {steps.map((step, index) => {
          const isNext = step === next;

          return (
            <li
              className={`rounded-md border p-4 ${isNext ? "border-[var(--primary)] bg-[var(--surface-muted)]" : "border-[var(--border)]"}`}
              key={step.key}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  {step.done ? (
                    <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-[var(--success)]" aria-hidden="true" />
                  ) : (
                    <Circle className="mt-0.5 h-6 w-6 shrink-0 text-[var(--ink-muted)]" aria-hidden="true" />
                  )}
                  <div>
                    <p className="font-semibold text-[var(--ink)]">
                      <span className="sr-only">{step.done ? "Done: " : "To do: "}</span>
                      {index + 1}. {step.title}
                    </p>
                    <p className="text-sm text-[var(--ink-muted)]">{step.progress}</p>
                    {!step.done && isNext ? <p className="mt-1 text-sm text-[var(--ink)]">{step.next}</p> : null}
                  </div>
                </div>
                {!step.done ? (
                  <Link
                    className={
                      isNext
                        ? "inline-flex h-11 items-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)]"
                        : "inline-flex h-11 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                    }
                    href={step.href}
                  >
                    {step.action}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
              {!step.done && step.percent > 0 ? (
                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
                  <div className="h-full rounded-full bg-[var(--success)]" style={{ width: `${step.percent}%` }} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
