import { notFound } from "next/navigation";
import { DocumentControlFixture } from "./DocumentControlFixture";

export const dynamic = "force-dynamic";

export default function DocumentControlFixturePage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return <DocumentControlFixture />;
}
