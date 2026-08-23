"use client";

// The pictures on the fleet compliance page.
//
// Hand-drawn SVG rather than a charting library on purpose. There are four
// charts, the data is a few dozen numbers, and a library would add a dependency,
// a bundle, and a theme to fight with for shapes this simple. Every component
// here takes numbers that are already correct (see src/lib/fleet-charts.ts) and
// does nothing but turn them into pixels.
//
// Three rules hold across all four:
//
//  1. No mark is identified by colour alone. Every chart carries a legend or a
//     direct label, and every one of them opens a plain table of the same
//     numbers, so a reader who cannot separate the amber from the red is never
//     stuck.
//  2. Marks are thin and the axes are quiet. The data is the loud thing.
//  3. Hovering any mark says what it is in words, because a wedge of a ring is
//     not self-explanatory no matter how well it is coloured.

import { useId, useState } from "react";
import type { GapRow, ProofSplit, ReadinessSlice, RenewalBucket } from "@/lib/fleet-charts";
import { CHART_COLORS } from "@/lib/fleet-charts";

type Point = { x: number; y: number };

function useTooltip() {
  const [tip, setTip] = useState<{ at: Point; text: string } | null>(null);

  const bind = (text: string) => ({
    onMouseEnter: (event: React.MouseEvent) => moveTo(event, text),
    onMouseMove: (event: React.MouseEvent) => moveTo(event, text),
    onMouseLeave: () => setTip(null),
    onFocus: (event: React.FocusEvent) => {
      const box = event.currentTarget.getBoundingClientRect();
      const parent = event.currentTarget.closest("[data-chart]")?.getBoundingClientRect();
      setTip({
        at: {
          x: box.left - (parent?.left ?? 0) + box.width / 2,
          y: box.top - (parent?.top ?? 0),
        },
        text,
      });
    },
    onBlur: () => setTip(null),
  });

  function moveTo(event: React.MouseEvent, text: string) {
    const parent = event.currentTarget.closest("[data-chart]")?.getBoundingClientRect();
    setTip({
      at: { x: event.clientX - (parent?.left ?? 0), y: event.clientY - (parent?.top ?? 0) },
      text,
    });
  }

  const node = tip ? (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md bg-[var(--ink)] px-2 py-1 text-xs font-medium text-white shadow-lg"
      style={{ left: tip.at.x, top: tip.at.y - 8 }}
      role="status"
    >
      {tip.text}
    </div>
  ) : null;

  return { bind, node };
}

function ChartCard({
  children,
  columns,
  note,
  rows,
  title,
}: {
  children: React.ReactNode;
  columns: readonly string[];
  note?: string;
  rows: readonly (readonly (string | number)[])[];
  title: string;
}) {
  return (
    <section className="relative rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" data-chart>
      <h3 className="text-sm font-semibold text-[var(--ink)]">{title}</h3>
      {note ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{note}</p> : null}
      <div className="mt-4">{children}</div>
      <details className="mt-4 border-t border-[var(--border)] pt-3">
        <summary className="cursor-pointer text-xs font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]">
          Show the numbers
        </summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-[var(--ink-muted)]">
                {columns.map((column, index) => (
                  <th className={`py-1 font-medium ${index === 0 ? "" : "text-right"}`} key={column} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className="border-t border-[var(--border)]" key={String(row[0])}>
                  {row.map((cell, index) => (
                    <td
                      className={`py-1 ${index === 0 ? "text-[var(--ink)]" : "text-right tabular-nums text-[var(--ink-muted)]"}`}
                      key={index}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

/**
 * A ring, with the answer in the hole.
 *
 * Segments are drawn as dashed strokes on one circle rather than as paths,
 * which keeps the arithmetic to two numbers per slice and makes the 2px gap
 * between them exact. The gap matters: two saturated wedges touching read as one
 * wedge with a colour change in the middle.
 */
function Ring({
  hole,
  segments,
  size = 190,
  sub,
  tooltip,
}: {
  hole: string;
  segments: readonly { color: string; label: string; value: number }[];
  size?: number;
  sub: string;
  tooltip: ReturnType<typeof useTooltip>;
}) {
  const stroke = 24;
  const radius = (size - stroke) / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const gap = total > 0 ? 3 : 0;

  let cursor = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:gap-6">
      <div className="relative shrink-0" style={{ height: size, width: size }}>
        <svg height={size} role="img" viewBox={`0 0 ${size} ${size}`} width={size}>
          <title>{sub}</title>
          <circle
            cx={size / 2}
            cy={size / 2}
            fill="none"
            r={radius}
            stroke={CHART_COLORS.empty}
            strokeWidth={stroke}
          />
          {total > 0
            ? segments.map((segment) => {
                if (segment.value <= 0) {
                  return null;
                }

                const length = (segment.value / total) * circumference;
                const offset = cursor;

                cursor += length;

                return (
                  <circle
                    className="cursor-default transition-opacity hover:opacity-80 focus:outline-none"
                    cx={size / 2}
                    cy={size / 2}
                    fill="none"
                    key={segment.label}
                    r={radius}
                    stroke={segment.color}
                    strokeDasharray={`${Math.max(length - gap, 0.5)} ${circumference}`}
                    strokeDashoffset={-offset}
                    strokeWidth={stroke}
                    tabIndex={0}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                    {...tooltip.bind(`${segment.label}: ${segment.value} of ${total}`)}
                  />
                );
              })
            : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold tabular-nums text-[var(--ink)]">{hole}</span>
          <span className="mt-0.5 px-6 text-center text-[11px] leading-tight text-[var(--ink-muted)]">{sub}</span>
        </div>
      </div>
      <ul className="w-full space-y-2">
        {segments.map((segment) => (
          <li className="flex items-center gap-2 text-sm" key={segment.label}>
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: segment.value > 0 ? segment.color : CHART_COLORS.empty }}
            />
            <span className="flex-1 text-[var(--ink-muted)]">{segment.label}</span>
            <span className="font-semibold tabular-nums text-[var(--ink)]">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReadinessChart({ slices, total }: { slices: readonly ReadinessSlice[]; total: number }) {
  const tooltip = useTooltip();
  const ready = slices.find((slice) => slice.key === "compliant")?.count ?? 0;

  return (
    <ChartCard
      columns={["State", "Units"]}
      note="Every unit takes the state of its worst document."
      rows={slices.map((slice) => [slice.label, slice.count])}
      title="Can the fleet roll?"
    >
      {tooltip.node}
      <Ring
        hole={`${ready}/${total}`}
        segments={slices.map((slice) => ({ color: slice.color, label: slice.label, value: slice.count }))}
        sub="units good to go"
        tooltip={tooltip}
      />
    </ChartCard>
  );
}

export function ProofChart({ split }: { split: ProofSplit }) {
  const tooltip = useTooltip();
  const total = split.proven + split.awaiting;
  const percent = total === 0 ? 0 : Math.round((split.proven / total) * 100);

  return (
    <ChartCard
      columns={["State", "Records"]}
      note="A date on file is a claim. The scan behind it is the proof an auditor asks for."
      rows={[
        ["Certificate attached", split.proven],
        ["Date only, no scan", split.awaiting],
      ]}
      title="Can we prove it?"
    >
      {tooltip.node}
      <Ring
        hole={`${percent}%`}
        segments={[
          { color: CHART_COLORS.good, label: "Certificate attached", value: split.proven },
          { color: CHART_COLORS.warning, label: "Date only, no scan", value: split.awaiting },
        ]}
        sub="of live records have a certificate attached"
        tooltip={tooltip}
      />
    </ChartCard>
  );
}

/**
 * The worst inspections, longest bar first.
 *
 * Horizontal because the labels are inspection names and a name like "PIUC,
 * pressure, internal, upper coupler" cannot be read rotated under a column. One
 * series, so one colour and no legend: the title says what the bars are.
 */
export function GapChart({ rows, unitTotal }: { rows: readonly GapRow[]; unitTotal: number }) {
  const tooltip = useTooltip();
  const worst = rows.reduce((max, row) => Math.max(max, row.gaps), 0);

  if (rows.length === 0) {
    return (
      <ChartCard columns={["Inspection", "Units with a gap"]} rows={[]} title="Where the gaps are">
        <p className="py-8 text-center text-sm text-[var(--ink-muted)]">
          No gaps. Every unit has a valid record against every inspection it is held to.
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      columns={["Inspection", "Units with a gap", "Units held to it"]}
      note={`Counted in units, out of ${unitTotal} in the fleet. Missing or expired both count as a gap.`}
      rows={rows.map((row) => [row.label, row.gaps, row.held])}
      title="Where the gaps are"
    >
      {tooltip.node}
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-xs text-[var(--ink-muted)]" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--ink)]">
                {row.gaps}
                <span className="font-normal text-[var(--ink-muted)]">/{row.held}</span>
              </span>
            </div>
            <div className="mt-1 h-2.5 w-full overflow-hidden rounded-sm bg-[var(--surface-muted)]">
              <div
                className="h-full cursor-default rounded-sm transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: CHART_COLORS.critical,
                  width: `${worst === 0 ? 0 : (row.gaps / worst) * 100}%`,
                }}
                tabIndex={0}
                {...tooltip.bind(`${row.label}: ${row.gaps} of ${row.held} units held to it have a gap`)}
              />
            </div>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}

/**
 * When the renewals land.
 *
 * The overdue pile is the first column and is red; the months after it are one
 * teal series. Two colours, so there is a legend. Bars carry their count above
 * them only when there is something to count, because a row of zeros written out
 * is noise.
 */
export function RenewalChart({ buckets }: { buckets: readonly RenewalBucket[] }) {
  const tooltip = useTooltip();
  const headroom = useId();
  const tallest = buckets.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  const plotHeight = 150;

  return (
    <ChartCard
      columns={["When", "Certificates due"]}
      note="Certificates and vehicle files by the month they expire. The first column is work that is already late."
      rows={buckets.map((bucket) => [bucket.longLabel, bucket.count])}
      title="When the work lands"
    >
      {tooltip.node}
      <div className="flex items-end gap-1.5" style={{ height: plotHeight }} id={headroom}>
        {buckets.map((bucket) => {
          const height = tallest === 0 ? 0 : (bucket.count / tallest) * (plotHeight - 22);

          return (
            <div className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1" key={bucket.key}>
              <span
                className={`text-[10px] font-semibold tabular-nums ${
                  bucket.count > 0 ? "text-[var(--ink)]" : "text-transparent"
                }`}
              >
                {bucket.count > 0 ? bucket.count : "0"}
              </span>
              <div
                className="w-full cursor-default rounded-t-[4px] transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: bucket.overdue ? CHART_COLORS.critical : CHART_COLORS.upcoming,
                  height: Math.max(height, bucket.count > 0 ? 3 : 1),
                  minHeight: bucket.count > 0 ? 3 : 1,
                }}
                tabIndex={0}
                {...tooltip.bind(
                  `${bucket.longLabel}: ${bucket.count} certificate${bucket.count === 1 ? "" : "s"}`,
                )}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1.5 border-t border-[var(--border)] pt-1.5">
        {buckets.map((bucket) => (
          <span
            className="min-w-0 flex-1 text-center text-[10px] leading-tight text-[var(--ink-muted)]"
            key={bucket.key}
            title={bucket.longLabel}
          >
            {bucket.label}
          </span>
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-4 text-xs text-[var(--ink-muted)]">
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: CHART_COLORS.critical }}
          />
          Already expired
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: CHART_COLORS.upcoming }}
          />
          Coming due
        </li>
      </ul>
    </ChartCard>
  );
}
