"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckIcon, XIcon } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useProfileCompletion } from "@/hooks/use-profile-completion";
import { useFetch } from "@/hooks/use-fetch";
import { openProfileCompletion } from "@/lib/profile-completion-events";
import { isUnavailableBlock, type AvailabilityBlockLite } from "@/lib/unavailable-times";
import { APP_STORE_URL } from "../welcome/WelcomeDone";

const STORAGE_KEY = "wc-getting-started";
const WINDOW_DAYS = 14;

type Saved = { done: string[]; dismissed: boolean };

function load(): Saved {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Saved>;
      return { done: Array.isArray(parsed.done) ? parsed.done : [], dismissed: parsed.dismissed === true };
    }
  } catch {
    /* storage can be blocked; the card just forgets */
  }
  return { done: [], dismissed: false };
}

function save(next: Saved) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

/** Records a row as handled from elsewhere, e.g. skipping "when can’t you work". */
export function markGettingStartedDone(id: string) {
  const current = load();
  if (!current.done.includes(id)) save({ ...current, done: [...current.done, id] });
}

/** Fourteen quiet days of "where do I start" for a new student, then it goes away on its own. */
export function GettingStartedCard() {
  const { data: user } = useCurrentUser();
  const { data: completion } = useProfileCompletion();
  const [saved, setSaved] = useState<Saved | null>(null);

  useEffect(() => setSaved(load()), []);
  const isStudent = user?.role === "STUDENT";
  // "When can't you work" counts as done once anything is saved, on any device.
  const { data: blocks } = useFetch<AvailabilityBlockLite[]>({
    url: `/api/users/${user?.id ?? ""}/availability`,
    transform: (json) => ((json as { data?: AvailabilityBlockLite[] }).data ?? []),
    enabled: Boolean(isStudent && user?.id && saved && !saved.dismissed),
    refetchOnFocus: false,
  });

  if (!saved || saved.dismissed || user?.role !== "STUDENT" || !user.accountCreatedAt) return null;
  const ageDays = (Date.now() - new Date(user.accountCreatedAt).getTime()) / 86_400_000;
  if (!(ageDays >= 0 && ageDays <= WINDOW_DAYS)) return null;

  const profileDone = completion?.completion.profileComplete === true;
  const mark = (id: string) => {
    const next = { ...saved, done: saved.done.includes(id) ? saved.done : [...saved.done, id] };
    setSaved(next);
    save(next);
  };
  const dismiss = () => {
    const next = { ...saved, dismissed: true };
    setSaved(next);
    save(next);
  };

  const hasUnavailable = (blocks ?? []).some(isUnavailableBlock);
  const items: Array<{ id: string; label: string; done: boolean; href?: string; external?: boolean; markOnClick?: boolean; onClick?: () => void }> = [
    { id: "profile", label: "Finish your profile", done: profileDone, onClick: openProfileCompletion },
    { id: "availability", label: "Add when you can’t work", done: hasUnavailable || saved.done.includes("availability"), href: "/welcome/availability", markOnClick: false },
    { id: "schedule", label: "Check the schedule", done: saved.done.includes("schedule"), href: "/schedule" },
    { id: "guides", label: "Read the guides", done: saved.done.includes("guides"), href: "/resources" },
    { id: "app", label: "Get the iPhone app", done: saved.done.includes("app"), href: APP_STORE_URL, external: true },
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
