import { NextResponse } from "next/server";
import { renderProductPage } from "@/lib/app-product-page";
import { offloadPage } from "@/lib/app-product-pages";
import { loadLiveVersions, type LiveVersions } from "@/lib/apps-live-versions";

export const dynamic = "force-dynamic";

/** Public offload product page at wisconsincreative.com/apps/offload. Like /apps, it is noindex. */
export async function GET(request: Request) {
  const live = await loadLiveVersions().catch((): LiveVersions => ({}));
  return new NextResponse(renderProductPage(offloadPage, request.headers.get("x-nonce") ?? undefined, live.offload), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
