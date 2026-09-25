import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  requireAuth: vi.fn(),
}));

const tx = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: vi.fn() },
    $transaction: vi.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  },
}));

vi.mock("@/lib/env", () => ({
  env: {
    sessionCookieName: "app_session",
    trustedOrigins: ["https://app.example.com"],
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: vi.fn(),
  SETTINGS_MUTATION_LIMIT: { max: 30, windowMs: 60_000 },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

import { requireAuth } from "@/lib/auth";
import {
  DEFAULT_NOTIFICATION_PREFS,
  DEFAULT_QUIET_HOURS,
  isInQuietHours,
  mergePrefs,
  normalizePrefs,
  resolvePushPresentation,
  shouldDeliverCategory,
} from "@/lib/services/notification-prefs";
import { NOTIFICATION_CATALOG } from "@/lib/notification-catalog";
import { PATCH, PUT } from "@/app/api/me/notification-preferences/route";

const user = {
  id: "cm000000000000000000000001",
  email: "student@example.com",
  name: "Student User",
  role: "STUDENT" as const,
  avatarUrl: null,
  forcePasswordChange: false,
};

function send(handler: typeof PATCH, body: unknown) {
  return handler(
    new Request("https://app.example.com/api/me/notification-preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", origin: "https://app.example.com" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) },
  );
}

function savedPrefs() {
  return tx.user.update.mock.calls[0]?.[0].data.notificationPrefs;
}

describe("normalizePrefs", () => {
  it("defaults every category to its catalog level for a missing record", () => {
    const prefs = normalizePrefs(null);
    expect(prefs).toEqual(DEFAULT_NOTIFICATION_PREFS);
    for (const entry of NOTIFICATION_CATALOG) {
      expect(prefs.push[entry.id]).toBe(entry.defaultLevel);
      expect(prefs.categories[entry.id]).toBe(true);
    }
    expect(prefs.quietHours.enabled).toBe(false);
  });

  it("reads a v1 boolean false as off and a v1 true as the default level", () => {
    const prefs = normalizePrefs({ categories: { trade: false, schedule: true } });
    expect(prefs.push.trade).toBe("off");
    expect(prefs.categories.trade).toBe(false);
    expect(prefs.push.schedule).toBe("silent");
  });

  it("lets split-out categories inherit a mute until they are set", () => {
    const muted = normalizePrefs({ categories: { licenseExpiry: false, schedule: false } });
    expect(shouldDeliverCategory(muted, "licenseHeld")).toBe(false);
    expect(shouldDeliverCategory(muted, "reviewQueue")).toBe(false);

    const explicit = normalizePrefs({ categories: { licenseExpiry: false }, push: { licenseHeld: "standard" } });
    expect(shouldDeliverCategory(explicit, "licenseHeld")).toBe(true);
  });

  it("keeps the admin categories on for records written before they existed", () => {
    const prefs = normalizePrefs({ categories: { gearPrep: false } });
    expect(prefs.categories.itemReports).toBe(true);
    expect(prefs.categories.systemAlerts).toBe(true);
    expect(prefs.categories.reviewQueue).toBe(true);
  });

  it("drops invalid levels and quiet-hour values", () => {
    const prefs = normalizePrefs({
      push: { trade: "loud" },
      quietHours: { enabled: true, start: "25:00", days: [1, 1, 9] },
    });
    expect(prefs.push.trade).toBe("standard");
    expect(prefs.quietHours).toMatchObject({ enabled: true, start: "22:00", days: [1] });
  });
});

describe("mergePrefs", () => {
  it("keeps stored fields the patch omits", () => {
    const stored = { badges: false, categories: { trade: false }, channels: { email: false, push: true } };
    const next = normalizePrefs(mergePrefs(stored, { channels: { push: false } }));
    expect(next.badges).toBe(false);
    expect(next.push.trade).toBe("off");
    expect(next.channels).toEqual({ email: false, push: false });
  });

  it("stores only chosen levels, so untouched categories follow the catalog", () => {
    const merged = mergePrefs(null, { push: { schedule: "standard" } });
    expect(merged.push).toEqual({ schedule: "standard" });
    expect(merged).not.toHaveProperty("categories");
  });

  it("does not freeze the inherited held-license value on unrelated saves", () => {
    const merged = mergePrefs({ categories: { licenseExpiry: false } }, { push: { schedule: "off" } });
    expect(merged.push).not.toHaveProperty("licenseHeld");

    const reenabled = normalizePrefs(mergePrefs(merged, { categories: { licenseExpiry: true } }));
    expect(reenabled.push.licenseExpiry).toBe("silent");
    expect(reenabled.push.licenseHeld).toBe("silent");
  });

  it("keeps a chosen level when a legacy client re-sends the category as true", () => {
    const merged = mergePrefs({ push: { schedule: "standard" } }, { categories: { schedule: true } });
    expect(merged.push.schedule).toBe("standard");
  });

  it("clears a pause only when the patch says so", () => {
    const stored = { pausedUntil: "2099-01-01T00:00:00.000Z" };
    expect(mergePrefs(stored, {}).pausedUntil).toBe("2099-01-01T00:00:00.000Z");
    expect(mergePrefs(stored, { pausedUntil: null }).pausedUntil).toBeNull();
  });

  it("merges quiet hours field by field", () => {
    const stored = { quietHours: { enabled: true, start: "21:00", end: "06:00", days: [1, 2], allowUrgent: false } };
    expect(mergePrefs(stored, { quietHours: { end: "08:00" } }).quietHours).toEqual({
      enabled: true,
      start: "21:00",
      end: "08:00",
      days: [1, 2],
      allowUrgent: false,
    });
  });
});

describe("isInQuietHours", () => {
  const tz = "America/Chicago";
  // 2026-09-23 is a Wednesday (day 3). Chicago is UTC-5 in September.
  const at = (local: string) => new Date(`${local}-05:00`);
  const overnight = { ...DEFAULT_QUIET_HOURS, enabled: true, start: "22:00", end: "07:00", days: [3] };

  it("covers an overnight window on its start day and the next morning", () => {
    expect(isInQuietHours(overnight, at("2026-09-23T21:59"), tz)).toBe(false);
    expect(isInQuietHours(overnight, at("2026-09-23T22:00"), tz)).toBe(true);
    expect(isInQuietHours(overnight, at("2026-09-24T06:59"), tz)).toBe(true);
    expect(isInQuietHours(overnight, at("2026-09-24T07:00"), tz)).toBe(false);
  });

  it("does not start a window on a day that is not selected", () => {
    expect(isInQuietHours(overnight, at("2026-09-24T23:00"), tz)).toBe(false);
    expect(isInQuietHours(overnight, at("2026-09-23T03:00"), tz)).toBe(false);
  });

  it("handles same-day and all-day windows", () => {
    const afternoon = { ...overnight, start: "13:00", end: "15:00" };
    expect(isInQuietHours(afternoon, at("2026-09-23T14:00"), tz)).toBe(true);
    expect(isInQuietHours(afternoon, at("2026-09-23T15:00"), tz)).toBe(false);

    const allDay = { ...overnight, start: "00:00", end: "00:00", days: [0, 6] };
    expect(isInQuietHours(allDay, at("2026-09-26T12:00"), tz)).toBe(true);
    expect(isInQuietHours(allDay, at("2026-09-23T12:00"), tz)).toBe(false);
  });

  it("is off when disabled", () => {
    expect(isInQuietHours({ ...overnight, enabled: false }, at("2026-09-23T23:00"), tz)).toBe(false);
  });
});

describe("resolvePushPresentation", () => {
  const noon = new Date("2026-09-23T17:00:00.000Z");

  it("maps levels to APNs presentation", () => {
    const prefs = normalizePrefs({ push: { trade: "standard", schedule: "silent", reservation: "off" } });
    expect(resolvePushPresentation(prefs, "trade", noon)).toEqual({ interruptionLevel: "active", sound: true });
    expect(resolvePushPresentation(prefs, "schedule", noon)).toEqual({ interruptionLevel: "passive", sound: false });
    expect(resolvePushPresentation(prefs, "reservation", noon)).toBeNull();
    expect(resolvePushPresentation(prefs, "checkoutOverdue", noon)).toEqual({
      interruptionLevel: "time-sensitive",
      sound: true,
    });
  });

  it("never pushes an email-only category", () => {
    expect(resolvePushPresentation(normalizePrefs(null), "itemReports", noon)).toBeNull();
  });

  it("suppresses everything while paused or with push off", () => {
    expect(resolvePushPresentation(normalizePrefs({ pausedUntil: "2099-01-01T00:00:00.000Z" }), "trade", noon)).toBeNull();
    expect(resolvePushPresentation(normalizePrefs({ channels: { push: false } }), undefined, noon)).toBeNull();
  });

  it("delivers silently during quiet hours, letting urgent alerts through when allowed", () => {
    const quiet = { enabled: true, start: "00:00", end: "00:00", days: [0, 1, 2, 3, 4, 5, 6] };
    const prefs = normalizePrefs({ quietHours: { ...quiet, allowUrgent: true } });
    expect(resolvePushPresentation(prefs, "trade", noon)).toEqual({ interruptionLevel: "passive", sound: false });
    expect(resolvePushPresentation(prefs, "checkoutOverdue", noon)?.interruptionLevel).toBe("time-sensitive");

    const strict = normalizePrefs({ quietHours: { ...quiet, allowUrgent: false } });
    expect(resolvePushPresentation(strict, "checkoutOverdue", noon)).toEqual({ interruptionLevel: "passive", sound: false });
  });
});

describe("PATCH/PUT /api/me/notification-preferences", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuth).mockResolvedValue(user);
  });

  it("merges a single changed field over the stored record", async () => {
    tx.user.findUnique.mockResolvedValue({ notificationPrefs: { badges: false, categories: { trade: false } } });

    const res = await send(PATCH, { categories: { schedule: false } });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(savedPrefs().badges).toBe(false);
    expect(savedPrefs().push).toEqual({ trade: "off", schedule: "off" });
    expect(body.data.categories).toMatchObject({ trade: false, schedule: false, reservation: true });
  });

  it("does not reset badges or newer categories when a shipped client PUTs its full record", async () => {
    tx.user.findUnique.mockResolvedValue({
      notificationPrefs: { badges: false, categories: { systemAlerts: false } },
    });

    // Shape sent by iOS builds that predate the newer categories.
    const res = await send(PUT, {
      pausedUntil: null,
      channels: { email: true, push: true },
      categories: {
        checkoutDue: true,
        checkoutOverdue: true,
        reservation: true,
        licenseExpiry: true,
        schedule: true,
        trade: true,
        gearPrep: true,
      },
    });

    expect(res.status).toBe(200);
    expect(savedPrefs().badges).toBe(false);
    expect(savedPrefs().push).toEqual({ systemAlerts: "off" });
  });

  it("returns the catalog filtered to the caller's role", async () => {
    tx.user.findUnique.mockResolvedValue({ notificationPrefs: null });

    const res = await send(PATCH, { push: { schedule: "standard" } });
    const body = await res.json();
    const ids = body.catalog.map((entry: { id: string }) => entry.id);

    expect(res.status).toBe(200);
    expect(ids).toContain("licenseHeld");
    expect(ids).not.toContain("reviewQueue");
    expect(ids).not.toContain("systemAlerts");
  });

  it("rejects a level for a category the caller's role does not receive", async () => {
    tx.user.findUnique.mockResolvedValue({ notificationPrefs: null });

    const res = await send(PATCH, { push: { reviewQueue: "off" } });

    expect(res.status).toBe(400);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("saves quiet hours and rejects malformed times", async () => {
    tx.user.findUnique.mockResolvedValue({ notificationPrefs: null });

    const bad = await send(PATCH, { quietHours: { start: "9pm" } });
    expect(bad.status).toBe(400);

    const res = await send(PATCH, { quietHours: { enabled: true, start: "21:30", days: [0, 6] } });
    expect(res.status).toBe(200);
    expect(savedPrefs().quietHours).toEqual({
      enabled: true,
      start: "21:30",
      end: "07:00",
      days: [0, 6],
      allowUrgent: true,
    });
  });

  it("rejects an unknown value type without writing", async () => {
    tx.user.findUnique.mockResolvedValue({ notificationPrefs: null });

    const res = await send(PATCH, { channels: { push: "no" } });

    expect(res.status).toBe(400);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
