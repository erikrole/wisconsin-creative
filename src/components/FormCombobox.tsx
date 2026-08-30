"use client";

import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { buildCategoryPathOptions } from "@/lib/category-options";
import type { CategoryOption } from "@/types/category";

// ── Simple flat combobox ──

interface ComboboxOption {
  value: string;
  label: string;
}

interface FormComboboxProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Whether to show a clear/none option */
  allowClear?: boolean;
  /** Whether the combobox is disabled (renders plain text) */
  disabled?: boolean;
  /** Additional trigger styling for a specific form surface. */
  triggerClassName?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}

export function FormCombobox({
  id,
  value,
  onValueChange,
  options,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyLabel = "No results.",
  allowClear = false,
  disabled = false,
  triggerClassName,
  ariaInvalid,
  ariaDescribedBy,
}: FormComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  if (disabled) {
    return <span className="text-sm">{selected?.label || "\u2014"}</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          className={cn("h-9 w-full justify-between text-sm font-normal", triggerClassName)}
        >
          {selected ? (
            selected.label
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {allowClear && (
                <CommandItem
                  value=" "
                  onSelect={() => {
                    onValueChange("");
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 size-4", !value ? "opacity-100" : "opacity-0")} />
                  <span className="text-muted-foreground">&mdash;</span>
                </CommandItem>
              )}
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.label}
                  onSelect={() => {
                    onValueChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 size-4", value === opt.value ? "opacity-100" : "opacity-0")} />
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Grouped category combobox ──

interface CategoryComboboxProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  categories: CategoryOption[];
  /** Whether to show a clear/none option */
  allowClear?: boolean;
  /** Whether to show a "+ Create new category" option */
  allowCreate?: boolean;
  /** Callback when user clicks create — parent handles the creation flow */
  onCreateRequested?: () => void;
  /** Whether the combobox is disabled (renders plain text) */
  disabled?: boolean;
  /** Display label when disabled and no value is selected */
  disabledLabel?: string;
  /** Button variant for the trigger */
  variant?: "outline" | "ghost";
  triggerClassName?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}

export function CategoryCombobox({
  id,
  value,
  onValueChange,
  categories,
  allowClear = false,
  allowCreate = false,
  onCreateRequested,
  disabled = false,
  disabledLabel,
  variant = "outline",
  triggerClassName,
  ariaInvalid,
  ariaDescribedBy,
}: CategoryComboboxProps) {
  const [open, setOpen] = useState(false);

  const options = buildCategoryPathOptions(categories);
  const selectedCat = options.find((c) => c.value === value);

  if (disabled) {
    return <span className="text-sm">{disabledLabel || selectedCat?.label || "\u2014"}</span>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant={variant}
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          className={cn("h-9 w-full justify-between text-sm font-normal", triggerClassName)}
        >
          {selectedCat ? (
            selectedCat.label
          ) : (
            <span className="text-muted-foreground">Select category</span>
          )}
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search categories..." />
          <CommandList>
            <CommandEmpty>No category found.</CommandEmpty>
            {allowClear && (
              <>
                <CommandGroup>
                  <CommandItem
                    value=" "
                    onSelect={() => {
                      onValueChange("");
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        !value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="text-muted-foreground">&mdash;</span>
                  </CommandItem>
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading="Categories">
              {options.map((opt) => (
                <CommandItem
                  key={opt.value}
                  value={opt.label}
                  keywords={opt.keywords}
                  onSelect={() => {
                    onValueChange(opt.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 size-4",
                      value === opt.value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {allowCreate && onCreateRequested && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => {
                      setOpen(false);
                      onCreateRequested();
                    }}
                  >
                    + Create new category
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Item family combobox ──

export type BulkSkuOption = {
  id: string;
  name: string;
  trackByNumber: boolean;
  location: { name: string };
  balances: { onHandQuantity: number }[];
  categoryRel: { name: string } | null;
};

interface BulkSkuComboboxProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  skus: BulkSkuOption[];
  triggerClassName?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
}

export function BulkSkuCombobox({
  id,
  value,
  onValueChange,
  skus,
  triggerClassName,
  ariaInvalid,
  ariaDescribedBy,
}: BulkSkuComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = skus.find((s) => s.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={ariaInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          className={cn("h-9 w-full justify-between text-sm font-normal", triggerClassName)}
        >
          {selected ? (
            selected.name
          ) : (
            <span className="text-muted-foreground">Select an item</span>
          )}
          <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by name, location, category..." />
          <CommandList>
            <CommandEmpty>No items found.</CommandEmpty>
            <CommandGroup>
              {skus.map((sku) => {
                const qty = sku.balances.reduce((sum, b) => sum + b.onHandQuantity, 0);
                const searchLabel = [sku.name, sku.location.name, sku.categoryRel?.name].filter(Boolean).join(" ");
                return (
                  <CommandItem
                    key={sku.id}
                    value={searchLabel}
                    onSelect={() => {
                      onValueChange(sku.id);
                      setOpen(false);
                    }}
                  >
                    <Check className={cn("mr-2 size-4", value === sku.id ? "opacity-100" : "opacity-0")} />
                    <span>
                      {sku.name} — {qty} on hand ({sku.location.name})
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
