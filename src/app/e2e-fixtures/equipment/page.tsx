import { notFound } from "next/navigation";
import { EquipmentPanel } from "@/app/web/_components/EquipmentPanel";
import type {
  OfflineEquipmentAssigneeSummary,
  OfflineEquipmentDocumentSummary,
  OfflineEquipmentLinkableSubmissionSummary,
  OfflineEquipmentLocationSummary,
  OfflineEquipmentMaintenanceSummary,
  OfflineEquipmentMeterSummary,
  OfflineEquipmentServiceSummary,
  OfflineEquipmentSubmissionSummary,
  OfflineEquipmentSummary,
} from "@/lib/offline/equipment";

export const dynamic = "force-dynamic";

type EquipmentFixturePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function fixtureId(value: string | undefined) {
  return value?.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 48) || "default";
}

export default async function EquipmentFixturePage({ searchParams }: EquipmentFixturePageProps) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const runId = fixtureId(firstParam(params.run));
  const tenantId = `tenant-${runId}`;
  const userId = `worker-${runId}`;
  const equipmentId = `equipment-${runId}`;
  const yardId = `yard-${runId}`;
  const shopId = `shop-${runId}`;
  const issuedAt = "2026-05-24T10:00:00.000Z";
  const equipment: OfflineEquipmentSummary[] = [
    {
      assignedTo: userId,
      category: "vehicle",
      currentMeter: 980,
      id: equipmentId,
      locationId: yardId,
      make: "Ford",
      model: "F-550",
      name: "Service Truck",
      status: "active",
      tenantId,
      trackingMode: "mileage",
      unitNumber: "Unit 47",
      updatedAt: issuedAt,
      vinOrSerial: "VIN47",
      year: 2024,
    },
  ];
  const services: OfflineEquipmentServiceSummary[] = [
    {
      dueDate: null,
      dueMeter: 950,
      equipmentId,
      id: `service-${runId}`,
      intervalMode: "by_meter",
      isActive: true,
      lastCompletedAt: null,
      lastCompletedMeter: null,
      recurrenceUnit: "meter",
      recurrenceValue: 250,
      serviceType: "oil_change",
      tenantId,
      title: "Oil Change",
      updatedAt: issuedAt,
    },
  ];
  const documents: OfflineEquipmentDocumentSummary[] = [
    {
      attachmentIds: [`${tenantId}/equipment/${equipmentId}/documents/registration.pdf`],
      attachmentUrls: {
        [`${tenantId}/equipment/${equipmentId}/documents/registration.pdf`]: "data:application/pdf;base64,UkVHSVNUUkFUSU9O",
      },
      docType: "registration",
      equipmentId,
      expiryDate: "2026-05-20",
      id: `document-${runId}`,
      isActive: true,
      reminderLeadDays: 30,
      tenantId,
      title: "Registration",
      updatedAt: issuedAt,
    },
  ];
  const maintenance: OfflineEquipmentMaintenanceSummary[] = [
    {
      attachmentIds: [],
      attachmentUrls: {},
      description: "Replaced belt and checked fluid leak.",
      equipmentId,
      id: `maintenance-${runId}`,
      meterAtService: 960,
      performedAt: "2026-05-18",
      tenantId,
      title: "Belt replacement",
      type: "repair",
      updatedAt: issuedAt,
      vendor: "Shop Crew",
    },
  ];
  const meterReadings: OfflineEquipmentMeterSummary[] = [
    {
      equipmentId,
      id: `meter-${runId}`,
      recordedAt: issuedAt,
      source: "manual",
      tenantId,
      updatedAt: issuedAt,
      value: 980,
    },
  ];
  const linkedSubmissions: OfflineEquipmentSubmissionSummary[] = [
    {
      equipmentId,
      formCode: "INSP",
      formId: `form-linked-${runId}`,
      formName: "Monthly Inspection",
      formType: "inspection",
      id: `linked-${runId}`,
      linkedAt: issuedAt,
      linkSource: "auto",
      locationName: "Main Yard (YD)",
      submittedAt: issuedAt,
      submissionId: `submission-linked-${runId}`,
      submitterName: "Blake Cowan",
      tenantId,
      updatedAt: issuedAt,
    },
  ];
  const linkableSubmissions: OfflineEquipmentLinkableSubmissionSummary[] = [
    {
      formCode: "DAILY",
      formId: `form-linkable-${runId}`,
      formName: "Daily Inspection",
      formType: "inspection",
      id: `submission-linkable-${runId}`,
      locationName: "Main Yard (YD)",
      submittedAt: "2026-05-24T12:00:00.000Z",
      submitterName: "Blake Cowan",
      tenantId,
      updatedAt: "2026-05-24T12:00:00.000Z",
    },
  ];
  const locations: OfflineEquipmentLocationSummary[] = [
    {
      code: "YD",
      id: yardId,
      name: "Main Yard",
      tenantId,
    },
    {
      code: "SHOP",
      id: shopId,
      name: "Repair Shop",
      tenantId,
    },
  ];
  const assignees: OfflineEquipmentAssigneeSummary[] = [
    {
      fullName: "Blake Cowan",
      id: userId,
      tenantId,
    },
    {
      fullName: "Avery Lee",
      id: `worker-alt-${runId}`,
      tenantId,
    },
  ];

  return (
    <main className="min-h-screen bg-[var(--background)] p-4">
      <EquipmentPanel
        initialAssignees={assignees}
        initialDocuments={documents}
        initialEquipment={equipment}
        initialLinkedSubmissions={linkedSubmissions}
        initialLinkableSubmissions={linkableSubmissions}
        initialLocations={locations}
        initialMaintenance={maintenance}
        initialMeterReadings={meterReadings}
        initialServices={services}
        offlineSyncDays={14}
        tenantId={tenantId}
        userId={userId}
      />
    </main>
  );
}
