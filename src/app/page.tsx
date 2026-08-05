import { redirect } from "next/navigation";
import LandingPage from "@/app/_landing/LandingPage";
import { getCurrentUserContext } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const context = await getCurrentUserContext();

  // A carrier contact goes straight to their own page. Without this they land on the
  // marketing site after signing in, which reads as "this link did not work" to somebody
  // who only came here to send an insurance certificate.
  if (context.status === "subcontractor_user") {
    redirect("/sub");
  }

  if (context.status === "app_user" || context.status === "consultant" || context.status === "profile_pending") {
    redirect("/choose");
  }

  return <LandingPage />;
}
