"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { CalendarPlusIcon, PlusIcon, XIcon } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  WEEK_DAYS,
  defaultWeeklyEndsOn,
  formatAwayDates,
  formatClockTime,
  formatWeekDays,
  groupWeekly,
  localToday,
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
        <p className="text-sm font-bold text-[var(--accent)]">Getting started</p>
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

async function post(userId: string, body: Record<string, unknown>) {
  const res = await fetch(`/api/users/${userId}/availability`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "CANNOT_WORK", ...body }),
  });
  if (handleAuthRedirect(res)) return false;
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not save that"));
  return true;
}

function FormShell({
  title,
  saving,
  canSave,
  onCancel,
  onSubmit,
  children,
}: {
  title: string;
  saving: boolean;
  canSave: boolean;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-5 rounded-2xl border border-[var(--border)] bg-card p-5" aria-label={title}>
      {children}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:px-6" disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}

function TimeRange({
  startsAt,
  endsAt,
  setStartsAt,
  setEndsAt,
}: {
  startsAt: string;
  endsAt: string;
  setStartsAt: (v: string) => void;
  setEndsAt: (v: string) => void;
}) {
  const fromId = useId();
  const toId = useId();
  const valid = startsAt < endsAt;
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fromId}>From</Label>
          <Input id={fromId} type="time" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="h-11" required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={toId}>To</Label>
          <Input
            id={toId}
            type="time"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            className="h-11"
            aria-invalid={!valid}
            aria-describedby={!valid ? `${toId}-err` : undefined}
            required
          />
        </div>
      </div>
      {!valid && (
        <p id={`${toId}-err`} className="-mt-3 text-sm text-destructive">
          The end time has to be after the start.
        </p>
      )}
    </>
  );
}

function WeeklyForm({ userId, onSaved, onCancel }: { userId: string; onSaved: () => void; onCancel: () => void }) {
  const nameId = useId();
  const endId = useId();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [startsAt, setStartsAt] = useState("09:30");
  const [endsAt, setEndsAt] = useState("10:45");
  const [endsOn, setEndsOn] = useState(defaultWeeklyEndsOn);
  const [saving, setSaving] = useState(false);
  const canSave = days.length > 0 && startsAt < endsAt && !saving;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    let count = 0;
    try {
      for (const dayOfWeek of days) {
        if (!(await post(userId, { kind: "WEEKLY", dayOfWeek, startsAt, endsAt, label: label.trim() || undefined, semesterEndsOn: endsOn || null }))) return;
        count += 1;
      }
      toast.success(`Added ${label.trim() || "weekly time"}`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that");
      // Some days may have saved; show what's there rather than guess.
      if (count > 0) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell title="Add something weekly" saving={saving} canSave={canSave} onCancel={onCancel} onSubmit={save}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>What is it?</Label>
        <Input id={nameId} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="COMM 201, job at the Union" maxLength={80} className="h-11" autoFocus />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Days</legend>
        <div className="grid grid-cols-7 gap-1.5">
          {WEEK_DAYS.map(({ day, short, name }) => {
            const on = days.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                aria-label={name}
                onClick={() => setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]))}
                className={cn(
                  "flex h-11 w-full max-w-11 items-center justify-center justify-self-center rounded-full border text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                  on ? "border-transparent bg-foreground text-background" : "border-[var(--border)] bg-transparent text-foreground hover:bg-[var(--bg-surface)]",
                )}
              >
                {short}
              </button>
            );
          })}
        </div>
      </fieldset>

      <TimeRange startsAt={startsAt} endsAt={endsAt} setStartsAt={setStartsAt} setEndsAt={setEndsAt} />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={endId}>Repeats until</Label>
        <Input id={endId} type="date" value={endsOn} min={localToday()} onChange={(e) => setEndsOn(e.target.value)} className="h-11" />
        <p className="text-sm text-[var(--text-secondary)]">Usually the end of the term. After this it stops blocking shifts.</p>
      </div>
    </FormShell>
  );
}

function AwayForm({ userId, onSaved, onCancel }: { userId: string; onSaved: () => void; onCancel: () => void }) {
  const nameId = useId();
  const fromId = useId();
  const throughId = useId();
  const allDayId = useId();
  const today = localToday();
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState(today);
  const [through, setThrough] = useState("");
  const [allDay, setAllDay] = useState(true);
  const [startsAt, setStartsAt] = useState("09:00");
  const [endsAt, setEndsAt] = useState("17:00");
  const [saving, setSaving] = useState(false);
  const datesValid = Boolean(from) && (!through || through >= from);
  const canSave = datesValid && (allDay || startsAt < endsAt) && !saving;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const ok = await post(userId, {
        kind: "AD_HOC",
        date: from,
        dateEndsOn: through || from,
        allDay,
        startsAt: allDay ? "00:00" : startsAt,
        endsAt: allDay ? "23:59" : endsAt,
        label: label.trim() || undefined,
      });
      if (!ok) return;
      toast.success(`Added ${label.trim() || "days away"}`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell title="Add days away" saving={saving} canSave={canSave} onCancel={onCancel} onSubmit={save}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>What for?</Label>
        <Input id={nameId} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Trip home" maxLength={80} className="h-11" autoFocus />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={fromId}>From</Label>
          <Input
            id={fromId}
            type="date"
            value={from}
            min={today}
            onChange={(e) => {
              setFrom(e.target.value);
              if (through && e.target.value > through) setThrough(e.target.value);
            }}
            className="h-11"
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={throughId}>Through</Label>
          <Input id={throughId} type="date" value={through} min={from || today} onChange={(e) => setThrough(e.target.value)} className="h-11" />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={allDayId} className="font-normal">All day</Label>
        <Switch id={allDayId} checked={allDay} onCheckedChange={setAllDay} />
      </div>

      {!allDay && <TimeRange startsAt={startsAt} endsAt={endsAt} setStartsAt={setStartsAt} setEndsAt={setEndsAt} />}
    </FormShell>
  );
}
