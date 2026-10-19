/**
 * Wish list rules shared by the service, routes, and page. A wish never touches the budget until an
 * admin moves it there. Money is whole cents.
 * Reference: docs/AREA_BUDGET.md
 */

export const WISH_STATUSES = ["OPEN", "APPROVED", "IN_BUDGET", "DECLINED"] as const;
export type WishStatusValue = (typeof WISH_STATUSES)[number];

export const WISH_STATUS_LABELS: Record<WishStatusValue, string> = {
  OPEN: "Open",
  APPROVED: "Approved",
  IN_BUDGET: "In budget",
  DECLINED: "Declined",
};

export type WishMoney = { status: WishStatusValue; estimateCents: number | null; quantity: number };

/** Open and approved wishes are the ones still waiting on a decision to buy; they are not in any budget. */
export function pendingWishCents(wishes: WishMoney[]): number {
  return wishes
    .filter((wish) => wish.status === "OPEN" || wish.status === "APPROVED")
    .reduce((sum, wish) => sum + (wish.estimateCents ?? 0) * wish.quantity, 0);
}

export function wishCounts(wishes: Pick<WishMoney, "status">[]): Record<WishStatusValue | "ALL", number> {
  const counts = { OPEN: 0, APPROVED: 0, IN_BUDGET: 0, DECLINED: 0, ALL: wishes.length };
  for (const wish of wishes) counts[wish.status] += 1;
  return counts;
}

/** "bhphotovideo.com" from a product link; null when it isn't a web link. */
export function linkDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * What the quick-add bar does with its text: a pasted web link becomes the link and a title taken
 * from its domain (editable after); anything else is the title.
 */
export function parseQuickAdd(text: string): { title: string; linkUrl: string | null } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^https?:\/\/\S+$/i.test(trimmed)) {
    const domain = linkDomain(trimmed);
    return domain ? { title: `Item from ${domain}`, linkUrl: trimmed } : null;
  }
  return { title: trimmed, linkUrl: null };
}
