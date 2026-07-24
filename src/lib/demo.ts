// Optional one-click "try the live demo" login.
//
// This only turns on when both env vars are set on the deployment, so the shared codebase
// stays clean: a client fork that has no demo tenant never sets these, and the button
// simply does not render. The credentials are a deliberately shared, public demo login,
// but they live in server-only env vars (not NEXT_PUBLIC) so they are never shipped to the
// browser, and the sign-in happens in a server action.
//
// To enable on a deployment, set:
//   DEMO_LOGIN_EMAIL      the demo account email
//   DEMO_LOGIN_PASSWORD   the demo account password

export type DemoLoginCredentials = { email: string; password: string };

export function getDemoLoginCredentials(): DemoLoginCredentials | null {
  const email = process.env.DEMO_LOGIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEMO_LOGIN_PASSWORD;

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

export function isDemoLoginEnabled(): boolean {
  return getDemoLoginCredentials() !== null;
}
