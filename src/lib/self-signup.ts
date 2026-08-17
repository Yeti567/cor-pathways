// Whether this deployment will still accept somebody signing themselves up.
//
// The rule lives in the database (migration 20260817000000): the first account in
// a fresh database founds the company, and after that the only way in is an
// invitation. This module exists so the login page can say so plainly instead of
// showing a form that is guaranteed to fail, and so the server action can refuse
// with a sentence rather than a 500 out of GoTrue.
//
// Neither of those is the enforcement. The anon key ships in every browser bundle,
// so anyone can POST straight at /auth/v1/signup and never reach this code. The
// trigger is what actually stops them. This is only about telling the truth to the
// person looking at the page.

export const SIGNUP_CLOSED_MESSAGE =
  "Signing yourself up is closed on this deployment. Ask an administrator to invite you.";

/**
 * The whole of what this module needs from Supabase: ask one function, get back a
 * result carrying data and error. Declared structurally rather than as a slice of
 * SupabaseClient so a test can pass a two-line stand-in, and so nothing here has an
 * opinion about the rest of the client.
 */
type SignupAvailabilityProbe = {
  rpc(fn: "self_signup_available"): PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * Fails CLOSED. If the question cannot be answered, for any reason at all, we hide
 * the form rather than offer it: a deployment that has not run the migration yet,
 * or that cannot be reached, is not a deployment we should be inviting strangers
 * to claim. The cost of being wrong in this direction is one person asking why the
 * signup form is missing. The cost of being wrong in the other is a stranger's
 * company inside a client's database.
 */
export async function isSelfSignupAvailable(client: SignupAvailabilityProbe): Promise<boolean> {
  try {
    const { data, error } = await client.rpc("self_signup_available");

    if (error) {
      return false;
    }

    return data === true;
  } catch {
    return false;
  }
}
