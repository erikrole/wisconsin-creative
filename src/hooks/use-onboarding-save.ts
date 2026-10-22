"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchProfileCompletion, PROFILE_COMPLETION_QUERY_KEY, type ProfileCompletionResponse } from "@/hooks/use-profile-completion";
import { groupValues, ONBOARDING_GROUP_FIELDS, onboardingGroupSchemas, sameGroup, type OnboardingGroup, type OnboardingValues } from "@/lib/onboarding-save";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { advanceProfileCompletionReads, profileCompletionReadEpoch } from "@/lib/profile-completion-cache";

type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";
type Options = {
  data: ProfileCompletionResponse | null | undefined;
  values: OnboardingValues;
  applyGroup: (group: OnboardingGroup, profile: ProfileCompletionResponse["profile"]) => void;
  onResume?: (data: ProfileCompletionResponse) => void;
};
const groups = Object.keys(ONBOARDING_GROUP_FIELDS) as OnboardingGroup[];

/** Private answers stay in memory until the authenticated server acknowledges them. */
export function useOnboardingSave(options: Options) {
  const query = useQueryClient();
  const latest = useRef(options);
  latest.current = options;
  const owner = useRef<string | null>(null);
  const mutationEpoch = useRef(0);
  const alive = useRef(true);
  const readControllers = useRef(new Set<AbortController>());
  const [reconcileTick, setReconcileTick] = useState(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const baseline = useRef<Partial<Record<OnboardingGroup, { values: OnboardingValues; version: string }>>>({});
  const dirty = useRef(new Set<OnboardingGroup>());
  const conflicts = useRef(new Set<OnboardingGroup>());
  const pending = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushRef = useRef<(keepalive?: boolean) => Promise<boolean>>(async () => false);
  const [state, setState] = useState<SaveState>("saved");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const data = options.data;
    if (!data) return;
    if (owner.current !== data.profile.id) {
      owner.current = data.profile.id;
      mutationEpoch.current++;
      for (const controller of readControllers.current) controller.abort();
      pending.current = null;
      baseline.current = {};
      dirty.current.clear();
      conflicts.current.clear();
      setState("saved");
      setMessage("");
    }
    if (pending.current) return;
    for (const group of groups) {
      const version = data.versions?.[group];
      if (!version) continue;
      const saved = groupValues(data.profile, group);
      if (!dirty.current.has(group)) {
        baseline.current[group] = { values: saved, version };
        latest.current.applyGroup(group, data.profile);
      } else if (baseline.current[group]?.version !== version) {
        const candidate = onboardingGroupSchemas[group].safeParse(groupValues(latest.current.values, group));
        if (candidate.success && sameGroup(candidate.data, saved)) {
          baseline.current[group] = { values: saved, version };
          dirty.current.delete(group);
          conflicts.current.delete(group);
        } else {
          conflicts.current.add(group);
          setState("conflict");
          setMessage("Saved answers changed elsewhere. Your edits are still here.");
        }
      }
    }
  }, [options.data, reconcileTick]);

  const refresh = useCallback(async () => {
    await query.cancelQueries({ queryKey: PROFILE_COMPLETION_QUERY_KEY });
    const epoch = mutationEpoch.current;
    const sharedEpoch = profileCompletionReadEpoch(query);
    const userId = owner.current;
    const controller = new AbortController(); readControllers.current.add(controller);
    let data;
    try { data = await fetchProfileCompletion(controller.signal); }
    finally { readControllers.current.delete(controller); }
    if (!alive.current || epoch !== mutationEpoch.current || sharedEpoch !== profileCompletionReadEpoch(query) || userId !== owner.current) return null;
    if (data?.profile.id === owner.current) query.setQueryData(PROFILE_COMPLETION_QUERY_KEY, data);
    return data;
  }, [query]);

  const flush = useCallback((keepalive = false): Promise<boolean> => {
    if (pending.current) return pending.current;
    const userId = owner.current;
    let reschedule = false;
    const run = async () => {
      if (!userId) return false;
      for (const group of groups) {
        if (!dirty.current.has(group) || conflicts.current.has(group)) continue;
        const initial = baseline.current[group];
        const parsed = onboardingGroupSchemas[group].safeParse(groupValues(latest.current.values, group));
        if (!initial || !parsed.success) continue;
        const values = parsed.data;
        if (sameGroup(values, initial.values)) { dirty.current.delete(group); continue; }
        setState("saving");
        setMessage("");
        mutationEpoch.current++;
        advanceProfileCompletionReads(query);
        await query.cancelQueries({ queryKey: PROFILE_COMPLETION_QUERY_KEY });
        try {
          const response = await fetch("/api/me/profile-completion", {
            method: "PATCH", keepalive,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ step: "SAVE", group, expectedVersion: initial.version, values }),
          });
          if (!alive.current || owner.current !== userId || handleAuthRedirect(response)) return false;
          const body = await parseJsonSafely<{ data?: ProfileCompletionResponse; error?: string; code?: string }>(response);
          if (!response.ok || !body?.data?.profile) {
            if (response.status === 409 && body?.code === "ONBOARDING_CONFLICT") {
              conflicts.current.add(group);
              setState("conflict");
              setMessage("Saved answers changed elsewhere. Your edits are still here.");
              await refresh();
              return false;
            }
            throw new Error(body?.error ?? "Couldn’t save. Check your connection and retry.");
          }
          const next = body.data;
          mutationEpoch.current++;
          advanceProfileCompletionReads(query);
          const version = next.versions?.[group];
          if (!version) throw new Error("Your answer was saved, but setup needs to refresh.");
          baseline.current[group] = { values: groupValues(next.profile, group), version };
          const current = onboardingGroupSchemas[group].safeParse(groupValues(latest.current.values, group));
          if (current.success && sameGroup(current.data, values)) {
            dirty.current.delete(group);
            latest.current.applyGroup(group, next.profile);
          } else { reschedule = true; }
          await query.cancelQueries({ queryKey: PROFILE_COMPLETION_QUERY_KEY });
          if (owner.current !== userId) return false;
          query.setQueryData(PROFILE_COMPLETION_QUERY_KEY, next);
        } catch (error) {
          if (owner.current !== userId) return false;
          // The request may have committed even when its response was lost.
          try {
            const next = await refresh();
            if (next && next.profile.id === userId && sameGroup(groupValues(next.profile, group), values)) {
              baseline.current[group] = { values, version: next.versions?.[group] ?? initial.version };
              const current = onboardingGroupSchemas[group].safeParse(groupValues(latest.current.values, group));
              if (current.success && sameGroup(current.data, values)) dirty.current.delete(group);
              else reschedule = true;
              continue;
            }
          } catch { /* Keep the unacknowledged answers and their original baseline. */ }
          setState("error");
          setMessage(error instanceof Error ? error.message : "Couldn’t save. Retry to keep these answers.");
          return false;
        }
      }
      if (conflicts.current.size) { setState("conflict"); return false; }
      const saved = dirty.current.size === 0;
      setState(saved ? "saved" : "unsaved");
      setMessage(saved ? "" : "Complete the field to save your answer.");
      return saved;
    };
    const task = run().finally(() => {
      if (pending.current === task) pending.current = null;
      if (alive.current && owner.current === userId) setReconcileTick((value) => value + 1);
      if (reschedule && owner.current === userId && !conflicts.current.size) {
        timer.current = setTimeout(() => { void flushRef.current(); }, 0);
      }
    });
    pending.current = task;
    return task;
  }, [query, refresh]);
  flushRef.current = flush;

  const markDirty = useCallback((group: OnboardingGroup, immediate = false) => {
    dirty.current.add(group);
    if (!conflicts.current.size) setState("unsaved");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushRef.current(); }, immediate ? 0 : 500);
  }, []);

  useEffect(() => {
    const controllers = readControllers.current;
    const reconnect = () => { void flushRef.current().then(() => refresh()).then((data) => {
      if (data && !dirty.current.size && data.profile.id === owner.current) latest.current.onResume?.(data);
    }).catch(() => {}); };
    const leave = () => { if (dirty.current.size) void flushRef.current(true); };
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty.current.size) return;
      event.preventDefault(); event.returnValue = "";
    };
    const foreground = () => { if (document.visibilityState === "visible") reconnect(); else leave(); };
    window.addEventListener("online", reconnect);
    window.addEventListener("pagehide", leave);
    window.addEventListener("beforeunload", warn);
    document.addEventListener("visibilitychange", foreground);
    return () => {
      for (const controller of controllers) controller.abort();
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", reconnect);
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("visibilitychange", foreground);
    };
  }, [refresh]);

  const protectMutation = useCallback(async () => {
    mutationEpoch.current++;
    advanceProfileCompletionReads(query);
    await query.cancelQueries({ queryKey: PROFILE_COMPLETION_QUERY_KEY });
  }, [query]);

  const useSaved = useCallback(async () => {
    if (pending.current) await pending.current;
    let data;
    try { data = await refresh(); }
    catch { setMessage("Couldn’t refresh saved answers. Your edits are still here."); return; }
    if (!data || data.profile.id !== owner.current) return;
    for (const group of conflicts.current) {
      latest.current.applyGroup(group, data.profile);
      baseline.current[group] = { values: groupValues(data.profile, group), version: data.versions?.[group] ?? "" };
      dirty.current.delete(group);
    }
    conflicts.current.clear(); setState(dirty.current.size ? "unsaved" : "saved"); setMessage("");
  }, [refresh]);

  const keepEdits = useCallback(async () => {
    if (pending.current) await pending.current;
    try {
      const data = await refresh();
      if (!data || data.profile.id !== owner.current) return;
      for (const group of conflicts.current) {
        baseline.current[group] = { values: groupValues(data.profile, group), version: data.versions?.[group] ?? "" };
      }
      conflicts.current.clear();
      await flushRef.current();
    } catch { setState("error"); setMessage("Couldn’t refresh saved answers. Your edits are still here."); }
  }, [refresh]);

  return { state, message, markDirty, flush, refresh, protectMutation, useSaved, keepEdits, hasPending: () => dirty.current.size > 0 };
}
