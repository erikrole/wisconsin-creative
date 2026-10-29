"use client";

import { useId, useState } from "react";
import { PaintRollerIcon } from "lucide-react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { PaintWeek } from "./PaintWeek";
import { WEEK_DAYS, defaultWeeklyEndsOn, localToday, type BlockedRange } from "@/lib/unavailable-times";

/**
 * The two student-shaped "can't work" forms: something that repeats weekly,
 * and dates they're away. Both save CANNOT_WORK availability blocks, so
 * scheduling and the staff Availability tab read them unchanged.
 */

async function postUnavailable(userId: string, body: Record<string, unknown>) {
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
  bare,
  saveLabel = "Save",
  onCancel,
  onSubmit,
  children,
}: {
  title: string;
  saving: boolean;
  canSave: boolean;
  /** Inside a dialog: no card chrome of its own. */
  bare?: boolean;
  saveLabel?: string;
  onCancel: () => void;
  onSubmit: (e: React.FormEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className={cn("flex flex-col gap-5", !bare && "rounded-2xl border border-[var(--border)] bg-card p-5")} aria-label={title}>
      {children}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" className="h-11" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" className="h-11 sm:px-6" disabled={!canSave}>
          {saving ? "Saving…" : saveLabel}
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

export function WeeklyForm({ userId, onSaved, onCancel }: { userId: string; onSaved: () => void; onCancel: () => void }) {
  const nameId = useId();
  const endId = useId();
  const [label, setLabel] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [startsAt, setStartsAt] = useState("09:30");
  const [endsAt, setEndsAt] = useState("10:45");
  const [endsOn, setEndsOn] = useState(defaultWeeklyEndsOn);
  const [saving, setSaving] = useState(false);
  const [paintMode, setPaintMode] = useState(false);
  const canSave = days.length > 0 && startsAt < endsAt && !saving;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    let count = 0;
    try {
      for (const dayOfWeek of days) {
        if (!(await postUnavailable(userId, { kind: "WEEKLY", dayOfWeek, startsAt, endsAt, label: label.trim() || undefined, semesterEndsOn: endsOn || null }))) return;
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
        <div className="mb-2 flex items-center justify-between">
          <legend className="text-sm font-medium">Days</legend>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={paintMode}
            className={cn("h-8 gap-1.5 text-[var(--text-secondary)]", paintMode && "text-[var(--accent)]")}
            onClick={() => setPaintMode((on) => !on)}
          >
            <PaintRollerIcon className="size-4" aria-hidden="true" />
            Paint it in
          </Button>
        </div>
        {paintMode && (
          <div className="mb-2 flex flex-col gap-1.5">
            <PaintWeek days={days} startsAt={startsAt} endsAt={endsAt} onPaint={(next) => { setDays(next.days); setStartsAt(next.startsAt); setEndsAt(next.endsAt); }} />
            <p className="text-sm text-[var(--text-secondary)]">Drag across the days and hours. The roller is back.</p>
          </div>
        )}
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

type AwayFormProps = {
  userId: string;
  /** Gets the stretch that was blocked, so callers can check shifts in it. */
  onSaved: (range: BlockedRange) => void;
  onCancel: () => void;
  /** Prefill the first day, e.g. the day picked on the schedule. */
  initialFrom?: string;
  bare?: boolean;
};

export function AwayForm({ userId, onSaved, onCancel, initialFrom, bare }: AwayFormProps) {
  const nameId = useId();
  const fromId = useId();
  const throughId = useId();
  const allDayId = useId();
  const today = localToday();
  const [label, setLabel] = useState("");
  const [from, setFrom] = useState(initialFrom && initialFrom >= today ? initialFrom : today);
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
      const range: BlockedRange = {
        from,
        through: through || from,
        allDay,
        startsAt: allDay ? "00:00" : startsAt,
        endsAt: allDay ? "23:59" : endsAt,
      };
      const ok = await postUnavailable(userId, {
        kind: "AD_HOC",
        date: range.from,
        dateEndsOn: range.through,
        allDay,
        startsAt: range.startsAt,
        endsAt: range.endsAt,
        label: label.trim() || undefined,
      });
      if (!ok) return;
      toast.success(`Added ${label.trim() || "days away"}`);
      onSaved(range);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that");
    } finally {
      setSaving(false);
    }
  }

  return (
    <FormShell title="Add days away" saving={saving} canSave={canSave} bare={bare} saveLabel={bare ? "Add" : "Save"} onCancel={onCancel} onSubmit={save}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={nameId}>What for?</Label>
        <Input id={nameId} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Trip home, exam, other job" maxLength={80} className="h-11" autoFocus={!bare} />
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
