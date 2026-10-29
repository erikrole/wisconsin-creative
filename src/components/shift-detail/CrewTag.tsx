"use client";

import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  CREW_LABEL_MAX_LENGTH,
  MAX_CREW_TAGS,
  crewTagText,
  normalizeCrewTags,
  type CrewHalf,
  type CrewTagValue,
} from "@/lib/crew-label";
import { cn } from "@/lib/utils";

const TAG_CLASS =
  "inline-flex h-5 max-w-40 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-[11px] font-medium leading-none text-muted-foreground";

/** Read-only position tags ("SLOW1 · 1st half", "CAM3 · 2nd half") shown beside a worker's name. */
export function CrewTag({ tags, className }: { tags: CrewTagValue[]; className?: string }) {
  const texts = tags.map((tag) => crewTagText(tag.label, tag.half)).filter((text): text is string => Boolean(text));
  if (texts.length === 0) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1", className)} data-testid="crew-tag">
      {texts.map((text) => (
        <span key={text} className={cn(TAG_CLASS, "truncate")}>{text}</span>
      ))}
    </span>
  );
}

const HALF_ITEMS: Array<{ value: "ALL" | CrewHalf; label: string }> = [
  { value: "ALL", label: "Full game" },
  { value: "FIRST", label: "1st half" },
  { value: "SECOND", label: "2nd half" },
];

type DraftTag = { label: string; half: "ALL" | CrewHalf };

const toDraft = (tags: CrewTagValue[]): DraftTag[] =>
  tags.length > 0
    ? tags.map((tag) => ({ label: tag.label ?? "", half: tag.half ?? "ALL" }))
    : [{ label: "", half: "ALL" }];

/**
 * Tags shown as chips that open an editor. With none set it is a quiet
 * "Label" affordance that the row reveals on hover. "Add another" gives one
 * person a different label for each half.
 */
export function CrewTagEditor({
  tags,
  personName,
  disabled,
  revealClassName,
  onSave,
}: {
  tags: CrewTagValue[];
  personName: string;
  disabled: boolean;
  revealClassName?: string;
  onSave: (tags: CrewTagValue[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftTag[]>(() => toDraft(tags));
  const hasTag = tags.length > 0;

  function handleOpenChange(next: boolean) {
    if (next) setDraft(toDraft(tags));
    setOpen(next);
  }

  function updateDraft(index: number, patch: Partial<DraftTag>) {
    setDraft((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function save() {
    onSave(normalizeCrewTags(draft.map((row) => ({ label: row.label, half: row.half === "ALL" ? null : row.half }))));
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
            <CrewTag tags={tags} />
          ) : (
            <span className={cn(TAG_CLASS, "gap-0.5 bg-transparent px-1 hover:bg-muted")}>
              <PlusIcon className="size-3" aria-hidden="true" />
              Label
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3" align="start">
        <div>
          <p className="text-sm font-medium">Position labels</p>
          <p className="text-xs text-muted-foreground">
            Show next to {personName} wherever this event&rsquo;s crew appears.
          </p>
        </div>
        <div className="space-y-3">
          {draft.map((row, index) => (
            <div key={index} className="space-y-2 rounded-lg border p-2" data-testid="crew-tag-row">
              <div className="flex items-center gap-1.5">
                <Input
                  value={row.label}
                  maxLength={CREW_LABEL_MAX_LENGTH}
                  placeholder="e.g. SLOW1"
                  aria-label={`Label ${index + 1}`}
                  autoComplete="off"
                  onChange={(event) => updateDraft(index, { label: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      save();
                    }
                  }}
                />
                {draft.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10 shrink-0"
                    aria-label={`Remove label ${index + 1}`}
                    onClick={() => setDraft((rows) => rows.filter((_, i) => i !== index))}
                  >
                    <XIcon className="size-4" aria-hidden="true" />
                  </Button>
                )}
              </div>
              <ToggleGroup
                type="single"
                value={row.half}
                onValueChange={(value) => {
                  if (value) updateDraft(index, { half: value as "ALL" | CrewHalf });
                }}
                className="flex w-full"
                aria-label={`Which part of the event label ${index + 1} covers`}
              >
                {HALF_ITEMS.map((item) => (
                  <ToggleGroupItem key={item.value} value={item.value} className="flex-1 px-1 text-xs">
                    {item.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          ))}
        </div>
        {draft.length < MAX_CREW_TAGS && (
          <Button
            type="button"
            variant="ghost"
            className="h-10 w-full justify-start gap-1.5 text-xs"
            onClick={() => setDraft((rows) => [...rows, { label: "", half: rows.some((r) => r.half === "FIRST") ? "SECOND" : "FIRST" }])}
          >
            <PlusIcon className="size-3.5" aria-hidden="true" />
            Add another
          </Button>
        )}
        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-10 text-xs"
            disabled={!hasTag}
            onClick={() => {
              onSave([]);
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
