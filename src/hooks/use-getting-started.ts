"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuthenticatedQueryUserId } from "@/components/QueryProvider";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { mergeGettingStarted, normalizeGettingStarted, sameGettingStarted, type GettingStartedRow, type GettingStartedState } from "@/lib/getting-started";

const changedEvent = "wc-getting-started-changed";
const storageKey = (userId: string) => `wc-getting-started:${userId}`;
const memory = new Map<string, GettingStartedState>();

function read(userId: string): GettingStartedState {
  const current = memory.get(userId) ?? { done: [], dismissed: false };
  try { return mergeGettingStarted(normalizeGettingStarted(JSON.parse(localStorage.getItem(storageKey(userId)) ?? "null")), current); }
  catch { return current; }
}
function write(userId: string, state: GettingStartedState) {
  memory.set(userId, state);
  try { localStorage.setItem(storageKey(userId), JSON.stringify(state)); } catch { /* The account still saves without browser storage. */ }
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: userId }));
}

/** Only row identifiers are cached; each copy belongs to one signed-in account. */
export function markGettingStartedDone(userId: string, id: GettingStartedRow) {
  write(userId, mergeGettingStarted(read(userId), { done: [id] }));
}

export function useGettingStartedState(enabled: boolean) {
  const userId = useAuthenticatedQueryUserId();
  const query = useQueryClient();
  const actor = useRef(userId);
  actor.current = userId;
  const [local, setLocal] = useState<{ userId: string; state: GettingStartedState } | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const queryKey = ["getting-started", userId];
  useEffect(() => {
    setError("");
    setSaving(false);
    const load = () => { if (userId) setLocal({ userId, state: read(userId) }); };
    load();
    const retry = () => { setAttempt((value) => value + 1); void query.invalidateQueries({ queryKey: ["getting-started", userId] }); };
    window.addEventListener(changedEvent, load);
    window.addEventListener("storage", load);
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      window.removeEventListener(changedEvent, load);
      window.removeEventListener("storage", load);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [userId, query]);
  const server = useQuery<GettingStartedState>({
    queryKey,
    enabled: enabled && Boolean(userId),
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/me/getting-started", { signal });
      if (handleAuthRedirect(res) || !res.ok) throw new Error("Couldn’t load your checklist.");
      const json = await parseJsonSafely<{ data?: unknown; userId?: string }>(res);
      if (!json?.data || json.userId !== userId) throw new Error("Your sign-in changed. Reload to continue.");
      return normalizeGettingStarted(json.data);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: "always",
  });
  const state = userId && local?.userId === userId ? mergeGettingStarted(server.data ?? { done: [], dismissed: false }, local.state) : null;
  const stateKey = JSON.stringify(state);
  const latest = useRef(state);
  latest.current = state;
  useEffect(() => {
    const candidate = latest.current;
    if (!enabled || !userId || !candidate || !server.data || sameGettingStarted(candidate, server.data)) return;
    let cancelled = false;
    setSaving(true); setError("");
    void (async () => {
      try {
        const res = await fetch("/api/me/getting-started", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...candidate, ...(candidate.dismissed ? {} : { dismissed: undefined }), expectedUserId: userId }),
          keepalive: true,
        });
        if (handleAuthRedirect(res)) return;
        const json = await parseJsonSafely<{ data?: unknown; userId?: string }>(res);
        if (!res.ok || !json?.data || json.userId !== userId) throw new Error("Couldn’t save checklist progress. Retry to sync it.");
        if (!cancelled && actor.current === userId) setSaving(false);
        if (actor.current === userId) query.setQueryData(["getting-started", userId], normalizeGettingStarted(json.data));
      } catch (reason) {
        if (!cancelled && actor.current === userId) setError(reason instanceof Error ? reason.message : "Couldn’t save checklist progress.");
      } finally { if (!cancelled && actor.current === userId) setSaving(false); }
    })();
    return () => { cancelled = true; };
  }, [enabled, userId, stateKey, server.data, server.dataUpdatedAt, attempt, query]);
  const update = (patch: Partial<GettingStartedState>) => {
    if (!userId || !state) return;
    const next = mergeGettingStarted(state, patch);
    setLocal({ userId, state: next });
    write(userId, next);
  };
  return { state, update, error: error || (server.isError ? "Couldn’t sync checklist progress." : ""), saving, retry: () => { setAttempt((value) => value + 1); void server.refetch(); } };
}
