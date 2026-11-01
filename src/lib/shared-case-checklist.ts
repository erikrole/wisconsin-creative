/**
 * The shared case checklist: things packed in the Football Travel Case that
 * are not checked out (XLR cords, towels, sensor kits), ticked by hand on every
 * shared case trip. The list lives in Settings; ticks live on the trip.
 */

export const SHARED_CASE_CHECKLIST_KEY = "shared_case_checklist";
export const CHECKLIST_LABEL_MAX = 120;
export const CHECKLIST_SECTION_MAX = 60;
export const CHECKLIST_ITEMS_MAX = 200;

export type ChecklistItem = { id: string; label: string; section: string | null };
export type ChecklistCheck = { at: string; by: string };

export function parseChecklistItems(value: unknown): ChecklistItem[] {
  const items = value && typeof value === "object" && !Array.isArray(value) ? (value as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { id, label, section } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof label !== "string" || !label.trim()) return [];
    return [{ id, label, section: typeof section === "string" && section.trim() ? section : null }];
  });
}

export function parseChecklistChecks(value: unknown): Record<string, ChecklistCheck> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const checks: Record<string, ChecklistCheck> = {};
  for (const [key, check] of Object.entries(value)) {
    const { at, by } = (check ?? {}) as Partial<ChecklistCheck>;
    if (typeof at === "string" && typeof by === "string") checks[key] = { at, by };
  }
  return checks;
}

/** Items grouped under their section headings, in list order. */
export function groupChecklist(items: ChecklistItem[]) {
  const groups: { section: string | null; items: ChecklistItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.section === item.section) last.items.push(item);
    else groups.push({ section: item.section, items: [item] });
  }
  return groups;
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/;
const HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

function plainText(text: string) {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every list item in a guide's markdown (bullets, numbers or task boxes), with
 * the heading above it as its section. Used once to bring the old Resources
 * checklist over, so nobody retypes it.
 */
export function checklistFromMarkdown(markdown: string): Omit<ChecklistItem, "id">[] {
  const items: Omit<ChecklistItem, "id">[] = [];
  let section: string | null = null;
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    if (inFence) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      section = plainText(heading[1] ?? "").slice(0, CHECKLIST_SECTION_MAX) || null;
      continue;
    }
    const item = LIST_ITEM.exec(line);
    const label = item ? plainText(item[1] ?? "").slice(0, CHECKLIST_LABEL_MAX) : "";
    if (label) items.push({ label, section });
  }
  return items.slice(0, CHECKLIST_ITEMS_MAX);
}
