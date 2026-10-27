"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useCopyFeedback } from "@/hooks/use-copy-feedback";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Check, ExternalLink, Copy, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { CategoryOption } from "./types";
import { SaveableField, useSaveField } from "@/components/SaveableField";
import { CategoryCombobox } from "@/components/FormCombobox";
import { externalUrlHost, normalizeExternalUrl } from "@/lib/external-url";
import { useSyncedDraft } from "@/hooks/use-synced-draft";
import { formatUsdDraft, getNormalizedExternalUrl, normalizeUsdForDirty, parseUsdDraft } from "./item-info-format";

/* ── Text Input Field ──────────────────────────────────── */

export function TextInputField({
  label,
  value,
  placeholder,
  canEdit,
  onSave,
  mono,
  readOnly,
  warnDuplicate,
}: {
  label: string;
  value: string | null | undefined;
  placeholder?: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
  mono?: boolean;
  readOnly?: boolean;
  /** If set, checks for duplicate values on blur via search API */
  warnDuplicate?: { field: "assetTag" | "serialNumber"; assetId: string };
}) {
  const normalizedValue = value ?? "";
  const [draft, setDraft] = useSyncedDraft(normalizedValue);
  const [dupWarning, setDupWarning] = useState("");
  const saveField = useSaveField(onSave);
  const fieldId = useId();

  async function checkDuplicate(val: string) {
    if (!warnDuplicate || !val || val === normalizedValue) { setDupWarning(""); return; }
    try {
      const res = await fetch(`/api/assets?q=${encodeURIComponent(val)}&limit=5`);
      if (handleAuthRedirect(res)) return;
      if (!res.ok) return;
      const json = await parseJsonSafely<{ data?: Array<{ id: string; assetTag: string; serialNumber: string | null }> }>(res);
      const matches = (json?.data || []).filter(
        (a: { id: string; assetTag: string; serialNumber: string | null }) =>
          a.id !== warnDuplicate.assetId &&
          (warnDuplicate.field === "assetTag" ? a.assetTag === val : a.serialNumber === val)
      );
      const duplicate = matches[0];
      setDupWarning(duplicate ? `Duplicate found: ${duplicate.assetTag}` : "");
    } catch { /* ignore */ }
  }

  const isDirty = draft.trim() !== normalizedValue;

  async function commit() {
    if (saveField.isSaving) return;
    const trimmed = draft.trim();
    if (trimmed === normalizedValue) return;
    await checkDuplicate(trimmed);
    await saveField.save(trimmed);
  }

  function cancel() {
    setDraft(normalizedValue);
    saveField.reset();
    setDupWarning("");
  }

  return (
    <SaveableField
      label={label}
      status={saveField.status}
      isDirty={canEdit && !readOnly && isDirty}
      onCommit={commit}
      onCancel={cancel}
      htmlFor={fieldId}
    >
      <div className="flex-1 min-w-0">
        <Input
          id={fieldId}
          name={label.toLowerCase().replace(/\s+/g, "-")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          placeholder={placeholder}
          disabled={!canEdit || readOnly || saveField.isSaving}
          aria-busy={saveField.isSaving}
          className={cn("h-8 border-transparent bg-transparent text-sm shadow-none hover:border-input focus-visible:border-input disabled:opacity-100", mono && "font-mono")}
        />
        {dupWarning && (
          <p className="text-xs text-[var(--orange-text)] mt-0.5 px-1">{dupWarning}</p>
        )}
      </div>
    </SaveableField>
  );
}

export function CurrencyInputField({
  label,
  value,
  placeholder,
  canEdit,
  onSave,
}: {
  label: string;
  value: string | number | null | undefined;
  placeholder?: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [draft, setDraft] = useSyncedDraft(value, formatUsdDraft);
  const saveField = useSaveField(onSave);
  const fieldId = useId();
  const formattedValue = formatUsdDraft(value);
  const isDirty = normalizeUsdForDirty(draft) !== normalizeUsdForDirty(formattedValue);

  async function commit() {
    if (saveField.isSaving) return;
    let normalized: string;
    try {
      normalized = parseUsdDraft(draft);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enter a valid USD amount");
      return;
    }
    if (normalized === normalizeUsdForDirty(formattedValue)) {
      setDraft(formattedValue);
      return;
    }
    await saveField.save(normalized);
  }

  function cancel() {
    setDraft(formattedValue);
    saveField.reset();
  }

  return (
    <SaveableField
      label={label}
      status={saveField.status}
      isDirty={canEdit && isDirty}
      onCommit={commit}
      onCancel={cancel}
      htmlFor={fieldId}
    >
      <div className="relative flex-1">
        <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
          $
        </span>
        <Input
          id={fieldId}
          name={label.toLowerCase().replace(/\s+/g, "-")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          placeholder={placeholder || "0.00"}
          disabled={!canEdit || saveField.isSaving}
          aria-busy={saveField.isSaving}
          inputMode="decimal"
          autoComplete="off"
          className="h-8 pl-6 text-sm tabular-nums"
        />
      </div>
    </SaveableField>
  );
}

export function LinkField({
  label,
  value,
  placeholder,
  canEdit,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [draft, setDraft] = useSyncedDraft(value);
  const { copiedKey, copy: copyWithFeedback } = useCopyFeedback(2000);
  const copied = copiedKey === "link";
  const saveField = useSaveField(onSave);
  const fieldId = useId();

  const isDirty = draft.trim() !== value;
  const sourceHost = externalUrlHost(value);
  const openUrl = value ? getNormalizedExternalUrl(value) : "";

  async function commit() {
    if (saveField.isSaving) return;
    let normalized: string;
    try {
      normalized = normalizeExternalUrl(draft);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Enter a valid http or https URL");
      return;
    }
    const currentComparable = value ? getNormalizedExternalUrl(value) || value.trim() : "";
    if (normalized === currentComparable) return;
    await saveField.save(normalized);
  }

  function cancel() {
    setDraft(value);
    saveField.reset();
  }

  async function copyUrl() {
    if (!value) return;
    const result = await copyWithFeedback(openUrl, "link");
    if (result === "failed") {
      toast.error("Could not copy the link", {
        description: "Select the visible URL and copy it manually.",
      });
    }
  }

  return (
    <SaveableField
      label={label}
      status={saveField.status}
      isDirty={canEdit && isDirty}
      onCommit={commit}
      onCancel={cancel}
      htmlFor={fieldId}
    >
      <div className="flex h-8 items-center rounded-md border bg-background shadow-xs transition-[border-color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
        <Input
          id={fieldId}
          name={label.toLowerCase().replace(/\s+/g, "-")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") cancel();
          }}
          placeholder={placeholder}
          disabled={!canEdit || saveField.isSaving}
          aria-busy={saveField.isSaving}
          className="h-7 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        {sourceHost && (
          <span className="hidden max-w-[124px] shrink-0 truncate rounded-sm bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground sm:inline">
            {sourceHost}
          </span>
        )}
        {value && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                  onClick={() => window.open(openUrl, "_blank", "noopener")}
                  disabled={saveField.isSaving || !openUrl}
                  aria-label="Open link"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Open link</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mr-0.5 size-7 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
                  onClick={copyUrl}
                  disabled={saveField.isSaving}
                  aria-label={copied ? "Copied link" : "Copy link"}
                >
                  {copied ? (
                    <Check className="size-3.5 text-[var(--green-text)]" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{copied ? "Copied!" : "Copy link"}</TooltipContent>
            </Tooltip>
          </>
        )}
      </div>
    </SaveableField>
  );
}

/* ── Saveable Date Picker (wraps DatePicker with inline save) ── */

export function SaveableDatePickerField({
  label,
  value,
  canEdit,
  onSave,
}: {
  label: string;
  value: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const saveField = useSaveField(onSave);
  const dateValue = value ? new Date(value + "T00:00:00") : undefined;
  const fieldId = useId();

  return (
    <SaveableField label={label} status={saveField.status} htmlFor={fieldId}>
      <DatePicker
        id={fieldId}
        name={label.toLowerCase().replace(/\s+/g, "-")}
        value={dateValue}
        onChange={async (day) => {
          if (saveField.isSaving) return;
          const iso = day ? format(day, "yyyy-MM-dd") : "";
          if (iso === value) return;
          await saveField.save(iso);
        }}
        disabled={!canEdit || saveField.isSaving}
        className="rounded-md border bg-background shadow-xs [&_input]:h-8"
      />
    </SaveableField>
  );
}

/* ── Saveable Native Select (wraps NativeSelect with inline save) ── */

export function SaveableNativeSelectField({
  label,
  value,
  options,
  placeholder,
  canEdit,
  onSave,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  placeholder?: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const saveField = useSaveField(onSave);
  const fieldId = useId();

  if (!canEdit) {
    const selected = options.find((o) => o.value === value);
    return (
      <SaveableField label={label} status={saveField.status}>
        <span className="text-sm">{selected?.label || "\u2014"}</span>
      </SaveableField>
    );
  }

  return (
    <SaveableField label={label} status={saveField.status} htmlFor={fieldId}>
      <div className="relative">
        <NativeSelect
          id={fieldId}
          name={label.toLowerCase().replace(/\s+/g, "-")}
          value={value}
          onChange={async (e) => {
            if (saveField.isSaving) return;
            const v = e.target.value;
            if (v === value) return;
            await saveField.save(v);
          }}
          disabled={saveField.isSaving}
          aria-busy={saveField.isSaving}
          className="h-8 appearance-none bg-muted/40 pr-8 text-sm shadow-xs hover:bg-muted/60"
        >
          <option value="">{placeholder || "Select..."}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </NativeSelect>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </div>
    </SaveableField>
  );
}

/* ── Saveable Category Field (wraps CategoryCombobox with inline save + create) ── */

export function SaveableCategoryField({
  currentId,
  canEdit,
  categories,
  onSave,
  onCategoriesChanged,
  displayName,
  ghost,
}: {
  currentId: string;
  canEdit: boolean;
  categories: CategoryOption[];
  onSave: (id: string) => Promise<void>;
  onCategoriesChanged: () => void;
  displayName: string;
  ghost?: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveField = useSaveField(onSave);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  async function handleCreateCategory() {
    if (saving || saveField.isSaving) return;
    if (!newCatName.trim()) {
      setCreating(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newCatName.trim() }),
      });
      if (handleAuthRedirect(res)) return;
      if (res.ok) {
        const json = await parseJsonSafely<{ data?: { id?: string } }>(res);
        if (!json?.data?.id) {
          toast.error("Category was saved, but the response could not be read. Refresh before continuing.");
          return;
        }
        onCategoriesChanged();
        await saveField.save(json.data.id);
      } else {
        const msg = await parseErrorMessage(res, "Failed to create category");
        toast.error(msg);
      }
    } catch {
      toast.error("Failed to create category");
    } finally {
      setSaving(false);
      setCreating(false);
      setNewCatName("");
    }
  }

  return (
    <SaveableField label="Category" status={saveField.status}>
      {creating ? (
        <Input
          ref={inputRef}
          value={newCatName}
          onChange={(e) => setNewCatName(e.target.value)}
          placeholder="Category name"
          disabled={saving || saveField.isSaving}
          aria-busy={saving || saveField.isSaving}
          onBlur={handleCreateCategory}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleCreateCategory();
            if (e.key === "Escape") {
              setCreating(false);
              setNewCatName("");
            }
          }}
          className="h-8 text-sm"
        />
      ) : (
        <CategoryCombobox
          value={currentId}
          onValueChange={async (id) => {
            if (saveField.isSaving) return;
            if (id === currentId) return;
            await saveField.save(id);
          }}
          categories={categories}
          allowClear
          allowCreate
          onCreateRequested={() => setCreating(true)}
          disabled={!canEdit || saveField.isSaving}
          disabledLabel={displayName}
          variant={ghost ? "ghost" : "outline"}
          triggerClassName="h-8 bg-muted/40 pr-8 shadow-xs hover:bg-muted/60 [&>svg]:text-muted-foreground"
        />
      )}
    </SaveableField>
  );
}

/* ── Notes Field (inline-editable textarea) ─────────────── */

export function NotesField({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [draft, setDraft] = useSyncedDraft(value);
  const saveField = useSaveField(onSave);
  const fieldId = useId();

  const isDirty = draft.trim() !== (value || "");

  async function commit() {
    if (saveField.isSaving) return;
    const trimmed = draft.trim();
    if (trimmed === (value || "")) return;
    await saveField.save(trimmed);
  }

  function cancel() {
    setDraft(value);
    saveField.reset();
  }

  return (
    <SaveableField
      label="Notes"
      status={saveField.status}
      isDirty={canEdit && isDirty}
      onCommit={commit}
      onCancel={cancel}
      className="items-start"
      labelClassName="pt-2"
      htmlFor={fieldId}
    >
      {canEdit ? (
        <Textarea
          id={fieldId}
          name="notes"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") cancel();
          }}
          placeholder="Add notes..."
          disabled={saveField.isSaving}
          aria-busy={saveField.isSaving}
          rows={3}
          className="text-sm resize-none"
        />
      ) : (
        <p className="text-sm whitespace-pre-wrap py-1.5 px-3">
          {value || <span className="text-muted-foreground">No notes</span>}
        </p>
      )}
    </SaveableField>
  );
}
