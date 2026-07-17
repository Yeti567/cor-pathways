import { redirect } from "next/navigation";
import LandingPage from "@/app/_landing/LandingPage";
import { getCurrentUserContext } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function Home() {
  const context = await getCurrentUserContext();

  if (context.status === "app_user" || context.status === "consultant" || context.status === "profile_pending") {
    redirect("/choose");
  }

  return <LandingPage />;
}
