import {
  REPORT_SECTIONS,
  SETTINGS_SECTIONS,
  meetsRoleRequirement,
  type SettingsRole,
} from "@/lib/nav-sections";

// Only segments where the label diverges from default title-casing.
// Anything else falls through to formatSegment().
const SEGMENT_OVERRIDE: Record<string, { label: string; href?: string }> = {
  events: { label: "Schedule", href: "/schedule" },
  "bulk-inventory": { label: "Item family operations", href: "/items" },
};

export type SiblingItem = {
  href: string;
  label: string;
  requiredRole?: SettingsRole;
  description?: string;
  group?: string;
  ownerOnly?: boolean;
};

export const SIBLING_MAP: Record<string, ReadonlyArray<SiblingItem>> = {
  "/settings": SETTINGS_SECTIONS,
  "/reports": REPORT_SECTIONS,
};
for (const s of SETTINGS_SECTIONS) SIBLING_MAP[s.href] = SETTINGS_SECTIONS;
for (const s of REPORT_SECTIONS) SIBLING_MAP[s.href] = REPORT_SECTIONS;

export const RECENT_STORAGE_KEY = "breadcrumb-recent";
export const MAX_RECENT_PER_SECTION = 5;
export const MAX_RECENT_TOTAL = 30;
// Entity labels come from user-entered data (booking titles, names); cap what
// we persist so one long title can't bloat storage or the dropdown.
export const MAX_RECENT_LABEL_LENGTH = 80;

export type RecentEntity = { href: string; label: string; section: string };

function isRecentEntity(value: unknown): value is RecentEntity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.href === "string" &&
    typeof candidate.label === "string" &&
    typeof candidate.section === "string"
  );
}

export function getRecentEntities(section: string): RecentEntity[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const all: unknown = JSON.parse(raw);
    if (!Array.isArray(all)) return [];
    return all
      .filter(isRecentEntity)
      .filter((e) => e.section === section)
      .slice(0, MAX_RECENT_PER_SECTION);
  } catch {
    return [];
  }
}

export function saveRecentEntity(entity: RecentEntity) {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    let parsed: unknown = [];
    try {
      parsed = raw ? JSON.parse(raw) : [];
    } catch {
      // A corrupt cache must not disable all future recent-history writes.
    }
    const all = Array.isArray(parsed) ? parsed.filter(isRecentEntity) : [];
    const normalized = { ...entity, label: entity.label.slice(0, MAX_RECENT_LABEL_LENGTH) };
    if (all[0]?.href === normalized.href && all[0]?.label === normalized.label &&
        all[0]?.section === normalized.section) return;
    const filtered = all.filter((e) => e.href !== entity.href);
    filtered.unshift(normalized);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(filtered.slice(0, MAX_RECENT_TOTAL)));
  } catch {
    // localStorage unavailable
  }
}

export function formatSegment(segment: string): string {
  return SEGMENT_OVERRIDE[segment]?.label
    ?? segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isDynamicSegment(segment: string): boolean {
  if (/^[0-9a-f-]{8,}$/i.test(segment)) return true;
  if (/^c[a-z0-9]{20,}$/.test(segment)) return true;
  if (/^bulk-c[a-z0-9]{20,}$/.test(segment)) return true;
  return false;
}

export function isQuietBreadcrumbRoute(pathname: string): boolean {
  return pathname === "/import" || pathname.endsWith("/new");
}

function hasRoleGatedSiblings(siblings: ReadonlyArray<SiblingItem>): boolean {
  return siblings.some((s) => s.requiredRole != null || s.ownerOnly);
}

export function visibleSiblingsForRole(
  siblings: ReadonlyArray<SiblingItem>,
  role: string | undefined,
  ownerAccess = false,
): ReadonlyArray<SiblingItem> {
  if (!hasRoleGatedSiblings(siblings)) return siblings;
  if (!role) return [];
  return siblings.filter(
    (s) => (!s.requiredRole || meetsRoleRequirement(s.requiredRole, role)) && (!s.ownerOnly || ownerAccess),
  );
}

export type BreadcrumbItemData = { href: string; label: string; isPage: boolean };

/**
 * Turn a pathname into the ordered crumb list, dropping dynamic ID segments
 * and appending the resolved entity label (when known) as the current page.
 */
export function buildBreadcrumbItems(
  pathname: string,
  entityLabel: string | null,
): { items: BreadcrumbItemData[]; onDetailPage: boolean } {
  const segments = pathname.split("/").filter(Boolean);
  const onDetailPage = segments.some(isDynamicSegment);

  const crumbs: Array<{ href: string; label: string }> = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!; // in-bounds by loop condition
    if (isDynamicSegment(seg)) continue;
    const href = SEGMENT_OVERRIDE[seg]?.href ?? "/" + segments.slice(0, i + 1).join("/");
    crumbs.push({ href, label: formatSegment(seg) });
  }

  const items: BreadcrumbItemData[] = [
    { href: "/", label: "Home", isPage: false },
    ...crumbs.map((crumb, i) => ({
      ...crumb,
      isPage: i === crumbs.length - 1 && !onDetailPage && !entityLabel,
    })),
  ];

  if (onDetailPage && entityLabel) {
    items.push({ href: pathname, label: entityLabel, isPage: true });
  }

  return { items, onDetailPage };
}
