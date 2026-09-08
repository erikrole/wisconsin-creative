import { EventEmitter } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.hoisted(() => vi.fn());
vi.mock("http2", () => ({ default: { connect, constants: { NGHTTP2_CANCEL: 8 } } }));

type Response = { status: number; reason?: string };
function respond(responses: Response[]) {
  connect.mockImplementation(() => {
    const session = new EventEmitter();
    return Object.assign(session, {
      destroy: () => session.emit("close"),
      request: () => {
        const response = responses.shift();
        if (!response) throw new Error("Unexpected extra APNs request");
        const stream = new EventEmitter();
        return Object.assign(stream, {
          setTimeout: vi.fn(), close: vi.fn(),
          end: () => queueMicrotask(() => {
            stream.emit("response", { ":status": response.status });
            stream.emit("data", Buffer.from(JSON.stringify({ reason: response.reason })));
            stream.emit("end");
          }),
        });
      },
    });
  });
}

beforeEach(() => {
  vi.resetModules();
  connect.mockReset();
  vi.stubEnv("APNS_KEY_ID", "test-key");
  vi.stubEnv("APNS_TEAM_ID", "test-team");
  vi.stubEnv("APNS_BUNDLE_ID", "test.app");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  vi.stubEnv("APNS_P8_KEY", Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" })).toString("base64"));
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("expired APNs device tokens", () => {
  it("retires an expired token after the alternate environment also rejects it", async () => {
    respond([{ status: 410, reason: "ExpiredToken" }, { status: 400, reason: "BadDeviceToken" }]);
    const { sendPush } = await import("@/lib/push/apns");
    expect(await sendPush(["device"], { title: "Test", body: "Test" })).toEqual({ revoked: ["device"], accepted: [], ok: 0 });
    expect(connect).toHaveBeenCalledTimes(2);
  });
  it("preserves a token accepted by the alternate environment", async () => {
    respond([{ status: 410, reason: "ExpiredToken" }, { status: 200 }]);
    const { sendPush } = await import("@/lib/push/apns");
    expect(await sendPush(["device"], { title: "Test", body: "Test" })).toEqual({ revoked: [], accepted: ["device"], ok: 1 });
  });
  it("does not revoke on an inconclusive alternate response", async () => {
    respond([{ status: 410, reason: "ExpiredToken" }, { status: 503, reason: "ServiceUnavailable" }]);
    const { sendPush } = await import("@/lib/push/apns");
    expect((await sendPush(["device"], { title: "Test", body: "Test" })).revoked).toEqual([]);
  });
  it("refreshes a provider token without revoking the device", async () => {
    respond([{ status: 403, reason: "ExpiredProviderToken" }, { status: 200 }]);
    const { sendPush } = await import("@/lib/push/apns");
    expect((await sendPush(["device"], { title: "Test", body: "Test" })).accepted).toEqual(["device"]);
    expect(connect.mock.calls[0]?.[0]).toBe(connect.mock.calls[1]?.[0]);
  });
});
