import { EventEmitter } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.hoisted(() => vi.fn());
const APNS_P8_KEY = Buffer.from(
  generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey.export({ type: "pkcs8", format: "pem" }),
).toString("base64");
vi.mock("http2", () => ({ default: { connect, constants: { NGHTTP2_CANCEL: 8 } } }));

type Sent = { headers: Record<string, string>; body: Record<string, unknown> & { aps: Record<string, unknown> } };
type Reply = { status: number; body?: string } | "throw" | "error";

/** Fake APNs: records each request and answers from the queue, 200 by default. */
function fakeApns(replies: Reply[] = []) {
  const sent: Sent[] = [];
  connect.mockImplementation(() => {
    const session = new EventEmitter();
    return Object.assign(session, {
      destroy: () => session.emit("close"),
      request: (headers: Record<string, string>) => {
        const reply = replies.shift() ?? { status: 200 };
        if (reply === "throw") throw new Error("session destroyed");
        const stream = new EventEmitter();
        return Object.assign(stream, {
          setTimeout: vi.fn(),
          close: vi.fn(),
          end: (payload: string) => {
            sent.push({ headers, body: JSON.parse(payload) });
            queueMicrotask(() => {
              if (reply === "error") return stream.emit("error", new Error("reset"));
              stream.emit("response", { ":status": reply.status });
              if (reply.body !== undefined) stream.emit("data", Buffer.from(reply.body));
              stream.emit("end");
            });
          },
        });
      },
    });
  });
  return sent;
}

async function load() {
  return import("@/lib/push/apns");
}

beforeEach(() => {
  vi.resetModules();
  connect.mockReset();
  vi.stubEnv("APNS_KEY_ID", "test-key");
  vi.stubEnv("APNS_TEAM_ID", "test-team");
  vi.stubEnv("APNS_BUNDLE_ID", "test.app");
  vi.stubEnv("APNS_P8_KEY", APNS_P8_KEY);
  vi.stubEnv("VERCEL_ENV", "production");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("sendPush", () => {
  it("builds the alert with every presentation option", async () => {
    const sent = fakeApns();
    const { sendPush } = await load();

    const result = await sendPush(["tok-1"], {
      title: "Due back soon", subtitle: "Football at Iowa", body: "Return by 5 PM",
      payload: { bookingId: "b1" }, category: "CHECKOUT", interruptionLevel: "time-sensitive",
      threadId: "booking-b1", badge: 3, relevanceScore: 0.8, collapseId: "x".repeat(80), filterCriteria: "gear",
    });

    expect(result).toEqual({ revoked: [], accepted: ["tok-1"], ok: 1 });
    expect(sent[0]!.headers).toEqual(expect.objectContaining({
      ":path": "/3/device/tok-1", "apns-topic": "test.app", "apns-push-type": "alert", "apns-collapse-id": "x".repeat(64),
    }));
    expect(sent[0]!.headers.authorization).toMatch(/^bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(sent[0]!.body).toEqual({
      aps: {
        alert: { title: "Due back soon", subtitle: "Football at Iowa", body: "Return by 5 PM" },
        sound: "default", "thread-id": "booking-b1", badge: 3, "relevance-score": 0.8,
        "interruption-level": "time-sensitive", category: "CHECKOUT", "filter-criteria": "gear",
      },
      bookingId: "b1",
    });
  });

  it("defaults to a passive alert and drops unset options, including the sound when silent", async () => {
    const sent = fakeApns();
    const { sendPush } = await load();

    await sendPush(["tok-1"], { title: "Hi", body: "There", sound: false, badge: 0 });

    expect(sent[0]!.body).toEqual({ aps: { alert: { title: "Hi", body: "There" }, badge: 0, "interruption-level": "passive" } });
    expect(sent[0]!.headers).not.toHaveProperty("apns-collapse-id");
    expect(sent[0]!.headers).not.toHaveProperty("apns-priority");
  });

  it("sends nothing when APNs is not configured or there are no tokens", async () => {
    vi.stubEnv("APNS_P8_KEY", "");
    const { sendPush } = await load();

    expect(await sendPush(["tok-1"], { title: "Hi", body: "There" })).toEqual({ revoked: [], accepted: [], ok: 0 });
    vi.stubEnv("APNS_P8_KEY", APNS_P8_KEY);
    expect(await sendPush([], { title: "Hi", body: "There" })).toEqual({ revoked: [], accepted: [], ok: 0 });
    expect(connect).not.toHaveBeenCalled();
  });

  it("counts a broken stream, an unreadable reply or a server error as not delivered, without revoking", async () => {
    // The failures go to the primary host; nothing is retried on the other environment.
    fakeApns(["throw", "error", { status: 500, body: "<html>" }, { status: 429, body: JSON.stringify({ reason: "TooManyRequests" }) }]);
    const { sendPush } = await load();

    const result = await sendPush(["a", "b", "c", "d"], { title: "Hi", body: "There" });

    expect(result).toEqual({ revoked: [], accepted: [], ok: 0 });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("0/4 delivered"));
  });
});

describe("sendCompanionInvalidation", () => {
  it("sends a low-priority background nudge to the Mac app", async () => {
    const sent = fakeApns();
    const { sendCompanionInvalidation } = await load();

    await sendCompanionInvalidation(["mac-1"], "v42");

    expect(sent[0]!.headers).toEqual(expect.objectContaining({ "apns-topic": "com.erikrole.GearOps", "apns-push-type": "background", "apns-priority": "5" }));
    expect(sent[0]!.body).toEqual({ aps: { "content-available": 1 }, companionProjectionVersion: "v42" });
  });

  it("uses the configured Mac bundle id", async () => {
    vi.stubEnv("APNS_MACOS_BUNDLE_ID", "test.mac");
    const sent = fakeApns();
    const { sendCompanionInvalidation } = await load();

    await sendCompanionInvalidation(["mac-1"], "v42");

    expect(sent[0]!.headers["apns-topic"]).toBe("test.mac");
  });
});

describe("checkout return Live Activity", () => {
  const endsAt = new Date("2026-10-25T22:00:00.000Z");
  const now = new Date("2026-10-25T20:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });
  afterEach(() => { vi.useRealTimers(); });

  it("starts with the booking attributes, a stale date six hours after the due time, and an alert", async () => {
    const sent = fakeApns();
    const { startCheckoutReturnLiveActivityTokens } = await load();

    await startCheckoutReturnLiveActivityTokens(
      ["la-1"],
      { bookingId: "b1", bookingTitle: "Football at Iowa", requesterName: "Ada", requesterInitials: "A", returnTimeText: "Due 5:00 PM" },
      { endsAt, allowsExtend: true, urgency: "warning" },
    );

    expect(sent[0]!.headers).toEqual(expect.objectContaining({ "apns-topic": "test.app.push-type.liveactivity", "apns-push-type": "liveactivity" }));
    expect(sent[0]!.body.aps).toEqual({
      timestamp: now.getTime() / 1000,
      event: "start",
      "attributes-type": "CheckoutReturnActivityAttributes",
      attributes: { bookingId: "b1", bookingTitle: "Football at Iowa", requesterName: "Ada", requesterInitials: "A", requesterAvatarUrl: null, returnTimeText: "Due 5:00 PM" },
      "content-state": { endsAt: endsAt.toISOString(), now: now.toISOString(), nextNeedAt: null, allowsExtend: true, urgency: "warning" },
      "stale-date": endsAt.getTime() / 1000 + 6 * 60 * 60,
      "input-push-token": 1,
      alert: { title: "Football at Iowa", body: "Due 5:00 PM" },
    });
  });

  it("updates the state, with an alert only when asked", async () => {
    const sent = fakeApns();
    const { updateCheckoutReturnLiveActivityTokens } = await load();
    const nextNeedAt = new Date("2026-10-26T14:00:00.000Z");

    await updateCheckoutReturnLiveActivityTokens(["la-1"], { endsAt, nextNeedAt, allowsExtend: false, urgency: "overdue" });
    await updateCheckoutReturnLiveActivityTokens(["la-1"], { endsAt, allowsExtend: false, urgency: "critical" }, { alert: { title: "Overdue", body: "Bring it back" } });

    expect(sent[0]!.body.aps).toEqual({
      timestamp: now.getTime() / 1000,
      event: "update",
      "content-state": { endsAt: endsAt.toISOString(), now: now.toISOString(), nextNeedAt: nextNeedAt.toISOString(), allowsExtend: false, urgency: "overdue" },
    });
    expect(sent[1]!.body.aps).toEqual(expect.objectContaining({ alert: { title: "Overdue", body: "Bring it back" } }));
  });

  it("ends as returned and dismisses two minutes later", async () => {
    const sent = fakeApns();
    const { endCheckoutReturnLiveActivityTokens } = await load();

    await endCheckoutReturnLiveActivityTokens(["la-1"]);

    expect(sent[0]!.body.aps).toEqual({
      timestamp: now.getTime() / 1000,
      event: "end",
      "dismissal-date": now.getTime() / 1000 + 120,
      "content-state": { endsAt: now.toISOString(), now: now.toISOString(), nextNeedAt: null, allowsExtend: false, urgency: "returned" },
    });
  });
});
