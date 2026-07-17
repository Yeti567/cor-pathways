"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Gauge,
  Link2,
  MapPin,
  Paperclip,
  Search,
  Truck,
  Unlink,
  UserRound,
  Wrench,
} from "lucide-react";
import {
  equipmentDocumentTypeOptions,
  equipmentDueStatusClass,
  equipmentIntervalModeOptions,
  equipmentMaintenanceTypeOptions,
  equipmentServiceTypeOptions,
  equipmentStatusOptions,
  formatEquipmentDueDetail,
  formatEquipmentCategory,
  formatEquipmentMeter,
  formatEquipmentStatus,
  getEquipmentScheduleStatus,
  type EquipmentDueStatus,
} from "@/lib/equipment";
import {
  cacheOfflineEquipmentLibrary,
  compareOfflineEquipmentByAttention,
  getCachedOfflineEquipmentLibrary,
  getOfflineEquipmentDocumentStatus,
  getOfflineEquipmentNextServiceLabel,
  getOfflineEquipmentServiceIndicator,
  offlineEquipmentMatchesSearch,
  queueOfflineEquipmentAssignment,
  queueOfflineEquipmentDocument,
  queueOfflineEquipmentMaintenanceLog,
  queueOfflineEquipmentMeterReading,
  queueOfflineEquipmentSubmissionLink,
  queueOfflineEquipmentSubmissionUnlink,
  queueOfflineScheduledServiceCreation,
  queueOfflineScheduledServiceCompletion,
  type OfflineEquipmentAssigneeSummary,
  type OfflineEquipmentDocumentAttachmentDraft,
  type OfflineEquipmentDocumentSummary,
  type OfflineEquipmentLibrary,
  type OfflineEquipmentLinkableSubmissionSummary,
  type OfflineEquipmentLocationSummary,
  type OfflineEquipmentMaintenanceSummary,
  type OfflineEquipmentMeterSummary,
  type OfflineEquipmentSubmissionSummary,
  type OfflineEquipmentServiceSummary,
  type OfflineEquipmentSummary,
} from "@/lib/offline/equipment";
import { flushQueuedMutations } from "@/lib/offline/sync";

type EquipmentPanelProps = {
  initialAssignees: OfflineEquipmentAssigneeSummary[];
  initialDocuments: OfflineEquipmentDocumentSummary[];
  initialEquipment: OfflineEquipmentSummary[];
  initialLocations: OfflineEquipmentLocationSummary[];
  initialMaintenance: OfflineEquipmentMaintenanceSummary[];
  initialMeterReadings: OfflineEquipmentMeterSummary[];
  initialLinkedSubmissions: OfflineEquipmentSubmissionSummary[];
  initialLinkableSubmissions: OfflineEquipmentLinkableSubmissionSummary[];
  initialServices: OfflineEquipmentServiceSummary[];
  offlineSyncDays: number;
  tenantId: string;
  userId: string;
};

type EquipmentStatusFilter = "all" | "active" | "down";
type AssignmentDraft = {
  assignedTo: string;
  locationId: string;
  status: string;
};
type MaintenanceDraft = {
  description: string;
  meterAtService: string;
  title: string;
  type: string;
};
type DocumentDraft = {
  docType: string;
  expiryDate: string;
  issuedDate: string;
  reminderLeadDays: string;
  title: string;
};
type ServiceCompletionDraft = {
  completedMeter: string;
  serviceId: string;
};
type ServiceCreationDraft = {
  dueDate: string;
  dueMeter: string;
  intervalMode: string;
  recurrenceUnit: string;
  recurrenceValue: string;
  serviceType: string;
  title: string;
};

const equipmentDocumentAttachmentTypes = new Set([
  "application/pdf",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxEquipmentDocumentAttachmentBytes = 10 * 1024 * 1024;

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function dueDetail(status: EquipmentDueStatus) {
  if (status.daysUntilDue !== null) {
    if (status.daysUntilDue < 0) {
      return `${Math.abs(status.daysUntilDue)} days overdue`;
    }

    if (status.daysUntilDue === 0) {
      return "Due today";
    }

    return `Due in ${status.daysUntilDue} days`;
  }

  if (status.meterRemaining !== null) {
    if (status.meterRemaining <= 0) {
      return "Meter overdue";
    }

    return `${status.meterRemaining.toLocaleString("en")} remaining`;
  }

  return status.label;
}

function statusClass(status: string) {
  if (status === "down") {
    return "bg-red-50 text-[var(--danger)]";
  }

  if (status === "active") {
    return "bg-emerald-50 text-[var(--success)]";
  }

  return "bg-[var(--surface-muted)] text-[var(--ink-muted)]";
}

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00`));
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function optionLabel(options: readonly { label: string; value: string }[], value: string) {
  return options.find((option) => option.value === value)?.label ?? value.replaceAll("_", " ");
}

function attachmentLabel(path: string, index: number) {
  const fileName = path.split("/").pop()?.replace(/^\d+-/, "") || `Attachment ${index + 1}`;
  return fileName.length > 34 ? `${fileName.slice(0, 31)}...` : fileName;
}

function serviceDueLine(service: OfflineEquipmentServiceSummary) {
  const parts = [
    service.dueDate ? `Due ${formatDate(service.dueDate)}` : null,
    typeof service.dueMeter === "number" ? `Due at ${service.dueMeter.toLocaleString("en")}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "No due value";
}

function recurrenceLine(service: OfflineEquipmentServiceSummary) {
  if (!service.recurrenceUnit || !service.recurrenceValue) {
    return "One-time service";
  }

  return `Every ${service.recurrenceValue.toLocaleString("en")} ${service.recurrenceUnit}`;
}

function meterSourceLabel(source: string) {
  switch (source) {
    case "inspection":
      return "Inspection";
    case "maintenance":
      return "Maintenance";
    default:
      return "Manual";
  }
}

function emptyLibrary(): OfflineEquipmentLibrary {
  return {
    assignees: [],
    documents: [],
    equipment: [],
    locations: [],
    maintenance: [],
    meterReadings: [],
    linkedSubmissions: [],
    linkableSubmissions: [],
    services: [],
  };
}

function defaultMaintenanceDraft(): MaintenanceDraft {
  return {
    description: "",
    meterAtService: "",
    title: "",
    type: "repair",
  };
}

function defaultAssignmentDraft(equipment: OfflineEquipmentSummary): AssignmentDraft {
  return {
    assignedTo: equipment.assignedTo ?? "",
    locationId: equipment.status === "down" ? "" : equipment.locationId ?? "",
    status: equipment.status,
  };
}

function defaultDocumentDraft(): DocumentDraft {
  return {
    docType: "registration",
    expiryDate: "",
    issuedDate: "",
    reminderLeadDays: "30",
    title: "",
  };
}

function defaultServiceCompletionDraft(serviceId = ""): ServiceCompletionDraft {
  return {
    completedMeter: "",
    serviceId,
  };
}

function defaultServiceCreationDraft(): ServiceCreationDraft {
  return {
    dueDate: "",
    dueMeter: "",
    intervalMode: "by_date",
    recurrenceUnit: "",
    recurrenceValue: "",
    serviceType: "scheduled_maintenance",
    title: "",
  };
}

function readEquipmentDocumentAttachment(file: File): Promise<OfflineEquipmentDocumentAttachmentDraft> {
  if (!equipmentDocumentAttachmentTypes.has(file.type)) {
    return Promise.reject(new Error("Choose a PDF, PNG, JPEG, WebP, HEIC, or HEIF document."));
  }

  if (file.size > maxEquipmentDocumentAttachmentBytes) {
    return Promise.reject(new Error("Choose a document under 10 MB."));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("error", () => reject(new Error("Document attachment could not be read.")));
    reader.addEventListener("load", () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";

      if (!dataUrl) {
        reject(new Error("Document attachment could not be read."));
        return;
      }

      resolve({
        contentType: file.type,
        dataUrl,
        name: file.name || "equipment-document",
      });
    });
    reader.readAsDataURL(file);
  });
}

export function EquipmentPanel({
  initialAssignees,
  initialDocuments,
  initialEquipment,
  initialLocations,
  initialMaintenance,
  initialMeterReadings,
  initialLinkedSubmissions,
  initialLinkableSubmissions,
  initialServices,
  offlineSyncDays,
  tenantId,
  userId,
}: EquipmentPanelProps) {
  const initialLibrary = useMemo(
    () => ({
      assignees: initialAssignees,
      documents: initialDocuments,
      equipment: initialEquipment,
      locations: initialLocations,
      maintenance: initialMaintenance,
      meterReadings: initialMeterReadings,
      linkedSubmissions: initialLinkedSubmissions,
      linkableSubmissions: initialLinkableSubmissions,
      services: initialServices,
    }),
    [
      initialAssignees,
      initialDocuments,
      initialEquipment,
      initialLocations,
      initialMaintenance,
      initialMeterReadings,
      initialLinkedSubmissions,
      initialLinkableSubmissions,
      initialServices,
    ],
  );
  const [library, setLibrary] = useState<OfflineEquipmentLibrary>(initialLibrary);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<EquipmentStatusFilter>("all");
  const [cacheReady, setCacheReady] = useState(false);
  const [meterInputs, setMeterInputs] = useState<Record<string, string>>({});
  const [meterSavingId, setMeterSavingId] = useState<string | null>(null);
  const [meterNotice, setMeterNotice] = useState("");
  const [meterError, setMeterError] = useState("");
  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(null);
  const [assignmentInputs, setAssignmentInputs] = useState<Record<string, AssignmentDraft>>({});
  const [assignmentSavingId, setAssignmentSavingId] = useState<string | null>(null);
  const [activeMaintenanceId, setActiveMaintenanceId] = useState<string | null>(null);
  const [maintenanceInputs, setMaintenanceInputs] = useState<Record<string, MaintenanceDraft>>({});
  const [maintenanceAttachments, setMaintenanceAttachments] = useState<Record<string, OfflineEquipmentDocumentAttachmentDraft[]>>({});
  const [maintenanceSavingId, setMaintenanceSavingId] = useState<string | null>(null);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [documentInputs, setDocumentInputs] = useState<Record<string, DocumentDraft>>({});
  const [documentAttachments, setDocumentAttachments] = useState<Record<string, OfflineEquipmentDocumentAttachmentDraft[]>>({});
  const [documentSavingId, setDocumentSavingId] = useState<string | null>(null);
  const [activeServiceCompletionId, setActiveServiceCompletionId] = useState<string | null>(null);
  const [serviceCompletionInputs, setServiceCompletionInputs] = useState<Record<string, ServiceCompletionDraft>>({});
  const [serviceCompletionSavingId, setServiceCompletionSavingId] = useState<string | null>(null);
  const [activeServiceCreationId, setActiveServiceCreationId] = useState<string | null>(null);
  const [serviceCreationInputs, setServiceCreationInputs] = useState<Record<string, ServiceCreationDraft>>({});
  const [serviceCreationSavingId, setServiceCreationSavingId] = useState<string | null>(null);
  const [activeSubmissionLinkId, setActiveSubmissionLinkId] = useState<string | null>(null);
  const [submissionLinkInputs, setSubmissionLinkInputs] = useState<Record<string, string>>({});
  const [submissionLinkSavingId, setSubmissionLinkSavingId] = useState<string | null>(null);
  const [submissionUnlinkSavingId, setSubmissionUnlinkSavingId] = useState<string | null>(null);
  const [expandedEquipmentIds, setExpandedEquipmentIds] = useState<Record<string, boolean>>({});
  const expiresAt = useMemo(() => addDays(new Date(), offlineSyncDays).toISOString(), [offlineSyncDays]);

  useEffect(() => {
    let active = true;

    async function hydrateEquipment() {
      if (initialEquipment.length > 0) {
        await cacheOfflineEquipmentLibrary({
          ...initialLibrary,
          expiresAt,
        });
      }

      const cached = await getCachedOfflineEquipmentLibrary(tenantId);
      const nextLibrary = initialEquipment.length > 0 ? initialLibrary : cached;

      if (!active) {
        return;
      }

      setLibrary(nextLibrary.equipment.length > 0 ? nextLibrary : emptyLibrary());
      setCacheReady(cached.equipment.length > 0 || initialEquipment.length > 0);
    }

    hydrateEquipment().catch(() => undefined);

    return () => {
      active = false;
    };
  }, [expiresAt, initialEquipment.length, initialLibrary, tenantId]);

  const locationById = useMemo(() => new Map(library.locations.map((location) => [location.id, location])), [library.locations]);
  const assigneeById = useMemo(() => new Map(library.assignees.map((assignee) => [assignee.id, assignee])), [library.assignees]);
  const servicesByEquipmentId = useMemo(() => {
    const map = new Map<string, OfflineEquipmentServiceSummary[]>();

    for (const service of library.services) {
      const services = map.get(service.equipmentId) ?? [];
      services.push(service);
      map.set(service.equipmentId, services);
    }

    return map;
  }, [library.services]);
  const documentsByEquipmentId = useMemo(() => {
    const map = new Map<string, OfflineEquipmentDocumentSummary[]>();

    for (const document of library.documents) {
      const documents = map.get(document.equipmentId) ?? [];
      documents.push(document);
      map.set(document.equipmentId, documents);
    }

    return map;
  }, [library.documents]);
  const maintenanceByEquipmentId = useMemo(() => {
    const map = new Map<string, OfflineEquipmentMaintenanceSummary[]>();

    for (const entry of library.maintenance) {
      const entries = map.get(entry.equipmentId) ?? [];
      entries.push(entry);
      map.set(entry.equipmentId, entries);
    }

    return map;
  }, [library.maintenance]);
  const meterReadingsByEquipmentId = useMemo(() => {
    const map = new Map<string, OfflineEquipmentMeterSummary[]>();

    for (const reading of library.meterReadings) {
      const readings = map.get(reading.equipmentId) ?? [];
      readings.push(reading);
      map.set(reading.equipmentId, readings);
    }

    return map;
  }, [library.meterReadings]);
  const linkedSubmissionsByEquipmentId = useMemo(() => {
    const map = new Map<string, OfflineEquipmentSubmissionSummary[]>();

    for (const linkedSubmission of library.linkedSubmissions) {
      const linkedSubmissions = map.get(linkedSubmission.equipmentId) ?? [];
      linkedSubmissions.push(linkedSubmission);
      map.set(linkedSubmission.equipmentId, linkedSubmissions);
    }

    return map;
  }, [library.linkedSubmissions]);
  const equipmentRows = useMemo(
    () =>
      library.equipment
        .map((equipment) => {
          const location = equipment.locationId ? locationById.get(equipment.locationId) : null;
          const assignee = equipment.assignedTo ? assigneeById.get(equipment.assignedTo) : null;
          const services = servicesByEquipmentId.get(equipment.id) ?? [];
          const activeServices = services.filter((service) => service.isActive);
          const documents = documentsByEquipmentId.get(equipment.id) ?? [];
          const maintenance = maintenanceByEquipmentId.get(equipment.id) ?? [];
          const meterReadings = meterReadingsByEquipmentId.get(equipment.id) ?? [];
          const linkedSubmissions = linkedSubmissionsByEquipmentId.get(equipment.id) ?? [];
          const serviceIndicator = getOfflineEquipmentServiceIndicator({
            documents,
            equipment,
            services,
          });
          const expiringDocumentCount = documents.filter(
            (document) => getOfflineEquipmentDocumentStatus(document).state !== "current",
          ).length;

          return {
            assigneeName: assignee?.fullName ?? "Unassigned",
            documents,
            equipment,
            expiringDocumentCount,
            locationName: location ? `${location.name}${location.code ? ` (${location.code})` : ""}` : "No location",
            maintenance,
            meterReadings,
            linkedSubmissions,
            nextServiceLabel: getOfflineEquipmentNextServiceLabel({
              currentMeter: equipment.currentMeter,
              services,
            }),
            activeServices,
            serviceIndicator,
            services,
          };
        })
        .filter((row) => {
          if (statusFilter !== "all" && row.equipment.status !== statusFilter) {
            return false;
          }

          return offlineEquipmentMatchesSearch(
            {
              assigneeName: row.assigneeName,
              equipment: row.equipment,
              locationName: row.locationName,
            },
            query,
          );
        })
        .sort(compareOfflineEquipmentByAttention),
    [
      assigneeById,
      documentsByEquipmentId,
      library.equipment,
      linkedSubmissionsByEquipmentId,
      locationById,
      maintenanceByEquipmentId,
      meterReadingsByEquipmentId,
      query,
      servicesByEquipmentId,
      statusFilter,
    ],
  );
  const downCount = library.equipment.filter((equipment) => equipment.status === "down").length;
  const attentionCount = equipmentRows.filter((row) => row.serviceIndicator.state !== "current").length;

  function linkableSubmissionsForEquipment(equipmentId: string) {
    const linkedSubmissionIds = new Set((linkedSubmissionsByEquipmentId.get(equipmentId) ?? []).map((link) => link.submissionId));

    return library.linkableSubmissions.filter((submission) => !linkedSubmissionIds.has(submission.id));
  }

  function assignmentDraftFor(equipment: OfflineEquipmentSummary) {
    return assignmentInputs[equipment.id] ?? defaultAssignmentDraft(equipment);
  }

  function updateAssignmentDraft(equipment: OfflineEquipmentSummary, patch: Partial<AssignmentDraft>) {
    setAssignmentInputs((current) => {
      const next = {
        ...defaultAssignmentDraft(equipment),
        ...current[equipment.id],
        ...patch,
      };

      if (next.status === "down") {
        next.locationId = "";
      }

      return {
        ...current,
        [equipment.id]: next,
      };
    });
  }

  async function submitEquipmentAssignment(equipment: OfflineEquipmentSummary) {
    const draft = assignmentDraftFor(equipment);

    setMeterNotice("");
    setMeterError("");
    setAssignmentSavingId(equipment.id);

    try {
      const result = await queueOfflineEquipmentAssignment({
        assignedTo: draft.assignedTo || null,
        equipment,
        expiresAt,
        locationId: draft.locationId || null,
        status: draft.status,
        userId,
      });

      setLibrary((current) => ({
        ...current,
        equipment: current.equipment.map((item) => (item.id === result.equipment.id ? result.equipment : item)),
      }));
      setAssignmentInputs((current) => ({
        ...current,
        [equipment.id]: defaultAssignmentDraft(result.equipment),
      }));
      setActiveAssignmentId(null);

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushQueuedMutations();
        setMeterNotice(`${equipment.unitNumber} assignment synced.`);
      } else {
        setMeterNotice(`${equipment.unitNumber} assignment saved offline and queued to sync.`);
      }
    } catch (error) {
      setMeterError(error instanceof Error ? error.message : "Equipment assignment was not saved.");
    } finally {
      setAssignmentSavingId(null);
    }
  }

  async function submitMeterReading(equipment: OfflineEquipmentSummary) {
    const rawValue = meterInputs[equipment.id]?.trim() ?? "";
    const value = Number(rawValue);

    setMeterNotice("");
    setMeterError("");

    if (!rawValue || !Number.isFinite(value) || value < 0) {
      setMeterError("Enter a valid meter reading before saving.");
      return;
    }

    setMeterSavingId(equipment.id);

    try {
      const result = await queueOfflineEquipmentMeterReading({
        equipment,
        expiresAt,
        userId,
        value,
      });

      setLibrary((current) => ({
        ...current,
        equipment: current.equipment.map((item) => (item.id === result.equipment.id ? result.equipment : item)),
        meterReadings: result.meterReading ? [result.meterReading, ...current.meterReadings] : current.meterReadings,
      }));
      setMeterInputs((current) => ({
        ...current,
        [equipment.id]: "",
      }));

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushQueuedMutations();
        setMeterNotice(`${equipment.unitNumber} meter reading synced.`);
      } else {
        setMeterNotice(`${equipment.unitNumber} meter reading saved offline and queued to sync.`);
      }
    } catch (error) {
      setMeterError(error instanceof Error ? error.message : "Meter reading was not saved.");
    } finally {
      setMeterSavingId(null);
    }
  }

  function maintenanceDraftFor(equipmentId: string) {
    return maintenanceInputs[equipmentId] ?? defaultMaintenanceDraft();
  }

  function updateMaintenanceDraft(equipmentId: string, patch: Partial<MaintenanceDraft>) {
    setMaintenanceInputs((current) => ({
      ...current,
      [equipmentId]: {
        ...defaultMaintenanceDraft(),
        ...current[equipmentId],
        ...patch,
      },
    }));
  }

  async function submitMaintenanceLog(equipment: OfflineEquipmentSummary) {
    const draft = maintenanceDraftFor(equipment.id);
    const rawMeter = draft.meterAtService.trim();
    const meterAtService = rawMeter ? Number(rawMeter) : null;

    setMeterNotice("");
    setMeterError("");

    if (!draft.title.trim()) {
      setMeterError("Enter maintenance details before saving.");
      return;
    }

    if (meterAtService !== null && (!Number.isFinite(meterAtService) || meterAtService < 0)) {
      setMeterError("Enter a valid service meter reading.");
      return;
    }

    setMaintenanceSavingId(equipment.id);

    try {
      const result = await queueOfflineEquipmentMaintenanceLog({
        attachments: maintenanceAttachments[equipment.id] ?? [],
        description: draft.description,
        equipment,
        expiresAt,
        meterAtService,
        title: draft.title,
        type: draft.type,
        userId,
      });

      setLibrary((current) => ({
        ...current,
        equipment: current.equipment.map((item) => (item.id === result.equipment.id ? result.equipment : item)),
        maintenance: result.maintenance ? [result.maintenance, ...current.maintenance] : current.maintenance,
        meterReadings: result.meterReading ? [result.meterReading, ...current.meterReadings] : current.meterReadings,
      }));
      setMaintenanceInputs((current) => ({
        ...current,
        [equipment.id]: defaultMaintenanceDraft(),
      }));
      setMaintenanceAttachments((current) => ({
        ...current,
        [equipment.id]: [],
      }));
      setActiveMaintenanceId(null);

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushQueuedMutations();
        setMeterNotice(`${equipment.unitNumber} maintenance logged and synced.`);
      } else {
        setMeterNotice(`${equipment.unitNumber} maintenance saved offline and queued to sync.`);
      }
    } catch (error) {
      setMeterError(error instanceof Error ? error.message : "Maintenance was not saved.");
    } finally {
      setMaintenanceSavingId(null);
    }
  }

  async function updateMaintenanceAttachments(equipmentId: string, files: File[]) {
    setMeterError("");

    if (files.length === 0) {
      setMaintenanceAttachments((current) => ({
        ...current,
        [equipmentId]: [],
      }));
      return;
    }

    const attachments = await Promise.all(files.map((file) => readEquipmentDocumentAttachment(file)));

    setMaintenanceAttachments((current) => ({
      ...current,
      [equipmentId]: attachments,
    }));
  }

  function documentDraftFor(equipmentId: string) {
    return documentInputs[equipmentId] ?? defaultDocumentDraft();
  }

  function updateDocumentDraft(equipmentId: string, patch: Partial<DocumentDraft>) {
    setDocumentInputs((current) => ({
      ...current,
      [equipmentId]: {
        ...defaultDocumentDraft(),
        ...current[equipmentId],
        ...patch,
      },
    }));
  }

  async function updateDocumentAttachments(equipmentId: string, files: File[]) {
    setMeterError("");

    if (files.length === 0) {
      setDocumentAttachments((current) => ({
        ...current,
        [equipmentId]: [],
      }));
      return;
    }

    const attachments = await Promise.all(files.map((file) => readEquipmentDocumentAttachment(file)));

    setDocumentAttachments((current) => ({
      ...current,
      [equipmentId]: attachments,
    }));
  }

  async function submitEquipmentDocument(equipment: OfflineEquipmentSummary) {
    const draft = documentDraftFor(equipment.id);
    const reminderLeadDays = Number(draft.reminderLeadDays.trim() || "30");

    setMeterNotice("");
    setMeterError("");

    if (!draft.title.trim() || !draft.expiryDate) {
      setMeterError("Enter document details before saving.");
      return;
    }

    if (!Number.isFinite(reminderLeadDays) || reminderLeadDays < 0) {
      setMeterError("Enter a valid reminder lead time.");
      return;
    }

    setDocumentSavingId(equipment.id);

    try {
      const result = await queueOfflineEquipmentDocument({
        attachments: documentAttachments[equipment.id] ?? [],
        docType: draft.docType,
        equipment,
        expiresAt,
        expiryDate: draft.expiryDate,
        issuedDate: draft.issuedDate || null,
        reminderLeadDays,
        title: draft.title,
        userId,
      });

      setLibrary((current) => ({
        ...current,
        documents: result.document ? [result.document, ...current.documents] : current.documents,
      }));
      setDocumentInputs((current) => ({
        ...current,
        [equipment.id]: defaultDocumentDraft(),
      }));
      setDocumentAttachments((current) => ({
        ...current,
        [equipment.id]: [],
      }));
      setActiveDocumentId(null);

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushQueuedMutations();
        setMeterNotice(`${equipment.unitNumber} document synced.`);
      } else {
        setMeterNotice(`${equipment.unitNumber} document saved offline and queued to sync.`);
      }
    } catch (error) {
      setMeterError(error instanceof Error ? error.message : "Equipment document was not saved.");
    } finally {
      setDocumentSavingId(null);
    }
  }

  function serviceCreationDraftFor(equipmentId: string) {
    return serviceCreationInputs[equipmentId] ?? defaultServiceCreationDraft();
  }

  function updateServiceCreationDraft(equipmentId: string, patch: Partial<ServiceCreationDraft>) {
    setServiceCreationInputs((current) => ({
      ...current,
      [equipmentId]: {
        ...defaultServiceCreationDraft(),
        ...current[equipmentId],
        ...patch,
      },
    }));
  }

  async function submitServiceCreation(equipment: OfflineEquipmentSummary) {
    const draft = serviceCreationDraftFor(equipment.id);
    const usesMeterDue = draft.intervalMode === "by_meter" || draft.intervalMode === "both";
    const dueMeter = usesMeterDue && draft.dueMeter.trim() ? Number(draft.dueMeter) : null;
    const recurrenceValue = draft.recurrenceValue.trim() ? Number(draft.recurrenceValue) : null;
    const recurrenceUnit =
      draft.recurrenceUnit === "meter" || draft.recurrenceUnit === "days" || draft.recurrenceUnit === "months"
        ? draft.recurrenceUnit
        : null;

    setMeterNotice("");
    setMeterError("");

    if (!draft.title.trim()) {
      setMeterError("Enter scheduled service details.");
      return;
    }

    if ((draft.intervalMode === "by_date" || draft.intervalMode === "both") && !draft.dueDate) {
      setMeterError("Enter a due date for this scheduled service.");
      return;
    }

    if ((draft.intervalMode === "by_meter" || draft.intervalMode === "both") && dueMeter === null) {
      setMeterError("Enter a due meter for this scheduled service.");
      return;
    }

    if (dueMeter !== null && (!Number.isFinite(dueMeter) || dueMeter < 0)) {
      setMeterError("Enter a valid due meter.");
      return;
    }

    if (recurrenceValue !== null && (!Number.isInteger(recurrenceValue) || recurrenceValue <= 0)) {
      setMeterError("Enter a valid recurrence interval.");
      return;
    }

    if (recurrenceValue !== null && !recurrenceUnit) {
      setMeterError("Choose a recurrence unit.");
      return;
    }

    setServiceCreationSavingId(equipment.id);

    try {
      const result = await queueOfflineScheduledServiceCreation({
        dueDate: draft.intervalMode === "by_meter" ? null : draft.dueDate || null,
        dueMeter,
        equipment,
        expiresAt,
        intervalMode: draft.intervalMode,
        recurrenceUnit,
        recurrenceValue,
        serviceType: draft.serviceType,
        title: draft.title,
        userId,
      });

      setLibrary((current) => ({
        ...current,
        services: [result.service, ...current.services],
      }));
      setServiceCreationInputs((current) => ({
        ...current,
        [equipment.id]: defaultServiceCreationDraft(),
      }));
      setActiveServiceCreationId(null);

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushQueuedMutations();
        setMeterNotice(`${equipment.unitNumber} scheduled service synced.`);
      } else {
        setMeterNotice(`${equipment.unitNumber} scheduled service saved offline and queued to sync.`);
      }
    } catch (error) {
      setMeterError(error instanceof Error ? error.message : "Scheduled service was not saved.");
    } finally {
      setServiceCreationSavingId(null);
    }
  }

  function serviceCompletionDraftFor(equipmentId: string, activeServices: OfflineEquipmentServiceSummary[]) {
    return serviceCompletionInputs[equipmentId] ?? defaultServiceCompletionDraft(activeServices[0]?.id ?? "");
  }

  function updateServiceCompletionDraft(equipmentId: string, patch: Partial<ServiceCompletionDraft>) {
    setServiceCompletionInputs((current) => ({
      ...current,
      [equipmentId]: {
        ...defaultServiceCompletionDraft(),
        ...current[equipmentId],
        ...patch,
      },
    }));
  }

  async function submitServiceCompletion(equipment: OfflineEquipmentSummary, activeServices: OfflineEquipmentServiceSummary[]) {
    const draft = serviceCompletionDraftFor(equipment.id, activeServices);
    const service = activeServices.find((candidate) => candidate.id === draft.serviceId) ?? activeServices[0] ?? null;
    const rawMeter = draft.completedMeter.trim();
    const completedMeter = rawMeter ? Number(rawMeter) : null;

    setMeterNotice("");
    setMeterError("");

    if (!service) {
      setMeterError("Choose a scheduled service to complete.");
      return;
    }

    if (completedMeter !== null && (!Number.isFinite(completedMeter) || completedMeter < 0)) {
      setMeterError("Enter a valid completion meter reading.");
      return;
    }

    if (service.recurrenceUnit === "meter" && completedMeter === null) {
      setMeterError("Enter the completion meter reading for this recurring service.");
      return;
    }

    setServiceCompletionSavingId(equipment.id);

    try {
      const result = await queueOfflineScheduledServiceCompletion({
        completedMeter,
        equipment,
        expiresAt,
        service,
        userId,
      });

      setLibrary((current) => ({
        ...current,
        equipment: current.equipment.map((item) => (item.id === result.equipment.id ? result.equipment : item)),
        maintenance: result.maintenance ? [result.maintenance, ...current.maintenance] : current.maintenance,
        meterReadings: result.meterReading ? [result.meterReading, ...current.meterReadings] : current.meterReadings,
        services: current.services.map((item) => (item.id === result.service.id ? result.service : item)),
      }));
      setServiceCompletionInputs((current) => ({
        ...current,
        [equipment.id]: defaultServiceCompletionDraft(activeServices.find((item) => item.id !== service.id)?.id ?? ""),
      }));
      setActiveServiceCompletionId(null);

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushQueuedMutations();
        setMeterNotice(`${equipment.unitNumber} scheduled service completed and synced.`);
      } else {
        setMeterNotice(`${equipment.unitNumber} scheduled service completed offline and queued to sync.`);
      }
    } catch (error) {
      setMeterError(error instanceof Error ? error.message : "Scheduled service was not completed.");
    } finally {
      setServiceCompletionSavingId(null);
    }
  }

  async function submitSubmissionLink(equipment: OfflineEquipmentSummary) {
    const submissionId = submissionLinkInputs[equipment.id] ?? "";
    const submission = library.linkableSubmissions.find((candidate) => candidate.id === submissionId) ?? null;
    const linkedSubmissions = linkedSubmissionsByEquipmentId.get(equipment.id) ?? [];

    setMeterNotice("");
    setMeterError("");

    if (!submission) {
      setMeterError("Choose a submitted form to link.");
      return;
    }

    setSubmissionLinkSavingId(equipment.id);

    try {
      const result = await queueOfflineEquipmentSubmissionLink({
        equipment,
        expiresAt,
        linkedSubmissions,
        submission,
        userId,
      });

      setLibrary((current) => ({
        ...current,
        linkedSubmissions: [
          result.linkedSubmission,
          ...current.linkedSubmissions.filter((link) => link.id !== result.linkedSubmission.id),
        ],
      }));
      setSubmissionLinkInputs((current) => ({
        ...current,
        [equipment.id]: "",
      }));
      setActiveSubmissionLinkId(null);

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushQueuedMutations();
        setMeterNotice(`${equipment.unitNumber} form link synced.`);
      } else {
        setMeterNotice(`${equipment.unitNumber} form link saved offline and queued to sync.`);
      }
    } catch (error) {
      setMeterError(error instanceof Error ? error.message : "Submitted form was not linked.");
    } finally {
      setSubmissionLinkSavingId(null);
    }
  }

  async function submitSubmissionUnlink(link: OfflineEquipmentSubmissionSummary, equipment: OfflineEquipmentSummary) {
    setMeterNotice("");
    setMeterError("");
    setSubmissionUnlinkSavingId(link.id);

    try {
      await queueOfflineEquipmentSubmissionUnlink({ link, userId });

      setLibrary((current) => ({
        ...current,
        linkedSubmissions: current.linkedSubmissions.filter((candidate) => candidate.id !== link.id),
      }));

      if (typeof navigator !== "undefined" && navigator.onLine) {
        await flushQueuedMutations();
        setMeterNotice(`${equipment.unitNumber} form link removed.`);
      } else {
        setMeterNotice(`${equipment.unitNumber} form unlink saved offline and queued to sync.`);
      }
    } catch (error) {
      setMeterError(error instanceof Error ? error.message : "Submitted form link was not removed.");
    } finally {
      setSubmissionUnlinkSavingId(null);
    }
  }

  return (
    <section className="scroll-mt-5 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm" id="equipment">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--ink)]">Equipment</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {query || statusFilter !== "all" ? `${equipmentRows.length} matches` : `${library.equipment.length} units`}
          </p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
          <Truck className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-[var(--border)] bg-white p-3">
          <Truck className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{library.equipment.length}</p>
          <p className="text-xs text-[var(--ink-muted)]">Cached units</p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white p-3">
          <AlertTriangle className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{attentionCount}</p>
          <p className="text-xs text-[var(--ink-muted)]">Needs attention</p>
        </div>
        <div className="rounded-md border border-[var(--border)] bg-white p-3">
          <Wrench className="h-4 w-4 text-[var(--primary)]" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{downCount}</p>
          <p className="text-xs text-[var(--ink-muted)]">Down units</p>
        </div>
      </div>

      <form
        className="mt-4 grid gap-3 sm:grid-cols-[1fr_150px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <label className="relative block">
          <span className="sr-only">Search equipment</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ink-muted)]" aria-hidden="true" />
          <input
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white pl-9 pr-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Unit, serial, location"
            type="search"
            value={query}
          />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select
            className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
            onChange={(event) => setStatusFilter(event.target.value as EquipmentStatusFilter)}
            value={statusFilter}
          >
            <option value="all">All status</option>
            <option value="active">Active</option>
            <option value="down">Down</option>
          </select>
        </label>
        <button
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
          type="submit"
        >
          <Search className="h-4 w-4" aria-hidden="true" />
          Search
        </button>
      </form>

      {cacheReady ? (
        <p className="mt-3 inline-flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs font-semibold text-[var(--success)]">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Saved for offline
        </p>
      ) : null}
      {meterNotice ? (
        <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-[var(--success)]">{meterNotice}</p>
      ) : null}
      {meterError ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm font-semibold text-[var(--danger)]">{meterError}</p> : null}

      {equipmentRows.length > 0 ? (
        <div className="mt-4 divide-y divide-[var(--border)] rounded-md border border-[var(--border)] bg-white">
          {equipmentRows.map((row) => (
            <article className="grid gap-3 p-3 lg:grid-cols-[1fr_auto]" key={row.equipment.id}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate font-semibold text-[var(--ink)]">
                    {row.equipment.unitNumber}
                    {row.equipment.name ? `, ${row.equipment.name}` : ""}
                  </p>
                  <span className={`rounded-md px-2 py-1 text-xs font-semibold ${statusClass(row.equipment.status)}`}>
                    {formatEquipmentStatus(row.equipment.status)}
                  </span>
                  <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${equipmentDueStatusClass(row.serviceIndicator)}`}>
                    {dueDetail(row.serviceIndicator)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">
                  {formatEquipmentCategory(row.equipment.category)}
                  {row.equipment.make || row.equipment.model ? ` - ${[row.equipment.make, row.equipment.model].filter(Boolean).join(" ")}` : ""}
                </p>
                <div className="mt-3 grid gap-2 text-xs text-[var(--ink-muted)] sm:grid-cols-2">
                  <span className="inline-flex items-center gap-1">
                    <Gauge className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                    {formatEquipmentMeter({
                      trackingMode: row.equipment.trackingMode,
                      value: row.equipment.currentMeter,
                    })}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                    {row.equipment.status === "down" ? "No location while down" : row.locationName}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <UserRound className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                    {row.assigneeName}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                    {row.nextServiceLabel}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 lg:justify-end">
                <form
                  className="grid w-full gap-2 sm:grid-cols-[minmax(140px,1fr)_auto] lg:max-w-xs"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitMeterReading(row.equipment).catch(() => undefined);
                  }}
                >
                  <label>
                    <span className="sr-only">Meter reading for {row.equipment.unitNumber}</span>
                    <input
                      className="h-8 w-full rounded-md border border-[var(--border)] bg-white px-2 text-xs text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      inputMode="decimal"
                      min="0"
                      onChange={(event) =>
                        setMeterInputs((current) => ({
                          ...current,
                          [row.equipment.id]: event.target.value,
                        }))
                      }
                      placeholder={row.equipment.trackingMode === "hours" ? "Log hours" : "Log mileage"}
                      step="0.1"
                      type="number"
                      value={meterInputs[row.equipment.id] ?? ""}
                    />
                  </label>
                  <button
                    className="inline-flex h-8 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-3 text-xs font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={meterSavingId === row.equipment.id}
                    type="submit"
                  >
                    <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
                    {meterSavingId === row.equipment.id ? "Saving" : "Save"}
                  </button>
                </form>
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  onClick={() => setActiveAssignmentId((current) => (current === row.equipment.id ? null : row.equipment.id))}
                  type="button"
                >
                  <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                  Assign
                </button>
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  onClick={() => setActiveMaintenanceId((current) => (current === row.equipment.id ? null : row.equipment.id))}
                  type="button"
                >
                  <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                  Log Maintenance
                </button>
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={row.activeServices.length === 0}
                  onClick={() => setActiveServiceCompletionId((current) => (current === row.equipment.id ? null : row.equipment.id))}
                  type="button"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Complete Service
                </button>
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  onClick={() => setActiveServiceCreationId((current) => (current === row.equipment.id ? null : row.equipment.id))}
                  type="button"
                >
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  Add Service
                </button>
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  onClick={() => setActiveDocumentId((current) => (current === row.equipment.id ? null : row.equipment.id))}
                  type="button"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  Add Document
                </button>
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={linkableSubmissionsForEquipment(row.equipment.id).length === 0}
                  onClick={() => setActiveSubmissionLinkId((current) => (current === row.equipment.id ? null : row.equipment.id))}
                  type="button"
                >
                  <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Link Form
                </button>
                <button
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                  onClick={() =>
                    setExpandedEquipmentIds((current) => ({
                      ...current,
                      [row.equipment.id]: !current[row.equipment.id],
                    }))
                  }
                  type="button"
                >
                  {expandedEquipmentIds[row.equipment.id] ? (
                    <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                  Details
                </button>
                <span className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink-muted)]">
                  <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                  {row.activeServices.length} services
                </span>
                <span className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink-muted)]">
                  <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                  {row.expiringDocumentCount > 0 ? `${row.expiringDocumentCount} expiring` : `${row.documents.length} docs`}
                </span>
              </div>
              {activeAssignmentId === row.equipment.id ? (
                <form
                  className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:col-span-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitEquipmentAssignment(row.equipment).catch(() => undefined);
                  }}
                >
                  <div className="grid gap-3 md:grid-cols-3">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Status</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateAssignmentDraft(row.equipment, { status: event.target.value })}
                        value={assignmentDraftFor(row.equipment).status}
                      >
                        {equipmentStatusOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Assigned worker</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateAssignmentDraft(row.equipment, { assignedTo: event.target.value })}
                        value={assignmentDraftFor(row.equipment).assignedTo}
                      >
                        <option value="">Unassigned</option>
                        {library.assignees.map((assignee) => (
                          <option key={assignee.id} value={assignee.id}>
                            {assignee.fullName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Location</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-[var(--ink-muted)]"
                        disabled={assignmentDraftFor(row.equipment).status === "down"}
                        onChange={(event) => updateAssignmentDraft(row.equipment, { locationId: event.target.value })}
                        value={assignmentDraftFor(row.equipment).status === "down" ? "" : assignmentDraftFor(row.equipment).locationId}
                      >
                        <option value="">No location</option>
                        {library.locations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                            {location.code ? ` (${location.code})` : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {assignmentDraftFor(row.equipment).status === "down" ? (
                    <p className="rounded-md border border-[var(--border)] bg-white px-3 py-2 text-xs font-semibold text-[var(--ink-muted)]">
                      Down units cannot be assigned to a location.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={assignmentSavingId === row.equipment.id}
                      type="submit"
                    >
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                      {assignmentSavingId === row.equipment.id ? "Saving" : "Save Assignment"}
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      onClick={() => setActiveAssignmentId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {activeMaintenanceId === row.equipment.id ? (
                <form
                  className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:col-span-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitMaintenanceLog(row.equipment).catch(() => undefined);
                  }}
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_180px_160px]">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Maintenance details</span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateMaintenanceDraft(row.equipment.id, { title: event.target.value })}
                        placeholder="Replaced belt, checked leak"
                        value={maintenanceDraftFor(row.equipment.id).title}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Type</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateMaintenanceDraft(row.equipment.id, { type: event.target.value })}
                        value={maintenanceDraftFor(row.equipment.id).type}
                      >
                        {equipmentMaintenanceTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">
                        Meter ({row.equipment.trackingMode === "hours" ? "hours" : "mileage"})
                      </span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => updateMaintenanceDraft(row.equipment.id, { meterAtService: event.target.value })}
                        placeholder="Optional"
                        step="0.1"
                        type="number"
                        value={maintenanceDraftFor(row.equipment.id).meterAtService}
                      />
                    </label>
                  </div>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-[var(--ink)]">Notes</span>
                    <textarea
                      className="min-h-20 w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      onChange={(event) => updateMaintenanceDraft(row.equipment.id, { description: event.target.value })}
                      placeholder="Parts used, vendor, or follow-up needed"
                      value={maintenanceDraftFor(row.equipment.id).description}
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-[var(--ink)]">Receipts or photos</span>
                    <input
                      accept="application/pdf,image/heic,image/heif,image/jpeg,image/png,image/webp"
                      capture="environment"
                      className="block w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      multiple
                      onChange={(event) => {
                        const files = Array.from(event.currentTarget.files ?? []);
                        updateMaintenanceAttachments(row.equipment.id, files).catch((error) => {
                          setMeterError(error instanceof Error ? error.message : "Maintenance attachment could not be read.");
                        });
                      }}
                      type="file"
                    />
                  </label>
                  {(maintenanceAttachments[row.equipment.id]?.length ?? 0) > 0 ? (
                    <p className="text-xs font-semibold text-[var(--ink-muted)]">
                      {maintenanceAttachments[row.equipment.id].length} attachment
                      {maintenanceAttachments[row.equipment.id].length === 1 ? "" : "s"} ready
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={maintenanceSavingId === row.equipment.id}
                      type="submit"
                    >
                      <Wrench className="h-4 w-4" aria-hidden="true" />
                      {maintenanceSavingId === row.equipment.id ? "Saving" : "Save Maintenance"}
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      onClick={() => setActiveMaintenanceId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {activeServiceCreationId === row.equipment.id ? (
                <form
                  className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:col-span-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitServiceCreation(row.equipment).catch(() => undefined);
                  }}
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_180px_160px]">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Service title</span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateServiceCreationDraft(row.equipment.id, { title: event.target.value })}
                        placeholder="Oil change, annual inspection"
                        value={serviceCreationDraftFor(row.equipment.id).title}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Type</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateServiceCreationDraft(row.equipment.id, { serviceType: event.target.value })}
                        value={serviceCreationDraftFor(row.equipment.id).serviceType}
                      >
                        {equipmentServiceTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Interval</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateServiceCreationDraft(row.equipment.id, { intervalMode: event.target.value })}
                        value={serviceCreationDraftFor(row.equipment.id).intervalMode}
                      >
                        {equipmentIntervalModeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Due date</span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-[var(--ink-muted)]"
                        disabled={serviceCreationDraftFor(row.equipment.id).intervalMode === "by_meter"}
                        onChange={(event) => updateServiceCreationDraft(row.equipment.id, { dueDate: event.target.value })}
                        type="date"
                        value={
                          serviceCreationDraftFor(row.equipment.id).intervalMode === "by_meter"
                            ? ""
                            : serviceCreationDraftFor(row.equipment.id).dueDate
                        }
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">
                        Due meter ({row.equipment.trackingMode === "hours" ? "hours" : "mileage"})
                      </span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-[var(--surface-muted)] disabled:text-[var(--ink-muted)]"
                        disabled={serviceCreationDraftFor(row.equipment.id).intervalMode === "by_date"}
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => updateServiceCreationDraft(row.equipment.id, { dueMeter: event.target.value })}
                        placeholder="Meter value"
                        step="0.1"
                        type="number"
                        value={
                          serviceCreationDraftFor(row.equipment.id).intervalMode === "by_date"
                            ? ""
                            : serviceCreationDraftFor(row.equipment.id).dueMeter
                        }
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Recurrence interval</span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        inputMode="numeric"
                        min="1"
                        onChange={(event) => updateServiceCreationDraft(row.equipment.id, { recurrenceValue: event.target.value })}
                        placeholder="Optional"
                        step="1"
                        type="number"
                        value={serviceCreationDraftFor(row.equipment.id).recurrenceValue}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Recurrence unit</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateServiceCreationDraft(row.equipment.id, { recurrenceUnit: event.target.value })}
                        value={serviceCreationDraftFor(row.equipment.id).recurrenceUnit}
                      >
                        <option value="">One-time</option>
                        <option value="meter">{row.equipment.trackingMode === "hours" ? "Hours" : "Mileage"}</option>
                        <option value="days">Days</option>
                        <option value="months">Months</option>
                      </select>
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={serviceCreationSavingId === row.equipment.id}
                      type="submit"
                    >
                      <CalendarDays className="h-4 w-4" aria-hidden="true" />
                      {serviceCreationSavingId === row.equipment.id ? "Saving" : "Save Service"}
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      onClick={() => setActiveServiceCreationId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {activeDocumentId === row.equipment.id ? (
                <form
                  className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:col-span-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitEquipmentDocument(row.equipment).catch(() => undefined);
                  }}
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_180px_160px]">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Document title</span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateDocumentDraft(row.equipment.id, { title: event.target.value })}
                        placeholder="Registration, insurance, permit"
                        value={documentDraftFor(row.equipment.id).title}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Type</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateDocumentDraft(row.equipment.id, { docType: event.target.value })}
                        value={documentDraftFor(row.equipment.id).docType}
                      >
                        {equipmentDocumentTypeOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Reminder days</span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        inputMode="numeric"
                        min="0"
                        onChange={(event) => updateDocumentDraft(row.equipment.id, { reminderLeadDays: event.target.value })}
                        step="1"
                        type="number"
                        value={documentDraftFor(row.equipment.id).reminderLeadDays}
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Issued on</span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateDocumentDraft(row.equipment.id, { issuedDate: event.target.value })}
                        type="date"
                        value={documentDraftFor(row.equipment.id).issuedDate}
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Expires on</span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateDocumentDraft(row.equipment.id, { expiryDate: event.target.value })}
                        required
                        type="date"
                        value={documentDraftFor(row.equipment.id).expiryDate}
                      />
                    </label>
                  </div>
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-[var(--ink)]">Scan or photo</span>
                    <input
                      accept="application/pdf,image/heic,image/heif,image/jpeg,image/png,image/webp"
                      capture="environment"
                      className="block w-full rounded-md border border-[var(--border)] bg-white px-3 py-2 text-sm text-[var(--ink)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-1 file:text-sm file:font-semibold file:text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      multiple
                      onChange={(event) => {
                        const files = Array.from(event.currentTarget.files ?? []);
                        updateDocumentAttachments(row.equipment.id, files).catch((error) => {
                          setMeterError(error instanceof Error ? error.message : "Document attachment could not be read.");
                        });
                      }}
                      type="file"
                    />
                  </label>
                  {(documentAttachments[row.equipment.id]?.length ?? 0) > 0 ? (
                    <p className="text-xs font-semibold text-[var(--ink-muted)]">
                      {documentAttachments[row.equipment.id].length} attachment
                      {documentAttachments[row.equipment.id].length === 1 ? "" : "s"} ready
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={documentSavingId === row.equipment.id}
                      type="submit"
                    >
                      <FileText className="h-4 w-4" aria-hidden="true" />
                      {documentSavingId === row.equipment.id ? "Saving" : "Save Document"}
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      onClick={() => setActiveDocumentId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {activeSubmissionLinkId === row.equipment.id ? (
                <form
                  className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:col-span-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitSubmissionLink(row.equipment).catch(() => undefined);
                  }}
                >
                  <label className="space-y-1">
                    <span className="text-xs font-semibold text-[var(--ink)]">Submitted form</span>
                    <select
                      className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      disabled={linkableSubmissionsForEquipment(row.equipment.id).length === 0}
                      onChange={(event) =>
                        setSubmissionLinkInputs((current) => ({
                          ...current,
                          [row.equipment.id]: event.target.value,
                        }))
                      }
                      required
                      value={submissionLinkInputs[row.equipment.id] ?? ""}
                    >
                      <option value="">
                        {linkableSubmissionsForEquipment(row.equipment.id).length === 0 ? "No unlinked forms" : "Choose a form"}
                      </option>
                      {linkableSubmissionsForEquipment(row.equipment.id).map((submission) => (
                        <option key={submission.id} value={submission.id}>
                          {submission.formName} - {formatDateTime(submission.submittedAt)}
                          {submission.locationName ? ` - ${submission.locationName}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={submissionLinkSavingId === row.equipment.id || linkableSubmissionsForEquipment(row.equipment.id).length === 0}
                      type="submit"
                    >
                      <Link2 className="h-4 w-4" aria-hidden="true" />
                      {submissionLinkSavingId === row.equipment.id ? "Saving" : "Link Form"}
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      onClick={() => setActiveSubmissionLinkId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
              {expandedEquipmentIds[row.equipment.id] ? (
                <div className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:col-span-2 xl:grid-cols-2">
                  <div className="rounded-md border border-[var(--border)] bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--ink)]">Service Schedule</h3>
                      <span className="text-xs font-semibold text-[var(--ink-muted)]">{row.activeServices.length}</span>
                    </div>
                    {row.activeServices.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {row.activeServices.map((service) => {
                          const status = getEquipmentScheduleStatus(
                            {
                              dueDate: service.dueDate,
                              dueMeter: service.dueMeter,
                              intervalMode: service.intervalMode,
                              isActive: service.isActive,
                            },
                            row.equipment.currentMeter,
                          );

                          return (
                            <div className="rounded-md border border-[var(--border)] p-3" key={service.id}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-[var(--ink)]">{service.title}</p>
                                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${equipmentDueStatusClass(status)}`}>
                                  {formatEquipmentDueDetail(status)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                {optionLabel(equipmentServiceTypeOptions, service.serviceType)} / {serviceDueLine(service)}
                              </p>
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">{recurrenceLine(service)}</p>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
                        No scheduled service.
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-[var(--border)] bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--ink)]">Documents</h3>
                      <span className="text-xs font-semibold text-[var(--ink-muted)]">{row.documents.length}</span>
                    </div>
                    {row.documents.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {row.documents.map((document) => {
                          const status = getOfflineEquipmentDocumentStatus(document);

                          return (
                            <div className="rounded-md border border-[var(--border)] p-3" key={document.id}>
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="text-sm font-semibold text-[var(--ink)]">{document.title}</p>
                                <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${equipmentDueStatusClass(status)}`}>
                                  {formatEquipmentDueDetail(status)}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                {optionLabel(equipmentDocumentTypeOptions, document.docType)} / Expires {formatDate(document.expiryDate)}
                              </p>
                              {document.attachmentIds.length > 0 ? (
                                <div className="mt-2 flex flex-wrap gap-2">
                                  {document.attachmentIds.map((path, index) => {
                                    const url = document.attachmentUrls[path];
                                    const label = attachmentLabel(path, index);

                                    return url ? (
                                      <a
                                        className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                        href={url}
                                        key={path}
                                        rel="noreferrer"
                                        target="_blank"
                                      >
                                        <Paperclip className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                                        {label}
                                      </a>
                                    ) : (
                                      <span
                                        className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 text-xs font-semibold text-[var(--ink-muted)]"
                                        key={path}
                                      >
                                        <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                        {label}
                                      </span>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
                        No tracked documents.
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-[var(--border)] bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--ink)]">Maintenance History</h3>
                      <span className="text-xs font-semibold text-[var(--ink-muted)]">{row.maintenance.length}</span>
                    </div>
                    {row.maintenance.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {row.maintenance.slice(0, 5).map((entry) => (
                          <div className="rounded-md border border-[var(--border)] p-3" key={entry.id}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-[var(--ink)]">{entry.title}</p>
                              <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                                {formatDate(entry.performedAt)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--ink-muted)]">
                              {optionLabel(equipmentMaintenanceTypeOptions, entry.type)}
                              {typeof entry.meterAtService === "number"
                                ? ` / ${formatEquipmentMeter({
                                    trackingMode: row.equipment.trackingMode,
                                    value: entry.meterAtService,
                                  })}`
                                : ""}
                              {entry.vendor ? ` / ${entry.vendor}` : ""}
                              {entry.attachmentIds.length > 0
                                ? ` / ${entry.attachmentIds.length} attachment${entry.attachmentIds.length === 1 ? "" : "s"}`
                                : ""}
                            </p>
                            {entry.description ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{entry.description}</p> : null}
                            {entry.attachmentIds.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {entry.attachmentIds.map((path, index) => {
                                  const url = entry.attachmentUrls[path];
                                  const label = attachmentLabel(path, index);

                                  return url ? (
                                    <a
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                      href={url}
                                      key={path}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      <Paperclip className="h-3.5 w-3.5 text-[var(--primary)]" aria-hidden="true" />
                                      {label}
                                    </a>
                                  ) : (
                                    <span
                                      className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] px-2 text-xs font-semibold text-[var(--ink-muted)]"
                                      key={path}
                                    >
                                      <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                      {label}
                                    </span>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
                        No maintenance logged.
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-[var(--border)] bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--ink)]">Meter History</h3>
                      <span className="text-xs font-semibold text-[var(--ink-muted)]">{row.meterReadings.length}</span>
                    </div>
                    {row.meterReadings.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {row.meterReadings.slice(0, 5).map((reading) => (
                          <div className="rounded-md border border-[var(--border)] p-3" key={reading.id}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm font-semibold text-[var(--ink)]">
                                {formatEquipmentMeter({
                                  trackingMode: row.equipment.trackingMode,
                                  value: reading.value,
                                })}
                              </p>
                              <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                                {meterSourceLabel(reading.source)}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--ink-muted)]">{formatDate(reading.recordedAt)}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
                        No meter history.
                      </p>
                    )}
                  </div>
                  <div className="rounded-md border border-[var(--border)] bg-white p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--ink)]">Inspections and Forms</h3>
                      <span className="text-xs font-semibold text-[var(--ink-muted)]">{row.linkedSubmissions.length}</span>
                    </div>
                    {row.linkedSubmissions.length > 0 ? (
                      <div className="mt-3 grid gap-2">
                        {row.linkedSubmissions.slice(0, 5).map((submission) => (
                          <div className="rounded-md border border-[var(--border)] p-3" key={submission.id}>
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold text-[var(--ink)]">{submission.formName}</p>
                                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                                  {submission.formCode ?? submission.formType ?? "Submitted form"}
                                </p>
                              </div>
                              <span className="rounded-md bg-[var(--surface-muted)] px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">
                                {submission.linkSource === "auto" ? "Auto" : "Manual"}
                              </span>
                            </div>
                            <p className="mt-2 text-xs text-[var(--ink-muted)]">
                              {formatDateTime(submission.submittedAt ?? submission.linkedAt)}
                              {submission.submitterName ? ` / ${submission.submitterName}` : ""}
                              {submission.locationName ? ` / ${submission.locationName}` : ""}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <a
                                className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                                href={`/admin/monitor/${submission.submissionId}/print`}
                              >
                                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                                Open Form
                              </a>
                              <button
                                className="inline-flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-2 text-xs font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)] disabled:cursor-not-allowed disabled:opacity-60"
                                disabled={submissionUnlinkSavingId === submission.id}
                                onClick={() => submitSubmissionUnlink(submission, row.equipment).catch(() => undefined)}
                                type="button"
                              >
                                <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                                {submissionUnlinkSavingId === submission.id ? "Removing" : "Unlink"}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-3 rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--ink-muted)]">
                        No linked inspections or forms.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
              {activeServiceCompletionId === row.equipment.id ? (
                <form
                  className="grid gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 lg:col-span-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitServiceCompletion(row.equipment, row.activeServices).catch(() => undefined);
                  }}
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">Scheduled service</span>
                      <select
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        onChange={(event) => updateServiceCompletionDraft(row.equipment.id, { serviceId: event.target.value })}
                        value={serviceCompletionDraftFor(row.equipment.id, row.activeServices).serviceId}
                      >
                        {row.activeServices.map((service) => (
                          <option key={service.id} value={service.id}>
                            {service.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="space-y-1">
                      <span className="text-xs font-semibold text-[var(--ink)]">
                        Meter ({row.equipment.trackingMode === "hours" ? "hours" : "mileage"})
                      </span>
                      <input
                        className="h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                        inputMode="decimal"
                        min="0"
                        onChange={(event) => updateServiceCompletionDraft(row.equipment.id, { completedMeter: event.target.value })}
                        placeholder="Required for meter recurrence"
                        step="0.1"
                        type="number"
                        value={serviceCompletionDraftFor(row.equipment.id, row.activeServices).completedMeter}
                      />
                    </label>
                  </div>
                  <p className="text-xs text-[var(--ink-muted)]">
                    Completing a service files it in maintenance history and advances the next due value when recurrence is configured.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:bg-[var(--primary-dark)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={serviceCompletionSavingId === row.equipment.id || row.activeServices.length === 0}
                      type="submit"
                    >
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {serviceCompletionSavingId === row.equipment.id ? "Saving" : "Complete Service"}
                    </button>
                    <button
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-[var(--border)] bg-white px-4 text-sm font-semibold text-[var(--ink-muted)] transition hover:border-[var(--primary)] hover:text-[var(--primary)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2"
                      onClick={() => setActiveServiceCompletionId(null)}
                      type="button"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--ink-muted)]">
          No equipment found.
        </div>
      )}
    </section>
  );
}
