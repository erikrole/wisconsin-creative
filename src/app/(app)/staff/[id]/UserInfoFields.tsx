"use client";

import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { UserDetail } from "../types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronsUpDown, InfoIcon, X } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { SaveableField, useSaveField } from "@/components/SaveableField";
import { cn } from "@/lib/utils";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import {
  APPAREL_FIT_OPTIONS,
  MENS_SHOE_SIZE_OPTIONS,
  SHOE_SYSTEM_OPTIONS,
  TOP_SIZE_OPTIONS,
  WOMENS_SHOE_SIZE_OPTIONS,
} from "@/lib/profile-sizing";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSyncedDraft } from "@/hooks/use-synced-draft";
import { birthdayDisplay, formatBirthdayInput, parseBirthdayInput, type ApiEnvelope } from "./user-info-helpers";

/* ── Text Input Field ─────────────────────────────────── */

export function TextInputField({
  label,
  value,
  placeholder,
  canEdit,
  onSave,
  type = "text",
  formatInput,
}: {
  label: ReactNode;
  value: string;
  placeholder?: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
  type?: "text" | "email" | "tel" | "url";
  formatInput?: (value: string) => string;
}) {
  const [draft, setDraft] = useSyncedDraft(value);
  const { status, save } = useSaveField(onSave);
  const id = useId();

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed === value) return;
    save(trimmed);
  }, [draft, value, save]);

  return (
    <SaveableField label={label} status={status} htmlFor={id}>
      <Input
        id={id}
        type={type}
        value={draft}
        onChange={(e) => setDraft(formatInput ? formatInput(e.target.value) : e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        disabled={!canEdit}
        className="h-10 text-sm"
      />
    </SaveableField>
  );
}

/* ── Select Input Field ───────────────────────────────── */

export function SelectInputField({
  label,
  value,
  options,
  canEdit,
  onSave,
  allowEmpty,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const { status, save } = useSaveField(onSave);

  return (
    <SaveableField label={label} status={status}>
      <Select
        value={value || "__none__"}
        onValueChange={(v) => {
          const resolved = v === "__none__" ? "" : v;
          if (resolved === value) return;
          save(resolved);
        }}
        disabled={!canEdit}
      >
        <SelectTrigger className="h-10 text-sm" aria-label={label}>
          <SelectValue placeholder={emptyLabel || "None"} />
        </SelectTrigger>
        <SelectContent><SelectGroup>
          {allowEmpty && (
            <SelectItem value="__none__">{emptyLabel || "None"}</SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup></SelectContent>
      </Select>
    </SaveableField>
  );
}

/* ── Date Input Field ─────────────────────────────────── */

export function DateInputField({
  label,
  value,
  canEdit,
  onSave,
}: {
  label: string;
  value: string | null;          // ISO datetime
  canEdit: boolean;
  onSave: (iso: string | null) => Promise<void>;
}) {
  const initial = value ? value.slice(0, 10) : "";
  const [draft, setDraft] = useSyncedDraft(initial);
  const { status, save } = useSaveField<string | null>(onSave);
  const id = useId();

  const commit = useCallback(() => {
    if (draft === initial) return;
    if (!draft) {
      save(null);
      return;
    }
    // Normalize to UTC midnight; date column in Postgres ignores time.
    const iso = new Date(`${draft}T00:00:00.000Z`).toISOString();
    save(iso);
  }, [draft, initial, save]);

  return (
    <SaveableField label={label} status={status} htmlFor={id}>
      <Input
        id={id}
        type="date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        disabled={!canEdit}
        className="h-10 text-sm"
      />
    </SaveableField>
  );
}

/* ── Direct Report Autocomplete ───────────────────────── */

type DirectReportSearchResult = { id: string; name: string; email: string };

export function DirectReportField({
  user,
  canEdit,
  onSavePicked,
  onSaveFreeText,
}: {
  user: UserDetail;
  canEdit: boolean;
  onSavePicked: (pickedUserId: string | null) => Promise<void>;
  onSaveFreeText: (name: string | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectReportSearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  const linkedName = user.directReport?.name ?? null;
  const displayValue = linkedName ?? user.directReportName ?? "";

  // Debounced search against the existing /api/users endpoint.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users?q=${encodeURIComponent(trimmed)}&limit=8&active=all`);
        if (handleAuthRedirect(res)) return;
        if (!res.ok) return;
        const json = await parseJsonSafely<ApiEnvelope<Array<{ id: string; name: string; email: string }>>>(res);
        const data: DirectReportSearchResult[] = (json?.data ?? [])
          .filter((u: { id: string }) => u.id !== user.id)
          .map((u: { id: string; name: string; email: string }) => ({
            id: u.id, name: u.name, email: u.email,
          }));
        setResults(data);
      } finally {
        setSearching(false);
      }
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open, user.id]);

  async function pickUser(picked: DirectReportSearchResult) {
    setOpen(false);
    setQuery("");
    await onSavePicked(picked.id);
  }

  async function saveFreeTextFromQuery() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setOpen(false);
    setQuery("");
    await onSaveFreeText(trimmed);
  }

  async function clear() {
    setOpen(false);
    setQuery("");
    if (user.directReportId) {
      await onSavePicked(null);
    } else if (user.directReportName) {
      await onSaveFreeText(null);
    }
  }

  return (
    <SaveableField label="Direct Report" status="idle">
      <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            disabled={!canEdit}
            aria-label="Direct report"
            className="w-full justify-between h-10 font-normal text-sm"
          >
            {displayValue ? (
              <span className="flex items-center gap-1.5 truncate">
                <span className="truncate">{displayValue}</span>
                {!linkedName && user.directReportName && <span className="text-xs text-muted-foreground">(external)</span>}
              </span>
            ) : (
              <span className="text-muted-foreground">No direct report</span>
            )}
            <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search users or type a name..."
              aria-label="Search direct reports"
              value={query}
              onValueChange={setQuery}
              onKeyDown={(e) => {
                if (e.key === "Enter" && results.length === 0 && query.trim()) {
                  e.preventDefault();
                  void saveFreeTextFromQuery();
                }
              }}
            />
            <CommandList>
              {searching && (
                <CommandEmpty>Searching…</CommandEmpty>
              )}
              {!searching && results.length === 0 && query.trim().length >= 2 && (
                <CommandEmpty>
                  <button
                    type="button"
                    className="text-sm text-left w-full px-2 py-1 hover:bg-accent rounded"
                    onClick={saveFreeTextFromQuery}
                  >
                    Use “{query.trim()}” as free-text
                  </button>
                </CommandEmpty>
              )}
              {!searching && results.length === 0 && query.trim().length < 2 && (
                <CommandEmpty>Type at least 2 characters…</CommandEmpty>
              )}
              {results.length > 0 && (
                <CommandGroup heading="Staff">
                  {results.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={r.id}
                      onSelect={() => pickUser(r)}
                    >
                      <div className="flex flex-col">
                        <span>{r.name}</span>
                        <span className="text-xs text-muted-foreground">{r.email}</span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {(user.directReportId || user.directReportName) && (
                <CommandGroup>
                  <CommandItem onSelect={clear} className="text-destructive">
                    <X className="mr-2 size-4" /> Clear
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </SaveableField>
  );
}

/* ── Sizes Row (compact 2- or 3-column inline edit) ───── */

function SizeMiniSelect({
  label,
  ariaLabel,
  value,
  options,
  canEdit,
  onSave,
}: {
  label: string;
  ariaLabel: string;
  value: string;
  options: readonly { value: string; label: string }[];
  canEdit: boolean;
  onSave: (v: string | null) => Promise<void>;
}) {
  const { status, save } = useSaveField<string | null>(onSave);
  const choices = value && !options.some((option) => option.value === value)
    ? [{ value, label: value }, ...options]
    : options;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">
        {label}
        {status === "saving" && " · saving"}
        {status === "saved" && " · saved"}
        {status === "error" && " · error"}
      </span>
      <Select value={value || "__none__"} onValueChange={(next) => save(next === "__none__" ? null : next)} disabled={!canEdit}>
        <SelectTrigger className="h-10" aria-label={ariaLabel}><SelectValue placeholder="Select" /></SelectTrigger>
        <SelectContent><SelectGroup>
          <SelectItem value="__none__">Not set</SelectItem>
          {choices.map((choice) => <SelectItem key={choice.value} value={choice.value}>{choice.label}</SelectItem>)}
        </SelectGroup></SelectContent>
      </Select>
    </div>
  );
}

export function SizesRow({
  user,
  isStudent,
  canEdit,
  onPatch,
}: {
  user: UserDetail;
  isStudent: boolean;
  canEdit: boolean;
  onPatch: (payload: Record<string, unknown>) => Promise<void>;
}) {
  return (
    <>
      <SaveableField label="Clothing" className="items-start">
        <div className={cn("grid gap-2", isStudent ? "grid-cols-2" : "grid-cols-3")}>
          <SizeMiniSelect
            label="Fit"
            ariaLabel="Top fit"
            value={user.topSizeFit ?? ""}
            options={APPAREL_FIT_OPTIONS}
            canEdit={canEdit}
            onSave={(v) => onPatch({ topSizeFit: v })}
          />
          <SizeMiniSelect
            label={isStudent ? "Size" : "Top"}
            ariaLabel={isStudent ? "Clothing size" : "Top size"}
            value={user.topSize ?? ""}
            options={TOP_SIZE_OPTIONS.map((value) => ({ value, label: value }))}
            canEdit={canEdit}
            onSave={(v) => onPatch({ topSize: v })}
          />
          {!isStudent && (
            <SizeMiniSelect
              label="Bottom"
              ariaLabel="Bottom size"
              value={user.bottomSize ?? ""}
              options={TOP_SIZE_OPTIONS.map((value) => ({ value, label: value }))}
              canEdit={canEdit}
              onSave={(v) => onPatch({ bottomSize: v })}
            />
          )}
        </div>
      </SaveableField>
      <SaveableField label="Shoes" className="items-start">
        <div className="grid grid-cols-2 gap-2">
          <SizeMiniSelect
            label="Sizing"
            ariaLabel="Shoe sizing"
            value={user.shoeSizeSystem ?? ""}
            options={SHOE_SYSTEM_OPTIONS}
            canEdit={canEdit}
            onSave={(v) => onPatch({ shoeSizeSystem: v })}
          />
          <SizeMiniSelect
            label="Size"
            ariaLabel="Shoe size"
            value={user.shoeSize ?? ""}
            options={(user.shoeSizeSystem === "US_MENS" ? MENS_SHOE_SIZE_OPTIONS : WOMENS_SHOE_SIZE_OPTIONS).map((value) => ({ value, label: value }))}
            canEdit={canEdit}
            onSave={(v) => onPatch({ shoeSize: v })}
          />
        </div>
      </SaveableField>
    </>
  );
}

export function BirthdayField({
  user,
  canEdit,
  onPatch,
}: {
  user: UserDetail;
  canEdit: boolean;
  onPatch: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const initial = birthdayDisplay(user);
  const [draft, setDraft] = useSyncedDraft(initial);
  const { status, save } = useSaveField(onPatch);
  const id = useId();

  const commit = useCallback(() => {
    const formatted = formatBirthdayInput(draft);
    if (formatted === initial) return;
    if (!formatted) {
      save({ birthdayMonth: null, birthdayDay: null });
      return;
    }
    try {
      const parsed = parseBirthdayInput(formatted);
      if (!parsed) {
        save({ birthdayMonth: null, birthdayDay: null });
        return;
      }
      save({ birthdayMonth: parsed.month, birthdayDay: parsed.day });
    } catch (error) {
      setDraft(initial);
      toast.error(error instanceof Error ? error.message : "Enter birthday as MM/DD");
    }
  }, [draft, initial, save, setDraft]);

  return (
    <SaveableField label="Birthday" status={status} htmlFor={id}>
      <Input
        id={id}
        inputMode="numeric"
        autoComplete="bday"
        aria-label="Birthday month and day"
        value={draft}
        onChange={(event) => setDraft(formatBirthdayInput(event.target.value))}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        placeholder="MM/DD"
        disabled={!canEdit}
        className="h-10 text-sm"
      />
    </SaveableField>
  );
}

export function WiscardFields({
  cardNumber,
  issueCode,
  canEdit,
  onPatch,
}: {
  cardNumber: string;
  issueCode: string;
  canEdit: boolean;
  onPatch: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [cardDraft, setCardDraft] = useSyncedDraft(cardNumber);
  const [issueDraft, setIssueDraft] = useSyncedDraft(issueCode);
  const cardSave = useSaveField<string>((value) => onPatch({ wiscardCardNumber: value || null }));
  const issueSave = useSaveField<string>((value) => onPatch({ wiscardIssueCode: value || null }));
  const cardId = useId();
  const issueId = useId();

  const status = cardSave.status === "saving" || issueSave.status === "saving"
    ? "saving"
    : cardSave.status === "error" || issueSave.status === "error"
      ? "error"
      : cardSave.status === "saved" || issueSave.status === "saved"
        ? "saved"
        : "idle";

  return (
    <SaveableField label="Wiscard" status={status} htmlFor={cardId}>
      <div className="flex items-center gap-1.5">
        <div className="flex min-w-0 flex-1">
          <Input
            id={cardId}
            inputMode="numeric"
            autoComplete="off"
            aria-label="Wiscard number"
            value={cardDraft}
            onChange={(event) => setCardDraft(event.target.value.replace(/\D/g, "").slice(0, 10))}
            onBlur={() => { if (cardDraft !== cardNumber) void cardSave.save(cardDraft); }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            placeholder="XXXXXXXXXX"
            disabled={!canEdit}
            className="h-10 min-w-0 flex-1 rounded-r-none border-r-0 text-sm"
          />
          <Input
            id={issueId}
            inputMode="numeric"
            autoComplete="off"
            aria-label="Issue code"
            value={issueDraft}
            onChange={(event) => setIssueDraft(event.target.value.replace(/\D/g, "").slice(0, 1))}
            onBlur={() => { if (issueDraft !== issueCode) void issueSave.save(issueDraft); }}
            onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}
            placeholder="X"
            disabled={!canEdit}
            className="h-10 w-12 shrink-0 rounded-l-none px-0 text-center text-sm tabular-nums"
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label="Where to find the Wiscard issue code" className="inline-flex size-10 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <InfoIcon />
            </button>
          </TooltipTrigger>
          <TooltipContent>Issue code can be found in the bottom right of your Wiscard</TooltipContent>
        </Tooltip>
      </div>
    </SaveableField>
  );
}
