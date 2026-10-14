import { NextResponse } from "next/server";
import { loadLiveVersions } from "@/lib/apps-live-versions";
import { renderAppsPage } from "@/lib/apps-page";

export const dynamic = "force-dynamic";

/**
 * Public apps and tools directory at wisconsincreative.com/apps.
 * Middleware does not authenticate. It only attaches a CSP nonce, and this
 * path is included because it has no file extension. The page stays noindex.
 */
export async function GET(request: Request) {
  const live = await loadLiveVersions().catch(() => ({}));
  return new NextResponse(renderAppsPage(request.headers.get("x-nonce") ?? undefined, live), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
