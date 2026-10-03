import { notFound } from "next/navigation";
import { AddPeopleWizard } from "@/app/admin/people/add/AddPeopleWizard";

// Add Your People without signing in, for looking at the screen. Paste a list to see the
// review step. The file reader and the Add button call the real actions, which refuse a
// visitor who is not signed in, so nothing here can save.

export const dynamic = "force-dynamic";

export default function AddPeopleFixture() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main className="min-h-screen bg-[var(--background)] p-4 sm:p-8">
      <h1 className="mb-3 text-2xl font-bold text-[var(--ink)]">Add your people</h1>
      <AddPeopleWizard existingEmails={["dana@northwind.test"]} />
    </main>
  );
}
