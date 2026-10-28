"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Save Status Types ─────────────────────────────────── */

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/* ── useSaveField Hook ─────────────────────────────────── */

export function useSaveField<T = string>(onSave: (v: T) => Promise<void>) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const save = useCallback(
    async (value: T) => {
      if (savingRef.current) return;
      savingRef.current = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      setStatus("saving");
      try {
        await onSave(value);
        setStatus("saved");
        timerRef.current = setTimeout(() => setStatus("idle"), 2000);
      } catch (err) {
        setStatus("error");
        toast.error(err instanceof Error && err.message ? err.message : "Save failed");
        timerRef.current = setTimeout(() => setStatus("idle"), 3000);
      } finally {
        savingRef.current = false;
      }
    },
    [onSave],
  );

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    savingRef.current = false;
    setStatus("idle");
  }, []);

  return { status, save, reset, isSaving: status === "saving" };
}

/* ── SaveStatusIndicator ───────────────────────────────── */

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;

  return (
    <span
      className={cn(
        "inline-flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium transition-opacity duration-300",
        status === "saving" && "text-muted-foreground",
        status === "saved" && "bg-[var(--green-bg)] text-[var(--green-text)]",
        status === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      {status === "saving" && (
        <>
          <Spinner className="size-3" />
          <span>Saving</span>
        </>
      )}
      {status === "saved" && (
        <>
          <Check className="size-3" />
          <span>Saved</span>
        </>
      )}
      {status === "error" && (
        <>
          <X className="size-3" />
          <span>Failed</span>
        </>
      )}
    </span>
  );
}

/* ── SaveableField Layout ──────────────────────────────── */

export function SaveableField({
  label,
  status = "idle",
  isDirty,
  onCommit,
  onCancel,
  className,
  labelClassName,
  htmlFor,
  ariaLabel,
  children,
}: {
  label: React.ReactNode;
  status?: SaveStatus;
  isDirty?: boolean;
  onCommit?: () => void;
  onCancel?: () => void;
  className?: string;
  labelClassName?: string;
  htmlFor?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "group/row relative flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 transition-[background-color,box-shadow] hover:bg-foreground/[0.03] focus-within:bg-background/60",
        isDirty && "bg-primary/5 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary/60",
        className,
      )}
    >
      {htmlFor ? (
        <Label
          htmlFor={htmlFor}
          className={cn("text-sm text-muted-foreground shrink-0 w-[120px]", labelClassName)}
        >
          {label}
        </Label>
      ) : (
        <span
          className={cn("text-sm text-muted-foreground shrink-0 w-[120px]", labelClassName)}
        >
          {label}
        </span>
      )}
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <div className="flex-1 min-w-0">{children}</div>
        {isDirty && onCommit && onCancel && status !== "saving" ? (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 border border-primary/20 bg-primary/[0.06] text-foreground shadow-[0_1px_0_rgba(15,23,42,0.05)] hover:bg-primary/[0.1]"
              onClick={onCommit}
              aria-label={`Save ${ariaLabel ?? (typeof label === "string" ? label : "field")}`}
            >
              <Check className="size-4" aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 border border-border/60 bg-background/70 text-muted-foreground shadow-[0_1px_0_rgba(15,23,42,0.05)] hover:bg-foreground/[0.04] hover:text-foreground"
              onClick={onCancel}
              aria-label={`Cancel ${ariaLabel ?? (typeof label === "string" ? label : "field")}`}
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ) : (
          <SaveStatusIndicator status={status} />
        )}
      </div>
    </div>
  );
}

/* ── FieldGroup (labeled section of saveable rows) ─────── */

export function FieldGroup({
  label,
  children,
}: {
  label?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border/30 pb-1 first:border-t-0">
      {label && (
        <div className="px-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/55">
          {label}
        </div>
      )}
      <div className="grid grid-cols-1 divide-y divide-border/30">{children}</div>
    </section>
  );
}
