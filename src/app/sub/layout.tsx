import { requireSubcontractorUser } from "@/lib/current-user";

/**
 * The carrier portal's outer gate.
 *
 * Belt and braces with the page-level check underneath it and the row level security
 * underneath that. A layout guard alone would be too weak, because a route that forgets
 * to call it is unguarded; row level security alone would be too weak in the other
 * direction, because it decides what data comes back rather than whether the page should
 * have rendered at all. All three have to agree before anything is shown.
 */
export default async function SubcontractorPortalLayout({ children }: { children: React.ReactNode }) {
  await requireSubcontractorUser();

  return <>{children}</>;
}
