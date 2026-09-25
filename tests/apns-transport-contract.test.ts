import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("APNs transport contract", () => {
  const source = (relativeFile: string) =>
    readFileSync(path.join(process.cwd(), relativeFile), "utf8");

  it("attaches a session error handler and request timeouts", () => {
    const apns = source("src/lib/push/apns.ts");
    // Every send path connects through the guarded helper — an unhandled
    // http2 session "error" event would kill the serverless function.
    expect(apns).toContain('client.on("error"');
    // The only raw http2.connect lives inside connectApns.
    expect((apns.match(/http2\.connect\(/g) ?? []).length).toBe(1);
    expect(apns).toContain("connectApns(host, budget)");
    expect(apns).toContain("req.setTimeout(requestTimeoutMs");
  });

  it("BUG: bounds the full APNs dispatch across provider and environment retries", () => {
    const apns = source("src/lib/push/apns.ts");
    const readTimeout = (name: string) => {
      const match = apns.match(new RegExp(`const ${name} = ([\\d_]+);`));
      if (!match?.[1]) throw new Error(`Missing ${name}`);
      return Number(match[1].replaceAll("_", ""));
    };
    const dispatchTimeout = readTimeout("APNS_DISPATCH_TIMEOUT_MS");
    const requestTimeout = readTimeout("APNS_REQUEST_TIMEOUT_MS");

    expect(dispatchTimeout).toBeLessThan(10_000);
    expect(requestTimeout * 3).toBeLessThan(dispatchTimeout);
    expect(apns).toContain("deadlineAt: Date.now() + APNS_DISPATCH_TIMEOUT_MS");
    expect(apns).toContain("Math.min(APNS_REQUEST_TIMEOUT_MS, remainingDispatchMs(budget))");
    expect(apns).toContain("if (authFailed.length > 0 && hasDispatchBudget(budget))");
    expect(apns).toContain("if (wrongEnv.length > 0 && hasDispatchBudget(budget))");

    const dispatch = apns.slice(
      apns.indexOf("async function dispatch("),
      apns.indexOf("export async function sendPush("),
    );
    expect(dispatch).toContain("const deadlineTimer = setTimeout(");
    expect(dispatch).toContain("for (const client of budget.sessions) client.destroy()");
    expect(dispatch).toContain("finally {");
    expect(dispatch).toContain("clearTimeout(deadlineTimer)");
  });

  it("caches the provider JWT instead of minting one per send", () => {
    const apns = source("src/lib/push/apns.ts");
    expect(apns).toContain("cachedJwt");
    // All sends fetch the token via the cache, never mint directly.
    expect((apns.match(/getJwt\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(apns).not.toContain("const jwt = makeJWT();");
  });

  it("retries wrong-environment tokens on the other APNs host before revoking", () => {
    const apns = source("src/lib/push/apns.ts");
    // Dev builds hold sandbox tokens even against the production server;
    // revoking on the first BadDeviceToken permanently silences those devices.
    expect(apns).toContain("APNS_FALLBACK_HOST");
    expect(apns).toContain('outcomes.get(t) === "badToken"');
    // Auth failures re-mint the provider JWT instead of failing the batch.
    expect(apns).toContain("invalidateJwt()");
  });

  it("omits the sound for silent deliveries and takes presentation from prefs", () => {
    const apns = source("src/lib/push/apns.ts");
    const notifications = source("src/lib/services/notifications.ts");
    expect(apns).toContain('...(opts.sound === false ? {} : { sound: "default" })');
    expect(notifications).toContain("const presentation = resolvePushPresentation(prefs, opts.category, now);");
    expect(notifications).toContain("interruptionLevel: presentation.interruptionLevel,");
    expect(notifications).toContain("sound: presentation.sound,");
    // One Notification Center stack per category, and the icon badge tracks
    // the unread inbox (the iOS app re-syncs it as rows are read).
    expect(apns).toContain('...(opts.threadId ? { "thread-id": opts.threadId } : {})');
    expect(apns).toContain("...(opts.badge !== undefined ? { badge: opts.badge } : {})");
    expect(notifications).toContain("threadId: pushThreadId(opts.payload, opts.category),");
    expect(notifications).toContain("if (bookingId) return `booking-${bookingId}`;");
    expect(notifications).toContain("if (eventId) return `event-${eventId}`;");
    // A later stage replaces the earlier alert; unrelated alerts never collapse.
    expect(apns).toContain('...(opts.collapseId ? { "apns-collapse-id": opts.collapseId.slice(0, 64) } : {})');
    expect(notifications).toContain("collapseId: opts.collapseId ?? opts.notificationId,");
    expect(notifications).toContain("? `checkout-${args.checkout.id}`");
    expect(apns).toContain('...(opts.relevanceScore !== undefined ? { "relevance-score": opts.relevanceScore } : {})');
    expect(notifications).toContain("db.notification.count({ where: { userId, readAt: null } })");
    expect(source("ios/Wisconsin/Core/AppState.swift")).toContain("setBadgeCount(count)");
  });

  it("sendPushToUser never throws into fire-and-forget call sites", () => {
    const notifications = source("src/lib/services/notifications.ts");
    const fnStart = notifications.indexOf("export async function sendPushToUser");
    const fnBody = notifications.slice(fnStart, notifications.indexOf("export", fnStart + 1));
    expect(fnBody).toContain("try {");
    expect(fnBody).toContain("catch (err)");
  });
});
