// Server-only Google OAuth and YouTube Data API access for the /youtube tool.
// Requests go directly to Google and never follow redirects.

import { createHash, randomBytes } from "node:crypto";

import { YouTubeToolError } from "./types";

export const BADGERS_CHANNEL_ID = "UCwGvYcF_PDvOvvADzEbrT0A";
export const YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube";
export const OAUTH_CALLBACK_PATH = "/api/youtube/oauth/callback";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const API_ROOT = "https://www.googleapis.com/youtube/v3/";
const TIMEOUT_MS = 20_000;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface PkcePair {
  state: string;
  verifier: string;
  challenge: string;
}

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(48).toString("base64url");
  return {
    state: randomBytes(24).toString("base64url"),
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
  };
}

/** Consent URL. `prompt=consent` makes Google return a refresh token on every grant. */
export function authorizationUrl(client: OAuthClient, pkce: PkcePair): string {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPE,
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state: pkce.state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

export class GoogleGrantRevokedError extends YouTubeToolError {
  constructor() {
    super("Google no longer accepts the saved YouTube connection. An admin needs to reconnect.");
    this.name = "GoogleGrantRevokedError";
  }
}

async function postForm(url: string, body: Record<string, string>, fetcher: typeof fetch): Promise<Response> {
  return fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
}

export interface GrantTokens {
  accessToken: string;
  expiresAt: number;
  refreshToken: string | null;
  scopes: string[];
}

function parseTokens(json: TokenResponse): GrantTokens {
  if (!json.access_token) throw new YouTubeToolError("Google did not return an access token.");
  return {
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max(0, (json.expires_in ?? 0) - 60) * 1000,
    refreshToken: json.refresh_token ?? null,
    scopes: (json.scope ?? "").split(" ").filter(Boolean),
  };
}

export async function exchangeCode(client: OAuthClient, code: string, verifier: string, fetcher: typeof fetch = fetch): Promise<GrantTokens> {
  const response = await postForm(TOKEN_URL, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: client.redirectUri,
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
  }, fetcher);
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (!response.ok) throw new YouTubeToolError(`Google rejected the sign-in (${json.error ?? response.status}). Try connecting again.`);
  return parseTokens(json);
}

export async function refreshAccessToken(client: Omit<OAuthClient, "redirectUri">, refreshToken: string, fetcher: typeof fetch = fetch): Promise<GrantTokens> {
  const response = await postForm(TOKEN_URL, {
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  }, fetcher);
  const json = (await response.json().catch(() => ({}))) as TokenResponse;
  if (json.error === "invalid_grant") throw new GoogleGrantRevokedError();
  if (!response.ok) throw new YouTubeToolError(`Google could not refresh the YouTube connection (${json.error ?? response.status}).`);
  return parseTokens(json);
}

/** Best effort: tells Google to drop the grant. A failure leaves nothing usable on our side. */
export async function revokeToken(token: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    return (await postForm(REVOKE_URL, { token }, fetcher)).ok;
  } catch {
    return false;
  }
}

/** Authorized YouTube Data API call. Errors surface Google's reason without retrying. */
export async function youtubeApi<T>(
  accessToken: string,
  path: string,
  options: { query?: Record<string, string | undefined>; method?: "GET" | "PUT" | "POST"; body?: unknown; ifMatch?: string } = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const url = new URL(path, API_ROOT);
  for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.ifMatch) headers["If-Match"] = options.ifMatch;
  const response = await fetcher(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await response.json().catch(() => null)) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null;
  if (!response.ok) {
    const reason = json?.error?.errors?.[0]?.reason ?? String(response.status);
    throw new YouTubeToolError(`YouTube returned an error (${reason}): ${json?.error?.message ?? "no details"}`);
  }
  return json as T;
}

export interface OwnedChannel {
  id: string;
  title: string;
  uploadsPlaylistId: string;
}

export async function ownedChannels(accessToken: string, fetcher: typeof fetch = fetch): Promise<OwnedChannel[]> {
  const json = await youtubeApi<{
    items?: Array<{ id: string; snippet?: { title?: string }; contentDetails?: { relatedPlaylists?: { uploads?: string } } }>;
  }>(accessToken, "channels", { query: { part: "snippet,contentDetails", mine: "true" } }, fetcher);
  return (json.items ?? []).map((item) => ({
    id: item.id,
    title: item.snippet?.title ?? "",
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? "",
  }));
}
