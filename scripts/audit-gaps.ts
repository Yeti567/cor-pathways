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
} from "../src/lib/contracted-equipment";
import {
  contractedDriverIdentityRecords,
  contractedDriverCertificationStatuses,
  contractedDriverMissingTickets,
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

async function all(table: string, select: string, tenantScoped = true) {
  let from = 0;
  let rows: any[] = [];
  for (;;) {
    let q = sb.from(table).select(select).range(from, from + 999);
    if (tenantScoped) q = q.eq("tenant_id", T);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows = rows.concat(data || []);
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
    all("equipment", "id,unit_number,name,category,vin_or_serial,license_plate,status,deleted_at,notes"),
    all("equipment_document", "id,equipment_id,doc_type,title,certification_type_id,issued_date,expiry_date,is_active,attachment_ids,reminder_lead_days,deleted_at"),
    all("equipment_certification_requirement", "equipment_id,certification_type_id"),
    all("equipment_certification_types", "id,name,applies_by_default,default_interval_days"),
    all("contracted_equipment", "id,unit_number,category,subcontractor_id,vin_or_serial,license_plate,status,deleted_at"),
    all("contracted_equipment_document", "id,contracted_equipment_id,doc_type,title,certification_type_id,issued_date,expiry_date,is_active,attachment_ids,reminder_lead_days,deleted_at"),
    all("contracted_equipment_certification_requirement", "contracted_equipment_id,certification_type_id"),
    all("contracted_driver", "id,full_name,subcontractor_id,contracted_equipment_id,license_province,license_expiry,abstract_issued,abstract_expiry,cso_completed,status,email,phone,notes,deleted_at"),
    all("contracted_driver_certification", "id,contracted_driver_id,certification_type_id,name,issued_on,expires_on,issuing_company,detail,attachment_path"),
    all("contracted_driver_document", "id,contracted_driver_id,doc_type,title,issued_date,expiry_date,attachment_path,created_at"),
    all("subcontractor", "id,legal_name,operating_name,active,deleted_at"),
    all("certification_types", "id,name,category,is_mandatory"),
  ]);

  const live = (r: any) => !r.deleted_at;
  const typeInputs = eqTypes.map((t: any) => ({ id: t.id, name: t.name, appliesByDefault: t.applies_by_default }));
  const carrierName = new Map(carriers.filter(live).map((c: any) => [c.id, c.legal_name || c.operating_name]));
  const mandatoryTickets = certTypes.filter((t: any) => t.category === "ticket" && t.is_mandatory).map((t: any) => ({ id: t.id, name: t.name }));
  const certTypeById = new Map(certTypes.map((t: any) => [t.id, t]));

  type Gap = { group: string; subject: string; carrier?: string; item: string; state: string; detail: string; falseAlarm?: boolean };
  const gaps: Gap[] = [];
  const say = (s: string) =>
    s === "expired" ? "EXPIRED" : s === "missing" ? "missing" : s === "due_soon" ? "due soon" : s === "awaiting_proof" ? "no scan" : s;

  // ---- owned equipment -------------------------------------------------------
  const eqDocsBy = new Map<string, any[]>();
  for (const d of eqDocs.filter(live)) (eqDocsBy.get(d.equipment_id) ?? eqDocsBy.set(d.equipment_id, []).get(d.equipment_id)!).push(d);
  const eqReqBy = new Map<string, string[]>();
  for (const r of eqReqs) (eqReqBy.get(r.equipment_id) ?? eqReqBy.set(r.equipment_id, []).get(r.equipment_id)!).push(r.certification_type_id);

  let ownedUnits = 0;
  for (const e of equipment.filter(live).sort((a: any, b: any) => (a.unit_number || "").localeCompare(b.unit_number || "", undefined, { numeric: true }))) {
    if (e.status === "retired" || e.status === "sold") continue;
    ownedUnits++;
    const docs = eqDocsBy.get(e.id) ?? [];
    const label = `Unit ${e.unit_number}`;

    if (!e.vin_or_serial || e.vin_or_serial.length !== 17)
      gaps.push({ group: "Trailers and owned equipment", subject: label, item: "Serial / VIN", state: "missing", detail: e.vin_or_serial ? `${e.vin_or_serial.length} characters, should be 17` : "blank" });
    if (!e.license_plate)
      gaps.push({ group: "Trailers and owned equipment", subject: label, item: "Licence plate", state: "missing", detail: "blank" });

    for (const s of buildVehicleFileStatuses({ category: e.category, documents: docs.map((d: any) => ({ docType: d.doc_type, expiryDate: d.expiry_date, isActive: d.is_active, reminderLeadDays: d.reminder_lead_days, hasProof: (d.attachment_ids || []).length > 0 })) }, now)) {
      if (s.state === "on_file") continue;
      if (s.state === "missing" && s.required === false) continue;
      gaps.push({ group: "Trailers and owned equipment", subject: label, item: s.label, state: say(s.state), detail: s.expiryDate ? `expiry ${s.expiryDate}` : "" });
    }
    for (const s of buildUnitCertificationStatuses({
      certificationTypes: expectedCertificationTypesForUnit({ category: e.category, certificationTypes: typeInputs, requiredTypeIds: eqReqBy.get(e.id) ?? null }),
      certificationTypeNames: new Map(typeInputs.map((t) => [t.id, t.name])),
      documents: docs.map((d: any) => ({ certificationTypeId: d.certification_type_id, docType: d.doc_type, expiryDate: d.expiry_date, isActive: d.is_active, reminderLeadDays: d.reminder_lead_days, title: d.title, hasProof: (d.attachment_ids || []).length > 0 })),
    }, now)) {
      if (s.state === "on_file" || (s as any).superseded) continue;
      if (s.state === "missing" && (s as any).expected === false) continue;
      gaps.push({ group: "Trailers and owned equipment", subject: label, item: s.label, state: say(s.state), detail: s.expiryDate ? `expiry ${s.expiryDate}` : "" });
    }
  }

  // ---- contracted equipment (the trucks) -------------------------------------
  const cDocsBy = new Map<string, any[]>();
  for (const d of cDocs.filter(live)) (cDocsBy.get(d.contracted_equipment_id) ?? cDocsBy.set(d.contracted_equipment_id, []).get(d.contracted_equipment_id)!).push(d);
  const cReqBy = new Map<string, string[]>();
  for (const r of cReqs) (cReqBy.get(r.contracted_equipment_id) ?? cReqBy.set(r.contracted_equipment_id, []).get(r.contracted_equipment_id)!).push(r.certification_type_id);

  let truckUnits = 0;
  for (const u of cEquip.filter(live).sort((a: any, b: any) => (a.unit_number || "").localeCompare(b.unit_number || "", undefined, { numeric: true }))) {
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
      const contDoc = docs.find((d: any) => d.doc_type === s.docType && d.is_active &&
        d.expiry_date && d.expiry_date === d.issued_date && (d.attachment_ids || []).length > 0);
      if (s.state === "expired" && contDoc) {
        gaps.push({ group: "Contracted trucks", subject: label, carrier, item: s.label, state: "EXPIRED",
          detail: `stored as expiring ${contDoc.expiry_date}, the day it was issued - the scan on file is a CONTINUOUS registration, which never expires`,
          falseAlarm: true } as any);
        continue;
      }
      gaps.push({ group: "Contracted trucks", subject: label, carrier, item: s.label, state: say(s.state), detail: s.expiryDate ? `expiry ${s.expiryDate}` : "" });
    }
    for (const s of contractedUnitCertificationStatuses({ category: u.category, certificationTypes: typeInputs, requiredTypeIds: cReqBy.get(u.id) ?? null, documents: docs }, now)) {
      if (s.state === "on_file" || (s as any).superseded) continue;
      if (s.state === "missing" && (s as any).expected === false) continue;
      gaps.push({ group: "Contracted trucks", subject: label, carrier, item: s.label, state: say(s.state), detail: s.expiryDate ? `expiry ${s.expiryDate}` : "" });
    }
  }

  // ---- contracted drivers ----------------------------------------------------
  const dCertBy = new Map<string, any[]>();
  for (const c of driverCerts.filter(live)) (dCertBy.get(c.contracted_driver_id) ?? dCertBy.set(c.contracted_driver_id, []).get(c.contracted_driver_id)!).push(c);
  const dDocBy = new Map<string, any[]>();
  for (const d of driverDocs.filter(live)) (dDocBy.get(d.contracted_driver_id) ?? dDocBy.set(d.contracted_driver_id, []).get(d.contracted_driver_id)!).push(d);

  let driverCount = 0;
  for (const d of drivers.filter(live).sort((a: any, b: any) => (carrierName.get(a.subcontractor_id) || "").localeCompare(carrierName.get(b.subcontractor_id) || "") || a.full_name.localeCompare(b.full_name))) {
    if (d.status !== "active") continue;
    driverCount++;
    const carrier = carrierName.get(d.subcontractor_id) || "(no carrier)";
    const certs = (dCertBy.get(d.id) ?? []).map((c: any) => ({ ...c, typeCategory: certTypeById.get(c.certification_type_id)?.category ?? null, typeName: certTypeById.get(c.certification_type_id)?.name ?? null }));

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
