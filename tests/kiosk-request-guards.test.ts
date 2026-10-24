import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http";
import { jsonRequest, routeCtx } from "./_helpers/route-request";

const kioskMock = vi.hoisted(() => ({ requireKiosk: vi.fn() }));
const limitMock = vi.hoisted(() => ({ enforceRateLimit: vi.fn() }));

vi.mock("@/lib/auth", () => ({ requireKiosk: kioskMock.requireKiosk }));
vi.mock("@/lib/rate-limit", () => limitMock);
vi.mock("@/lib/role-preview", () => ({
  readRolePreviewFromRequest: vi.fn().mockResolvedValue(null),
  isRolePreviewBlockedRequest: vi.fn(),
}));
vi.mock("@/lib/preview-activity", () => ({ recordPreviewActivity: vi.fn() }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({
  deferCompanionProjectionRefresh: vi.fn(),
}));

import { withKiosk, KIOSK_MUTATION_LIMIT } from "@/lib/api";

const kiosk = { kioskId: "kiosk-1", name: "Video Office", locationId: "loc-1", locationName: "Video" };

describe("withKiosk request guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    kioskMock.requireKiosk.mockResolvedValue(kiosk);
    limitMock.enforceRateLimit.mockResolvedValue(undefined);
  });

  it("rate-limits mutations per kiosk after authenticating", async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const res = await withKiosk(handler)(jsonRequest("/api/kiosk/x", "POST", { a: 1 }), routeCtx({}));
    expect(res.status).toBe(200);
    expect(limitMock.enforceRateLimit).toHaveBeenCalledWith("kiosk:mutations:kiosk-1", KIOSK_MUTATION_LIMIT);
  });

  it("answers 429 and skips the handler when the kiosk is over budget", async () => {
    limitMock.enforceRateLimit.mockRejectedValue(new HttpError(429, "Too many requests."));
    const handler = vi.fn();
    const res = await withKiosk(handler)(jsonRequest("/api/kiosk/x", "POST", {}), routeCtx({}));
    expect(res.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not spend the write budget on reads", async () => {
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    await withKiosk(handler)(jsonRequest("/api/kiosk/x", "GET"), routeCtx({}));
    expect(limitMock.enforceRateLimit).not.toHaveBeenCalled();
  });

  it("refuses an oversize declared body with 413 before the session lookup", async () => {
    const req = new Request("https://app.example.com/api/kiosk/x", {
      method: "POST",
      headers: { origin: "https://app.example.com", host: "app.example.com", "content-length": "300000" },
      body: "{}",
    });
    const handler = vi.fn();
    const res = await withKiosk(handler)(req, routeCtx({}));
    expect(res.status).toBe(413);
    expect(kioskMock.requireKiosk).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("honors a route-specific body ceiling", async () => {
    const req = new Request("https://app.example.com/api/kiosk/x", {
      method: "POST",
      headers: { origin: "https://app.example.com", host: "app.example.com", "content-length": "300000" },
      body: "{}",
    });
    const handler = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    const res = await withKiosk(handler, { maxBodyBytes: 2_000_000 })(req, routeCtx({}));
    expect(res.status).toBe(200);
  });
});
