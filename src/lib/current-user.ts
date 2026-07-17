import { cache } from "react";
import { redirect } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type TenantRow = Database["public"]["Tables"]["tenants"]["Row"];
export type AppUserRow = Database["public"]["Tables"]["users"]["Row"];
export type ConsultantRow = Database["public"]["Tables"]["consultants"]["Row"];
export type PermissionProfileRow = Database["public"]["Tables"]["permission_profiles"]["Row"];

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
    redirect("/choose");
  }

  return context;
}

