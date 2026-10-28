import type { NextResponse } from "next/server";

/** A JSON response the server read for a page, keyed by the API URL the browser would have requested. */
export type FetchSeed = { url: string; json: unknown; fetchedAt: number };

/** A value for a query key, already in the shape that query's function returns. */
export type QuerySeed = { key: readonly unknown[]; data: unknown; fetchedAt: number };

type ApiHandler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<NextResponse>;

/**
 * Runs an API route's own handler while the page renders, so the first paint holds the data and the browser
 * skips the matching request. The same code, auth and queries run once either way. Any failure returns
 * null and the browser makes its normal request.
 */
export async function readSeed(handler: ApiHandler, url: string): Promise<FetchSeed | null> {
  try {
    const response = await handler(new Request(`http://internal${url}`), { params: Promise.resolve({}) });
    if (!response.ok) return null;
    return { url, json: await response.json(), fetchedAt: Date.now() };
  } catch {
    return null;
  }
}
