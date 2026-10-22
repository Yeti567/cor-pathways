import type { MaintenanceWorkOrderPriority, MaintenanceWorkOrderStatus } from "@/types/database";
import { maintenanceStatuses, priorityLabel } from "@/lib/maintenance";

// Shared pieces for the maintenance pages. The form classes are the purchasing module's,
// so every operations screen looks the same.
export {
  checkboxClass,
  dangerButtonClass,
  firstParam,
  Flash,
  inputClass,
  labelClass,
  labelTextClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionClass,
  textareaClass,
} from "@/app/admin/purchasing/_components/PurchasingChrome";

const toneClass = {
  danger: "bg-red-50 text-[var(--danger)]",
  info: "bg-sky-50 text-[var(--primary)]",
  neutral: "bg-[var(--surface-muted)] text-[var(--ink-muted)]",
  success: "bg-emerald-50 text-[var(--success)]",
  warn: "bg-amber-50 text-[var(--warning)]",
} as const;

export function WorkOrderStatusBadge({ status }: { status: MaintenanceWorkOrderStatus }) {
  const meta = maintenanceStatuses[status];
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${toneClass[meta.tone]}`}>{meta.label}</span>
  );
}

export function PriorityBadge({ priority }: { priority: MaintenanceWorkOrderPriority }) {
  const tone =
    priority === "urgent" ? toneClass.danger : priority === "high" ? toneClass.warn : priority === "low" ? toneClass.neutral : toneClass.info;

  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>{priorityLabel(priority)}</span>;
}
