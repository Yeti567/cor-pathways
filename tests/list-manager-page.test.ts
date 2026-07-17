import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(join(process.cwd(), "src/app/admin/lists/page.tsx"), "utf8");
const client = readFileSync(join(process.cwd(), "src/app/admin/lists/ListManagerClient.tsx"), "utf8");
const apiIndex = readFileSync(join(process.cwd(), "src/app/api/form-lists/route.ts"), "utf8");
const apiDetail = readFileSync(join(process.cwd(), "src/app/api/form-lists/[listId]/route.ts"), "utf8");
const apiItems = readFileSync(join(process.cwd(), "src/app/api/form-lists/[listId]/items/route.ts"), "utf8");
const apiItem = readFileSync(join(process.cwd(), "src/app/api/form-lists/[listId]/items/[itemId]/route.ts"), "utf8");
// The schema is one generated baseline now; pg_dump lowercases nothing and quotes
// identifiers, so normalise before matching.
const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20260716000000_initial_schema.sql"),
  "utf8",
).toLowerCase().replace(/"/g, "");

describe("list manager page", () => {
  it("renders the managed list client editor from the existing admin route", () => {
    expect(page).toContain("ListManagerClient");
    expect(client).toContain("function ListSidebar");
    expect(client).toContain("function ListEditor");
    expect(client).toContain("function ListItemRow");
    expect(client).toContain("function CreateListModal");
    expect(client).toContain("function ConfirmDeleteModal");
    expect(client).toContain("function SaveStatusIndicator");
    expect(client).toContain('role="tree"');
    expect(client).toContain('role="treeitem"');
    expect(client).toContain("DndContext");
  });

  it("uses REST endpoints for list and item persistence", () => {
    expect(apiIndex).toContain("export async function GET");
    expect(apiIndex).toContain("export async function POST");
    expect(apiDetail).toContain("export async function PATCH");
    expect(apiDetail).toContain("export async function DELETE");
    expect(apiItems).toContain("export async function POST");
    expect(apiItem).toContain("export async function PATCH");
    expect(apiItem).toContain("export async function DELETE");
    expect(apiDetail).toContain("usage.usageCount > 0");
  });

  it("adds tree schema and recursive tree fetch support", () => {
    expect(migration).toContain("parent_id uuid");
    expect(migration).toContain("with recursive tree as");
    expect(migration).toContain("get_managed_list_items_tree");
    expect(migration).toContain("seed_managed_lists_for_tenant");
    expect(migration).toContain("risk (severity + probability)");
  });
});
