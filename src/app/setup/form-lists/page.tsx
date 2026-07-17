import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type SetupFormListsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SetupFormListsPage({ searchParams }: SetupFormListsPageProps) {
  const params = await searchParams;
  const listId = firstParam(params.listId);

  redirect(`/admin/lists${listId ? `?listId=${encodeURIComponent(listId)}` : ""}`);
}
