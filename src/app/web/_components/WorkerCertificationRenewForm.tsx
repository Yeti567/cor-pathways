import { Camera } from "lucide-react";

// The renewal form that sits on each of a worker's own tickets.
//
// Collapsed into a <details> so a list of a dozen tickets stays a list. It opens
// already saying what it is for, because the two jobs it does read very
// differently to the person holding the phone: one is "my ticket ran out and
// here is the new card", the other is "the office typed my date in and I am
// sending the card to back it up". Same action, different sentence.
//
// The dates are prefilled from the record. A worker only supplying the missing
// photo should not have to retype a date that was already right, and retyping is
// where a wrong date comes from.

type WorkerCertificationRenewFormProps = {
  action: (formData: FormData) => Promise<void> | void;
  certificationId: string;
  expiresOn: string | null;
  issuedOn: string | null;
  name: string;
  /** False when the record holds a date and no card, which changes the wording. */
  hasProof: boolean;
};

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export function WorkerCertificationRenewForm({
  action,
  certificationId,
  expiresOn,
  hasProof,
  issuedOn,
  name,
}: WorkerCertificationRenewFormProps) {
  return (
    <details className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3">
      <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">
        {hasProof ? "Renew this ticket" : "Add the photo"}
      </summary>
      <p className="mt-2 text-xs text-[var(--ink-muted)]">
        {hasProof
          ? `Photograph the new ${name} card and put in the new expiry. It replaces the copy on your file.`
          : `Your ${name} expiry is on file but the card is not. Photograph it and the record goes green.`}
      </p>
      <form action={action} className="mt-3 grid gap-3">
        <input name="certificationId" type="hidden" value={certificationId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Issued on</span>
            <input className={inputClass} defaultValue={issuedOn ?? ""} name="issuedOn" type="date" />
          </label>
          <label className="space-y-2">
            <span className="text-sm font-medium text-[var(--ink)]">Expires on</span>
            <input className={inputClass} defaultValue={expiresOn ?? ""} name="expiresOn" type="date" />
          </label>
        </div>
        <label className="space-y-2">
          <span className="text-sm font-medium text-[var(--ink)]">Photo of the card</span>
          <input
            // capture="environment" opens the rear camera straight away on a
            // phone, which is the whole point: the card is in their hand.
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
          {hasProof ? "Save New Card" : "Save Photo"}
        </button>
      </form>
    </details>
  );
}
