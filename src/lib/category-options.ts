import type { CategoryOption } from "@/types/category";

type CategoryPathOption = {
  value: string;
  label: string;
  keywords: string[];
};

export function buildCategoryPathOptions(categories: CategoryOption[]): CategoryPathOption[] {
  const byId = new Map(categories.map((category) => [category.id, category]));

  function labelFor(category: CategoryOption) {
    const parts = [category.name];
    let cursor = category.parentId ? byId.get(category.parentId) : undefined;
    let guard = 0;

    while (cursor && guard < categories.length) {
      parts.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      guard += 1;
    }

    return parts.join(" / ");
  }

  return categories
    .map((category) => ({
      value: category.id,
      label: labelFor(category),
      keywords: [category.name],
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
