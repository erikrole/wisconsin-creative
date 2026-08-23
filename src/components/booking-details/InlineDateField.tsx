"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Check, X, CalendarIcon } from "lucide-react";

function pad(n: number) { return String(n).padStart(2, "0"); }
function roundTo15(m: number) { return Math.round(m / 15) * 15; }

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => i);
const MINUTE_OPTIONS = [0, 15, 30, 45];

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * Displays a date/time as plain styled text.
 * When canEdit=true, clicking opens a calendar+time popover.
 * Saves on explicit "Apply" click — discards on popover close without Apply.
 */
export function InlineDateField({
  value,
  canEdit,
  onSave,
  minDate,
  formatValue,
}: {
  /** ISO string */
  value: string;
  canEdit: boolean;
  onSave: (iso: string) => Promise<void>;
  /** Optional lower bound (ISO string) */
  minDate?: string;
  formatValue?: (iso: string) => string;
}) {
  const current = new Date(value);
  const displayText = formatValue?.(value) ?? current.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const [open, setOpen] = useState(false);
	  const [pendingDate, setPendingDate] = useState<Date>(current);
	  const [status, setStatus] = useState<SaveStatus>("idle");
	  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
	  const controlId = useId();

  // Reset pending when value changes externally (e.g. after successful save)
  useEffect(() => {
    if (!open) setPendingDate(new Date(value));
  }, [value, open]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  function handleOpenChange(next: boolean) {
    if (!next) {
      // Discard uncommitted changes
      setPendingDate(new Date(value));
    }
    setOpen(next);
  }

  function handleDaySelect(day: Date | undefined) {
    if (!day) return;
    const next = new Date(day);
    next.setHours(pendingDate.getHours(), pendingDate.getMinutes(), 0, 0);
    setPendingDate(next);
  }

  function handleTimeChange(h: number, m: number) {
    const next = new Date(pendingDate);
    next.setHours(h, m, 0, 0);
    setPendingDate(next);
  }

  async function handleApply() {
    setStatus("saving");
    try {
      await onSave(pendingDate.toISOString());
      setStatus("saved");
      timerRef.current = setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
      timerRef.current = setTimeout(() => setStatus("idle"), 3000);
    }
    setOpen(false);
  }

  const statusIcon =
    status === "saving" ? <Spinner className="size-3.5" /> :
    status === "saved"  ? <Check className="size-3.5 text-[var(--green-text)]" /> :
    status === "error"  ? <X className="size-3.5 text-destructive" /> :
    null;

  if (!canEdit) {
    return <span>{displayText}</span>;
  }

  const minDateObj = minDate ? new Date(minDate) : undefined;
  const h = pendingDate.getHours();
  const m = roundTo15(pendingDate.getMinutes());

  return (
    <span className="inline-flex items-center gap-1.5">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="text-sm font-medium rounded px-1 -mx-1 cursor-pointer hover:bg-muted/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            title="Click to edit date"
          >
            {displayText}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={pendingDate}
            onSelect={handleDaySelect}
            defaultMonth={pendingDate}
            disabled={minDateObj ? (d) => d < new Date(minDateObj.getTime() - 86400000) : undefined}
          />
          <div className="border-t px-3 py-2 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <CalendarIcon className="size-4 text-muted-foreground shrink-0" />
	              <NativeSelect
	                id={`${controlId}-hour`}
	                name="inlineDateHour"
	                aria-label="Hour"
	                value={h}
	                onChange={(e) => handleTimeChange(Number(e.target.value), m)}
              >
                {HOUR_OPTIONS.map((hr) => (
                  <option key={hr} value={hr}>
                    {hr === 0 ? "12" : hr > 12 ? String(hr - 12) : String(hr)}
                    {hr < 12 ? " AM" : " PM"}
                  </option>
                ))}
              </NativeSelect>
              <span className="text-muted-foreground">:</span>
	              <NativeSelect
	                id={`${controlId}-minute`}
	                name="inlineDateMinute"
	                aria-label="Minute"
	                value={m}
                onChange={(e) => handleTimeChange(h, Number(e.target.value))}
              >
                {MINUTE_OPTIONS.map((mn) => (
                  <option key={mn} value={mn}>{pad(mn)}</option>
                ))}
              </NativeSelect>
            </div>
            <Button
              className="h-10 w-full"
              onClick={handleApply}
              disabled={status === "saving"}
            >
              {status === "saving" ? "Saving…" : "Confirm date"}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {statusIcon}
    </span>
  );
}
