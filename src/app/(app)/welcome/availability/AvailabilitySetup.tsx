"use client";

import { useState } from "react";
import { toast } from "sonner";
import { CalendarPlusIcon, PlusIcon, XIcon } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { AwayForm, WeeklyForm } from "@/components/availability/cant-work-forms";
import {
  formatAwayDates,
  formatClockTime,
  formatWeekDays,
  groupWeekly,
  upcomingAway,
  type AvailabilityBlockLite,
} from "@/lib/unavailable-times";

type Props = {
  userId: string;
  /** Called when they finish or skip; the page decides where to go next. */
  onDone: (outcome: "saved" | "skipped") => void;
};

type Mode = "weekly" | "away" | null;

/**
 * A calm, student-shaped front door to availability: what repeats every week
 * (classes, a job, practice) and the dates they're away.
 */
export function AvailabilitySetup({ userId, onDone }: Props) {
  const { data, loading, error, reload } = useFetch<AvailabilityBlockLite[]>({
    url: `/api/users/${userId}/availability`,
    transform: (json) => ((json as { data?: AvailabilityBlockLite[] }).data ?? []),
    refetchOnFocus: false,
  });
  const weekly = groupWeekly(data ?? []);
  const away = upcomingAway(data ?? []);
  const hasAny = weekly.length > 0 || away.length > 0;
  const [mode, setMode] = useState<Mode>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(key: string, ids: string[], name: string) {
    if (removing) return;
    setRemoving(key);
    try {
      for (const id of ids) {
        const res = await fetch(`/api/users/${userId}/availability/${id}`, { method: "DELETE" });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not remove that"));
      }
      toast.success(`Removed ${name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that");
    } finally {
      setRemoving(null);
      reload();
    }
  }

  const saved = () => {
    setMode(null);
    reload();
  };

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-10 sm:py-16">
      <header className="space-y-2">
        <p className="text-sm font-bold text-[var(--accent)]">Availability</p>
        <h1 className="text-balance text-3xl">When can’t you work?</h1>
        <p className="text-pretty text-[var(--text-secondary)]">
          Add classes, a job, or anything else that repeats each week, and any dates you’ll be away. We’ll schedule around them. You can change these any time.
        </p>
      </header>

      {loading ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : error ? (
        <div className="rounded-2xl border border-[var(--border)] bg-card p-5 text-sm">
          <p>We couldn’t load your times.</p>
          <Button variant="outline" className="mt-3 h-10" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <section aria-labelledby="weekly-title" className="flex flex-col gap-3">
            <div>
              <h2 id="weekly-title" className="text-lg">Every week</h2>
              <p className="text-sm text-[var(--text-secondary)]">Classes, a job, practice.</p>
            </div>
            {weekly.length > 0 && (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
                {weekly.map((item) => {
                  const name = item.label ?? "Weekly time";
                  const when = `${formatWeekDays(item.days)} · ${formatClockTime(item.startsAt)} – ${formatClockTime(item.endsAt)}`;
                  return (
                    <Row key={item.key} title={name} detail={when} removing={removing === item.key} onRemove={() => void remove(item.key, item.blockIds, name)} />
                  );
                })}
              </ul>
            )}
            {mode === "weekly" ? (
              <WeeklyForm userId={userId} onSaved={saved} onCancel={() => setMode(null)} />
            ) : (
              <Button variant="outline" className="h-11 self-start" onClick={() => setMode("weekly")}>
                <PlusIcon className="size-4" aria-hidden="true" />
                {weekly.length > 0 ? "Add another" : "Add something weekly"}
              </Button>
            )}
          </section>

          <section aria-labelledby="away-title" className="flex flex-col gap-3">
            <div>
              <h2 id="away-title" className="text-lg">Days away</h2>
              <p className="text-sm text-[var(--text-secondary)]">A trip home, a game you’re traveling to, an exam.</p>
            </div>
            {away.length > 0 && (
              <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
                {away.map((item) => {
                  const name = item.label ?? "Away";
                  const when = `${formatAwayDates(item)}${item.allDay ? "" : ` · ${formatClockTime(item.startsAt)} – ${formatClockTime(item.endsAt)}`}`;
                  return <Row key={item.id} title={name} detail={when} removing={removing === item.id} onRemove={() => void remove(item.id, [item.id], name)} />;
                })}
              </ul>
            )}
            {mode === "away" ? (
              <AwayForm userId={userId} onSaved={saved} onCancel={() => setMode(null)} />
            ) : (
              <Button variant="outline" className="h-11 self-start" onClick={() => setMode("away")}>
                <CalendarPlusIcon className="size-4" aria-hidden="true" />
                {away.length > 0 ? "Add more days away" : "Add days away"}
              </Button>
            )}
          </section>
        </>
      )}

      {!loading && mode === null && (
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          {hasAny ? (
            <Button className="h-11 w-full text-base font-bold sm:w-auto sm:px-8" onClick={() => onDone("saved")}>
              Done
            </Button>
          ) : (
            <Button variant="ghost" className="h-11 text-[var(--text-secondary)]" onClick={() => onDone("skipped")}>
              Skip for now
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ title, detail, removing, onRemove }: { title: string; detail: string; removing: boolean; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{title}</span>
        <span className="block text-sm text-[var(--text-secondary)] tabular-nums">{detail}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-11 text-[var(--text-muted)] hover:text-foreground"
        aria-label={`Remove ${title}, ${detail}`}
        disabled={removing}
        onClick={onRemove}
      >
        <XIcon className="size-4" aria-hidden="true" />
      </Button>
    </li>
  );
}
