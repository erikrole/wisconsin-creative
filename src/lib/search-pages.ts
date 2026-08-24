import { REPORT_SECTIONS, SETTINGS_SECTIONS, isReportSectionVisible, isSectionVisible } from "@/lib/nav-sections";

export type PageSearchResult = {
  type: "page";
  id: string;
  title: string;
  subtitle: string;
  href: string;
  keywords: string[];
};

const CORE_SEARCH_PAGES: PageSearchResult[] = [
  { type: "page", id: "dashboard", title: "Dashboard", subtitle: "Daily gear, checkout, reservation, and draft work", href: "/", keywords: ["home", "today", "overdue", "drafts", "my gear"] },
  { type: "page", id: "schedule", title: "Schedule", subtitle: "Events, shifts, crew coverage, and event command center", href: "/schedule", keywords: ["events", "calendar", "assignments", "coverage", "shifts"] },
  { type: "page", id: "scoreboard", title: "Scoreboard", subtitle: "Team season totals and per-person leaderboards", href: "/scoreboard", keywords: ["record", "wins", "losses", "leaderboard", "events worked", "recognition"] },
  { type: "page", id: "items", title: "Items", subtitle: "Inventory list, filters, favorites, and item details", href: "/items", keywords: ["gear", "inventory", "assets", "equipment", "favorites"] },
  { type: "page", id: "bookings", title: "Bookings", subtitle: "Combined active checkouts and reservations", href: "/bookings", keywords: ["all bookings", "active", "past", "history"] },
  { type: "page", id: "checkouts", title: "Checkouts", subtitle: "Gear pickup, custody, due-back, and return work", href: "/bookings?tab=checkouts", keywords: ["checked out", "pickup", "pending pickup", "returns", "custody"] },
  { type: "page", id: "reservations", title: "Reservations", subtitle: "Future gear holds and planning work", href: "/bookings?tab=reservations", keywords: ["reserve", "reserved", "confirmed", "planned"] },
  { type: "page", id: "resources", title: "Resources", subtitle: "Guides, docs, links, and workflow references", href: "/resources", keywords: ["guides", "docs", "documentation", "contacts"] },
  { type: "page", id: "licenses", title: "Software", subtitle: "Photo Mechanic licenses and shared department logins", href: "/licenses", keywords: ["software", "passwords", "accounts", "seats", "codes", "claims"] },
  { type: "page", id: "notifications", title: "Notifications", subtitle: "Unread alerts, reminders, and operational messages", href: "/notifications", keywords: ["alerts", "inbox", "messages", "reminders"] },
];

const STAFF_SEARCH_PAGES: PageSearchResult[] = [
  { type: "page", id: "kits", title: "Kits", subtitle: "Reusable gear bundles and member availability", href: "/kits", keywords: ["bundles", "kit members", "interview kit"] },
  { type: "page", id: "operations", title: "Operations", subtitle: "Daily queue for operational exceptions and inventory cleanup", href: "/operations", keywords: ["fix today", "hygiene", "cleanup", "queue", "problems", "repair", "ops"] },
  { type: "page", id: "battery-ops", title: "Battery Ops", subtitle: "Battery family counts, missing units, and unit status", href: "/bulk-inventory/batteries", keywords: ["batteries", "units", "missing", "bulk"] },
  { type: "page", id: "users", title: "Users", subtitle: "Roster, roles, assignments, and profile records", href: "/users", keywords: ["people", "roster", "students", "staff", "profiles"] },
  { type: "page", id: "reports", title: "Reports", subtitle: "Utilization, checkout, overdue, scan, and audit analytics", href: "/reports", keywords: ["analytics", "metrics", "charts", "audit"] },
  { type: "page", id: "settings", title: "Settings", subtitle: "Personal preferences and operational configuration", href: "/settings", keywords: ["configuration", "admin", "preferences"] },
];

const INTERNAL_SEARCH_PAGES: PageSearchResult[] = [
  { type: "page", id: "accountability", title: "Accountability", subtitle: "The overdue leaderboard nobody wants to join", href: "/accountability", keywords: ["overdue", "leaderboard", "late returns", "accountability", "on time"] },
];

export function getVisiblePageSearchResults(
  role: string | undefined,
  query: string,
  limit = 8,
  ownerAccess = false,
): PageSearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const canUseStaffPages = role === "ADMIN" || role === "STAFF";
  const isInternalRole = role === "ADMIN" || role === "STAFF" || role === "STUDENT";
  const pages = [
    ...CORE_SEARCH_PAGES,
    ...(isInternalRole ? INTERNAL_SEARCH_PAGES : []),
    ...(canUseStaffPages ? STAFF_SEARCH_PAGES : []),
    ...SETTINGS_SECTIONS
      .filter((section) => role ? isSectionVisible(section, role, ownerAccess) : false)
      .map((section) => ({
        type: "page" as const,
        id: `settings:${section.href}`,
        title: section.label,
        subtitle: `Settings · ${section.description}`,
        href: section.href,
        keywords: [section.group, ...(section.keywords ?? [])],
      })),
    ...(canUseStaffPages
      ? REPORT_SECTIONS.filter((section) => role ? isReportSectionVisible(section, role) : false).map((section) => ({
          type: "page" as const,
          id: `reports:${section.href}`,
          title: section.label,
          subtitle: "Reports and analytics",
          href: section.href,
          keywords: ["reports", "analytics"],
        }))
      : []),
  ];

  return pages
    .filter((page) => [page.title, page.subtitle, page.href, ...page.keywords].join(" ").toLowerCase().includes(q))
    .slice(0, limit);
}
