import Link from "next/link";
import { redirect } from "next/navigation";
import { Layers, Save, Trash2 } from "lucide-react";
import {
  createInventoryCategory,
  deleteInventoryCategory,
  renameInventoryCategory,
} from "@/app/admin/inventory/actions";
import { AdminShell } from "@/app/admin/_components/AdminShell";
import { canUseAdminPanel } from "@/lib/access-control";
import { requireAppUser } from "@/lib/current-user";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";

export const dynamic = "force-dynamic";

type CategoryRow = Database["public"]["Tables"]["inventory_category"]["Row"];
type ItemCategoryRef = Pick<Database["public"]["Tables"]["inventory_item"]["Row"], "category_id">;

type CategoriesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--border)] bg-white px-3 text-sm text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] focus:ring-offset-2";

export default async function InventoryCategoriesPage({ searchParams }: CategoriesPageProps) {
  const params = await searchParams;
  const notice = firstParam(params.notice);
  const error = firstParam(params.error);
  const context = await requireAppUser();

  if (!canUseAdminPanel(context.appUser)) {
    redirect("/choose");
  }

  if (!context.tenant?.inventory_enabled) {
    redirect("/admin/setup");
  }

  const supabase = await createSupabaseServerClient();
  const [{ data: categories }, { data: items }] = await Promise.all([
    supabase
      .from("inventory_category")
      .select("*")
      .eq("tenant_id", context.appUser.tenant_id)
      .order("name", { ascending: true })
      .returns<CategoryRow[]>(),
    supabase
      .from("inventory_item")
      .select("category_id")
      .eq("tenant_id", context.appUser.tenant_id)
      .is("deleted_at", null)
      .returns<ItemCategoryRef[]>(),
  ]);

  const categoryRows = categories ?? [];
  const itemCountByCategory = new Map<string, number>();

  for (const item of items ?? []) {
    if (item.category_id) {
      itemCountByCategory.set(item.category_id, (itemCountByCategory.get(item.category_id) ?? 0) + 1);
    }
  }

  const uncategorised = (items ?? []).filter((item) => !item.category_id).length;

  return (
    <AdminShell eyebrow="Inventory" tenantName={context.tenant?.name ?? "Company profile"} title="Categories">
      {notice ? (
        <p className="mb-4 rounded-md border border-[var(--success)] bg-emerald-50 p-3 text-sm text-[var(--success)]">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mb-4 rounded-md border border-[var(--danger)] bg-red-50 p-3 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--surface-muted)] text-[var(--primary)]">
            <Layers className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">Categories</h2>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              Groups for filtering your{" "}
              <Link className="font-semibold text-[var(--primary)] hover:underline" href="/admin/inventory/items">
                items
              </Link>
              , such as Mats, Tools, PPE, Parts, and Consumables. Optional: an item does not need one. Removing a
              category leaves its items in place and simply uncategorised.
            </p>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <section className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          {categoryRows.length > 0 ? (
            <div className="divide-y divide-[var(--border)]">
              {categoryRows.map((category) => {
                const count = itemCountByCategory.get(category.id) ?? 0;

                return (
                  <div className="grid gap-3 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-end" key={category.id}>
                    <form action={renameInventoryCategory} className="flex flex-wrap items-end gap-3">
                      <input name="categoryId" type="hidden" value={category.id} />
                      <label className="min-w-[12rem] flex-1 space-y-2">
                        <span className="text-sm font-medium text-[var(--ink)]">Name</span>
                        <input className={inputClass} defaultValue={category.name} name="name" required />
                      </label>
                      <span className="pb-2 text-sm text-[var(--ink-muted)]">
                        {count} item{count === 1 ? "" : "s"}
                      </span>
                      <button
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-muted)]"
                        type="submit"
                      >
                        <Save className="h-4 w-4" aria-hidden="true" />
                        Save
                      </button>
                    </form>
                    <form action={deleteInventoryCategory}>
                      <input name="categoryId" type="hidden" value={category.id} />
                      <button
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-[var(--border)] bg-white px-3 text-sm font-semibold text-[var(--danger)] transition hover:bg-red-50"
                        type="submit"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Remove
                      </button>
                    </form>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="p-6 text-sm text-[var(--ink-muted)]">
              No categories yet. They are optional, so you can skip this and add them later once you can see which
              groupings you actually want.
            </p>
          )}

          {uncategorised > 0 ? (
            <p className="border-t border-[var(--border)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--ink-muted)]">
              {uncategorised} item{uncategorised === 1 ? " has" : "s have"} no category.
            </p>
          ) : null}
        </section>

        <section className="h-fit rounded-lg border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
          <h3 className="text-base font-semibold text-[var(--ink)]">Add a category</h3>
          <form action={createInventoryCategory} className="mt-4 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-[var(--ink)]">Name</span>
              <input className={inputClass} name="name" placeholder="Mats" required />
            </label>
            <button
              className="inline-flex h-10 w-full items-center justify-center rounded-md bg-[var(--primary)] px-4 text-sm font-semibold text-white transition hover:opacity-90"
              type="submit"
            >
              Add category
            </button>
          </form>
        </section>
      </div>
    </AdminShell>
  );
}
