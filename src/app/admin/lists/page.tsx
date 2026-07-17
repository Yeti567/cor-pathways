import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { ListManagerClient } from "./ListManagerClient";

export const dynamic = "force-dynamic";

type ManagedListsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ManagedListsPage({ searchParams }: ManagedListsPageProps) {
  const [params, context] = await Promise.all([searchParams, requireAppUser()]);

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  return (
    <AdminShell eyebrow="Form setup" tenantName={context.tenant?.name ?? "Company profile"} title="Managed Lists">
      <ListManagerClient initialListId={firstParam(params.listId) ?? null} />
    </AdminShell>
  );
}
