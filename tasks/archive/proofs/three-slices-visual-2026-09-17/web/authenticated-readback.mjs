import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = "/Users/role/Code/wisconsin-creative";
const proof = join(root, "tasks/archive/proofs/three-slices-visual-2026-09-17");
const auth = JSON.parse(readFileSync(join(root, "test-results/playwright/auth/user.json"), "utf8"));
const cookie = auth.cookies.find((c) => c.name === "gear-tracker-session");
if (!cookie?.value) throw new Error("Missing local session cookie");

async function api(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:3000${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      Cookie: `gear-tracker-session=${cookie.value}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { text: text.slice(0, 200) };
  }
  return { path, status: response.status, body };
}

const me = await api("/api/me");
const meUser = me.body?.user ?? me.body;

const now = new Date();
const from = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
const to = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString();

const events = await api(
  `/api/calendar-events?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&includePast=true`,
);
const eventRows = events.body?.data ?? events.body ?? [];

const shiftGroups = await api(
  `/api/shift-groups?startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&limit=200`,
);
const groups = shiftGroups.body?.data ?? [];

const pending = groups
  .filter((g) => g.hasWorkingCopy || g.claimsPaused || g.pendingRelease)
  .map((g) => ({
    id: g.id,
    eventId: g.eventId,
    summary: g.event?.summary ?? null,
    claimsPaused: g.claimsPaused ?? null,
    hasWorkingCopy: g.hasWorkingCopy ?? null,
    pendingRelease: g.pendingRelease ?? null,
    endsAt: g.event?.endsAt ?? null,
  }));

const combined = (Array.isArray(eventRows) ? eventRows : [])
  .filter((e) => (e.combinedEvents && e.combinedEvents.length) || e.combinedIntoId)
  .slice(0, 8)
  .map((e) => ({
    id: e.id,
    summary: e.summary,
    combinedCount: 1 + (e.combinedEvents?.length ?? 0),
    combinedIntoId: e.combinedIntoId ?? null,
  }));

const badges = await api("/api/badges");
const awardCatalog = await api("/api/badges?manualOnly=true");
const catalog = Array.isArray(badges.body)
  ? badges.body
  : badges.body?.data ?? badges.body?.definitions ?? [];
const manuals = Array.isArray(awardCatalog.body)
  ? awardCatalog.body
  : awardCatalog.body?.data ?? [];
const catalogKeys = Array.isArray(catalog)
  ? catalog.map((b) => b.key).filter(Boolean)
  : [];

const profile = await api(`/api/badges/user/${meUser.id}`);
const profileData = profile.body ?? {};
const completion = await api("/api/me/profile-completion");
const completionData = completion.body?.data ?? completion.body ?? {};

const summary = {
  me: {
    status: me.status,
    role: meUser?.role ?? null,
    name: meUser?.name ?? null,
    emailLocal: typeof meUser?.email === "string" ? meUser.email.split("@")[0] : null,
  },
  events: { status: events.status, count: Array.isArray(eventRows) ? eventRows.length : null },
  shiftGroups: { status: shiftGroups.status, count: groups.length, pendingCount: pending.length, pending },
  combined,
  badges: {
    status: badges.status,
    catalogCount: catalogKeys.length,
    hasPlanAhead: catalogKeys.includes("plan_ahead"),
    hasCrewCheckout: catalogKeys.includes("crew_checkout"),
    hasEventHero: catalogKeys.includes("event_hero"),
    hasAboveAndBeyond: catalogKeys.includes("above_and_beyond"),
    awardCatalogStatus: awardCatalog.status,
    awardCatalogCount: Array.isArray(manuals) ? manuals.length : null,
    awardCatalogHasEventHero: Array.isArray(manuals) && manuals.some((b) => b.key === "event_hero"),
    awardCatalogHasAboveAndBeyond: Array.isArray(manuals) && manuals.some((b) => b.key === "above_and_beyond"),
  },
  profile: {
    status: profile.status,
    earned: (profileData.data ?? profileData).earnedCount
      ?? (profileData.data ?? profileData).badges?.filter((b) => b.earned)?.length
      ?? null,
    streakCount: Array.isArray((profileData.data ?? profileData).streaks)
      ? (profileData.data ?? profileData).streaks.length
      : null,
    streakNames: Array.isArray((profileData.data ?? profileData).streaks)
      ? (profileData.data ?? profileData).streaks.map((s) => s.name || s.label || s.key).slice(0, 8)
      : [],
  },
  profileCompletion: {
    status: completion.status,
    shouldPrompt: completionData.completion?.shouldPrompt ?? null,
    isComplete: completionData.completion?.isComplete ?? null,
    leakedHiddenFlag: Object.prototype.hasOwnProperty.call(completionData.profile ?? {}, "hiddenFromRoster"),
  },
};

mkdirSync(join(proof, "web"), { recursive: true });
writeFileSync(join(proof, "web/authenticated-readback.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
