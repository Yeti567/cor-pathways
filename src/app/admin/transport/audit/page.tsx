import { redirect } from "next/navigation";

// COR audit readiness now lives in its own module at /admin/cor (toggle in Setup).
// This route is retired and forwards there so existing links keep working.
export const dynamic = "force-dynamic";

export default function RetiredTransportAuditPage() {
  redirect("/admin/cor");
}
