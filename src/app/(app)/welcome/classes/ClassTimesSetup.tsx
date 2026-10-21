"use client";

import { useId, useState } from "react";
import { toast } from "sonner";
import { PlusIcon, XIcon } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
  CLASS_DAYS,
  defaultClassesEndOn,
  formatClassDays,
  formatClockTime,
  groupClassTimes,
  type ClassTime,
  type WeeklyBlock,
} from "@/lib/class-times";

type Props = {
  userId: string;
  /** Called when they finish or skip; the page decides where to go next. */
  onDone: (outcome: "saved" | "skipped") => void;
};

/** A calm, student-shaped front door to weekly availability: classes, days, times. */
export function ClassTimesSetup({ userId, onDone }: Props) {
  const { data, loading, error, reload } = useFetch<WeeklyBlock[]>({
    url: `/api/users/${userId}/availability`,
    transform: (json) => ((json as { data?: WeeklyBlock[] }).data ?? []),
    refetchOnFocus: false,
  });
  const classes = groupClassTimes(data ?? []);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const showForm = adding || (!loading && classes.length === 0);

  async function remove(item: ClassTime) {
    if (removing) return;
    setRemoving(item.key);
    try {
      for (const id of item.blockIds) {
        const res = await fetch(`/api/users/${userId}/availability/${id}`, { method: "DELETE" });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not remove that class"));
      }
      toast.success(`Removed ${item.label ?? "class"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove that class");
    } finally {
      setRemoving(null);
      reload();
    }
  }

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-10 sm:py-16">
      <header className="space-y-2">
        <p className="text-sm font-bold text-[var(--accent)]">Getting started</p>
        <h1 className="text-balance text-3xl">When are you in class?</h1>
        <p className="text-pretty text-[var(--text-secondary)]">
          Add your classes so you’re not scheduled during them. You can change them any time.
        </p>
      </header>

      {loading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : error ? (
        <div className="rounded-2xl border border-[var(--border)] bg-card p-5 text-sm">
          <p>We couldn’t load your classes.</p>
          <Button variant="outline" className="mt-3 h-10" onClick={reload}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {classes.length > 0 && (
            <ul aria-label="Your classes" className="divide-y divide-border overflow-hidden rounded-2xl border border-[var(--border)] bg-card">
              {classes.map((item) => (
                <li key={item.key} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{item.label ?? "Class"}</span>
                    <span className="block text-sm text-[var(--text-secondary)] tabular-nums">
                      {formatClassDays(item.days)} · {formatClockTime(item.startsAt)} – {formatClockTime(item.endsAt)}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11 text-[var(--text-muted)] hover:text-foreground"
                    aria-label={`Remove ${item.label ?? "class"}, ${formatClassDays(item.days)} ${formatClockTime(item.startsAt)}`}
                    disabled={removing === item.key}
                    onClick={() => void remove(item)}
                  >
                    <XIcon className="size-4" aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {showForm ? (
            <AddClassForm
              userId={userId}
              first={classes.length === 0}
              onCancel={classes.length > 0 ? () => setAdding(false) : undefined}
              onSaved={() => {
                setAdding(false);
                reload();
              }}
            />
          ) : (
            <Button variant="outline" className="h-11 self-start" onClick={() => setAdding(true)}>
              <PlusIcon className="size-4" aria-hidden="true" />
              Add another class
            </Button>
          )}
        </>
      )}

      {!loading && !(adding && classes.length > 0) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          {classes.length === 0 ? (
            <Button variant="ghost" className="h-11 text-[var(--text-secondary)]" onClick={() => onDone("skipped")}>
              Skip for now
            </Button>
          ) : (
            <Button className="h-11 w-full text-base font-bold sm:w-auto sm:px-8" onClick={() => onDone("saved")}>
              Done
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function AddClassForm({
  userId,
  first,
  onSaved,
  onCancel,
}: {
  userId: string;
  first: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const nameId = useId();
  const fromId = useId();
  const toId = useId();
  const endId = useId();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [startsAt, setStartsAt] = useState("09:30");
  const [endsAt, setEndsAt] = useState("10:45");
  const [endsOn, setEndsOn] = useState(defaultClassesEndOn);
  const [saving, setSaving] = useState(false);

  const timesValid = startsAt < endsAt;
  const canSave = days.length > 0 && timesValid && !saving;

  function toggle(day: number) {
    setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    let saved = 0;
    try {
      for (const dayOfWeek of days) {
        const res = await fetch(`/api/users/${userId}/availability`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: "WEEKLY",
            intent: "CANNOT_WORK",
            dayOfWeek,
            startsAt,
            endsAt,
            label: label.trim() || undefined,
            semesterEndsOn: endsOn || null,
          }),
        });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Could not save that class"));
        saved += 1;
      }
      toast.success(`Added ${label.trim() || "class"}`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that class");
      // Some days may have saved; show what's there rather than guess.
      if (saved > 0) onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-5 rounded-2xl border border-[var(--border)] bg-card p-5">
      <p className="font-bold">{first ? "Add a class" : "Add another class"}</p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>Class</Label>
        <Input id={nameId} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="COMM 201" maxLength={80} className="h-11" />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">Days</legend>
        <div className="grid grid-cols-7 gap-1.5">
          {CLASS_DAYS.map(({ day, short, name }) => {
            const on = days.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                aria-label={name}
                onClick={() => toggle(day)}
                className={cn(
                  "flex h-11 w-full max-w-11 items-center justify-center justify-self-center rounded-full border text-sm font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
                  on
                    ? "border-transparent bg-foreground text-background"
                    : "border-[var(--border)] bg-transparent text-foreground hover:bg-[var(--bg-surface)]",
                )}
              >
                {short}
              </button>
            );
          })}
        </div>
      </fieldset>

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
            aria-invalid={!timesValid}
            aria-describedby={!timesValid ? `${toId}-err` : undefined}
            required
          />
        </div>
      </div>
      {!timesValid && (
        <p id={`${toId}-err`} className="-mt-3 text-sm text-destructive">
          The class has to end after it starts.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={endId}>Last day of classes</Label>
        <Input id={endId} type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className="h-11" />
        <p className="text-sm text-[var(--text-secondary)]">After this, the class stops blocking shifts.</p>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="ghost" className="h-11" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
        )}
        <Button type="submit" className="h-11 sm:px-6" disabled={!canSave}>
          {saving ? "Saving…" : "Add class"}
        </Button>
      </div>
    </form>
  );
}
