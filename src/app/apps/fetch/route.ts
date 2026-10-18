import { NextResponse } from "next/server";
import { renderProductPage } from "@/lib/app-product-page";
import { fetchPage } from "@/lib/app-product-pages";
import { loadLiveVersions, type LiveVersions } from "@/lib/apps-live-versions";

export const dynamic = "force-dynamic";

/** Public fetch product page at wisconsincreative.com/apps/fetch. Like /apps, it is noindex. */
export async function GET(request: Request) {
  const live = await loadLiveVersions().catch((): LiveVersions => ({}));
  return new NextResponse(renderProductPage(fetchPage, request.headers.get("x-nonce") ?? undefined, live.fetch), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
