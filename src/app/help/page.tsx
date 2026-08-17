import { HelpBrowser } from "./HelpBrowser";
import { HelpShell } from "./HelpShell";
import { APP_NAME } from "@/lib/brand";

export const metadata = {
  title: `Help Center, ${APP_NAME}`,
  description: "Search articles, troubleshoot offline sync, learn the form builder, and more.",
};

export default function HelpPage() {
  return (
    <HelpShell>
      <HelpBrowser />
    </HelpShell>
  );
}
