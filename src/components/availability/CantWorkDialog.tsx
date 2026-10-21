"use client";

import { useState } from "react";
import { CheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { blockedWindow, formatClockTime, shiftsDuring, type BlockedRange, type ShiftLite } from "@/lib/unavailable-times";
import { AwayForm } from "./cant-work-forms";

type Props = {
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill the first day, e.g. the day picked on the schedule. */
  initialFrom?: string;
  onSaved?: () => void;
};

type Clash = ShiftLite;
type PostState = { status: "idle" | "posting" | "posted" } | { status: "error"; message: string };

/**
 * The quick everyday way in: one dated "can't work" entry, from Home or Schedule.
 * If they're already on a shift in that stretch, it offers the Trade Board right
 * away, since a day off doesn't move a shift on its own.
 */
export function CantWorkDialog({ userId, open, onOpenChange, initialFrom, onSaved }: Props) {
  const [clashes, setClashes] = useState<Clash[] | null>(null);
  const [posts, setPosts] = useState<Record<string, PostState>>({});

  function close(next: boolean) {
    onOpenChange(next);
    if (!next) {
      setClashes(null);
      setPosts({});
    }
  }

  async function saved(range: BlockedRange) {
    onSaved?.();
    const found = await findClashes(range);
    if (found.length === 0) close(false);
    else setClashes(found);
  }

  async function post(assignmentId: string) {
    setPosts((prev) => ({ ...prev, [assignmentId]: { status: "posting" } }));
    try {
      const res = await fetch("/api/shift-trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftAssignmentId: assignmentId, notes: "Can’t work this day." }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error(await parseErrorMessage(res, "Couldn’t post it"));
      setPosts((prev) => ({ ...prev, [assignmentId]: { status: "posted" } }));
    } catch (err) {
      setPosts((prev) => ({ ...prev, [assignmentId]: { status: "error", message: err instanceof Error ? err.message : "Couldn’t post it" } }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        {clashes ? (
          <>
            <DialogHeader className="flex-col items-start gap-1">
              <DialogTitle>You’re on the schedule then</DialogTitle>
              <DialogDescription>
                Your day off is saved, but these shifts are still yours. Post them to the Trade Board so a teammate can pick them up.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ul className="flex flex-col divide-y divide-border" data-cant-work-clashes>
                {clashes.map((shift) => {
                  const state = posts[shift.id] ?? { status: "idle" };
                  return (
                    <li key={shift.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-bold text-foreground">{shift.event.summary}</span>
                        <span className="truncate text-[13px] tabular-nums text-muted-foreground">{shiftWhen(shift)}</span>
                        {state.status === "error" && <span className="text-[13px] text-destructive">{state.message}</span>}
                      </span>
                      {state.status === "posted" ? (
                        <span className="flex h-10 items-center gap-1.5 text-sm font-bold text-[var(--green-text)]">
                          <CheckIcon className="size-4" aria-hidden="true" />
                          Posted
                        </span>
                      ) : (
                        <Button variant="outline" className="h-10" disabled={state.status === "posting"} onClick={() => void post(shift.id)}>
                          {state.status === "posting" ? "Posting…" : "Post to Trade Board"}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </DialogBody>
            <DialogFooter>
              <Button className="h-11 sm:px-6" onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className="flex-col items-start gap-1">
              <DialogTitle>Can’t work some days?</DialogTitle>
              <DialogDescription>A trip, an exam, another job. We won’t schedule you then.</DialogDescription>
            </DialogHeader>
            <DialogBody className="pb-6">
              {open && (
                <AwayForm
                  bare
                  userId={userId}
                  initialFrom={initialFrom}
                  onCancel={() => close(false)}
                  onSaved={(range) => void saved(range)}
                />
              )}
            </DialogBody>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Their own shifts in the blocked stretch. A failed check just skips the offer. */
async function findClashes(range: BlockedRange): Promise<Clash[]> {
  const { start, end } = blockedWindow(range);
  const params = new URLSearchParams({ startDate: start.toISOString(), endDate: end.toISOString(), limit: "20" });
  try {
    const res = await fetch(`/api/my-shifts?${params}`);
    if (!res.ok) return [];
    const json = await parseJsonSafely<{ data?: Clash[] }>(res);
    return shiftsDuring(Array.isArray(json?.data) ? json.data : [], range);
  } catch {
    return [];
  }
}

function shiftWhen(shift: Clash): string {
  if (shift.event.allDay) {
    const [y = 0, m = 1, d = 1] = shift.event.startsAt.slice(0, 10).split("-").map(Number);
    return `${new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · All day`;
  }
  const start = new Date(shift.startsAt);
  const clock = (date: Date) => formatClockTime(`${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`);
  const day = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  return `${day} · ${clock(start)} – ${clock(new Date(shift.endsAt))}`;
}
