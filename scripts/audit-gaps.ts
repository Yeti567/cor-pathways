// What every unit and driver in a tenant is still short of, as JSON.
//
// WHY THIS EXISTS. After a load the dashboard shows the shape of the problem - so many
// amber, so many red - but the question a safety administrator actually asks is "give me
// the list so I can work through it". That list was being reconstructed by hand out of
// SQL each time, which is slow and, worse, re-decides what "complete" means every time
// somebody writes the query.
//
// SO IT DECIDES NOTHING ITSELF. Every judgement here comes from the same functions the
// pages use - buildVehicleFileStatuses, expectedCertificationTypesForUnit,
// contractedUnitCertificationStatuses, contractedDriverIdentityRecords. If this and the
// dashboard ever disagree, this is the one that is wrong.
//
// FALSE ALARMS ARE SEPARATED, NOT SUPPRESSED. An Alberta CONTINUOUS registration has no
// expiry; loaded from a carrier's equipment sheet it arrives with the expiry set to its
// issue date and reads as overdue from the day it was filed. Those are marked
// `falseAlarm` and carry an explanation, so a chase list built from this file does not
// send a carrier hunting for a document that is already attached and perfectly valid.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/audit-gaps.ts --tenant <uuid> [--out <file.json>]
//
// Writes JSON: { counts, gaps: [{ group, subject, carrier?, item, state, detail,
// falseAlarm? }] }. States are the app's own: expired, missing, due_soon,
// awaiting_proof - rendered here as EXPIRED / missing / due soon / no scan.

import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import {
  buildVehicleFileStatuses,
  buildUnitCertificationStatuses,
  expectedCertificationTypesForUnit,
} from "../src/lib/equipment";
import {
  contractedUnitFileStatuses,
  contractedUnitCertificationStatuses,
  type ContractedEquipmentDocumentFields,
} from "../src/lib/contracted-equipment";
import type { CertificationCategory } from "../src/types/database";
import {
  contractedDriverIdentityRecords,
  contractedDriverCertificationStatuses,
  contractedDriverMissingTickets,
  type ContractedDriverCertificationRow,
  type ContractedDriverDocumentRow,
} from "../src/lib/contracted-drivers";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const tenantArg = arg("--tenant");

if (!tenantArg) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/audit-gaps.ts --tenant <uuid> [--out <file.json>]");
  process.exit(1);
}

const T: string = tenantArg;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const now = new Date();

// The columns this script selects, one type per table. Typing them is not ceremony:
// the `any` they replace was hiding a dead branch for months. `(s as any).superseded`
// on an equipment certification is always undefined - that property exists only on a
// DRIVER certification status - so the filter it guarded had never once fired.
type LiveRow = { deleted_at: string | null };

type EquipmentRow = LiveRow & {
  id: string; unit_number: string | null; name: string | null; category: string;
  vin_or_serial: string | null; license_plate: string | null; status: string; notes: string | null;
};
type EquipmentDocRow = LiveRow & {
  id: string; equipment_id: string; doc_type: string; title: string;
  certification_type_id: string | null; issued_date: string | null; expiry_date: string | null;
  is_active: boolean; attachment_ids: string[] | null; reminder_lead_days: number;
};
type EquipmentReqRow = { equipment_id: string; certification_type_id: string };
type EquipmentTypeRow = {
  id: string; name: string; applies_by_default: boolean; default_interval_days: number | null;
};
type ContractedUnitRow = LiveRow & {
  id: string; unit_number: string | null; category: string; subcontractor_id: string;
  vin_or_serial: string | null; license_plate: string | null; status: string;
};
// The status helpers declare exactly the columns they read, so the script's select
// can satisfy them directly instead of being cast.
type ContractedDocRow = ContractedEquipmentDocumentFields & {
  id: string; contracted_equipment_id: string; issued_date: string | null;
};
type ContractedReqRow = { contracted_equipment_id: string; certification_type_id: string };
type ContractedDriverRow = LiveRow & {
  id: string; full_name: string; subcontractor_id: string; contracted_equipment_id: string | null;
  license_province: string | null; license_expiry: string | null; abstract_issued: string | null;
  abstract_expiry: string | null; cso_completed: string | null; status: string;
  email: string | null; phone: string | null; notes: string | null;
};
// These two are handed to helpers that pass the row straight through to their own
// output, so they take the real row type and the query selects all of it. A
// hand-written subset here would drift from the table the day a column is added.
type DriverCertRow = ContractedDriverCertificationRow;
type DriverDocRow = ContractedDriverDocumentRow;
type CarrierRow = LiveRow & {
  id: string; legal_name: string | null; operating_name: string | null; active: boolean;
};
type CertTypeRow = { id: string; name: string; category: CertificationCategory | null; is_mandatory: boolean };

async function all<T>(table: string, select: string, tenantScoped = true): Promise<T[]> {
  let from = 0;
  let rows: T[] = [];
  for (;;) {
    let q = sb.from(table).select(select).range(from, from + 999);
    if (tenantScoped) q = q.eq("tenant_id", T);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows = rows.concat((data ?? []) as T[]);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

async function main(): Promise<void> {
  const [
    equipment, eqDocs, eqReqs, eqTypes,
    cEquip, cDocs, cReqs,
    drivers, driverCerts, driverDocs,
    carriers, certTypes,
  ] = await Promise.all([
    all<EquipmentRow>("equipment", "id,unit_number,name,category,vin_or_serial,license_plate,status,deleted_at,notes"),
    all<EquipmentDocRow>("equipment_document", "id,equipment_id,doc_type,title,certification_type_id,issued_date,expiry_date,is_active,attachment_ids,reminder_lead_days,deleted_at"),
    all<EquipmentReqRow>("equipment_certification_requirement", "equipment_id,certification_type_id"),
    all<EquipmentTypeRow>("equipment_certification_types", "id,name,applies_by_default,default_interval_days"),
    all<ContractedUnitRow>("contracted_equipment", "id,unit_number,category,subcontractor_id,vin_or_serial,license_plate,status,deleted_at"),
    all<ContractedDocRow>("contracted_equipment_document", "id,contracted_equipment_id,doc_type,title,certification_type_id,issued_date,expiry_date,is_active,attachment_ids,reminder_lead_days,deleted_at"),
    all<ContractedReqRow>("contracted_equipment_certification_requirement", "contracted_equipment_id,certification_type_id"),
    all<ContractedDriverRow>("contracted_driver", "id,full_name,subcontractor_id,contracted_equipment_id,license_province,license_expiry,abstract_issued,abstract_expiry,cso_completed,status,email,phone,notes,deleted_at"),
    all<DriverCertRow>("contracted_driver_certification", "*"),
    all<DriverDocRow>("contracted_driver_document", "*"),
    all<CarrierRow>("subcontractor", "id,legal_name,operating_name,active,deleted_at"),
    all<CertTypeRow>("certification_types", "id,name,category,is_mandatory"),
  ]);

  const live = (r: LiveRow) => !r.deleted_at;
  const typeInputs = eqTypes.map((t) => ({ id: t.id, name: t.name, appliesByDefault: t.applies_by_default }));
  const carrierName = new Map(carriers.filter(live).map((c) => [c.id, c.legal_name || c.operating_name]));
  const mandatoryTickets = certTypes.filter((t) => t.category === "ticket" && t.is_mandatory).map((t) => ({ id: t.id, name: t.name }));
  const certTypeById = new Map(certTypes.map((t) => [t.id, t]));

  type Gap = { group: string; subject: string; carrier?: string; item: string; state: string; detail: string; falseAlarm?: boolean };
  const gaps: Gap[] = [];
  const say = (s: string) =>
    s === "expired" ? "EXPIRED" : s === "missing" ? "missing" : s === "due_soon" ? "due soon" : s === "awaiting_proof" ? "no scan" : s;

  // ---- owned equipment -------------------------------------------------------
  const eqDocsBy = new Map<string, EquipmentDocRow[]>();
  for (const d of eqDocs.filter(live)) (eqDocsBy.get(d.equipment_id) ?? eqDocsBy.set(d.equipment_id, []).get(d.equipment_id)!).push(d);
  const eqReqBy = new Map<string, string[]>();
  for (const r of eqReqs) (eqReqBy.get(r.equipment_id) ?? eqReqBy.set(r.equipment_id, []).get(r.equipment_id)!).push(r.certification_type_id);

  let ownedUnits = 0;
  for (const e of equipment.filter(live).sort((a, b) => (a.unit_number || "").localeCompare(b.unit_number || "", undefined, { numeric: true }))) {
    if (e.status === "retired" || e.status === "sold") continue;
    ownedUnits++;
    const docs = eqDocsBy.get(e.id) ?? [];
    const label = `Unit ${e.unit_number}`;

    if (!e.vin_or_serial || e.vin_or_serial.length !== 17)
      gaps.push({ group: "Trailers and owned equipment", subject: label, item: "Serial / VIN", state: "missing", detail: e.vin_or_serial ? `${e.vin_or_serial.length} characters, should be 17` : "blank" });
    if (!e.license_plate)
      gaps.push({ group: "Trailers and owned equipment", subject: label, item: "Licence plate", state: "missing", detail: "blank" });

    for (const s of buildVehicleFileStatuses({ category: e.category, documents: docs.map((d) => ({ docType: d.doc_type, expiryDate: d.expiry_date, isActive: d.is_active, reminderLeadDays: d.reminder_lead_days, hasProof: (d.attachment_ids || []).length > 0 })) }, now)) {
      if (s.state === "on_file") continue;
      if (s.state === "missing" && s.required === false) continue;
      gaps.push({ group: "Trailers and owned equipment", subject: label, item: s.label, state: say(s.state), detail: s.expiryDate ? `expiry ${s.expiryDate}` : "" });
    }
    for (const s of buildUnitCertificationStatuses({
      certificationTypes: expectedCertificationTypesForUnit({ category: e.category, certificationTypes: typeInputs, requiredTypeIds: eqReqBy.get(e.id) ?? null }),
      certificationTypeNames: new Map(typeInputs.map((t) => [t.id, t.name])),
      documents: docs.map((d) => ({ certificationTypeId: d.certification_type_id, docType: d.doc_type, expiryDate: d.expiry_date, isActive: d.is_active, reminderLeadDays: d.reminder_lead_days, title: d.title, hasProof: (d.attachment_ids || []).length > 0 })),
    }, now)) {
      if (s.state === "on_file") continue;
      if (s.state === "missing" && s.expected === false) continue;
      gaps.push({ group: "Trailers and owned equipment", subject: label, item: s.label, state: say(s.state), detail: s.expiryDate ? `expiry ${s.expiryDate}` : "" });
    }
  }

  // ---- contracted equipment (the trucks) -------------------------------------
  const cDocsBy = new Map<string, ContractedDocRow[]>();
  for (const d of cDocs.filter(live)) (cDocsBy.get(d.contracted_equipment_id) ?? cDocsBy.set(d.contracted_equipment_id, []).get(d.contracted_equipment_id)!).push(d);
  const cReqBy = new Map<string, string[]>();
  for (const r of cReqs) (cReqBy.get(r.contracted_equipment_id) ?? cReqBy.set(r.contracted_equipment_id, []).get(r.contracted_equipment_id)!).push(r.certification_type_id);

  let truckUnits = 0;
  for (const u of cEquip.filter(live).sort((a, b) => (a.unit_number || "").localeCompare(b.unit_number || "", undefined, { numeric: true }))) {
    truckUnits++;
    const docs = cDocsBy.get(u.id) ?? [];
    const label = `Unit ${u.unit_number}`;
    const carrier = carrierName.get(u.subcontractor_id) || "(no carrier)";

    if (!u.vin_or_serial || u.vin_or_serial.length !== 17)
      gaps.push({ group: "Contracted trucks", subject: label, carrier, item: "Serial / VIN", state: "missing", detail: u.vin_or_serial ? `${u.vin_or_serial.length} characters, should be 17` : "blank" });
    if (!u.license_plate)
      gaps.push({ group: "Contracted trucks", subject: label, carrier, item: "Licence plate", state: "missing", detail: "blank" });

    for (const s of contractedUnitFileStatuses({ category: u.category, documents: docs }, now)) {
      if (s.state === "on_file") continue;
      if (s.state === "missing" && s.required === false) continue;
      // An Alberta CONTINUOUS registration has no expiry. Loaded from a carrier sheet it
      // came in with expiry = issue date, so the app reads it as overdue the day it was
      // filed. Every one of these has its certificate attached: the paperwork is fine and
      // the record is wrong, so it must not go on the chase list.
      const contDoc = docs.find((d) => d.doc_type === s.docType && d.is_active &&
        d.expiry_date && d.expiry_date === d.issued_date && (d.attachment_ids || []).length > 0);
      if (s.state === "expired" && contDoc) {
        gaps.push({ group: "Contracted trucks", subject: label, carrier, item: s.label, state: "EXPIRED",
          detail: `stored as expiring ${contDoc.expiry_date}, the day it was issued - the scan on file is a CONTINUOUS registration, which never expires`,
          falseAlarm: true });
        continue;
      }
      gaps.push({ group: "Contracted trucks", subject: label, carrier, item: s.label, state: say(s.state), detail: s.expiryDate ? `expiry ${s.expiryDate}` : "" });
    }
    for (const s of contractedUnitCertificationStatuses({ category: u.category, certificationTypes: typeInputs, requiredTypeIds: cReqBy.get(u.id) ?? null, documents: docs }, now)) {
      if (s.state === "on_file") continue;
      if (s.state === "missing" && s.expected === false) continue;
      gaps.push({ group: "Contracted trucks", subject: label, carrier, item: s.label, state: say(s.state), detail: s.expiryDate ? `expiry ${s.expiryDate}` : "" });
    }
  }

  // ---- contracted drivers ----------------------------------------------------
  const dCertBy = new Map<string, DriverCertRow[]>();
  // No deleted_at on this table - nothing to filter.
  for (const c of driverCerts) (dCertBy.get(c.contracted_driver_id) ?? dCertBy.set(c.contracted_driver_id, []).get(c.contracted_driver_id)!).push(c);
  const dDocBy = new Map<string, DriverDocRow[]>();
  // No deleted_at on this table either.
  for (const d of driverDocs) (dDocBy.get(d.contracted_driver_id) ?? dDocBy.set(d.contracted_driver_id, []).get(d.contracted_driver_id)!).push(d);

  let driverCount = 0;
  for (const d of drivers.filter(live).sort((a, b) => (carrierName.get(a.subcontractor_id) || "").localeCompare(carrierName.get(b.subcontractor_id) || "") || a.full_name.localeCompare(b.full_name))) {
    if (d.status !== "active") continue;
    driverCount++;
    const carrier = carrierName.get(d.subcontractor_id) || "(no carrier)";
    const certs = (dCertBy.get(d.id) ?? []).map((c) => {
      const type = c.certification_type_id ? certTypeById.get(c.certification_type_id) : undefined;
      return { ...c, typeCategory: type?.category ?? null, typeName: type?.name ?? null };
    });

    for (const r of contractedDriverIdentityRecords(d, now, dDocBy.get(d.id) ?? [])) {
      if (r.status.tone === "success") continue;
      if (!r.date) gaps.push({ group: "Contracted drivers", subject: d.full_name, carrier, item: r.label, state: "missing", detail: "no date on file" });
      else if (r.status.tone === "danger") gaps.push({ group: "Contracted drivers", subject: d.full_name, carrier, item: r.label, state: "EXPIRED", detail: r.date });
      else if (r.status.tone === "warning") gaps.push({ group: "Contracted drivers", subject: d.full_name, carrier, item: r.label, state: "due soon", detail: r.date });
      else if (r.status.tone === "unproven") gaps.push({ group: "Contracted drivers", subject: d.full_name, carrier, item: r.label, state: "no scan", detail: r.date });
      if (r.mismatch) gaps.push({ group: "Contracted drivers", subject: d.full_name, carrier, item: r.label, state: "disagrees", detail: `record says ${r.mismatch.tracked}, the scan says ${r.mismatch.onDocument}` });
    }
    for (const t of contractedDriverMissingTickets({ certifications: certs, mandatoryTickets }))
      gaps.push({ group: "Contracted drivers", subject: d.full_name, carrier, item: t.name, state: "missing", detail: "mandatory ticket, nothing on file" });
    for (const s of contractedDriverCertificationStatuses({ certifications: certs, mandatoryTicketTypeIds: mandatoryTickets.map((t) => t.id) }, now)) {
      if (s.superseded || s.status.tone === "success" || s.category !== "ticket") continue;
      const st = s.status.tone === "danger" ? "EXPIRED" : s.status.tone === "warning" ? "due soon" : s.status.tone === "unproven" ? "no scan" : null;
      if (st) gaps.push({ group: "Contracted drivers", subject: d.full_name, carrier, item: s.label, state: st, detail: s.expiresOn || "" });
    }
    if (!d.email) gaps.push({ group: "Contracted drivers", subject: d.full_name, carrier, item: "Email address", state: "missing", detail: "" });
  }

  const out = arg("--out") ?? "fleet-gaps.json";
  fs.writeFileSync(out, JSON.stringify({ counts: { ownedUnits, truckUnits, driverCount, carriers: carriers.filter(live).length }, gaps }, null, 1));
  console.log(`${gaps.length} item(s) across ${ownedUnits} owned unit(s), ${truckUnits} contracted unit(s) and ${driverCount} driver(s) -> ${out}`);
}

void main();
