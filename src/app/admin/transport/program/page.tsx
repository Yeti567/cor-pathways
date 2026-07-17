import { redirect } from "next/navigation";

// The Safety Program (COR) section is retired. COR now lives in its own module at
// /admin/cor (toggle in Setup). This route forwards there so existing links keep
// working.
export const dynamic = "force-dynamic";

export default function RetiredTransportProgramPage() {
  redirect("/admin/cor");
}
