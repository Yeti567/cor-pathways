import { HelpBrowser } from "./HelpBrowser";
import { HelpShell } from "./HelpShell";

export const metadata = {
  title: "Help Center, Cor Pathway 360",
  description: "Search articles, troubleshoot offline sync, learn the form builder, and more.",
};

export default function HelpPage() {
  return (
    <HelpShell>
      <HelpBrowser />
    </HelpShell>
  );
}
