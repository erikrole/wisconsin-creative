import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MAX_RECENT_LABEL_LENGTH,
  MAX_RECENT_PER_SECTION,
  MAX_RECENT_TOTAL,
  RECENT_STORAGE_KEY,
  buildBreadcrumbItems,
  formatSegment,
  getRecentEntities,
  isDynamicSegment,
  isQuietBreadcrumbRoute,
  saveRecentEntity,
  shouldShowBreadcrumbs,
  visibleSiblingsForRole,
  type SiblingItem,
} from "@/lib/breadcrumbs";
import { clearLocalTraces } from "@/lib/local-traces";
import { QUERY_CACHE_STORAGE_KEY } from "@/lib/query-client";

function stubLocalStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  return store;
}

describe("isDynamicSegment", () => {
  it("detects UUID, cuid, and bulk-cuid identifiers", () => {
    expect(isDynamicSegment("0f8b4c2a-9d3e-4f1b-8a2c-1d2e3f4a5b6c")).toBe(true);
    expect(isDynamicSegment("cmf0abcdefghijklmnop1234")).toBe(true);
    expect(isDynamicSegment("bulk-cmf0abcdefghijklmnop1234")).toBe(true);
    expect(isDynamicSegment("deadbeef01")).toBe(true);
  });

  it("does not misclassify any static route segment in the app", () => {
    // Every static segment currently used under src/app/(app). If a new route
    // segment ever matches the dynamic-ID heuristics, add it here first — a
    // false positive silently drops the crumb from the trail.
    const staticSegments = [
      "admin", "fix-today", "bookings", "bulk-inventory", "batteries",
      "checkouts", "events", "import", "items", "hygiene", "kits", "labels",
      "licenses", "notifications", "profile", "reports", "audit", "badges",
      "bulk-losses", "overdue", "scans", "utilization", "reservations", "new",
      "resources", "edit", "scan", "schedule", "assign", "search", "settings",
      "allowed-emails", "appearance", "calendar-sources", "categories",
      "checkout-policies", "data-export", "database", "departments",
      "escalation", "kiosk-devices", "locations", "reservation-rules",
      "security", "sports", "venue-mappings", "users", "onboarding-status",
      "org-chart",
    ];
    for (const segment of staticSegments) {
      expect(isDynamicSegment(segment), `expected "${segment}" to be static`).toBe(false);
    }
  });
});

describe("formatSegment", () => {
  it("uses overrides where the label diverges from title-casing", () => {
    expect(formatSegment("events")).toBe("Schedule");
    expect(formatSegment("bulk-inventory")).toBe("Item family operations");
    expect(formatSegment("allowed-emails")).toBe("Registration access");
    expect(formatSegment("kiosk-devices")).toBe("Kiosks");
    expect(formatSegment("scan")).toBe("Scan");
  });

  it("title-cases hyphenated segments by default", () => {
    expect(formatSegment("checkout-policies")).toBe("Checkout policies");
    expect(formatSegment("onboarding-status")).toBe("Onboarding Status");
  });
});

describe("buildBreadcrumbItems", () => {
  it("appends the entity label as the current page on detail routes", () => {
    const { items, onDetailPage } = buildBreadcrumbItems(
      "/items/cmf0abcdefghijklmnop1234",
      "AT-1002",
    );

    expect(onDetailPage).toBe(true);
    expect(items).toEqual([
      { href: "/", label: "Home", isPage: false },
      { href: "/items", label: "Items", isPage: false },
      { href: "/items/cmf0abcdefghijklmnop1234", label: "AT-1002", isPage: true },
    ]);
  });

  it("leaves the trail without a page item while the entity label loads", () => {
    const { items, onDetailPage } = buildBreadcrumbItems(
      "/items/cmf0abcdefghijklmnop1234",
      null,
    );

    expect(onDetailPage).toBe(true);
    expect(items).toEqual([
      { href: "/", label: "Home", isPage: false },
      { href: "/items", label: "Items", isPage: false },
    ]);
  });

  it("routes overridden segments to their canonical section", () => {
    const { items } = buildBreadcrumbItems(
      "/events/0f8b4c2a-9d3e-4f1b-8a2c-1d2e3f4a5b6c",
      "Volleyball vs. Michigan",
    );

    expect(items[1]).toEqual({ href: "/schedule", label: "Schedule", isPage: false });
    expect(items[2]?.isPage).toBe(true);
  });

  it("marks the last static crumb as the page on non-detail routes", () => {
    const { items, onDetailPage } = buildBreadcrumbItems("/settings/allowed-emails", null);

    expect(onDetailPage).toBe(false);
    expect(items).toEqual([
      { href: "/", label: "Home", isPage: false },
      { href: "/settings", label: "Settings", isPage: false },
      { href: "/settings/allowed-emails", label: "Registration access", isPage: true },
    ]);
  });

  it("links bulk-inventory trails back through the items section", () => {
    const { items } = buildBreadcrumbItems("/bulk-inventory/batteries", null);

    expect(items).toEqual([
      { href: "/", label: "Home", isPage: false },
      { href: "/items", label: "Item family operations", isPage: false },
      { href: "/bulk-inventory/batteries", label: "Batteries", isPage: true },
    ]);
  });
});

describe("isQuietBreadcrumbRoute", () => {
  it("treats import and creation routes as quiet", () => {
    expect(isQuietBreadcrumbRoute("/import")).toBe(true);
    expect(isQuietBreadcrumbRoute("/checkouts/new")).toBe(true);
    expect(isQuietBreadcrumbRoute("/reservations/new")).toBe(true);
    expect(isQuietBreadcrumbRoute("/items")).toBe(false);
  });
});

describe("shouldShowBreadcrumbs", () => {
  it("hides Home-only and top-level section trails", () => {
    expect(shouldShowBreadcrumbs([{ href: "/", label: "Home", isPage: true }], false)).toBe(false);
    expect(shouldShowBreadcrumbs([
      { href: "/", label: "Home", isPage: false },
      { href: "/items", label: "Items", isPage: true },
    ], false)).toBe(false);
  });

  it("keeps nested, create, and entity-detail trails", () => {
    expect(shouldShowBreadcrumbs([
      { href: "/", label: "Home", isPage: false },
      { href: "/settings", label: "Settings", isPage: false },
      { href: "/settings/categories", label: "Categories", isPage: true },
    ], false)).toBe(true);
    expect(shouldShowBreadcrumbs([
      { href: "/", label: "Home", isPage: false },
      { href: "/items", label: "Items", isPage: false },
    ], true)).toBe(true);
  });
});

describe("visibleSiblingsForRole", () => {
  const gated: SiblingItem[] = [
    { href: "/reports/utilization", label: "Utilization" },
    { href: "/reports/audit", label: "Audit", requiredRole: "ADMIN" },
  ];

  it("passes ungated lists through unchanged", () => {
    const ungated: SiblingItem[] = [{ href: "/a", label: "A" }, { href: "/b", label: "B" }];
    expect(visibleSiblingsForRole(ungated, undefined)).toBe(ungated);
  });

  it("filters gated entries by role and hides gated lists while the role is unknown", () => {
    expect(visibleSiblingsForRole(gated, "ADMIN")).toEqual(gated);
    expect(visibleSiblingsForRole(gated, "STAFF").map((s) => s.href)).toEqual([
      "/reports/utilization",
    ]);
    expect(visibleSiblingsForRole(gated, undefined)).toEqual([]);
  });

  it("keeps owner-only siblings hidden without the explicit owner gate", () => {
    const ownerOnly: SiblingItem[] = [
      { href: "/settings/database", label: "Database diagnostics" },
      { href: "/settings/app-activity", label: "App activity", ownerOnly: true },
    ];
    expect(visibleSiblingsForRole(ownerOnly, "ADMIN").map((s) => s.href)).toEqual([
      "/settings/database",
    ]);
    expect(visibleSiblingsForRole(ownerOnly, "ADMIN", true)).toEqual(ownerOnly);
  });
});

describe("recent entities storage", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an empty list for corrupt or non-array payloads", () => {
    store.set(RECENT_STORAGE_KEY, "not json{");
    expect(getRecentEntities("items")).toEqual([]);

    store.set(RECENT_STORAGE_KEY, JSON.stringify({ href: "/items/1" }));
    expect(getRecentEntities("items")).toEqual([]);
  });

  it("repairs corrupt recent storage on the next visit", () => {
    store.set(RECENT_STORAGE_KEY, "{broken");
    saveRecentEntity({ href: "/items/a", label: "Camera", section: "items" });
    expect(getRecentEntities("items")).toHaveLength(1);
  });

  it("drops malformed entries instead of rendering them", () => {
    store.set(
      RECENT_STORAGE_KEY,
      JSON.stringify([
        { href: "/items/a", label: "AT-1", section: "items" },
        { href: null, label: "broken", section: "items" },
        { label: "no href", section: "items" },
        "just a string",
        { href: "/users/b", label: "Someone", section: "users" },
      ]),
    );

    expect(getRecentEntities("items")).toEqual([
      { href: "/items/a", label: "AT-1", section: "items" },
    ]);
  });

  it("caps per-section reads and total writes", () => {
    for (let i = 0; i < MAX_RECENT_TOTAL + 10; i++) {
      saveRecentEntity({ href: `/items/${i}`, label: `AT-${i}`, section: "items" });
    }

    const persisted = JSON.parse(store.get(RECENT_STORAGE_KEY)!) as unknown[];
    expect(persisted).toHaveLength(MAX_RECENT_TOTAL);
    expect(getRecentEntities("items")).toHaveLength(MAX_RECENT_PER_SECTION);
  });

  it("dedupes by href, moves revisits to the front, and caps label length", () => {
    saveRecentEntity({ href: "/items/a", label: "AT-1", section: "items" });
    saveRecentEntity({ href: "/items/b", label: "x".repeat(500), section: "items" });
    saveRecentEntity({ href: "/items/a", label: "AT-1 renamed", section: "items" });

    const recents = getRecentEntities("items");
    expect(recents.map((r) => r.href)).toEqual(["/items/a", "/items/b"]);
    expect(recents[0]?.label).toBe("AT-1 renamed");
    expect(recents[1]?.label).toHaveLength(MAX_RECENT_LABEL_LENGTH);
  });
});

describe("clearLocalTraces", () => {
  it("removes per-user history keys but keeps device preferences", () => {
    const store = stubLocalStorage();
    store.set(RECENT_STORAGE_KEY, "[]");
    store.set("recent-searches", "[]");
    store.set(QUERY_CACHE_STORAGE_KEY, "{}");
    store.set("theme", "dark");

    clearLocalTraces();

    expect(store.has(RECENT_STORAGE_KEY)).toBe(false);
    expect(store.has("recent-searches")).toBe(false);
    expect(store.has(QUERY_CACHE_STORAGE_KEY)).toBe(false);
    expect(store.get("theme")).toBe("dark");
    vi.unstubAllGlobals();
  });
});
