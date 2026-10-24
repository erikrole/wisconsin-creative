import { z } from "zod";
import { withAuth } from "@/lib/api";
import { ok } from "@/lib/http";
import { enforceRateLimit, SETTINGS_MUTATION_LIMIT } from "@/lib/rate-limit";
import { SIDEBAR_PREFS_MAX_ITEMS, loadSidebarPrefs, saveSidebarPrefs } from "@/lib/services/sidebar-prefs";

const hrefs = z.array(z.string().max(128)).max(SIDEBAR_PREFS_MAX_ITEMS);
const putSchema = z.object({ pinned: hrefs, hidden: hrefs });

/** GET /api/me/sidebar-prefs — the caller's pinned and hidden sidebar pages, or null if never saved. */
export const GET = withAuth(async (_req, { user }) => {
  return ok({ data: await loadSidebarPrefs(user.id) });
});

/** PUT /api/me/sidebar-prefs — replaces the caller's pinned and hidden sidebar pages. */
export const PUT = withAuth(async (req, { user }) => {
  await enforceRateLimit(`sidebar-prefs:${user.id}`, SETTINGS_MUTATION_LIMIT);
  const body = putSchema.parse(await req.json());
  return ok({ data: await saveSidebarPrefs(user.id, body) });
});
