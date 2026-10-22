"use client";

import { useEffect, useMemo, useState } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FRESH_SCOPE_CLASS } from "@/lib/fonts/fresh";
import { MAX_SLOTS_PER_AREA_CLASS, type WorkingSchedulePayload } from "@/lib/schedule-working-copy";
import { AREA_LABELS } from "@/types/areas";
import { cn } from "@/lib/utils";

const AREA_ORDER = ["VIDEO", "PHOTO", "GRAPHICS", "SOCIAL", "COMMS", "LIVE_PRODUCTION"] as const;
const WORKER_TYPES = ["FT", "ST"] as const;

type Area = (typeof AREA_ORDER)[number];
type WorkerType = (typeof WORKER_TYPES)[number];
type CountKey = `${Area}:${WorkerType}`;

export type CrewSizeTarget = { area: Area; workerType: WorkerType; count: number };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slots: WorkingSchedulePayload["slots"];
  saving: boolean;
  onSave: (counts: CrewSizeTarget[]) => Promise<boolean>;
};

function key(area: Area, workerType: WorkerType): CountKey {
  return `${area}:${workerType}`;
}

/**
 * Crew size in one step: set how many Staff and Student positions each area
 * needs, then save once. Filled slots (or slots with history) set the floor,
 * since only open, never-assigned slots can be removed.
 */
export function CrewSizeDialog({ open, onOpenChange, slots, saving, onSave }: Props) {
  const { current, floor } = useMemo(() => {
    const currentCounts = new Map<CountKey, number>();
    const floorCounts = new Map<CountKey, number>();
    for (const slot of slots) {
      const k = key(slot.area as Area, slot.workerType as WorkerType);
      currentCounts.set(k, (currentCounts.get(k) ?? 0) + 1);
      if (slot.assignment || slot.assignmentHistoryCount > 0) floorCounts.set(k, (floorCounts.get(k) ?? 0) + 1);
    }
    return { current: currentCounts, floor: floorCounts };
  }, [slots]);

  const [draft, setDraft] = useState<Map<CountKey, number>>(new Map());
  useEffect(() => {
    if (open) setDraft(new Map(current));
    // Reseed only when the dialog opens; a save refreshes `slots` underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const changes = useMemo(() => {
    const targets: CrewSizeTarget[] = [];
    let added = 0;
    let removed = 0;
    for (const area of AREA_ORDER) {
      for (const workerType of WORKER_TYPES) {
        const k = key(area, workerType);
        const before = current.get(k) ?? 0;
        const after = draft.get(k) ?? 0;
        if (before === after) continue;
        targets.push({ area, workerType, count: after });
        if (after > before) added += after - before;
        else removed += before - after;
      }
    }
    return { targets, added, removed };
  }, [current, draft]);

  const total = [...draft.values()].reduce((sum, value) => sum + value, 0);

  function step(area: Area, workerType: WorkerType, delta: 1 | -1) {
    setDraft((previous) => {
      const k = key(area, workerType);
      const next = new Map(previous);
      const value = (previous.get(k) ?? 0) + delta;
      next.set(k, Math.min(MAX_SLOTS_PER_AREA_CLASS, Math.max(floor.get(k) ?? 0, value)));
      return next;
    });
  }

  async function save() {
    if (changes.targets.length === 0) {
      onOpenChange(false);
      return;
    }
    if (await onSave(changes.targets)) onOpenChange(false);
  }

  const summary = [
    changes.added > 0 ? `${changes.added} to add` : null,
    changes.removed > 0 ? `${changes.removed} to remove` : null,
  ].filter(Boolean).join(" · ");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(FRESH_SCOPE_CLASS, "bg-[var(--background)] sm:max-w-lg")}>
        <DialogHeader className="pr-16">
          <div>
            <DialogTitle>Crew size</DialogTitle>
            <DialogDescription className="mt-1">
              Set how many people each area needs. New slots open in the private working schedule and release with your other crew changes.
            </DialogDescription>
          </div>
        </DialogHeader>

        <DialogBody className="px-6 py-4">
          <div className="overflow-hidden rounded-xl border border-[var(--border)]">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 border-b border-[var(--border)] bg-[var(--bg-surface)] px-3 sm:gap-x-4 sm:px-4 py-2 text-xs font-bold text-[var(--text-secondary)]">
              <span>Area</span>
              <span className="w-[6.5rem] sm:w-[7.5rem] text-center">Staff</span>
              <span className="w-[6.5rem] sm:w-[7.5rem] text-center">Student</span>
            </div>
            <ul className="divide-y divide-[var(--border)]">
              {AREA_ORDER.map((area) => (
                <li key={area} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-2 px-3 py-1.5 sm:gap-x-4 sm:px-4">
                  <span className="min-w-0 text-sm font-bold leading-tight">{AREA_LABELS[area] ?? area}</span>
                  {WORKER_TYPES.map((workerType) => {
                    const k = key(area, workerType);
                    const value = draft.get(k) ?? 0;
                    const min = floor.get(k) ?? 0;
                    const changed = value !== (current.get(k) ?? 0);
                    const label = `${AREA_LABELS[area] ?? area} ${workerType === "FT" ? "Staff" : "Student"}`;
                    return (
                      <div key={workerType} className="flex w-[6.5rem] sm:w-[7.5rem] items-center justify-between">
                        <Button
                          type="button"
                          variant="ghost"
                          className="size-10 p-0"
                          disabled={saving || value <= min}
                          onClick={() => step(area, workerType, -1)}
                          aria-label={`Fewer ${label} slots`}
                          title={value <= min && min > 0 ? `${min} filled or used before, so they stay` : undefined}
                        >
                          <MinusIcon className="size-4" />
                        </Button>
                        <span
                          className={cn(
                            "w-6 text-center text-sm tabular-nums",
                            value === 0 ? "text-[var(--text-muted)]" : "font-bold",
                            changed && "font-bold text-[var(--blue-text)]",
                          )}
                          aria-live="polite"
                          aria-label={`${value} ${label} slots`}
                        >
                          {value}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          className="size-10 p-0"
                          disabled={saving || value >= MAX_SLOTS_PER_AREA_CLASS}
                          onClick={() => step(area, workerType, 1)}
                          aria-label={`More ${label} slots`}
                        >
                          <PlusIcon className="size-4" />
                        </Button>
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          </div>
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            Filled slots can&apos;t be removed here. Unassign the person first.
          </p>
        </DialogBody>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs tabular-nums text-[var(--text-secondary)]">
            {summary || `${total} position${total === 1 ? "" : "s"}`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" className="h-10" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button className="h-10" onClick={() => void save()} loading={saving} disabled={changes.targets.length === 0}>
              Save crew size
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
