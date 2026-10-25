import { beforeEach, describe, expect, it, vi } from "vitest";
import { Role } from "@prisma/client";
import { authUser, routeCtx } from "./_helpers/route-request";

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  cookie: vi.fn(),
  completeConnection: vi.fn(),
  connectionStatus: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth, requireKiosk: vi.fn() }));
vi.mock("@/lib/services/companion-projection-publisher", () => ({ deferCompanionProjectionRefresh: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: (name: string) => mocks.cookie(name) })) }));
vi.mock("@/lib/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env")>();
  return { env: new Proxy(actual.env, { get: (target, key) => (key === "appUrl" ? "https://app.example.com" : Reflect.get(target, key)) }) };
});
vi.mock("@/lib/youtube/connection", () => ({
  oauthClient: () => ({ clientId: "client" }),
  completeConnection: mocks.completeConnection,
  connectionStatus: mocks.connectionStatus,
  disconnect: mocks.disconnect,
}));
vi.mock("@/lib/youtube/google", () => ({
  createPkcePair: () => ({ state: "state123", verifier: "verifier456", challenge: "c" }),
  authorizationUrl: () => "https://accounts.google.com/o/oauth2/v2/auth?state=state123",
}));

import { GET as start } from "@/app/api/youtube/oauth/start/route";
import { GET as callback } from "@/app/api/youtube/oauth/callback/route";
import { DELETE as disconnectRoute, GET as status } from "@/app/api/youtube/connection/route";
import { HttpError } from "@/lib/http";
import { YouTubeToolError } from "@/lib/youtube/types";

const admin = authUser(Role.ADMIN);
const goodCookie = { value: `state123.verifier456.${admin.id}` };
const back = (query: string) => callback(new Request(`https://app.example.com/api/youtube/oauth/callback${query}`), routeCtx({}));
const landing = (res: Response) => new URL(res.headers.get("location")!);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(admin);
  mocks.cookie.mockReturnValue(goodCookie);
  mocks.completeConnection.mockResolvedValue(undefined);
});

describe("GET /api/youtube/oauth/start", () => {
  it("redirects to Google and keeps the state, verifier and user in a short-lived cookie", async () => {
    const res = await start(new Request("https://app.example.com/api/youtube/oauth/start"), routeCtx({}));

    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=state123");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`wc_youtube_oauth=state123.verifier456.${admin.id}`);
    expect(cookie).toMatch(/Path=\/api\/youtube\/oauth/);
    expect(cookie).toMatch(/Max-Age=600/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
  });

  it("is admin only", async () => {
    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));

    expect((await start(new Request("https://app.example.com/api/youtube/oauth/start"), routeCtx({}))).status).toBe(403);
  });
});

describe("GET /api/youtube/oauth/callback", () => {
  it("completes the connection and lands on /youtube, clearing the cookie", async () => {
    const res = await back("?state=state123&code=abc");

    expect(mocks.completeConnection).toHaveBeenCalledWith(admin, "abc", "verifier456");
    expect(res.status).toBe(303);
    expect(landing(res).toString()).toBe("https://app.example.com/youtube?connection=connected");
    expect(res.headers.get("set-cookie")).toMatch(/wc_youtube_oauth=;.*Max-Age=0/);
  });

  it("reports a cancelled sign-in without calling Google", async () => {
    const res = await back("?error=access_denied&state=state123");

    expect(landing(res).searchParams.get("connection")).toBe("cancelled");
    expect(mocks.completeConnection).not.toHaveBeenCalled();
  });

  it("refuses a mismatched state, another user's cookie, a missing cookie or a missing code", async () => {
    const expired = "The sign-in expired or did not match. Start the connection again.";
    for (const [query, cookie] of [
      ["?state=other&code=abc", goodCookie],
      ["?state=state123&code=abc", { value: "state123.verifier456.someone-else" }],
      ["?state=state123&code=abc", undefined],
      ["?state=state123", goodCookie],
    ] as const) {
      mocks.cookie.mockReturnValue(cookie);
      const url = landing(await back(query));
      expect(url.searchParams.get("connection")).toBe("error");
      expect(url.searchParams.get("message")).toBe(expired);
    }
    expect(mocks.completeConnection).not.toHaveBeenCalled();
  });

  it("shows a known failure as a short message and rethrows anything else", async () => {
    mocks.completeConnection.mockRejectedValueOnce(new YouTubeToolError("That account does not manage the Badgers channel. ".repeat(10)));
    const url = landing(await back("?state=state123&code=abc"));
    expect(url.searchParams.get("connection")).toBe("error");
    expect(url.searchParams.get("message")).toHaveLength(200);

    mocks.completeConnection.mockRejectedValueOnce(new HttpError(409, "Already connected"));
    expect(landing(await back("?state=state123&code=abc")).searchParams.get("message")).toBe("Already connected");

    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.completeConnection.mockRejectedValueOnce(new Error("boom"));
    expect((await back("?state=state123&code=abc")).status).toBe(500);
  });
});

describe("/api/youtube/connection", () => {
  it("shows the status and disconnects, admin only", async () => {
    mocks.connectionStatus.mockResolvedValue({ connected: true });
    mocks.disconnect.mockResolvedValue({ disconnected: true });

    expect((await (await status(new Request("https://app.example.com/api/youtube/connection"), routeCtx({}))).json())).toEqual({ connected: true });
    const del = await disconnectRoute(new Request("https://app.example.com/api/youtube/connection", { method: "DELETE", headers: { origin: "https://app.example.com" } }), routeCtx({}));
    expect(await del.json()).toEqual({ disconnected: true });
    expect(mocks.disconnect).toHaveBeenCalledWith(admin);

    mocks.requireAuth.mockResolvedValue(authUser(Role.STAFF));
    expect((await status(new Request("https://app.example.com/api/youtube/connection"), routeCtx({}))).status).toBe(403);
  });
});
