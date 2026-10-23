"use client";

import { useEffect } from "react";
import Link from "next/link";
import { CheckIcon, XIcon } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { useFetch } from "@/hooks/use-fetch";
import {
  withinGettingStartedWindow,
  type GettingStartedRow,
} from "@/lib/getting-started";
import { useGettingStartedState } from "@/hooks/use-getting-started";
import { Button } from "@/components/ui/button";
import { openProfileCompletion } from "@/lib/profile-completion-events";
import { UNAVAILABLE_CHANGED_EVENT, isUnavailableBlock, type AvailabilityBlockLite } from "@/lib/unavailable-times";
import { APP_STORE_URL } from "../welcome/WelcomeDone";

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
  const { state: saved, update, error: syncError, saving: syncing, retry } = useGettingStartedState(eligible);
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

  if (!eligible || !saved) return null;
  const syncFeedback = syncError ? (
    <p role="status" className="text-sm text-muted-foreground">{syncError} <Button variant="link" onClick={retry}>Retry</Button></p>
  ) : syncing ? <p role="status" className="text-xs text-muted-foreground">Saving checklist…</p> : null;
  if (saved.dismissed) return syncFeedback;

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
  if (items.every((item) => item.done)) return syncFeedback;
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
      {syncFeedback}
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
