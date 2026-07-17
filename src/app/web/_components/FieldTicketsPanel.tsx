import { FileSignature } from "lucide-react";
import { submitFieldTicket } from "@/app/admin/change-orders/actions";
import {
  FIELD_TICKET_STATUS_BADGE,
  FIELD_TICKET_STATUS_LABELS,
  type FieldTicketStatus,
} from "@/lib/change-orders";

type ProjectOption = {
  id: string;
  name: string;
};

type FieldTicketItem = {
  id: string;
  title: string;
  status: FieldTicketStatus;
  created_at: string;
  project_name: string | null;
};

const inputClass =
  "h-11 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

// Crew-facing capture of a field variation / change request. A submitted ticket
// lands in the admin Change Orders area where it can be promoted into a change
// order. Server component: the form posts straight to the server action.
export function FieldTicketsPanel({
  projects,
  tickets,
}: {
  projects: ProjectOption[];
  tickets: FieldTicketItem[];
}) {
  return (
    <section className="scroll-mt-24 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="field-tickets">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <FileSignature className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Field variations</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Spotted extra or changed work on site? Log it here. The office reviews it and turns it into a change order.
          </p>
        </div>
      </div>

      <form action={submitFieldTicket} className="mt-4 grid gap-3">
        {projects.length > 0 ? (
          <label className="space-y-1">
            <span className="text-sm font-medium text-[var(--ink)]">Project (optional)</span>
            <select className={inputClass} defaultValue="" name="project_id">
              <option value="">Not sure / leave for the office</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="space-y-1">
          <span className="text-sm font-medium text-[var(--ink)]">What changed</span>
          <input className={inputClass} name="title" placeholder="e.g. Extra excavation at north footing" required />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-[var(--ink)]">Details</span>
          <textarea
            className="min-h-24 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            name="description"
            placeholder="What happened, why, and the extra work involved."
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-[var(--ink)]">Rough cost estimate (optional)</span>
          <input className={inputClass} defaultValue="" name="estimated_amount" placeholder="0.00" step="0.01" type="number" />
        </label>

        <label className="space-y-1">
          <span className="text-sm font-medium text-[var(--ink)]">Photo (optional)</span>
          <input
            accept="image/png,image/jpeg,image/webp,application/pdf"
            className="block w-full text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-white file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--ink)]"
            name="photo"
            type="file"
          />
        </label>

        <button
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-5 text-sm font-semibold text-white transition hover:opacity-90"
          type="submit"
        >
          Submit field variation
        </button>
      </form>

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-[var(--ink)]">Your recent submissions</h3>
        {tickets.length === 0 ? (
          <p className="mt-2 rounded-md border border-dashed border-[var(--border)] bg-white p-4 text-center text-sm text-[var(--ink-muted)]">
            Nothing submitted yet.
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
            {tickets.map((ticket) => (
              <li className="flex items-center justify-between gap-3 px-3 py-2" key={ticket.id}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">{ticket.title}</p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {ticket.project_name ?? "No project"} · {ticket.created_at.slice(0, 10)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${FIELD_TICKET_STATUS_BADGE[ticket.status]}`}>
                  {FIELD_TICKET_STATUS_LABELS[ticket.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
