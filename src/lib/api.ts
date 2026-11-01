import { after, NextResponse } from "next/server";
import { bumpScheduleRevision, isScheduleMutation } from "@/lib/schedule-live";
import { bearerTokenFrom, isTokenBlockedRequest } from "@/lib/api-token";
import { requireAuth, requireKiosk, type AuthUser, type KioskContext } from "@/lib/auth";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";
import { failRequest, tagRequestJsonParseErrors } from "@/lib/api-handler";
import { deferCompanionProjectionRefresh } from "@/lib/services/companion-projection-publisher";
import { isRolePreviewBlockedRequest, readRolePreviewFromRequest } from "@/lib/role-preview";
import { recordPreviewActivity } from "@/lib/preview-activity";

export { withHandler } from "@/lib/api-handler";

type AuthCtx<P extends Record<string, string> = Record<string, string>> = {
  user: AuthUser;
  params: P;
};

function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) {
    throw new HttpError(403, "Origin header required for mutating requests");
  }

  if (!allowedSameOrigins(req).has(origin)) {
    throw new HttpError(403, "Cross-origin request blocked");
  }
}

// Kiosk and user mutations share the same trust model: an Origin header that
// matches the request's own origin or a configured trusted origin.
const assertKioskSameOrigin = assertSameOrigin;

/**
 * Origins accepted for CSRF checks. We trust the request's own origin
 * (`req.url`, which on Vercel is set by the platform, not the client) and an
 * explicit env-configured allowlist. We deliberately do NOT derive an origin
 * from `x-forwarded-host`/`x-forwarded-proto`: behind a misconfigured proxy
 * those are client-controllable and would let an attacker forge an allowed
 * Origin. In development we widen the loopback host to both schemes so Next's
 * internal scheme reporting doesn't reject local browser requests.
 */
function allowedSameOrigins(req: Request): Set<string> {
  const requestUrl = new URL(req.url);
  const origins = new Set<string>([requestUrl.origin]);

  for (const trusted of env.trustedOrigins) {
    origins.add(trusted);
  }

  if (process.env.NODE_ENV !== "production" && isLoopbackHost(requestUrl.hostname)) {
    const port = requestUrl.port ? `:${requestUrl.port}` : "";
    for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
      origins.add(`http://${hostname}${port}`);
      origins.add(`https://${hostname}${port}`);
    }
  }

  return origins;
}

function isLoopbackHost(host: string): boolean {
  const hostname = host.replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
}

function isForcePasswordAllowed(req: Request): boolean {
  const pathname = new URL(req.url).pathname;
  return (
    (req.method === "PATCH" && pathname === "/api/profile") ||
    (req.method === "POST" && pathname === "/api/me/change-password") ||
    (req.method === "POST" && pathname === "/api/auth/logout")
  );
}

function isOnboardingAllowed(req: Request, user: AuthUser): boolean {
  const path = new URL(req.url).pathname;
  if (isForcePasswordAllowed(req) && (path !== "/api/profile" || user.forcePasswordChange)) return true;
  return (req.method === "GET" && path === "/api/me")
    || ((req.method === "GET" || req.method === "PATCH") && path === "/api/me/profile-completion")
    || (["GET", "POST", "DELETE"].includes(req.method) && path === `/api/users/${encodeURIComponent(user.id)}/avatar`)
    || (req.method === "POST" && [
      "/api/auth/passkey/registration/options", "/api/auth/passkey/registration/verify",
      "/api/diagnostics",
    ].includes(path));
}

/**
 * Authenticated API route handler.
 * Wraps try/catch, calls requireAuth(), and resolves dynamic params.
 *
 * For routes with dynamic segments, supply the param shape as a generic:
 *   `withAuth<{ id: string }>(async (req, { user, params }) => { ... })`
 *
 * For routes without dynamic segments, omit the generic:
 *   `withAuth(async (req, { user }) => { ... })`
 */
export function withAuth<P extends Record<string, string> = Record<string, string>>(
  handler: (req: Request, ctx: AuthCtx<P>) => Promise<NextResponse>
) {
  return async (req: Request, context: { params: Promise<P> }): Promise<NextResponse> => {
    let user: AuthUser | null = null;
    try {
      const mutating = req.method !== "GET" && req.method !== "HEAD";
      // CSRF: validate Origin header on mutating requests. A bearer token is
      // never attached by a browser on its own, so token requests skip it.
      if (mutating && !bearerTokenFrom(req.headers.get("authorization"))) {
        assertSameOrigin(req);
      }
      user = await requireAuth();
      if (user.apiTokenScope && isTokenBlockedRequest(new URL(req.url).pathname, req.method)) {
        throw new HttpError(403, "This route needs a signed-in session, not an API token");
      }
      if (mutating && user.apiTokenScope === "READ") {
        throw new HttpError(403, "This API token is read-only");
      }
      await recordPreviewActivity();
      if (user.forcePasswordChange && !isForcePasswordAllowed(req)) {
        throw new HttpError(403, "Password change required before continuing");
      }
      if (user.onboardingRequired && !isOnboardingAllowed(req, user)) {
        throw new HttpError(403, "Complete your required setup before continuing", { code: "ONBOARDING_REQUIRED" });
      }
      if (user.preview && isRolePreviewBlockedRequest(req)) {
        throw new HttpError(403, "Preview mode is read-only");
      }
      const params = (context?.params ? await context.params : {}) as P;
      const response = await handler(tagRequestJsonParseErrors(req), { user, params });
      deferCompanionProjectionRefresh(req, response);
      deferScheduleRevisionBump(req, response);
      return response;
    } catch (error) {
      return failRequest(error, req, user);
    }
  };
}

function deferScheduleRevisionBump(req: Request, response: Response) {
  if (process.env.NODE_ENV === "test" || !isScheduleMutation(req, response)) return;
  try {
    after(bumpScheduleRevision);
  } catch {
    void bumpScheduleRevision();
  }
}

type KioskCtx<P extends Record<string, string> = Record<string, string>> = {
  kiosk: KioskContext;
  params: P;
};

const KIOSK_MAX_BODY_BYTES = 256 * 1024;
export const KIOSK_MUTATION_LIMIT = { max: 300, windowMs: 60_000 };

/**
 * Kiosk-authenticated API route handler.
 * Validates kiosk device session cookie (not user session).
 * CSRF origin check included for mutating requests.
 */
export function withKiosk<P extends Record<string, string> = Record<string, string>>(
  handler: (req: Request, ctx: KioskCtx<P>) => Promise<NextResponse>,
  options: {
    /**
     * Runs after the CSRF and role-preview checks and before the database
     * session lookup. Return a response to answer without touching Neon, or
     * null to continue to `handler`.
     */
    withoutDatabase?: (req: Request) => Promise<NextResponse | null>;
    /** Largest accepted request body in bytes. Defaults to 256 KB. */
    maxBodyBytes?: number;
  } = {},
) {
  return async (req: Request, context: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      // CSRF: require Origin on mutating requests (matches withAuth).
      const mutating = req.method !== "GET" && req.method !== "HEAD";
      if (mutating) {
        assertKioskSameOrigin(req);
        // Kiosk bodies are small JSON; refuse a declared oversize body before
        // any session lookup or parsing.
        const declared = Number(req.headers.get("content-length") ?? "0");
        if (declared > (options.maxBodyBytes ?? KIOSK_MAX_BODY_BYTES)) {
          throw new HttpError(413, "Request body too large");
        }
      }
      if (await readRolePreviewFromRequest(req)) {
        throw new HttpError(403, "Kiosk access is unavailable in role preview");
      }
      const early = options.withoutDatabase ? await options.withoutDatabase(req) : null;
      if (early) return early;
      const kiosk = await requireKiosk();
      // A stolen or runaway kiosk session cannot flood writes. The budget is
      // far above rapid scanning (about 2 scans a second); it lives in Redis,
      // never Neon.
      if (mutating) {
        await enforceRateLimit(`kiosk:mutations:${kiosk.kioskId}`, KIOSK_MUTATION_LIMIT);
      }
      const params = (context?.params ? await context.params : {}) as P;
      const response = await handler(tagRequestJsonParseErrors(req), { kiosk, params });
      deferCompanionProjectionRefresh(req, response);
      return response;
    } catch (error) {
      return failRequest(error, req);
    }
  };
}
