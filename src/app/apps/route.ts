import { NextResponse } from "next/server";
import { renderAppsPage } from "@/lib/apps-page";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { loginPathWithReturnTo } from "@/lib/return-to";

export const dynamic = "force-dynamic";

/** Internal apps and tools page: signed-in staff only. */
export async function GET(request: Request) {
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
  return new NextResponse(renderAppsPage(), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
