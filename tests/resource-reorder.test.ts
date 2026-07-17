import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const adminActions = readFileSync(join(process.cwd(), "src/app/admin/actions.ts"), "utf8");
const documentsPage = readFileSync(join(process.cwd(), "src/app/admin/documents/page.tsx"), "utf8");

describe("resource library reorder wiring", () => {
  it("exports tenant-scoped reorder actions for sections and resources", () => {
    expect(adminActions).toContain("export async function moveResourceSection");
    expect(adminActions).toContain("export async function moveResource");
    expect(adminActions).toContain("coerceResourceMoveDirection");
    expect(adminActions).toContain("getResourceReorderUpdates(sectionRows ?? [], sectionId, direction)");
    expect(adminActions).toContain("getResourceReorderUpdates(resourceRows ?? [], resourceId, direction)");
    expect(adminActions).toContain('.eq("tenant_id", tenantId)');
  });

  it("normalizes sibling sort order and records audit events when a resource moves", () => {
    expect(adminActions).toContain('.from("resource_sections")');
    expect(adminActions).toContain('.from("resources")');
    expect(adminActions).toContain('.is("section_id", null)');
    expect(adminActions).toContain(".update({ sort_order: update.sort_order })");
    expect(adminActions).toContain('action: "resource_section.reorder"');
    expect(adminActions).toContain('action: "document_resource.reorder"');
    expect(adminActions).toContain("notice=Resource%20section%20moved.");
    expect(adminActions).toContain("notice=Resource%20moved.");
  });

  it("renders icon controls for section and resource reordering", () => {
    expect(documentsPage).toContain("action={moveResourceSection}");
    expect(documentsPage).toContain("action={moveResource}");
    expect(documentsPage).toContain('name="direction" type="hidden" value="up"');
    expect(documentsPage).toContain('name="direction" type="hidden" value="down"');
    expect(documentsPage).toContain("disabled={sectionIndex === 0}");
    expect(documentsPage).toContain("disabled={position?.isFirst ?? true}");
    expect(documentsPage).toContain("<ArrowUp");
    expect(documentsPage).toContain("<ArrowDown");
  });
});
