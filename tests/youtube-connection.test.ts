import { randomBytes } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_KEY = randomBytes(32).toString("base64");

const { mockDb, mockAudit, mockEnv } = vi.hoisted(() => ({
  mockDb: {
    youTubeConnection: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  mockAudit: vi.fn(),
  mockEnv: { youtubeOAuthClientId: "client-id", youtubeOAuthClientSecret: "client-secret", youtubeTokenKey: "", appUrl: "https://wisconsincreative.com" },
}));

vi.mock("@/lib/db", () => ({ db: mockDb }));
vi.mock("@/lib/audit", () => ({ createAuditEntry: mockAudit }));
vi.mock("@/lib/env", () => ({ env: mockEnv }));

import { verifierFor } from "@/app/api/youtube/oauth/shared";
import {
  __clearYouTubeAccessCache,
  channelAccessToken,
  completeConnection,
  disconnect,
  oauthClient,
} from "@/lib/youtube/connection";
import { authorizationUrl, BADGERS_CHANNEL_ID, createPkcePair, youtubeApi, YOUTUBE_SCOPE } from "@/lib/youtube/google";
import { createSecretBox } from "@/lib/secret-box";
import type { AuthUser } from "@/lib/auth";

const admin = { id: "admin-1", role: "ADMIN", name: "Erik", email: "e@example.com", avatarUrl: null } as AuthUser;

type Route = (url: string, init: RequestInit) => { status?: number; json: unknown };

function fakeFetch(route: Route) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetcher = (async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const { status = 200, json } = route(url, init);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, calls };
}

const google = (overrides: { token?: Record<string, unknown>; channels?: unknown[]; refresh?: { status?: number; json: unknown } } = {}) =>
  fakeFetch((url, init) => {
    const body = String(init.body ?? "");
    if (url.includes("oauth2.googleapis.com/token") && body.includes("grant_type=refresh_token")) {
      return overrides.refresh ?? { json: { access_token: "fresh-access", expires_in: 3600 } };
    }
    if (url.includes("oauth2.googleapis.com/token")) {
      return { json: { access_token: "access-1", expires_in: 3600, refresh_token: "refresh-secret", scope: YOUTUBE_SCOPE, ...overrides.token } };
    }
    if (url.includes("oauth2.googleapis.com/revoke")) return { json: {} };
    if (url.includes("/youtube/v3/channels")) {
      return { json: { items: overrides.channels ?? [{ id: BADGERS_CHANNEL_ID, snippet: { title: "Wisconsin Badgers" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] } };
    }
    return { status: 404, json: {} };
  });

beforeEach(() => {
  vi.clearAllMocks();
  __clearYouTubeAccessCache();
  mockEnv.youtubeTokenKey = TOKEN_KEY;
  mockDb.youTubeConnection.findUnique.mockResolvedValue(null);
  mockDb.youTubeConnection.upsert.mockImplementation(async ({ create }) => ({ id: "conn-1", ...create }));
});

describe("OAuth request", () => {
  it("asks for offline YouTube access with PKCE and the production callback", () => {
    const pkce = createPkcePair();
    const url = new URL(authorizationUrl(oauthClient(), pkce));
    expect(url.searchParams.get("scope")).toBe(YOUTUBE_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toContain("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBe(pkce.verifier);
    expect(url.searchParams.get("redirect_uri")).toBe("https://wisconsincreative.com/api/youtube/oauth/callback");
  });

  it("refuses to start when this environment has no credentials", () => {
    mockEnv.youtubeTokenKey = "";
    expect(() => oauthClient()).toThrow(/not configured/);
  });

  it("accepts the callback only for the same state and signed-in user", () => {
    const cookie = "state-abc.verifier-xyz.admin-1";
    expect(verifierFor(cookie, "state-abc", "admin-1")).toBe("verifier-xyz");
    expect(verifierFor(cookie, "state-abd", "admin-1")).toBeNull();
    expect(verifierFor(cookie, "state-abc", "someone-else")).toBeNull();
    expect(verifierFor(undefined, "state-abc", "admin-1")).toBeNull();
    expect(verifierFor(cookie, null, "admin-1")).toBeNull();
  });
});

describe("completing the connection", () => {
  it("stores only an encrypted refresh token and audits without secrets", async () => {
    const { fetcher } = google();
    await expect(completeConnection(admin, "code", "verifier", fetcher)).resolves.toEqual({ channelTitle: "Wisconsin Badgers" });
    const stored = mockDb.youTubeConnection.upsert.mock.calls[0]![0].create;
    expect(stored.encryptedRefreshToken).not.toContain("refresh-secret");
    expect(createSecretBox({ readKey: () => TOKEN_KEY, keyName: "K", label: "YouTube token" }).decrypt(stored.encryptedRefreshToken)).toBe("refresh-secret");
    const audit = JSON.stringify(mockAudit.mock.calls[0]![0]);
    expect(audit).toContain("CONNECT");
    expect(audit).not.toMatch(/refresh-secret|access-1/);
  });

  it("rejects an account that does not manage the Badgers channel and revokes the grant", async () => {
    const { fetcher, calls } = google({ channels: [{ id: "UC-someone-else", snippet: { title: "Personal" } }] });
    await expect(completeConnection(admin, "code", "verifier", fetcher)).rejects.toThrow(/does not manage/);
    expect(calls.some((call) => call.url.includes("/revoke"))).toBe(true);
    expect(mockDb.youTubeConnection.upsert).not.toHaveBeenCalled();
  });

  it("rejects a grant without a refresh token or without the YouTube scope", async () => {
    await expect(completeConnection(admin, "code", "verifier", google({ token: { refresh_token: undefined } }).fetcher)).rejects.toThrow(/lasting grant/);
    await expect(completeConnection(admin, "code", "verifier", google({ token: { scope: "openid" } }).fetcher)).rejects.toThrow(/management access/);
    expect(mockDb.youTubeConnection.upsert).not.toHaveBeenCalled();
  });
});

describe("using the connection", () => {
  const storedRow = () => ({
    id: "conn-1", channelId: BADGERS_CHANNEL_ID, channelTitle: "Wisconsin Badgers", revokedAt: null, connectedById: "admin-1",
    encryptedRefreshToken: createSecretBox({ readKey: () => TOKEN_KEY, keyName: "K", label: "YouTube token" }).encrypt("refresh-secret"),
  });

  it("refreshes an access token once and reuses it", async () => {
    mockDb.youTubeConnection.findUnique.mockResolvedValue(storedRow());
    const { fetcher, calls } = google();
    expect(await channelAccessToken(fetcher)).toBe("fresh-access");
    expect(await channelAccessToken(fetcher)).toBe("fresh-access");
    expect(calls).toHaveLength(1);
  });

  it("marks the connection for reconnect when Google revokes the grant", async () => {
    mockDb.youTubeConnection.findUnique.mockResolvedValue(storedRow());
    const { fetcher } = google({ refresh: { status: 400, json: { error: "invalid_grant" } } });
    await expect(channelAccessToken(fetcher)).rejects.toThrow(/reconnect/);
    expect(mockDb.youTubeConnection.update).toHaveBeenCalledWith(expect.objectContaining({ data: { revokedAt: expect.any(Date) } }));
  });

  it("refuses when nothing is connected", async () => {
    await expect(channelAccessToken(google().fetcher)).rejects.toThrow(/not connected/);
  });

  it("disconnect revokes at Google, deletes the row and audits", async () => {
    mockDb.youTubeConnection.findUnique.mockResolvedValue(storedRow());
    const { fetcher, calls } = google();
    expect(await disconnect(admin, fetcher)).toEqual({ revokedAtGoogle: true });
    expect(calls[0]!.url).toContain("/revoke");
    expect(mockDb.youTubeConnection.delete).toHaveBeenCalledWith({ where: { id: "conn-1" } });
    expect(mockAudit.mock.calls[0]![0]).toMatchObject({ action: "DISCONNECT" });
  });
});

describe("YouTube API calls", () => {
  it("never follows redirects and sends the revision with writes", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ json: { ok: true } }));
    await youtubeApi("token", "videos", { method: "PUT", query: { part: "snippet" }, body: { id: "v" }, ifMatch: '"etag"' }, fetcher);
    expect(calls[0]!.init.redirect).toBe("error");
    expect((calls[0]!.init.headers as Record<string, string>)["If-Match"]).toBe('"etag"');
    expect(calls[0]!.url).toBe("https://www.googleapis.com/youtube/v3/videos?part=snippet");
  });

  it("surfaces YouTube's reason without retrying", async () => {
    const { fetcher, calls } = fakeFetch(() => ({ status: 403, json: { error: { message: "Quota exceeded", errors: [{ reason: "quotaExceeded" }] } } }));
    await expect(youtubeApi("token", "videos", {}, fetcher)).rejects.toThrow(/quotaExceeded/);
    expect(calls).toHaveLength(1);
  });
});
