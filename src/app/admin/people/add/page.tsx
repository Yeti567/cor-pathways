import { redirect } from "next/navigation";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { AddPeopleWizard } from "@/app/admin/people/add/AddPeopleWizard";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Add Your People: the client's own staff list in, accounts out, no invitations sent.
// See src/lib/people-intake.ts for why it reads their list rather than our template.

export const dynamic = "force-dynamic";

export default async function AddPeoplePage() {
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  const supabase = await createSupabaseServerClient();
  const { data: users } = await supabase
    .from("users")
    .select("email")
    .eq("tenant_id", context.appUser.tenant_id)
    .limit(5000)
    .returns<{ email: string | null }[]>();

  return (
    <AdminShell eyebrow="Onboarding" tenantName={context.tenant?.name ?? "Company profile"} title="Add your people">
      <p className="mb-4 max-w-2xl text-sm text-[var(--ink-muted)]">
        Give us the staff list you already have. We&rsquo;ll work out who&rsquo;s who, you check it, and they&rsquo;re added.
        Nobody gets an email until you choose to send the invitations.
      </p>
      <AddPeopleWizard existingEmails={(users ?? []).map((user) => user.email ?? "").filter(Boolean)} />
    </AdminShell>
  );
}
