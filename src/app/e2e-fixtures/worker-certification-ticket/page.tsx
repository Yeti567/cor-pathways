import { notFound, redirect } from "next/navigation";
import { WorkerCertificationTicketForm } from "@/app/web/_components/WorkerCertificationTicketForm";

export const dynamic = "force-dynamic";

type WorkerCertificationTicketFixtureProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function textValue(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function captureWorkerTicketUpload(formData: FormData) {
  "use server";

  const name = textValue(formData, "name");
  const issuedOn = textValue(formData, "issuedOn");
  const expiresOn = textValue(formData, "expiresOn");
  const attachment = formData.get("attachment");
  const fileName = attachment instanceof File ? attachment.name : "";
  const fileType = attachment instanceof File ? attachment.type : "";

  if (!name || !fileName) {
    redirect("/e2e-fixtures/worker-certification-ticket?error=Ticket%20name%20and%20file%20are%20required.");
  }

  const params = new URLSearchParams({
    expiresOn,
    fileName,
    fileType,
    issuedOn,
    name,
    notice: "Ticket upload captured.",
  });

  redirect(`/e2e-fixtures/worker-certification-ticket?${params.toString()}`);
}

export default async function WorkerCertificationTicketFixture({ searchParams }: WorkerCertificationTicketFixtureProps) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const name = firstParam(params.name);
  const issuedOn = firstParam(params.issuedOn);
  const expiresOn = firstParam(params.expiresOn);
  const fileName = firstParam(params.fileName);
  const fileType = firstParam(params.fileType);

  return (
    <main className="min-h-screen bg-[var(--background)] p-4">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[var(--ink)]">Certification Tickets</h1>
            <p className="text-sm text-[var(--ink-muted)]">Mobile worker upload fixture</p>
          </div>
        </div>

        {notice ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-[var(--success)]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <WorkerCertificationTicketForm action={captureWorkerTicketUpload} />

        {name ? (
          <article className="mt-4 rounded-md border border-[var(--border)] bg-white p-3">
            <h2 className="font-semibold text-[var(--ink)]">Captured Ticket</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <div>
                <dt className="font-semibold text-[var(--ink-muted)]">Name</dt>
                <dd className="text-[var(--ink)]">{name}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--ink-muted)]">Issued</dt>
                <dd className="text-[var(--ink)]">{issuedOn}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--ink-muted)]">Expires</dt>
                <dd className="text-[var(--ink)]">{expiresOn}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--ink-muted)]">File</dt>
                <dd className="break-words text-[var(--ink)]">
                  {fileName} {fileType ? `(${fileType})` : ""}
                </dd>
              </div>
            </dl>
          </article>
        ) : (
          <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
            No certification tickets have been added to your profile yet.
          </div>
        )}
      </section>
    </main>
  );
}
