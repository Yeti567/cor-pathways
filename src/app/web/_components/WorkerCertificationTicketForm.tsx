import { Camera } from "lucide-react";

type WorkerCertificationTicketFormProps = {
  action: (formData: FormData) => Promise<void> | void;
};

export function WorkerCertificationTicketForm({ action }: WorkerCertificationTicketFormProps) {
  return (
    <form action={action} className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <div className="grid gap-3">
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Ticket name</span>
          <input
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            name="name"
            placeholder="First Aid, H2S, CSTS"
            required
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Issued on</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              name="issuedOn"
              type="date"
            />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Expires on</span>
            <input
              className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
              name="expiresOn"
              type="date"
            />
          </label>
        </div>
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Ticket photo or PDF</span>
          <input
            accept="image/*,.pdf,application/pdf"
            capture="environment"
            className="block w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            name="attachment"
            required
            type="file"
          />
        </label>
        <button
          className="inline-flex h-10 w-fit items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          type="submit"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Upload Ticket
        </button>
      </div>
    </form>
  );
}
