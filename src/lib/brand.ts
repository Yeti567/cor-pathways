// The product name shown to users.
//
// Client deployments are forks of this repo, and every fork used to rebrand by
// hand-editing a dozen source files. That is slow, easy to miss (one deployment
// rebranded its homepage but not its invite email, so workers were greeted by
// the wrong product name), and it guarantees a merge conflict in those same
// files every time the fork pulls upstream.
//
// One env var instead. A fork sets NEXT_PUBLIC_APP_NAME once and never touches
// source, so it can merge upstream cleanly forever.
//
// Read straight from process.env rather than through lib/env so this stays
// dependency-free: it is imported by client components, and pulling zod in
// behind it would put the validator in the browser bundle for no benefit.
// NEXT_PUBLIC_ values are inlined at build time, so this works on both sides.

export const DEFAULT_APP_NAME = "Core Pathways";

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME?.trim() || DEFAULT_APP_NAME;
