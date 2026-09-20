"use client";

import { useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

type SaveStatus = "idle" | "saving" | "saved" | "error";

export function InlineTitle({
  value,
  canEdit,
  onSave,
  className,
  placeholder,
  saveMode = "blur",
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
  className?: string;
  placeholder?: string;
  saveMode?: "blur" | "explicit";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  async function commit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value) {
      setDraft(value);
      setEditing(false);
      return;
    }
    setStatus("saving");
    try {
      await onSave(trimmed);
      setEditing(false);
      setStatus("saved");
      timerRef.current = setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setDraft(value);
      setStatus("error");
      timerRef.current = setTimeout(() => setStatus("idle"), 3000);
    }
  }

  if (!canEdit) {
    return <span className={className}>{value || placeholder}</span>;
  }

  const statusIndicator = status !== "idle" && (
    <span className={cn(
      "inline-flex items-center gap-1 text-xs ml-2 align-middle transition-opacity duration-300",
      status === "saving" && "text-muted-foreground",
      status === "saved" && "text-[var(--green-text)]",
      status === "error" && "text-destructive",
    )}>
      {status === "saving" && <Spinner className="size-3.5" />}
      {status === "saved" && <Check className="size-3.5" />}
      {status === "error" && <X className="size-3.5" />}
    </span>
  );

  if (editing) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={saveMode === "blur" ? () => void commit() : undefined}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              if (saveMode === "blur") e.currentTarget.blur();
              else void commit();
            }
            if (e.key === "Escape") { setDraft(value); setEditing(false); }
          }}
          aria-label={placeholder || "Edit title"}
          className={`${className} min-w-0 bg-transparent border-none outline-none ring-1 ring-ring rounded px-1 -mx-1`}
        />
        {saveMode === "explicit" && (
          <span className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 border border-primary/20 bg-primary/[0.06]"
              onClick={() => void commit()}
              disabled={status === "saving"}
              aria-label="Save title"
            >
              {status === "saving" ? <Spinner className="size-4" /> : <Check className="size-4" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 border border-border/60 text-muted-foreground"
              onClick={() => { setDraft(value); setEditing(false); }}
              disabled={status === "saving"}
              aria-label="Cancel title edit"
            >
              <X className="size-4" />
            </Button>
          </span>
        )}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center">
      <span
        role="button"
        tabIndex={0}
        aria-label={`${value || placeholder} — click to edit`}
        className={`${className} cursor-pointer rounded px-1 -mx-1 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setEditing(true); }}
        title="Click to edit"
      >
        {value || <span className="text-muted-foreground">{placeholder}</span>}
      </span>
      {statusIndicator}
    </span>
  );
}
