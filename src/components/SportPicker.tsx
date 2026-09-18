"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NONE_SPORT_VALUE } from "@/lib/event-editor";
import {
  sportColumnLabel,
  sportLabel,
  sportsGroupedByProgram,
} from "@/lib/sports";
import { cn } from "@/lib/utils";

type SportPickerProps = {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  allowedCodes?: ReadonlySet<string>;
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  /** Full-width form control, or compact Schedule filter chip. */
  variant?: "field" | "filter";
};

export function SportPicker({
  id,
  value,
  onValueChange,
  allowedCodes,
  allowNone = false,
  noneLabel = "No sport",
  disabled,
  placeholder = "Select sport",
  variant = "field",
}: SportPickerProps) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => sportsGroupedByProgram(allowedCodes), [allowedCodes]);
  const selectedCode = value && value !== NONE_SPORT_VALUE ? value : "";
  const selectedLabel = selectedCode ? sportLabel(selectedCode) : "";
  const isFilter = variant === "filter";
  const columnCount = Number(groups.men.length > 0) + Number(groups.women.length > 0);

  function select(next: string) {
    onValueChange(next);
    setOpen(false);
  }

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          isFilter && "relative inline-flex min-h-10 overflow-hidden rounded-md border border-border/60 bg-background/70 shadow-[0_1px_0_rgba(15,23,42,0.05)] transition-[background-color,border-color,box-shadow]",
          isFilter && selectedCode
            ? "border-primary/20 bg-primary/[0.06] text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-t-full after:bg-primary/60"
            : isFilter
              ? "text-muted-foreground hover:border-border hover:bg-foreground/[0.025]"
              : undefined,
        )}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant={isFilter ? "ghost" : "outline"}
            role="combobox"
            aria-expanded={open}
            aria-haspopup="listbox"
            aria-label={selectedLabel ? `Sport: ${selectedLabel}` : "Sport filter"}
            disabled={disabled}
            className={cn(
              "h-10 justify-between font-normal",
              isFilter
                ? "max-w-[220px] min-w-0 gap-1.5 rounded-none border-0 px-3 text-xs shadow-none hover:bg-foreground/[0.04]"
                : "w-full",
            )}
          >
            {isFilter ? (
              <>
                <span className="shrink-0 font-medium">Sport{selectedCode ? ":" : ""}</span>
                {selectedCode ? (
                  <span className="truncate font-semibold text-foreground">{selectedLabel}</span>
                ) : (
                  <ChevronsUpDown className="size-3 opacity-50" aria-hidden="true" />
                )}
              </>
            ) : (
              <>
                <span className={cn("truncate", !selectedLabel && "text-muted-foreground")}>
                  {selectedLabel || placeholder}
                </span>
                <ChevronsUpDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
              </>
            )}
          </Button>
        </PopoverTrigger>
        {isFilter && selectedCode ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Clear Sport filter"
            className="size-10 rounded-none border-l border-border/50 text-muted-foreground shadow-none hover:bg-primary/[0.08] hover:text-foreground"
            onClick={() => { onValueChange(""); setOpen(false); }}
          >
            <X className="size-3" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <PopoverContent
        align="start"
        sideOffset={4}
        className={cn(
          "z-[60] p-0",
          columnCount > 1 ? "w-[min(28rem,calc(100vw-2rem))]" : "w-[min(18rem,calc(100vw-2rem))]",
        )}
      >
        <Command>
          <CommandInput placeholder="Search sport…" />
          <CommandList
            className={cn(
              "max-h-[min(22rem,var(--radix-popover-content-available-height))]",
              columnCount > 1 &&
                "[&_[cmdk-list-sizer]]:grid [&_[cmdk-list-sizer]]:grid-cols-2 [&_[cmdk-list-sizer]]:items-start",
            )}
          >
            <CommandEmpty className="col-span-2">No matching sport</CommandEmpty>
            {allowNone ? (
              <CommandGroup className="col-span-2">
                <CommandItem
                  value={`${noneLabel} none`}
                  onSelect={() => select(NONE_SPORT_VALUE)}
                >
                  <Check className={cn("size-4", selectedCode ? "opacity-0" : "opacity-100")} />
                  {noneLabel}
                </CommandItem>
              </CommandGroup>
            ) : null}
            {groups.men.length > 0 && (
              <CommandGroup heading="Men">
                {groups.men.map((sport) => (
                  <CommandItem
                    key={sport.code}
                    value={`${sport.label} ${sport.code}`}
                    onSelect={() => select(sport.code)}
                  >
                    <Check className={cn("size-4", selectedCode === sport.code ? "opacity-100" : "opacity-0")} />
                    {sportColumnLabel(sport.code)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {groups.women.length > 0 && (
              <CommandGroup heading="Women">
                {groups.women.map((sport) => (
                  <CommandItem
                    key={sport.code}
                    value={`${sport.label} ${sport.code}`}
                    onSelect={() => select(sport.code)}
                  >
                    <Check className={cn("size-4", selectedCode === sport.code ? "opacity-100" : "opacity-0")} />
                    {sportColumnLabel(sport.code)}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
