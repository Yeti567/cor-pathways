import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readSource("src/app/admin/actions.ts");

const actionGroups = [
  {
    guard: "requireFormManager",
    actions: [
      "createFormTemplate",
      "deleteFormTemplate",
      "updateFormTemplateSettings",
      "createManagedList",
      "updateManagedList",
      "deleteManagedList",
      "createManagedListItem",
      "updateManagedListItem",
      "deleteManagedListItem",
      "createFormSection",
      "createFormItem",
      "duplicateFormSection",
      "duplicateFormItem",
      "moveFormSection",
      "moveFormItem",
      "updateFormSection",
      "deleteFormSection",
      "updateFormItem",
      "updateFormItemLabelSetting",
      "deleteFormItem",
      "createFormFromDetectedText",
      "createFormFromUploadedForm",
      "createFormFromReviewedFields",
      "scanUploadedFormForReview",
      "updateCorSetting",
      "updateCorCertifyingPartner",
      "updateChangeOrdersSetting",
      "updateDailyInspectionSetting",
      "updateTradesSetting",
      "updateTradesLaborRate",
      "updateGcSetting",
      "updateInventorySetting",
      "createGcProject",
      "createRfi",
      "updateRfi",
      "updateCountrySetting",
      "updateEmrSetting",
      "createTradeCustomer",
      "addTradeServiceAddress",
      "createTradeWorkOrder",
      "updateTradeWorkOrder",
      "createPriceBookItem",
      "addTradeWorkOrderLine",
      "removeTradeWorkOrderLine",
      "createInvoiceFromWorkOrder",
      "updateTradeInvoice",
      "createServiceAgreement",
      "updateServiceAgreement",
      "createChecklistTemplate",
      "addChecklistTemplateItem",
      "removeChecklistTemplateItem",
      "applyChecklistTemplateToWorkOrder",
      "addWorkOrderTask",
      "removeWorkOrderTask",
    ],
  },
  {
    guard: "requireDocumentManager",
    actions: [
      "updateDocumentControlSetting",
      "updateDocumentControlNumberingSettings",
      "createResourceSection",
      "updateResourceSection",
      "moveResourceSection",
      "moveResource",
      "assignResourceSection",
      "uploadControlledDocument",
      "updateResourceCorSettings",
      "markResourceReviewed",
      "approveControlledDocument",
      "requestControlledDocumentRevision",
    ],
  },
  {
    guard: "requireAccessManager",
    actions: [
      "updateUserAccess",
      "createPermissionProfile",
      "updateConsultantRevocation",
      "updateWorkerAccess",
      "updateWorkerLocations",
    ],
  },
  { guard: "requireFollowUpManager", actions: ["updateFollowUp"] },
  {
    guard: "requireWorkflowManager",
    actions: [
      "createWorkflow",
      "updateWorkflowEnabled",
      "createWorkflowStep",
      "createWorkflowCondition",
      "createSchedule",
      "updateScheduledTaskStatus",
      "sendOverdueWorkReminders",
    ],
  },
  {
    guard: "requireAutoShareManager",
    actions: [
      "createAutoShareRecipient",
      "setAutoShareRecipientActive",
      "processQueuedAutoShareEmails",
      "retryAutoShareEmailNotification",
    ],
  },
  {
    guard: "requireTransportManager",
    actions: [
      "updateTransportSetting",
      "updateMaintenanceContact",
      "updateTransportSafetyFitness",
      "createTransportDriver",
      "uploadTransportDocument",
      "uploadTransportCompanyDocument",
      "archiveTransportDocument",
      "addDutyStatusEvent",
      "addDailyTimeRecord",
      "saveDutyLogSegments",
      "updateDriverHosCycle",
      "updateDriverHosRegime",
      "deleteDutyStatusEvent",
      "connectEldProvider",
      "disconnectEldProvider",
      "syncMotiveNow",
    ],
  },
  {
    guard: "requireMedicalVaultManager",
    actions: ["uploadMedicalVaultRecord", "archiveMedicalVaultRecord"],
  },
  { guard: "requireSettingsManager", actions: ["updateCompanySettings", "updatePrintSettings"] },
  {
    guard: "requireEquipmentManager",
    actions: [
      "createEquipment",
      "updateEquipment",
      "uploadEquipmentPhotos",
      "createEquipmentMeterReading",
      "createEquipmentMaintenanceLog",
      "createEquipmentScheduledService",
      "completeEquipmentScheduledService",
      "createEquipmentDocument",
      "createManualEquipmentSubmissionLink",
      "deleteEquipmentSubmissionLink",
    ],
  },
  { guard: "requireLocationManager", actions: ["createLocation", "updateLocation"] },
  { guard: "requireVisitorManager", actions: ["createVisitor", "signOutVisitor"] },
  {
    guard: "requireWorkerManager",
    actions: [
      "createWorker",
      "importWorkersFromCsv",
      "updateWorkerProfile",
      "createCertificationType",
      "deleteCertificationType",
      "createWorkerCertification",
      "deleteWorkerCertification",
    ],
  },
] as const;

const consultantSessionActions = ["requestConsultantOverride"] as const;

function readSource(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function actionBody(name: string) {
  const marker = `export async function ${name}`;
  const start = adminActions.indexOf(marker);
  expect(start, `${name} should be exported`).toBeGreaterThanOrEqual(0);

  const next = adminActions.indexOf("\nexport async function ", start + marker.length);

  return adminActions.slice(start, next === -1 ? adminActions.length : next);
}

function exportedAdminActionNames() {
  return [...adminActions.matchAll(/^export async function ([A-Za-z0-9_]+)/gm)].map((match) => match[1]);
}

describe("access permission matrix", () => {
  it("keeps every exported admin action in a reviewed permission group", () => {
    const reviewed = [
      ...actionGroups.flatMap((group) => group.actions),
      ...consultantSessionActions,
    ];

    expect([...reviewed].sort()).toEqual(exportedAdminActionNames().sort());
  });

  it("keeps admin action groups behind their expected server guard", () => {
    for (const group of actionGroups) {
      for (const action of group.actions) {
        expect(actionBody(action), `${action} should call ${group.guard}`).toContain(`await ${group.guard}()`);
      }
    }
  });

  it("keeps consultant override requests scoped to consultant sessions", () => {
    const body = actionBody("requestConsultantOverride");

    expect(body).toContain("await requireCurrentUser()");
    expect(body).toContain('context.status !== "consultant"');
    expect(body).toContain('redirect("/choose")');
  });

  it("keeps monitor and report pages behind the desktop monitor gate", () => {
    for (const path of [
      "src/app/admin/analytics/page.tsx",
      "src/app/admin/analytics/drilldown/page.tsx",
      "src/app/admin/analytics/export/route.ts",
      "src/app/admin/follow-ups/page.tsx",
      "src/app/admin/incidents/page.tsx",
      "src/app/admin/monitor/page.tsx",
      "src/app/admin/monitor/[submissionId]/print/page.tsx",
      "src/app/admin/reports/page.tsx",
      "src/app/admin/reports/export/route.ts",
    ]) {
      expect(readSource(path), `${path} should use canUseDesktopMonitor`).toContain("canUseDesktopMonitor");
    }
  });

  it("keeps administration pages behind the admin panel gate", () => {
    for (const path of [
      "src/app/admin/access/page.tsx",
      "src/app/admin/auto-share/page.tsx",
      "src/app/admin/certification-types/page.tsx",
      "src/app/admin/consultant-access/page.tsx",
      "src/app/admin/documents/page.tsx",
      "src/app/admin/equipment/page.tsx",
      "src/app/admin/equipment/[equipmentId]/page.tsx",
      "src/app/admin/forms/page.tsx",
      "src/app/admin/forms/[formId]/page.tsx",
      "src/app/admin/forms/[formId]/preview/page.tsx",
      "src/app/admin/lists/page.tsx",
      "src/app/admin/locations/page.tsx",
      "src/app/admin/page.tsx",
      "src/app/admin/permission-profiles/page.tsx",
      "src/app/admin/settings/page.tsx",
      "src/app/admin/setup/page.tsx",
      "src/app/admin/transport/page.tsx",
      "src/app/admin/transport/fleet/page.tsx",
      "src/app/admin/transport/hos/page.tsx",
      "src/app/admin/transport/connections/page.tsx",
      "src/app/admin/transport/drivers/page.tsx",
      "src/app/admin/transport/drivers/[driverId]/page.tsx",
      "src/app/admin/visitors/page.tsx",
      "src/app/admin/visitors/roster/export/route.ts",
      "src/app/admin/visitors/roster/page.tsx",
      "src/app/admin/worker-tickets/page.tsx",
      "src/app/admin/workers/import-template/route.ts",
      "src/app/admin/workers/page.tsx",
      "src/app/admin/workers/[userId]/page.tsx",
      "src/app/admin/workflows/page.tsx",
      "src/app/admin/workflows/[runId]/page.tsx",
    ]) {
      expect(readSource(path), `${path} should use canUseAdminPanel`).toContain("canUseAdminPanel");
    }
  });

  it("shows disabled access-management controls when the viewer cannot edit access", () => {
    const accessPage = readSource("src/app/admin/access/page.tsx");
    const permissionProfilesPage = readSource("src/app/admin/permission-profiles/page.tsx");
    const workerDetailPage = readSource("src/app/admin/workers/[userId]/page.tsx");
    const consultantAccessPage = readSource("src/app/admin/consultant-access/page.tsx");

    expect(accessPage).toContain("const canEdit = canManageAccess(context.appUser)");
    expect(accessPage).toContain("disabled={!canEdit}");
    expect(permissionProfilesPage).toContain("const canEdit = canManageAccess(context.appUser)");
    expect(permissionProfilesPage).toContain("disabled={!canEdit}");
    expect(workerDetailPage).toContain("const canEditAccess = canManageAccess(context.appUser)");
    expect(workerDetailPage).toContain("<fieldset disabled={!canEditAccess}");
    expect(workerDetailPage).toContain("Access management permission is required to change assigned locations.");
    expect(consultantAccessPage).toContain(
      'const canEdit = canManageAccess(context.appUser) && context.appUser.power_level === "super_admin"',
    );
    expect(consultantAccessPage).toContain("disabled={!canEdit}");
  });
});
