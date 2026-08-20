// Worker accounts and worker invitations, which are two separate acts.
//
// ENTERING A WORKER SENDS NOTHING. `createWorkerAccount` makes the auth account
// and stops there. The company sends invitations from the admin panel when the
// people are actually ready for them, which on a roster load is days or weeks
// after the names go in. Sending at entry time meant sixty drivers got a 24-hour
// link on the Tuesday the office did the data entry, and every one of those links
// was dead before anybody thought to tell the drivers to watch for it.
//
// SENDING GOES THROUGH RESEND, NOT SUPABASE. Supabase's transactional email is
// rate-limited to a handful of messages an hour, so looping the built-in mailer
// over a roster trips the limit almost immediately. `generateLink` mints the token
// without sending anything and we deliver a branded email ourselves.
//
// THE LINK IS A MAGIC LINK, AND THAT IS FORCED ON US. `generateLink({ type:
// 'invite' })` refuses an address that is already registered, and by the time an
// invitation is sent the account has existed since the day it was entered. A magic
// link is the one primitive that works for somebody who already exists. It carries
// a cost: `/auth/verify` treats the set-password step as optional for magic links,
// because a magic link can belong to somebody who already has a password. A worker
// who has never set one must not be allowed to skip it -- skipping leaves a
// one-session account that cannot sign in from any other phone -- so a first-time
// send marks the link `setup=1` and the verify flow makes the step mandatory. See
// `sendWorkerInviteByEmail`.

import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { APP_NAME } from "@/lib/brand";
import { isDemoTenant } from "@/lib/demo";
import { buildEmailConfirmationLink, withAccountSetupMarker } from "@/lib/auth-email-link";
import { sendViaResend } from "@/lib/resend-relay";

type AdminClient = SupabaseClient<Database>;

export type WorkerAccountParams = {
  email: string;
  fullName: string;
  companyName: string;
  // The creating admin's tenant. A demo tenant cannot create worker accounts: it
  // would mint an auth user for an arbitrary email address inside the shared demo
  // deployment, which is exactly what the demo must not do.
  tenantId: string;
};

export type WorkerInviteParams = WorkerAccountParams & {
  redirectTo: string;
  // True when this worker has never completed setup, which makes the password
  // step mandatory on the other end instead of skippable. See the file header.
  requireSetup?: boolean;
};

export type WorkerAccountResult =
  | { ok: true; user: User }
  | { ok: false; error: string };

export type WorkerInviteResult = { ok: true } | { ok: false; error: string };

export type WorkerInviteEmail = {
  subject: string;
  text: string;
  html: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Builds the branded invite email. Pure and deterministic so it can be unit
 * tested without touching Supabase or Resend.
 */
export function buildWorkerInviteEmail(params: {
  fullName: string;
  companyName: string;
  actionLink: string;
}): WorkerInviteEmail {
  const firstName = params.fullName.trim().split(/\s+/)[0] || "there";
  const company = params.companyName.trim() || "Your company";
  const subject = `${company} has invited you to ${APP_NAME}`;

  const text = [
    `Hi ${firstName},`,
    "",
    `${company} has invited you to ${APP_NAME}. Click the link below to accept your invitation and set up your account:`,
    "",
    params.actionLink,
    "",
    "This link is single use and expires, and a newer invitation email replaces this one - always use the newest email from us. If you were not expecting this invitation, you can safely ignore it.",
    "",
    APP_NAME,
  ].join("\n");

  const safeFirstName = escapeHtml(firstName);
  const safeCompany = escapeHtml(company);
  const safeLink = escapeHtml(params.actionLink);

  const html = [
    '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0f172a;">',
    `<p style="font-size:16px;">Hi ${safeFirstName},</p>`,
    `<p style="font-size:16px;line-height:1.5;"><strong>${safeCompany}</strong> has invited you to ${escapeHtml(APP_NAME)}. Accept your invitation and set up your account:</p>`,
    `<p style="margin:28px 0;"><a href="${safeLink}" style="background:#0a6b54;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;display:inline-block;">Accept invitation</a></p>`,
    `<p style="font-size:13px;color:#64748b;line-height:1.5;">If the button does not work, paste this link into your browser:<br><a href="${safeLink}" style="color:#0a6b54;word-break:break-all;">${safeLink}</a></p>`,
    '<p style="font-size:13px;color:#64748b;line-height:1.5;">This link is single use and expires, and a newer invitation email replaces this one &mdash; always use the newest email from us. If you were not expecting this invitation, you can safely ignore it.</p>',
    `<p style="font-size:13px;color:#64748b;">${escapeHtml(APP_NAME)}</p>`,
    "</div>",
  ].join("");

  return { subject, text, html };
}

type InviteDeps = {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  // Injectable so the pure invite logic can be unit tested without a database.
  // Defaults to the real tenants.demo_mode lookup.
  isDemoTenant?: (client: AdminClient, tenantId: string) => Promise<boolean>;
};

/**
 * Creates the auth account for a worker and sends NOTHING.
 *
 * WHY generateLink AND NOT createUser, which is the obvious choice and does not
 * work. `auth.admin.createUser` writes a password hash even when no password is
 * given, and the signup trigger (20260817000000) reads exactly that column to
 * decide what it is looking at: an account carrying a password is somebody
 * signing themselves up, and is refused outright once a company exists. Measured
 * against a local stack rather than reasoned about -- every `createUser` call
 * came back "Database error creating new user" and the auth row was rolled back,
 * so a whole roster load would have failed on the first name.
 *
 * `generateLink({ type: 'invite' })` provisions the account with the password
 * column genuinely empty, which is the branch the trigger lets through: no
 * tenant, no user row, and the calling action provisions the person into the
 * right company. Confirmed on the same local stack.
 *
 * The link it returns is deliberately discarded. That is the one cost of this
 * route -- a token minted and never used -- and it is a small one: nothing is
 * transmitted anywhere, and it expires on its own. The alternative is a trigger
 * change to the rule that closed self-service signup, which is not a thing to
 * loosen for the sake of tidiness here.
 */
export async function createWorkerAccount(
  adminSupabase: AdminClient,
  params: WorkerAccountParams,
  deps: InviteDeps = {},
): Promise<WorkerAccountResult> {
  const checkDemoTenant = deps.isDemoTenant ?? isDemoTenant;

  if (await checkDemoTenant(adminSupabase, params.tenantId)) {
    return { ok: false, error: "Adding workers is disabled in the demo." };
  }

  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: "invite",
    email: params.email,
    options: {
      data: {
        company_name: params.companyName,
        full_name: params.fullName,
      },
    },
  });

  if (error || !data.user) {
    return { ok: false, error: error?.message ?? "Worker account could not be created." };
  }

  return { ok: true, user: data.user };
}

/**
 * Emails a worker their invitation. Used for the first send and every resend
 * alike -- they are the same operation, because the account already exists in
 * both cases.
 *
 * A magic link is the primitive, since `generateLink({ type: "invite" })` refuses
 * an address that is already registered. `/auth/confirm` verifies any OTP type
 * through the same path and lands the worker in the same place, so the recipient
 * experience is identical to accepting a Supabase invitation.
 *
 * `requireSetup` marks the link for somebody who has never set a password, which
 * makes the password step mandatory rather than skippable on the other end. Get
 * this wrong in the safe direction and a worker who already has a password is
 * asked to confirm one; get it wrong in the other and they end up with a
 * session-only account that cannot sign in from a second device.
 *
 * Returns ok:false when the email fails. No account is being provisioned here, so
 * a send that did not happen is a plain failure with nothing to keep.
 */
export async function sendWorkerInviteByEmail(
  adminSupabase: AdminClient,
  params: WorkerInviteParams,
  deps: InviteDeps = {},
): Promise<WorkerInviteResult> {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const checkDemoTenant = deps.isDemoTenant ?? isDemoTenant;

  if (await checkDemoTenant(adminSupabase, params.tenantId)) {
    return { ok: false, error: "Inviting workers is disabled in the demo." };
  }

  const from = env.EMAIL_DELIVERY_FROM?.trim();
  const apiKey = env.RESEND_API_KEY?.trim();

  // Check before minting a link. A link generated and never sent is a live
  // credential sitting in the auth system for nothing.
  if (!from || !apiKey) {
    return {
      ok: false,
      error: "Email delivery is not configured (EMAIL_DELIVERY_FROM / RESEND_API_KEY), so no invite email was sent.",
    };
  }

  // The marker rides on redirectTo rather than being decided at verify time,
  // because by the time the link is redeemed the evidence is gone: verifyOtp has
  // already stamped email_confirmed_at, so "has this person ever completed setup"
  // reads as yes for everybody. Here, before the send, it is still knowable.
  const redirectTo = withAccountSetupMarker(params.redirectTo, params.requireSetup === true);

  const { data, error } = await adminSupabase.auth.admin.generateLink({
    type: "magiclink",
    email: params.email,
    options: {
      redirectTo,
    },
  });

  const actionLink = buildEmailConfirmationLink({
    properties: data?.properties,
    redirectTo,
    type: "magiclink",
  });

  if (error || !actionLink) {
    return { ok: false, error: error?.message ?? "No invitation link was returned, so no email was sent." };
  }

  const email = buildWorkerInviteEmail({
    actionLink,
    companyName: params.companyName,
    fullName: params.fullName,
  });

  const replyTo = env.EMAIL_DELIVERY_REPLY_TO?.trim() || undefined;
  const sendResult = await sendViaResend(
    { body: email.text, from, html: email.html, replyTo, subject: email.subject, to: params.email },
    apiKey,
    fetchImpl,
  );

  if (!sendResult.ok) {
    return { ok: false, error: sendResult.error };
  }

  return { ok: true };
}
