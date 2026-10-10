// Local preview only: serves recorded YouTube Data API GET responses so the
// review queue can be exercised without a channel connection. Requests to any
// other host pass through unchanged. See reader.ts for the guard.

import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { YouTubeToolError } from "./types";

const API_PREFIX = "/youtube/v3/";

/** Matches the recorder: method, API path and the query sorted by key. */
export function replayKey(input: string | URL, method = "GET"): string | null {
  const url = new URL(String(input));
  if (url.hostname !== "www.googleapis.com" || !url.pathname.startsWith(API_PREFIX)) return null;
  const query = new URLSearchParams([...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return `${method.toUpperCase()} ${url.pathname.slice(API_PREFIX.length)}?${query.toString()}`;
}

export function loadReplay(directory: string, passthrough: typeof fetch = fetch): { fetcher: typeof fetch; recordedAt: Date } {
  const root = resolve(directory);
  let manifest: { recordedAt?: string };
  try {
    manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  } catch {
    throw new YouTubeToolError("The YouTube replay recording is missing its manifest.");
  }
  const recordedAt = new Date(manifest.recordedAt ?? "");
  if (Number.isNaN(recordedAt.getTime())) throw new YouTubeToolError("The YouTube replay recording has no valid recording time.");
  const responses = new Map<string, { status: number; body: unknown }>();
  for (const name of readdirSync(root)) {
    if (!name.endsWith(".json") || name === "manifest.json") continue;
    const entry = JSON.parse(readFileSync(join(root, name), "utf8")) as { key: string; status: number; body: unknown };
    responses.set(entry.key, { status: entry.status, body: entry.body });
  }
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input;
    const key = replayKey(url, init?.method ?? "GET");
    if (key === null) return passthrough(input, init);
    const recorded = key.startsWith("GET ") ? responses.get(key) : undefined;
    if (!recorded) {
      return new Response(JSON.stringify({ error: { message: `Not in the replay recording: ${key}`, errors: [{ reason: "notRecorded" }] } }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify(recorded.body), { status: recorded.status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { fetcher, recordedAt };
}
