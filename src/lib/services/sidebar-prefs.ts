import { db } from "@/lib/db";

/** Pinned pages in display order, and pages hidden from the sidebar, as app hrefs. */
export type SidebarPrefs = { pinned: string[]; hidden: string[] };

export const SIDEBAR_PREFS_MAX_ITEMS = 60;
const HREF_PATTERN = /^\/[A-Za-z0-9/_-]{0,120}$/;

function hrefList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry === "string" && HREF_PATTERN.test(entry)) seen.add(entry);
    if (seen.size >= SIDEBAR_PREFS_MAX_ITEMS) break;
  }
  return [...seen];
}

/** Reads whatever is stored, dropping anything that is not a plain app href. Null means never saved. */
export function normalizeSidebarPrefs(value: unknown): SidebarPrefs | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return { pinned: hrefList(record.pinned), hidden: hrefList(record.hidden) };
}

export async function loadSidebarPrefs(userId: string): Promise<SidebarPrefs | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { sidebarPrefs: true } });
  return normalizeSidebarPrefs(user?.sidebarPrefs);
}

export async function saveSidebarPrefs(userId: string, prefs: SidebarPrefs): Promise<SidebarPrefs> {
  const next = normalizeSidebarPrefs(prefs) ?? { pinned: [], hidden: [] };
  await db.user.update({ where: { id: userId }, data: { sidebarPrefs: next } });
  return next;
}
