import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];
export type AppUserRow = Database["public"]["Tables"]["users"]["Row"];
export type ConsultantRow = Database["public"]["Tables"]["consultants"]["Row"];
export type PermissionProfileRow = Database["public"]["Tables"]["permission_profiles"]["Row"];
export type SubcontractorUserRow = Database["public"]["Tables"]["subcontractor_user"]["Row"];
export type SubcontractorUserAccessRow = Database["public"]["Tables"]["subcontractor_user_access"]["Row"];

export type CurrentUserContext =
  | {
      status: "signed_out";
      authUser: null;
      appUser: null;
      consultant: null;
      tenant: null;
      permissionProfile: null;
    }
  | {
      status: "app_user";
      authUser: User;
      appUser: AppUserRow;
      consultant: null;
      tenant: TenantRow | null;
      permissionProfile: PermissionProfileRow | null;
    }
  | {
      status: "consultant";
      authUser: User;
      appUser: null;
      consultant: ConsultantRow;
      tenant: null;
      permissionProfile: null;
    }
  // A person at a hired carrier. Deliberately carries no tenant and no permission
  // profile: they are not staff anywhere, and anything that reads `tenant` to decide
  // what a signed-in person may do must see nothing rather than something plausible.
  | {
      status: "subcontractor_user";
      authUser: User;
      appUser: null;
      consultant: null;
      subcontractorUser: SubcontractorUserRow;
      access: SubcontractorUserAccessRow[];
      tenant: null;
      permissionProfile: null;
    }
  | {
      status: "profile_pending";
      authUser: User;
      appUser: null;
      consultant: null;
      tenant: null;
      permissionProfile: null;
    };

export const getCurrentUserContext = cache(async function getCurrentUserContext(): Promise<CurrentUserContext> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      status: "signed_out",
      authUser: null,
      appUser: null,
      consultant: null,
      tenant: null,
      permissionProfile: null,
    };
  }

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<AppUserRow>();

  if (appUserError) {
    throw appUserError;
  }

  if (appUser) {
    const [{ data: tenant }, { data: permissionProfile }] = await Promise.all([
      supabase
        .from("tenants")
        .select("*")
        .eq("id", appUser.tenant_id)
        .maybeSingle<TenantRow>(),
      appUser.permission_profile_id
        ? supabase
            .from("permission_profiles")
            .select("*")
            .eq("id", appUser.permission_profile_id)
            .maybeSingle<PermissionProfileRow>()
        : Promise.resolve({ data: null }),
    ]);

    return {
      status: "app_user",
      authUser: user,
      appUser,
      consultant: null,
      tenant: tenant ?? null,
      permissionProfile: permissionProfile ?? null,
    };
  }

  const { data: consultant, error: consultantError } = await supabase
    .from("consultants")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<ConsultantRow>();

  if (consultantError) {
    throw consultantError;
  }

  if (consultant) {
    return {
      status: "consultant",
      authUser: user,
      appUser: null,
      consultant,
      tenant: null,
      permissionProfile: null,
    };
  }

  // Checked last, and only once the caller has failed to be staff or a consultant. The
  // order matters: a person must never be able to become a carrier login by also holding
  // a row here, and reaching this branch at all means every other identity came back
  // empty.
  const { data: subcontractorUser, error: subcontractorUserError } = await supabase
    .from("subcontractor_user")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<SubcontractorUserRow>();

  if (subcontractorUserError) {
    throw subcontractorUserError;
  }

  if (subcontractorUser) {
    const { data: access } = await supabase
      .from("subcontractor_user_access")
      .select("*")
      .eq("subcontractor_user_id", user.id)
      .eq("allowed", true)
      .returns<SubcontractorUserAccessRow[]>();

    return {
      status: "subcontractor_user",
      authUser: user,
      appUser: null,
      consultant: null,
      subcontractorUser,
      access: access ?? [],
      tenant: null,
      permissionProfile: null,
    };
  }

  return {
    status: "profile_pending",
    authUser: user,
    appUser: null,
    consultant: null,
    tenant: null,
    permissionProfile: null,
  };
});

export async function requireCurrentUser() {
  const context = await getCurrentUserContext();

  if (context.status === "signed_out") {
    redirect("/login");
  }

  // Email verification must be completed before any gated route is reachable.
  // OAuth/SSO accounts are confirmed by their provider (email_confirmed_at set).
  if (context.authUser && !context.authUser.email_confirmed_at) {
    redirect("/verify-email");
  }

  return context;
}

export async function requireAppUser() {
  const context = await requireCurrentUser();

  if (context.status !== "app_user") {
    // A carrier login has no business anywhere in the staff app, and bouncing them to
    // /choose would just show them a menu of doors they cannot open. Send them home.
    if (context.status === "subcontractor_user") {
      redirect("/sub");
    }

    redirect("/choose");
  }

  return context;
}

/**
 * Gate for the carrier portal.
 *
 * The mirror image of requireAppUser: staff and consultants are sent back to their own
 * surface rather than being shown a carrier's checklist. A portal login with no live
 * access rows has been revoked, so it is signed out to /choose rather than left looking
 * at an empty page it cannot act on.
 */
export async function requireSubcontractorUser() {
  const context = await requireCurrentUser();

  if (context.status !== "subcontractor_user") {
    redirect("/choose");
  }

  if (context.access.length === 0) {
    redirect("/choose");
  }

  return context;
}

