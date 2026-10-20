import { NextResponse } from "next/server";
import { renderProductPage } from "@/lib/app-product-page";
import { productPages } from "@/lib/app-product-pages";
import { loadLiveVersions, type LiveVersions } from "@/lib/apps-live-versions";

export const dynamic = "force-dynamic";

/** Public, static-content app overviews. No team or archive data is loaded. */
export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const page = productPages.find((candidate) => candidate.slug === slug);
  if (!page) return new NextResponse("App not found", { status: 404 });
  const live = page.slug === "wisconsin-creative"
    ? await loadLiveVersions().catch((): LiveVersions => ({}))
    : {};
  return new NextResponse(renderProductPage(page, request.headers.get("x-nonce") ?? undefined, live["wisconsin-creative"]), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}
