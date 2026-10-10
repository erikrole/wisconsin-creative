// Server-only: the stored Google grant for the Badgers channel. The refresh
// token is encrypted at rest, decrypted only to mint short-lived access
// tokens, and never returned to a client or written to the audit log.

import type { AuthUser } from "@/lib/auth";
import { createAuditEntry } from "@/lib/audit";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { createSecretBox } from "@/lib/secret-box";

import {
  BADGERS_CHANNEL_ID,
  exchangeCode,
  GoogleGrantRevokedError,
  OAUTH_CALLBACK_PATH,
  ownedChannels,
  refreshAccessToken,
  revokeToken,
  YOUTUBE_SCOPE,
  type OAuthClient,
} from "./google";

const tokenBox = createSecretBox({ readKey: () => env.youtubeTokenKey, keyName: "YOUTUBE_TOKEN_KEY", label: "YouTube token" });

const actorRole = (user: AuthUser) => user.preview?.actualRole ?? user.role;

export function youtubeConfigured(): boolean {
  return Boolean(env.youtubeOAuthClientId && env.youtubeOAuthClientSecret && env.youtubeTokenKey);
}

export function oauthClient(): OAuthClient {
  if (!youtubeConfigured()) throw new HttpError(503, "The YouTube connection is not configured for this environment.");
  return {
    clientId: env.youtubeOAuthClientId,
    clientSecret: env.youtubeOAuthClientSecret,
    redirectUri: new URL(OAUTH_CALLBACK_PATH, env.appUrl).toString(),
  };
}

export interface ConnectionStatus {
  configured: boolean;
  connected: boolean;
  channelTitle: string | null;
  connectedAt: string | null;
  connectedByName: string | null;
  lastUsedAt: string | null;
  needsReconnect: boolean;
}

export async function connectionStatus(): Promise<ConnectionStatus> {
  const row = await db.youTubeConnection.findUnique({ where: { channelId: BADGERS_CHANNEL_ID } });
  const connectedBy = row ? await db.user.findUnique({ where: { id: row.connectedById }, select: { name: true } }) : null;
  return {
    configured: youtubeConfigured(),
    connected: Boolean(row && !row.revokedAt),
    channelTitle: row?.channelTitle ?? null,
    connectedAt: row?.connectedAt.toISOString() ?? null,
    connectedByName: connectedBy?.name ?? null,
    lastUsedAt: row?.lastUsedAt?.toISOString() ?? null,
    needsReconnect: Boolean(row?.revokedAt),
  };
}

/** Finishes the consent flow: the grant must manage the Badgers channel and include a refresh token. */
export async function completeConnection(user: AuthUser, code: string, verifier: string, fetcher: typeof fetch = fetch) {
  const client = oauthClient();
  const tokens = await exchangeCode(client, code, verifier, fetcher);
  if (!tokens.scopes.includes(YOUTUBE_SCOPE)) {
    throw new HttpError(400, "YouTube management access was not granted. Connect again and allow access to the channel.");
  }
  if (!tokens.refreshToken) {
    throw new HttpError(400, "Google did not return a lasting grant. Remove the app under your Google account's third-party access, then connect again.");
  }
  const channel = (await ownedChannels(tokens.accessToken, fetcher)).find((item) => item.id === BADGERS_CHANNEL_ID);
  if (!channel) {
    await revokeToken(tokens.refreshToken, fetcher);
    throw new HttpError(403, "That Google account does not manage the Wisconsin Badgers channel. Choose the Badgers channel when Google asks.");
  }

  const before = await db.youTubeConnection.findUnique({ where: { channelId: channel.id } });
  const data = {
    channelTitle: channel.title,
    encryptedRefreshToken: tokenBox.encrypt(tokens.refreshToken),
    scopes: tokens.scopes,
    connectedById: user.id,
    connectedAt: new Date(),
    lastUsedAt: new Date(),
    revokedAt: null,
  };
  const row = await db.youTubeConnection.upsert({ where: { channelId: channel.id }, create: { channelId: channel.id, ...data }, update: data });
  accessCache.set(channel.id, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
  await createAuditEntry({
    actorId: user.id,
    actorRole: actorRole(user),
    entityType: "YouTubeConnection",
    entityId: row.id,
    action: before ? "RECONNECT" : "CONNECT",
    before: before ? { channelTitle: before.channelTitle, connectedById: before.connectedById, revokedAt: before.revokedAt } : undefined,
    after: { channelId: channel.id, channelTitle: channel.title, scopes: tokens.scopes },
  });
  return { channelTitle: channel.title };
}

// Access tokens live about an hour. Cache per server instance; never persisted.
const accessCache = new Map<string, { token: string; expiresAt: number }>();

/** A current access token for the Badgers channel, refreshing when needed. */
export async function channelAccessToken(fetcher: typeof fetch = fetch): Promise<string> {
  const cached = accessCache.get(BADGERS_CHANNEL_ID);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const row = await db.youTubeConnection.findUnique({ where: { channelId: BADGERS_CHANNEL_ID } });
  if (!row || row.revokedAt) throw new HttpError(409, "YouTube is not connected. An admin needs to connect the Badgers channel.");
  const client = oauthClient();
  try {
    const tokens = await refreshAccessToken(client, tokenBox.decrypt(row.encryptedRefreshToken), fetcher);
    accessCache.set(BADGERS_CHANNEL_ID, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
    await db.youTubeConnection.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof GoogleGrantRevokedError) {
      accessCache.delete(BADGERS_CHANNEL_ID);
      await db.youTubeConnection.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
      throw new HttpError(409, error.message);
    }
    throw error;
  }
}

export async function disconnect(user: AuthUser, fetcher: typeof fetch = fetch): Promise<{ revokedAtGoogle: boolean }> {
  const row = await db.youTubeConnection.findUnique({ where: { channelId: BADGERS_CHANNEL_ID } });
  if (!row) throw new HttpError(404, "YouTube is not connected.");
  let revokedAtGoogle = false;
  try {
    revokedAtGoogle = await revokeToken(tokenBox.decrypt(row.encryptedRefreshToken), fetcher);
  } catch {
    revokedAtGoogle = false; // Unreadable token: deleting the row still removes our access.
  }
  await db.youTubeConnection.delete({ where: { id: row.id } });
  accessCache.delete(BADGERS_CHANNEL_ID);
  await createAuditEntry({
    actorId: user.id,
    actorRole: actorRole(user),
    entityType: "YouTubeConnection",
    entityId: row.id,
    action: "DISCONNECT",
    before: { channelId: row.channelId, channelTitle: row.channelTitle, connectedById: row.connectedById },
    after: { revokedAtGoogle },
  });
  return { revokedAtGoogle };
}

/** Test seam. */
export function __clearYouTubeAccessCache() {
  accessCache.clear();
}
