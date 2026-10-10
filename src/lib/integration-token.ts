import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { withHandler } from "@/lib/api";

/**
 * Machine-to-machine access for a named integration, by a bearer token kept
 * in an environment variable. Same shape as `withCron`, with its own secret
 * per integration so one can be rotated or revoked without touching others.
 * Unset means the integration is off (503), never open.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export function withIntegrationToken<P extends Record<string, string> = Record<string, string>>(
  envName: string,
  handler: (req: Request, ctx: { params: P }) => Promise<NextResponse>,
) {
  return withHandler<P>(async (req, ctx) => {
    const secret = process.env[envName];
    if (!secret) {
      return NextResponse.json({ error: "Integration not configured" }, { status: 503 });
    }
    const supplied = req.headers.get("authorization") ?? "";
    if (!safeCompare(supplied, `Bearer ${secret}`)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return handler(req, ctx);
  });
}
