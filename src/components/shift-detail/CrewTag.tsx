"use client";

import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CREW_LABEL_MAX_LENGTH,
  crewHalfLabel,
  normalizeCrewLabel,
  type CrewHalf,
} from "@/lib/crew-label";
import { cn } from "@/lib/utils";

const TAG_CLASS =
  "inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-[11px] font-medium leading-none text-muted-foreground";

/** Read-only position tag ("SLOW1", "1st half") shown beside a worker's name. */
export function CrewTag({
  label,
  half,
  className,
}: {
  label?: string | null;
  half?: CrewHalf | null;
  className?: string;
}) {
  const text = label?.trim() || null;
  const halfText = crewHalfLabel(half);
  if (!text && !halfText) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)} data-testid="crew-tag">
      {text && <span className={cn(TAG_CLASS, "truncate")}>{text}</span>}
      {halfText && <span className={TAG_CLASS}>{halfText}</span>}
    </span>
  );
}

const HALF_ITEMS: Array<{ value: "ALL" | CrewHalf; label: string }> = [
  { value: "ALL", label: "Full game" },
  { value: "FIRST", label: "1st half" },
  { value: "SECOND", label: "2nd half" },
];

/**
 * Tag shown as a chip that opens an editor. With no tag set it is a quiet
 * "Label" affordance that the row reveals on hover.
 */
export function CrewTagEditor({
  label,
  half,
  personName,
  disabled,
  revealClassName,
  onSave,
}: {
  label: string | null | undefined;
  half: CrewHalf | null | undefined;
  personName: string;
  disabled: boolean;
  revealClassName?: string;
  onSave: (label: string | null, half: CrewHalf | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState(label ?? "");
  const [draftHalf, setDraftHalf] = useState<"ALL" | CrewHalf>(half ?? "ALL");
  const hasTag = Boolean(label?.trim() || half);

  function handleOpenChange(next: boolean) {
    if (next) {
      setDraftLabel(label ?? "");
      setDraftHalf(half ?? "ALL");
    }
    setOpen(next);
  }

  function save() {
    onSave(normalizeCrewLabel(draftLabel), draftHalf === "ALL" ? null : draftHalf);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${hasTag ? "Edit" : "Add"} position label for ${personName}`}
          className={cn(
            "inline-flex min-h-6 shrink-0 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
            !hasTag && revealClassName,
          )}
        >
          {hasTag ? (
            <CrewTag label={label} half={half} />
          ) : (
            <span className={cn(TAG_CLASS, "gap-0.5 bg-transparent px-1 hover:bg-muted")}>
              <PlusIcon className="size-3" aria-hidden="true" />
              Label
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] space-y-3 p-3" align="start">
        <div>
          <p className="text-sm font-medium">Position label</p>
          <p className="text-xs text-muted-foreground">
            Shows next to {personName} wherever this event&rsquo;s crew appears.
          </p>
        </div>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Label</span>
          <Input
            value={draftLabel}
            maxLength={CREW_LABEL_MAX_LENGTH}
            placeholder="e.g. SLOW1"
            autoComplete="off"
            onChange={(event) => setDraftLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                save();
              }
            }}
          />
        </label>
        <div className="space-y-1 text-xs">
          <span className="text-muted-foreground">Covers</span>
          <ToggleGroup
            type="single"
            value={draftHalf}
            onValueChange={(value) => {
              if (value) setDraftHalf(value as "ALL" | CrewHalf);
            }}
            className="flex w-full"
            aria-label="Which half this person covers"
          >
            {HALF_ITEMS.map((item) => (
              <ToggleGroupItem key={item.value} value={item.value} className="flex-1 px-1 text-xs">
                {item.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-10 text-xs"
            disabled={!hasTag}
            onClick={() => {
              onSave(null, null);
              setOpen(false);
            }}
          >
            Clear
          </Button>
          <Button type="button" className="h-10 text-xs" onClick={save}>
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
