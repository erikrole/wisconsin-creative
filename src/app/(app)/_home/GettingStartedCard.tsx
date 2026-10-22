"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, XIcon } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { useFetch } from "@/hooks/use-fetch";
import { useAuthenticatedQueryUserId } from "@/components/QueryProvider";
import { parseJsonSafely } from "@/lib/errors";
import {
  mergeGettingStarted,
  normalizeGettingStarted,
  sameGettingStarted,
  withinGettingStartedWindow,
  type GettingStartedRow,
  type GettingStartedState,
} from "@/lib/getting-started";
import { openProfileCompletion } from "@/lib/profile-completion-events";
import { UNAVAILABLE_CHANGED_EVENT, isUnavailableBlock, type AvailabilityBlockLite } from "@/lib/unavailable-times";
import { APP_STORE_URL } from "../welcome/WelcomeDone";

const STORAGE_KEY = "wc-getting-started";

/** The pre-sync per-browser copy. Still read so nothing ticked before sync is lost. */
function loadLocal(): GettingStartedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeGettingStarted(JSON.parse(raw));
  } catch {
    /* storage can be blocked; the server copy still works */
  }
  return { done: [], dismissed: false };
}

function saveLocal(next: GettingStartedState) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function sendPatch(patch: Partial<GettingStartedState>) {
  // Best effort: a failed save only means the row may show again on another device.
  void fetch("/api/me/getting-started", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  }).catch(() => {});
}

/** Records a row as handled from elsewhere, e.g. skipping "when can’t you work". */
export function markGettingStartedDone(id: GettingStartedRow) {
  saveLocal(mergeGettingStarted(loadLocal(), { done: [id] }));
  sendPatch({ done: [id] });
}

/** Progress shared with the iPhone app, merged with anything this browser saved before sync. */
function useGettingStartedState(enabled: boolean) {
  const userId = useAuthenticatedQueryUserId();
  const queryClient = useQueryClient();
  const queryKey = ["getting-started", userId ?? "unresolved"];
  const [local, setLocal] = useState<GettingStartedState | null>(null);
  useEffect(() => setLocal(loadLocal()), []);
  const server = useQuery<GettingStartedState>({
    queryKey,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/me/getting-started", { signal });
      if (!res.ok) throw new Error("server");
      const json = await parseJsonSafely<{ data?: unknown }>(res);
      return normalizeGettingStarted(json?.data);
    },
    enabled: enabled && Boolean(userId),
    staleTime: 60_000,
  });

  const state = server.data && local ? mergeGettingStarted(server.data, local) : null;
  // Push rows this browser ticked before sync existed, once.
  const needsUpload = Boolean(server.data && state && !sameGettingStarted(server.data, state));
  const uploaded = useRef(false);
  useEffect(() => {
    if (uploaded.current || !needsUpload || !state) return;
    uploaded.current = true;
    sendPatch(state);
  });

  const update = (patch: Partial<GettingStartedState>) => {
    if (!state) return;
    const next = mergeGettingStarted(state, patch);
    setLocal(next);
    saveLocal(next);
    queryClient.setQueryData(queryKey, next);
    sendPatch(patch);
  };
  return { state, update };
}

type Item = { id: GettingStartedRow; label: string; done: boolean; href?: string; external?: boolean; markOnClick?: boolean; onClick?: () => void };

/**
 * Fourteen quiet days of "where do I start" for a new student or staff member,
 * then it goes away on its own. Progress is shared with the iPhone app.
 */
export function GettingStartedCard() {
  const { data: user } = useCurrentUser();
  const { data: completion } = useProfileCompletion();
  const role = user?.role;
  const eligible = (role === "STUDENT" || role === "STAFF" || role === "ADMIN")
    && withinGettingStartedWindow(user?.accountCreatedAt)
    && !user?.preview?.readOnly;
  const { state: saved, update } = useGettingStartedState(eligible);
  const isStudent = role === "STUDENT";
  // "When can't you work" counts as done once anything is saved, on any device.
  const { data: blocks, reload: reloadBlocks } = useFetch<AvailabilityBlockLite[]>({
    url: `/api/users/${user?.id ?? ""}/availability`,
    transform: (json) => ((json as { data?: AvailabilityBlockLite[] }).data ?? []),
    enabled: Boolean(eligible && isStudent && user?.id && saved && !saved.dismissed),
    refetchOnFocus: false,
  });
  // A day off added from Home's Can't work card checks this row off right away.
  useEffect(() => {
    window.addEventListener(UNAVAILABLE_CHANGED_EVENT, reloadBlocks);
    return () => window.removeEventListener(UNAVAILABLE_CHANGED_EVENT, reloadBlocks);
  }, [reloadBlocks]);

  if (!eligible || !saved || saved.dismissed) return null;

  const profileDone = completion?.completion.profileComplete === true;
  const mark = (id: GettingStartedRow) => update({ done: [id] });
  const dismiss = () => update({ dismissed: true });
  const has = (id: GettingStartedRow) => saved.done.includes(id);

  const hasUnavailable = (blocks ?? []).some(isUnavailableBlock);
  const profile: Item = { id: "profile", label: "Finish your profile", done: profileDone, onClick: openProfileCompletion };
  const guides: Item = { id: "guides", label: "Read the guides", done: has("guides"), href: "/resources" };
  const app: Item = { id: "app", label: "Get the iPhone app", done: has("app"), href: APP_STORE_URL, external: true };
  const items: Item[] = isStudent
    ? [
        profile,
        { id: "availability", label: "Add when you can’t work", done: hasUnavailable || has("availability"), href: "/welcome/availability", markOnClick: false },
        { id: "schedule", label: "Check the schedule", done: has("schedule"), href: "/schedule" },
        guides,
        app,
      ]
    : [
        profile,
        { id: "crew", label: "Build a crew on the schedule", done: has("crew"), href: "/schedule" },
        { id: "onboarding-status", label: "See who’s set up", done: has("onboarding-status"), href: "/staff/onboarding-status" },
        guides,
        app,
      ];
  if (items.every((item) => item.done)) return null;
  const remaining = items.filter((item) => !item.done).length;

  return (
    <section aria-labelledby="getting-started-title" className="mb-4 rounded-2xl border border-[var(--border)] bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="getting-started-title" className="text-base">Getting started</h2>
          <p className="text-sm text-[var(--text-secondary)]">
            {remaining === 1 ? "One thing left." : `${remaining} things to look at in your first weeks.`}
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Hide getting started"
          className="-m-2 rounded-md p-2 text-[var(--text-muted)] hover:text-foreground"
        >
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
      <ul className="mt-3 divide-y divide-border">
        {items.map((item) => {
          const body = (
            <>
              <span
                className={
                  item.done
                    ? "flex size-5 items-center justify-center rounded-full bg-[var(--accent)] text-white"
                    : "size-5 rounded-full border border-[var(--border)]"
                }
                aria-hidden="true"
              >
                {item.done && <CheckIcon className="size-3" />}
              </span>
              <span className={item.done ? "text-[var(--text-muted)] line-through" : "font-bold"}>{item.label}</span>
            </>
          );
          const cls = "flex min-h-11 text-foreground w-full items-center gap-3 py-2 text-left text-sm";
          return (
            <li key={item.id}>
              {item.href ? (
                <Link
                  href={item.href}
                  {...(item.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  onClick={() => item.markOnClick !== false && mark(item.id)}
                  className={cls}
                >
                  {body}
                </Link>
              ) : (
                <button type="button" onClick={item.onClick} className={cls}>
                  {body}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
