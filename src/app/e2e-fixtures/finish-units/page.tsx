import { notFound } from "next/navigation";
import { FinishUnitsView } from "@/app/admin/equipment/finish/FinishUnitsView";
import { buildUnitFinish, finishQueue, type FinishDocumentRow, type FinishUnitRow } from "@/lib/unit-finish";

// The Finish Your Units screen with made-up units, for looking at it without signing in.
// Every unit, date and id here is invented. Nothing on this page can save: the forms
// post to the real actions, which refuse a visitor who is not signed in.

export const dynamic = "force-dynamic";

const TENANT = "00000000-0000-4000-8000-000000000000";
const types = [
  { appliesByDefault: true, id: "00000000-0000-4000-8000-0000000000f1", name: "Fire extinguisher inspection" },
  { appliesByDefault: false, id: "00000000-0000-4000-8000-0000000000f2", name: "External visual and leak (VK)" },
];

function unit(n: number, unitNumber: string): FinishUnitRow {
  return { category: "trailer", id: `00000000-0000-4000-8000-00000000010${n}`, is_commercial: true, name: null, unit_number: unitNumber };
}

function doc(equipmentId: string, partial: Partial<FinishDocumentRow>): FinishDocumentRow {
  return {
    attachment_ids: ["fixture.pdf"],
    certification_type_id: null,
    doc_type: "registration",
    equipment_id: equipmentId,
    expiry_date: null,
    id: `${equipmentId}-${partial.doc_type ?? "registration"}-${partial.certification_type_id ?? ""}-${partial.expiry_date ?? ""}`,
    is_active: true,
    issued_date: null,
    reminder_lead_days: 30,
    title: null,
    ...partial,
  };
}

export default function FinishUnitsFixture() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const a = unit(1, "101");
  const b = unit(2, "102");
  const c = unit(3, "103");
  const fleet = [
    {
      documents: [
        doc(a.id, {}),
        doc(a.id, { attachment_ids: null, doc_type: "cvip", expiry_date: "2027-04-30", issued_date: "2026-04-30" }),
        doc(a.id, { certification_type_id: types[0].id, doc_type: "certification", expiry_date: "2026-06-01" }),
        doc(a.id, { attachment_ids: ["fixture.pdf"], certification_type_id: types[1].id, doc_type: "certification", expiry_date: "2026-10-20" }),
      ],
      requiredTypeIds: [types[0].id, types[1].id],
      unit: a,
    },
    { documents: [doc(b.id, {}), doc(b.id, { doc_type: "cvip", expiry_date: "2027-02-01" })], requiredTypeIds: null, unit: b },
    { documents: [], requiredTypeIds: null, unit: c },
  ].map((entry) => buildUnitFinish({ ...entry, certificationTypes: types }, new Date("2026-10-03T12:00:00Z")));

  const queue = finishQueue(fleet);

  return (
    <main className="min-h-screen bg-[var(--background)] p-4 sm:p-8">
      <h1 className="mb-3 text-2xl font-bold text-[var(--ink)]">Finish your units</h1>
      <FinishUnitsView
        current={fleet[0]}
        finished={0}
        justFinished={undefined}
        notice="Document updated."
        queueLength={queue.length}
        returnTo={`/admin/equipment/finish?unit=${a.id}`}
        skipHref="/e2e-fixtures/finish-units"
        tenantId={TENANT}
        total={fleet.length}
        upNext={queue.filter((entry) => entry.unit.id !== a.id)}
      />
    </main>
  );
}
