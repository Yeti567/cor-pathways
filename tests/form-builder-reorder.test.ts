import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const formBuilderClient = readFileSync(
  join(process.cwd(), "src/app/admin/forms/[formId]/FormTypeDetailsBuilder.tsx"),
  "utf8",
);
const sectionReorderRoute = readFileSync(join(process.cwd(), "src/app/api/sections/reorder/route.ts"), "utf8");
const itemReorderRoute = readFileSync(join(process.cwd(), "src/app/api/items/reorder/route.ts"), "utf8");

describe("form builder reorder wiring", () => {
  it("uses dnd-kit for section, outline, and item sorting", () => {
    expect(formBuilderClient).toContain("DndContext");
    expect(formBuilderClient).toContain("SortableContext");
    expect(formBuilderClient).toContain("useSortable");
    expect(formBuilderClient).toContain("handleSectionDragEnd");
    expect(formBuilderClient).toContain("handleItemDragEnd");
    expect(formBuilderClient).toContain("SortableSectionCard");
    expect(formBuilderClient).toContain("SortableItemRow");
    expect(formBuilderClient).toContain("SortableOutlineRow");
  });

  it("persists section order through the section reorder endpoint", () => {
    expect(formBuilderClient).toContain('"/api/sections/reorder"');
    expect(sectionReorderRoute).toContain("orderUpdatesFromBody");
    expect(sectionReorderRoute).toContain(".from(\"form_sections\")");
    expect(sectionReorderRoute).toContain(".in(\"id\", ids)");
    expect(sectionReorderRoute).toContain("All reordered sections must belong to the same form.");
    expect(sectionReorderRoute).toContain(".update({ sort_order: update.order })");
    expect(sectionReorderRoute).toContain("revalidateFormBuilder(formId)");
  });

  it("persists item order through the item reorder endpoint", () => {
    expect(formBuilderClient).toContain('"/api/items/reorder"');
    expect(itemReorderRoute).toContain("orderUpdatesFromBody");
    expect(itemReorderRoute).toContain(".from(\"form_items\")");
    expect(itemReorderRoute).toContain(".in(\"id\", ids)");
    expect(itemReorderRoute).toContain("All reordered items must belong to the same section.");
    expect(itemReorderRoute).toContain(".update({ sort_order: update.order })");
    expect(itemReorderRoute).toContain("revalidateFormBuilder(formId)");
  });
});
