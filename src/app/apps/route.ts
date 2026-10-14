import { NextResponse } from "next/server";
import { loadLiveVersions } from "@/lib/apps-live-versions";
import { renderAppsPage } from "@/lib/apps-page";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { loginPathWithReturnTo } from "@/lib/return-to";

export const dynamic = "force-dynamic";

/** Internal apps and tools page: signed-in staff only. */
export async function GET(request: Request) {
  // `next dev` only: lets /apps be developed without a local database. Production builds never take this path.
  if (process.env.NODE_ENV === "development")
    return await htmlResponse(request);
  try {
    const user = await requireAuth();
    if (user.forcePasswordChange)
      return NextResponse.redirect(new URL("/change-password", request.url));
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      return NextResponse.redirect(
        new URL(loginPathWithReturnTo("/apps"), request.url),
      );
    }
    throw error;
  }
  return await htmlResponse(request);
}

async function htmlResponse(request: Request) {
  const live = await loadLiveVersions().catch(() => ({}));
  return new NextResponse(
    renderAppsPage(request.headers.get("x-nonce") ?? undefined, live),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex",
      },
    },
  );
}
