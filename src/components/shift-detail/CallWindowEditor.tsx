"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ClockIcon, RotateCcwIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { QUARTER_HOUR_MINUTES, roundUpToQuarterHour } from "@/lib/quarter-hour";
import {
  callWindowSourceLabel,
  dateTimeLocalToIso,
  formatCallTime,
  formatCallWindow,
  type CallWindowSource,
  type EffectiveCallWindow,
  toDateTimeLocalValue,
} from "@/lib/shift-call-windows";
import { cn } from "@/lib/utils";
import { CREW_CALL_TRIGGER_CLASS } from "./crew-row";

type EditableTarget = {
  type: "slot" | "assignment";
  id: string;
};

type CallWindowPair = {
  startsAt: string | null;
  endsAt: string | null;
};

type Props = {
  target?: EditableTarget;
  effectiveWindow: EffectiveCallWindow;
  overrideWindow?: CallWindowPair;
  disabled?: boolean;
  onSaved?: () => void;
  className?: string;
  compact?: boolean;
  showSourceBadge?: boolean;
  /**
   * "chip" is the standalone control: clock glyph, "Call 3:00 PM", source badge.
   * "bare" is the crew-row form: just the time, for a column already headed
   * Call. See {@link CREW_CALL_TRIGGER_CLASS} for the matching row styling.
   */
  variant?: "chip" | "bare";
};

const SOURCE_VARIANTS: Record<CallWindowSource, BadgeProps["variant"]> = {
  assignment: "blue",
  slot: "purple",
  default: "outline",
};

function hasOverride(window?: CallWindowPair): boolean {
  return Boolean(window?.startsAt && window?.endsAt);
}

function targetLabel(target?: EditableTarget): string {
  return target?.type === "assignment" ? "personal call time" : "slot call time";
}

export function CallWindowEditor({
  target,
  effectiveWindow,
  overrideWindow,
  disabled,
  onSaved,
  className,
  compact,
  showSourceBadge = true,
  variant = "chip",
}: Props) {
  const bare = variant === "bare";
  const editable = Boolean(target);
  const [open, setOpen] = useState(false);
  const [startDraft, setStartDraft] = useState("");
  const [endDraft, setEndDraft] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const overrideActive = hasOverride(overrideWindow);

  const resetDraft = useMemo(() => {
    const start = overrideWindow?.startsAt ?? effectiveWindow.startsAt;
    const end = overrideWindow?.endsAt ?? effectiveWindow.endsAt;
    return {
      start: toDateTimeLocalValue(start),
      end: toDateTimeLocalValue(end),
    };
  }, [effectiveWindow.endsAt, effectiveWindow.startsAt, overrideWindow?.endsAt, overrideWindow?.startsAt]);

  useEffect(() => {
    if (!open) return;
    setStartDraft(resetDraft.start);
    setEndDraft(resetDraft.end);
    setError("");
  }, [open, resetDraft]);

  async function patchWindow(callStartsAt: string | null, callEndsAt: string | null) {
    if (!target || savingRef.current) return;
    const start = callStartsAt ? new Date(callStartsAt) : null;
    const end = callEndsAt ? new Date(callEndsAt) : null;
    if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) {
      setError("Use valid start and end times.");
      return;
    }
    if ((callStartsAt === null) !== (callEndsAt === null)) {
      setError("Set both call time and coverage end.");
      return;
    }
    if (start && end && end <= start) {
      setError("Coverage end must be after call time.");
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setError("");
    const endpoint = target.type === "slot"
      ? `/api/shifts/${target.id}`
      : `/api/shift-assignments/${target.id}`;

    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callStartsAt, callEndsAt }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Call time was not saved");
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(callStartsAt ? "Call time updated" : "Call time cleared");
      setOpen(false);
      onSaved?.();
    } catch {
      const msg = "Could not reach the server. Call time was not saved.";
      setError(msg);
      toast.error(msg);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function saveDraft() {
    const callStartsAt = dateTimeLocalToIso(startDraft);
    const callEndsAt = dateTimeLocalToIso(endDraft);
    if (!callStartsAt || !callEndsAt) {
      setError("Set both call time and coverage end.");
      return;
    }
    void patchWindow(
      roundUpToQuarterHour(new Date(callStartsAt)).toISOString(),
      roundUpToQuarterHour(new Date(callEndsAt)).toISOString(),
    );
  }

  const label = formatCallTime(effectiveWindow);
  const windowLabel = formatCallWindow(effectiveWindow);
  const trigger = (
    <Button
      type="button"
      // A read-only chip needs its own outline; a bare row cell must not draw
      // a box around a value the reader cannot change.
      variant={editable || bare ? "ghost" : "outline"}
      size={compact ? "sm" : "default"}
      className={cn(
        "min-w-0 justify-start gap-1.5 px-2 text-left tabular-nums",
        compact ? "h-8 text-[11px]" : "h-9 text-xs",
        bare && CREW_CALL_TRIGGER_CLASS,
        !editable && "pointer-events-none bg-transparent hover:bg-transparent hover:text-muted-foreground",
        className,
      )}
      disabled={disabled}
      aria-label={editable ? `Edit ${targetLabel(target)}` : `Call ${label}`}
      title={windowLabel !== label ? `Coverage window: ${windowLabel}` : undefined}
      onClick={(event) => event.stopPropagation()}
    >
      {!bare && <ClockIcon className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 truncate">{bare ? label : `Call ${label}`}</span>
      {showSourceBadge && !bare && (
        <Badge variant={SOURCE_VARIANTS[effectiveWindow.source]} size="sm" className="shrink-0">
          {callWindowSourceLabel(effectiveWindow.source)}
        </Badge>
      )}
    </Button>
  );

  if (!target) return trigger;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-72 p-3" align="start" onClick={(event) => event.stopPropagation()}>
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold capitalize">{targetLabel(target)}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              The row shows one call time. The coverage end is still used for conflict checks.
            </p>
          </div>
          <div className="grid gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor={`${target.id}-call-start`} className="text-xs">Call time</Label>
              <Input
                id={`${target.id}-call-start`}
                type="datetime-local"
                step={QUARTER_HOUR_MINUTES * 60}
                value={startDraft}
                onChange={(event) => setStartDraft(event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`${target.id}-call-end`} className="text-xs">Coverage end</Label>
              <Input
                id={`${target.id}-call-end`}
                type="datetime-local"
                step={QUARTER_HOUR_MINUTES * 60}
                value={endDraft}
                onChange={(event) => setEndDraft(event.target.value)}
                disabled={saving}
              />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="ghost"
              className="h-10 gap-1.5"
              disabled={saving || !overrideActive}
              onClick={() => patchWindow(null, null)}
            >
              <RotateCcwIcon className="size-3.5" />
              Clear
            </Button>
            <div className="flex gap-2">
              <Button className="h-10" type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button className="h-10" type="button" disabled={saving} onClick={saveDraft}>
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
