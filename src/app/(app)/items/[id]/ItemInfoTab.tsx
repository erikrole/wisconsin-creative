"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useCopyFeedback } from "@/hooks/use-copy-feedback";
import { useInvalidateItemCatalog } from "@/hooks/use-item-cache-invalidation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Check,
  ExternalLink,
  Copy,
  ChevronDown,
  Download,
  PencilLine,
  RefreshCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { AssetDetail, CategoryOption } from "./types";
import { SaveableField, useSaveField, FieldGroup } from "@/components/SaveableField";
import { CategoryCombobox } from "@/components/FormCombobox";
import { useConfirm } from "@/components/ConfirmDialog";

/* ── Text Input Field ──────────────────────────────────── */

function TextInputField({
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
  const [draft, setDraft] = useState(normalizedValue);
  const [dupWarning, setDupWarning] = useState("");
  const saveField = useSaveField(onSave);
  const fieldId = useId();

  useEffect(() => {
    setDraft(normalizedValue);
  }, [normalizedValue]);

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
          className={cn("h-8 text-sm", mono && "font-mono")}
        />
        {dupWarning && (
          <p className="text-xs text-[var(--orange-text)] mt-0.5 px-1">{dupWarning}</p>
        )}
      </div>
    </SaveableField>
  );
}

/* ── USD Currency Field ─────────────────────────────────── */

function parseUsdDraft(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
    throw new Error("Enter a valid USD amount");
  }
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) {
    throw new Error("Enter a valid USD amount");
  }
  return numeric.toFixed(2);
}

function formatUsdDraft(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  try {
    const normalized = parseUsdDraft(String(value));
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(normalized));
  } catch {
    return String(value);
  }
}

function normalizeUsdForDirty(value: string): string {
  try {
    return parseUsdDraft(value);
  } catch {
    return value.trim();
  }
}

function CurrencyInputField({
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
  const [draft, setDraft] = useState(formatUsdDraft(value));
  const saveField = useSaveField(onSave);
  const fieldId = useId();
  const formattedValue = formatUsdDraft(value);
  const isDirty = normalizeUsdForDirty(draft) !== normalizeUsdForDirty(formattedValue);

  useEffect(() => {
    setDraft(formatUsdDraft(value));
  }, [value]);

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

/* ── Link Field (with open/copy buttons) ───────────────── */

function normalizeExternalUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Enter a valid http or https URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Enter a valid http or https URL");
  }
  return parsed.toString();
}

function getExternalUrlHost(value: string): string {
  try {
    return normalizeExternalUrl(value).replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
  } catch {
    return "";
  }
}

function getNormalizedExternalUrl(value: string): string {
  try {
    return normalizeExternalUrl(value);
  } catch {
    return "";
  }
}

function LinkField({
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
  const [draft, setDraft] = useState(value);
  const { copiedKey, copy: copyWithFeedback } = useCopyFeedback(2000);
  const copied = copiedKey === "link";
  const saveField = useSaveField(onSave);
  const fieldId = useId();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const isDirty = draft.trim() !== value;
  const sourceHost = getExternalUrlHost(value);
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

function SaveableDatePickerField({
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

function SaveableNativeSelectField({
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

function SaveableCategoryField({
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

function formatFirmwareDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

type FirmwareSupportMode = NonNullable<AssetDetail["firmwareWatch"]>["supportMode"];
type FirmwareBadgeVariant = "green" | "orange" | "gray";

function firmwareSupportVariant(mode: FirmwareSupportMode) {
  if (mode === "ACTIVE") return "green";
  if (mode === "MAINTENANCE") return "orange";
  return "gray";
}

function firmwareSupportLabel(mode: FirmwareSupportMode) {
  if (mode === "ACTIVE") return "Active";
  if (mode === "MAINTENANCE") return "Maintenance";
  return "Unknown";
}

function normalizeFirmwareVersion(value: string | null | undefined) {
  return (value ?? "")
    .trim()
    .replace(/^v(?:er\.?)?\s*/i, "")
    .toLowerCase();
}

function firmwareBadgeVariant(installedVersion: string, latestVersion: string | null): FirmwareBadgeVariant {
  if (!installedVersion || !latestVersion) return "gray";
  return normalizeFirmwareVersion(installedVersion) === normalizeFirmwareVersion(latestVersion)
    ? "green"
    : "orange";
}

function firmwareBadgeStatus(installedVersion: string, latestVersion: string | null) {
  if (!installedVersion) return "Not recorded";
  if (!latestVersion) return "Unknown";
  return normalizeFirmwareVersion(installedVersion) === normalizeFirmwareVersion(latestVersion)
    ? "Updated"
    : "Outdated";
}

function FirmwareWatchPanel({
  asset,
  canEdit,
  firmwareWatch,
  onSaveInstalledVersion,
}: {
  asset: AssetDetail;
  canEdit: boolean;
  firmwareWatch: NonNullable<AssetDetail["firmwareWatch"]>;
  onSaveInstalledVersion: (value: string) => Promise<void>;
}) {
  const installedVersion = asset.metadata?.installedFirmwareVersion?.trim() ?? "";
  const releaseDate = formatFirmwareDate(firmwareWatch.latestReleaseDate);
  const lastChecked = formatFirmwareDate(firmwareWatch.lastCheckedAt);
  const [open, setOpen] = useState(false);
  const [draftVersion, setDraftVersion] = useState(installedVersion);
  const saveInstalledVersion = useSaveField(onSaveInstalledVersion);
  const badgeVariant = firmwareBadgeVariant(installedVersion, firmwareWatch.latestVersion);
  const badgeStatus = firmwareBadgeStatus(installedVersion, firmwareWatch.latestVersion);
  const latestLabel = firmwareWatch.latestVersion ?? "Unknown";
  const needsUpdate =
    Boolean(firmwareWatch.latestVersion) &&
    normalizeFirmwareVersion(installedVersion) !==
      normalizeFirmwareVersion(firmwareWatch.latestVersion);

  useEffect(() => {
    if (open) setDraftVersion(installedVersion);
  }, [installedVersion, open]);

  async function saveVersion(value: string) {
    if (!canEdit || saveInstalledVersion.isSaving) return;
    const trimmed = value.trim();
    if (trimmed === installedVersion) {
      setOpen(false);
      return;
    }
    await saveInstalledVersion.save(trimmed);
    setOpen(false);
  }

  return (
    <>
      <dt className="flex h-8 items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Firmware
      </dt>
      <dd className="flex h-8 min-w-0 items-center gap-2">
        <Dialog open={open} onOpenChange={setOpen}>
          <Badge
            asChild
            variant={badgeVariant}
            size="sm"
            className="relative cursor-pointer rounded-sm font-mono tabular-nums hover:brightness-125 active:scale-[0.96] after:absolute after:left-1/2 after:top-1/2 after:size-10 after:-translate-x-1/2 after:-translate-y-1/2"
          >
            <button
              type="button"
              onClick={() => setOpen(true)}
              aria-label={`Edit installed firmware version, currently ${installedVersion || "not recorded"}`}
            >
              {installedVersion || "Set firmware"}
            </button>
          </Badge>
          {installedVersion && needsUpdate && (
            <span className="min-w-0 truncate text-muted-foreground">
              {latestLabel} available
            </span>
          )}
          <DialogContent className="max-w-[460px]">
            <DialogHeader>
              <div>
                <DialogTitle className="text-balance">Firmware</DialogTitle>
                <DialogDescription>
                  Installed firmware for {asset.assetTag}
                </DialogDescription>
              </div>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-4 py-4">
              <div className="rounded-md bg-muted/25 p-4 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Installed
                    </div>
                    <div
                      className={cn(
                        "mt-1.5 truncate text-2xl font-semibold leading-none tracking-tight",
                        installedVersion
                          ? "font-mono tabular-nums"
                          : "text-muted-foreground/60",
                      )}
                    >
                      {installedVersion || "Not recorded"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                    <Badge variant={badgeVariant} size="sm" className="rounded-sm">
                      {badgeStatus}
                    </Badge>
                    <Badge
                      variant={firmwareSupportVariant(firmwareWatch.supportMode)}
                      size="sm"
                      className="rounded-sm"
                    >
                      {firmwareSupportLabel(firmwareWatch.supportMode)}
                    </Badge>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-3 border-t border-border/40 pt-3 text-sm">
                  <div className="min-w-0 pr-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Newest
                    </dt>
                    <dd
                      className={cn(
                        "mt-1 truncate font-mono tabular-nums",
                        badgeVariant === "orange" && "text-[var(--orange-text)]",
                      )}
                    >
                      {latestLabel}
                    </dd>
                  </div>
                  <div className="min-w-0 border-l border-border/40 px-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Checked
                    </dt>
                    <dd className="mt-1 truncate tabular-nums">{lastChecked || "Not checked"}</dd>
                  </div>
                  <div className="min-w-0 border-l border-border/40 pl-3">
                    <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Released
                    </dt>
                    <dd className="mt-1 truncate tabular-nums">{releaseDate || "Not recorded"}</dd>
                  </div>
                </dl>
              </div>
              {canEdit && (
                <div className="flex flex-col gap-2">
                  <label htmlFor="installed-firmware-version" className="text-sm font-medium">
                    Installed firmware version
                  </label>
                  <Input
                    id="installed-firmware-version"
                    value={draftVersion}
                    onChange={(event) => setDraftVersion(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveVersion(draftVersion);
                    }}
                    placeholder={latestLabel === "Unknown" ? "Enter version" : latestLabel}
                    disabled={saveInstalledVersion.isSaving}
                    aria-busy={saveInstalledVersion.isSaving}
                    className="font-mono tabular-nums"
                  />
                  {needsUpdate && (
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full"
                      onClick={() => saveVersion(firmwareWatch.latestVersion ?? "")}
                      disabled={saveInstalledVersion.isSaving}
                    >
                      <Check className="size-4" aria-hidden="true" />
                      Mark updated to {latestLabel}
                    </Button>
                  )}
                </div>
              )}
              {firmwareWatch.supportNote && (
                <p className="text-pretty text-sm text-muted-foreground">{firmwareWatch.supportNote}</p>
              )}
              {firmwareWatch.lastError && (
                <p className="text-pretty text-sm text-[var(--orange-text)]">
                  Last check issue: {firmwareWatch.lastError}
                </p>
              )}
            </DialogBody>
            <DialogFooter className="items-center gap-2 sm:justify-between">
              <Button variant="outline" asChild>
                <a
                  href={firmwareWatch.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open Official firmware source"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  Sony update page
                </a>
              </Button>
              {canEdit && (
                <Button
                  type="button"
                  onClick={() => saveVersion(draftVersion)}
                  disabled={saveInstalledVersion.isSaving}
                >
                  {saveInstalledVersion.isSaving ? "Saving..." : "Save"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </dd>
    </>
  );
}

/* ── QR Code Visual ─────────────────────────────────────── */

export function QRCodeCanvas({
  value,
  size,
  margin = 2,
}: {
  value: string;
  size: number;
  margin?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!value || !canvasRef.current) return;
    setLoaded(false);
    import("qrcode").then((QRCode) => {
      if (!canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, value, { width: size, margin }, () => {
        setLoaded(true);
      });
    });
  }, [value, size, margin]);

  if (!value) return null;
  return (
    <canvas
      ref={canvasRef}
      className="qr-canvas"
      style={{ opacity: loaded ? 1 : 0 }}
    />
  );
}

/* ── QR Modal ──────────────────────────────────────────── */

export function QRModal({
  asset,
  canEdit,
  onRefresh,
  open,
  onOpenChange,
}: {
  asset: AssetDetail;
  canEdit: boolean;
  onRefresh: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const confirmDialog = useConfirm();
  const invalidateItemCatalog = useInvalidateItemCatalog();
  const [manualEntry, setManualEntry] = useState(false);
  const [qrDraft, setQrDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const {
    copiedKey,
    copy: copyWithFeedback,
    reset: resetCopyFeedback,
  } = useCopyFeedback(1600);
  const copied = copiedKey === "qr";
  const savingRef = useRef(false);

  function beginSave() {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setError("");
    return true;
  }

  function endSave() {
    savingRef.current = false;
    setSaving(false);
  }

  useEffect(() => {
    resetCopyFeedback();
    if (open) {
      setManualEntry(false);
      setQrDraft("");
      setError("");
    }
  }, [open, resetCopyFeedback]);

  async function copyCode() {
    if (!asset.qrCodeValue) return;
    const result = await copyWithFeedback(asset.qrCodeValue, "qr");
    if (result === "failed") {
      toast.error("Could not copy the QR code", {
        description: "Select the visible code and copy it manually.",
      });
    }
  }

  async function downloadPng() {
    if (!asset.qrCodeValue) return;
    const QRCode = await import("qrcode");
    const dataUrl = await QRCode.toDataURL(asset.qrCodeValue, { width: 1024, margin: 2 });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${asset.assetTag.replace(/[^\w-]+/g, "_")}-qr.png`;
    link.click();
  }

  async function generateQR() {
    if (asset.qrCodeValue) {
      const ok = await confirmDialog({
        title: "Generate new QR code",
        message: `Replace ${asset.qrCodeValue} with a new code? Printed labels with the current code will stop resolving to this item.`,
        confirmLabel: "Generate",
        variant: "danger",
      });
      if (!ok) return;
    }
    if (!beginSave()) return;
    try {
      const res = await fetch(`/api/assets/${asset.id}/generate-qr`, {
        method: "POST",
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed");
        setError(msg);
        return;
      }
      invalidateItemCatalog();
      onRefresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      endSave();
    }
  }

  async function saveManualQR() {
    if (savingRef.current) return;
    if (!qrDraft.trim()) {
      setManualEntry(false);
      return;
    }
    if (!beginSave()) return;
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrCodeValue: qrDraft.trim() }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed");
        setError(msg);
        return;
      }
      setManualEntry(false);
      setQrDraft("");
      invalidateItemCatalog();
      onRefresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      endSave();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <div>
            <DialogTitle>QR Code</DialogTitle>
            <DialogDescription>Identity details for {asset.assetTag}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="py-5">
          <div className="flex flex-col items-center">
            {asset.qrCodeValue ? (
              <div className="rounded-lg bg-white p-2.5 ring-1 ring-black/10 dark:ring-white/10">
                <QRCodeCanvas value={asset.qrCodeValue} size={204} />
              </div>
            ) : (
              <div className="flex size-[224px] items-center justify-center rounded-lg bg-muted/25 text-sm text-muted-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                No QR code yet
              </div>
            )}
            {asset.qrCodeValue && (
              <div className="mt-3 flex items-center gap-0.5">
                <span className="font-mono text-base font-semibold tracking-wide">
                  {asset.qrCodeValue}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={copyCode}
                  aria-label={copied ? "Copied QR code" : `Copy QR code ${asset.qrCodeValue}`}
                >
                  {copied ? (
                    <Check className="size-3.5 text-[var(--green-text)]" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </div>
            )}
          </div>
          {canEdit && !manualEntry && (
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" className="h-10" onClick={generateQR} disabled={saving}>
                <RefreshCcw className={cn("size-3.5", saving && "animate-spin")} aria-hidden="true" />
                {saving ? "Generating..." : "Generate new QR"}
              </Button>
              <Button className="h-10"
                variant="outline"
                onClick={() => setManualEntry(true)}
                disabled={saving}
              >
                <PencilLine className="size-3.5" aria-hidden="true" />
                Enter manually
              </Button>
            </div>
          )}
          {canEdit && manualEntry && (
            <div className="mt-4 flex gap-2">
              <Input
                value={qrDraft}
                onChange={(e) => setQrDraft(e.target.value)}
                placeholder="Paste or type QR code..."
                className="h-9 flex-1 font-mono"
                disabled={saving}
                aria-busy={saving}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveManualQR();
                  if (e.key === "Escape") setManualEntry(false);
                }}
                autoFocus
              />
              <Button className="h-10" onClick={saveManualQR} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => {
                  setManualEntry(false);
                  setQrDraft("");
                  setError("");
                }}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          )}
          {error && (
            <div className="text-destructive text-sm mt-3 text-center">
              {error}
            </div>
          )}
        </DialogBody>
        {asset.qrCodeValue && (
          <DialogFooter>
            <Button variant="outline" onClick={downloadPng}>
              <Download className="size-4" aria-hidden="true" />
              Download PNG
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Scan Value Row (click-to-copy identity value) ──────── */

function ScanValueRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <>
      <dt className="flex h-8 items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="flex h-8 min-w-0 items-center">
        <button
          type="button"
          onClick={onCopy}
          className="group/copy flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-sm pr-1 font-mono text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={copied ? `Copied ${label}` : `Copy ${label} ${value}`}
        >
          <span className="min-w-0 truncate">{value}</span>
          {copied ? (
            <Check className="size-3 shrink-0 text-[var(--green-text)]" aria-hidden="true" />
          ) : (
            <Copy
              className="size-3 shrink-0 opacity-50 transition-opacity group-hover/copy:opacity-100"
              aria-hidden="true"
            />
          )}
        </button>
      </dd>
    </>
  );
}

/* ── Item Info Card (tab entry point) ───────────────────── */

export type LocationOption = { id: string; name: string };
export type DepartmentOption = { id: string; name: string };

export default function ItemInfoCard({
  asset,
  canEdit,
  currentUserRole,
  categories,
  departments,
  locations,
  onFieldSaved,
  onRefresh,
  onCategoriesChanged,
}: {
  asset: AssetDetail;
  canEdit: boolean;
  currentUserRole: string;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  locations: LocationOption[];
  onFieldSaved: (updated: Partial<AssetDetail>) => void;
  onRefresh: () => void;
  onCategoriesChanged: () => void;
}) {
  const [showQrModal, setShowQrModal] = useState(false);
  const { copiedKey: copiedScanValue, copy: copyWithFeedback } = useCopyFeedback(1600);
  const invalidateItemCatalog = useInvalidateItemCatalog();
  const saveField = useCallback(
    async (patchKey: string, value: string) => {
      const body: Record<string, unknown> = {};
      if (patchKey === "purchasePrice" || patchKey === "residualValue") {
        const normalized = parseUsdDraft(value);
        body[patchKey] = normalized ? Number(normalized) : null;
      } else if (patchKey.startsWith("metadata.")) {
        const metaKey = patchKey.split(".")[1]!; // guaranteed by startsWith("metadata.") check
        const currentMeta = asset.metadata || {};
        const newMeta = { ...currentMeta, [metaKey]: value || undefined };
        body.notes = JSON.stringify(newMeta);
      } else {
        const nullableKeys = new Set(["name", "serialNumber", "purchaseDate", "warrantyDate", "linkUrl"]);
        body[patchKey] = nullableKeys.has(patchKey) ? value || null : value;
      }

      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Save failed");
        throw new Error(msg);
      }

      if (patchKey.startsWith("metadata.")) {
        const metaKey = patchKey.split(".")[1]!; // guaranteed by startsWith("metadata.") check
        onFieldSaved({ metadata: { ...asset.metadata, [metaKey]: value } });
      } else {
        const nullableKeys = new Set(["name", "serialNumber", "purchaseDate", "warrantyDate", "linkUrl"]);
        const numericKeys = new Set(["purchasePrice", "residualValue"]);
        const nextValue = numericKeys.has(patchKey)
          ? value
            ? Number(parseUsdDraft(value))
            : null
          : nullableKeys.has(patchKey)
            ? value || null
            : value;
        onFieldSaved({
          [patchKey]: nextValue,
        } as Partial<AssetDetail>);
      }
      invalidateItemCatalog();
    },
    [asset.id, asset.metadata, invalidateItemCatalog, onFieldSaved],
  );

  async function saveCategory(categoryId: string) {
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: categoryId || null }),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to save category"));
    invalidateItemCatalog();
    onRefresh();
  }

  async function saveDepartment(departmentId: string) {
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departmentId: departmentId || null }),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to save department"));
    invalidateItemCatalog();
    onRefresh();
  }

  async function saveLocation(locationId: string) {
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId }),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to save location"));
    invalidateItemCatalog();
    onRefresh();
  }

  /** Compute fiscal year from a date string (FY begins July 1) */
  function computeFiscalYear(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    const month = d.getMonth(); // 0-indexed
    const year = d.getFullYear();
    // FY begins July 1: dates in Jul-Dec belong to FY (year+1), Jan-Jun belong to FY (year)
    return String(month >= 6 ? year + 1 : year);
  }

  function getFiscalYearOptions() {
    const today = new Date();
    const currentFiscalYear = today.getMonth() >= 6 ? today.getFullYear() + 1 : today.getFullYear();
    const existing = asset.metadata?.fiscalYearPurchased;
    const years = new Set<string>();
    for (let year = currentFiscalYear + 2; year >= 2000; year -= 1) {
      years.add(String(year));
    }
    if (existing) years.add(existing);
    return [...years]
      .sort((a, b) => Number(b) - Number(a))
      .map((year) => ({ value: year, label: year }));
  }

  async function copyScanValue(kind: "qr" | "serial", value: string) {
    if (!value) return;
    const result = await copyWithFeedback(value, kind);
    if (result === "failed") {
      toast.error(`Could not copy the ${kind === "qr" ? "QR code" : "serial number"}`, {
        description: "Select the visible value and copy it manually.",
      });
    }
  }

  return (
    <Card className="details-card border-border/40">
      <div className="border-b border-border/30 p-2.5">
        <div className="rounded-md bg-muted/25 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <div className="grid grid-cols-[minmax(0,1fr)_88px] items-start gap-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">Identity</div>
                <Badge variant="outline" size="sm" className="rounded-sm bg-background text-muted-foreground">
                  Admin
                </Badge>
              </div>
              <dl className="mt-2 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 text-xs">
                {asset.qrCodeValue ? (
                  <ScanValueRow
                    label="QR"
                    value={asset.qrCodeValue}
                    copied={copiedScanValue === "qr"}
                    onCopy={() => copyScanValue("qr", asset.qrCodeValue)}
                  />
                ) : (
                  <>
                    <dt className="flex h-8 items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">QR</dt>
                    <dd className="flex h-8 min-w-0 items-center">
                      <span className="font-mono text-muted-foreground">No QR code</span>
                    </dd>
                  </>
                )}
                {asset.serialNumber && (
                  <ScanValueRow
                    label="Serial"
                    value={asset.serialNumber}
                    copied={copiedScanValue === "serial"}
                    onCopy={() => copyScanValue("serial", asset.serialNumber ?? "")}
                  />
                )}
                {asset.firmwareWatch && (
                  <FirmwareWatchPanel
                    asset={asset}
                    canEdit={canEdit}
                    firmwareWatch={asset.firmwareWatch}
                    onSaveInstalledVersion={(v) => saveField("metadata.installedFirmwareVersion", v)}
                  />
                )}
              </dl>
            </div>
            <div className="flex w-[88px] shrink-0 flex-col items-stretch">
              <button
                type="button"
                className="group flex aspect-square w-full items-center justify-center rounded-md bg-background p-1 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] outline-none transition-[background-color,box-shadow,transform] hover:bg-muted/50 active:scale-[0.96] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                onClick={() => setShowQrModal(true)}
                aria-label={canEdit ? "Open QR code details" : "View QR code"}
              >
                {asset.qrCodeValue ? (
                  <QRCodeCanvas value={asset.qrCodeValue} size={72} margin={1} />
                ) : (
                  <span className="text-xs text-muted-foreground">QR</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="py-1">
        <FieldGroup label="Product">
          <TextInputField
            label="Asset tag"
            value={asset.assetTag}
            canEdit={canEdit}
            onSave={(v) => saveField("assetTag", v)}
          />
          <TextInputField
            label="Product Name"
            value={asset.name || ""}
            placeholder="Add product name"
            canEdit={canEdit}
            onSave={(v) => saveField("name", v)}
          />
          <TextInputField
            label="Brand"
            value={asset.brand}
            placeholder="Add brand"
            canEdit={canEdit}
            onSave={(v) => saveField("brand", v)}
          />
          <TextInputField
            label="Model"
            value={asset.model}
            placeholder="Add model"
            canEdit={canEdit}
            onSave={(v) => saveField("model", v)}
          />
          <TextInputField
            label="Serial"
            value={asset.serialNumber}
            canEdit={canEdit}
            onSave={(v) => saveField("serialNumber", v)}
            mono
            warnDuplicate={{ field: "serialNumber", assetId: asset.id }}
          />
          <TextInputField
            label="UW Asset Tag"
            value={asset.metadata?.uwAssetTag || ""}
            placeholder="Add UW asset tag"
            canEdit={canEdit}
            onSave={(v) => saveField("metadata.uwAssetTag", v)}
          />
        </FieldGroup>
        <FieldGroup label="Organization">
          <SaveableNativeSelectField
            label="Department"
            value={asset.department?.id || ""}
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Select department"
            canEdit={canEdit}
            onSave={saveDepartment}
          />
          <SaveableCategoryField
            currentId={asset.category?.id || ""}
            displayName={asset.category?.name || ""}
            canEdit={canEdit}
            categories={categories}
            onSave={saveCategory}
            onCategoriesChanged={onCategoriesChanged}
          />
          <SaveableNativeSelectField
            label="Location"
            value={asset.location.id}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            placeholder="Select location"
            canEdit={canEdit}
            onSave={saveLocation}
          />
        </FieldGroup>
        {/* ── Procurement fields (hidden from students) ── */}
        {currentUserRole !== "STUDENT" && (
          <FieldGroup label="Procurement">
            <SaveableDatePickerField
              label="Purchase date"
              value={
                asset.purchaseDate
                  ? asset.purchaseDate.slice(0, 10)
                  : ""
              }
              canEdit={canEdit}
              onSave={async (v) => {
                await saveField("purchaseDate", v);
                if (v) {
                  const fy = computeFiscalYear(v);
                  if (fy) await saveField("metadata.fiscalYearPurchased", fy);
                }
              }}
            />
            <SaveableNativeSelectField
              label="Fiscal Year"
              value={asset.metadata?.fiscalYearPurchased || ""}
              options={getFiscalYearOptions()}
              placeholder="Select fiscal year"
              canEdit={canEdit}
              onSave={(v) => saveField("metadata.fiscalYearPurchased", v)}
            />
            <CurrencyInputField
              label="Purchase price"
              value={asset.purchasePrice}
              placeholder="0.00"
              canEdit={canEdit}
              onSave={(v) => saveField("purchasePrice", v)}
            />
            <LinkField
              label="Link"
              value={asset.linkUrl || ""}
              placeholder="Add product link"
              canEdit={canEdit}
              onSave={(v) => saveField("linkUrl", v)}
            />
          </FieldGroup>
        )}
        {/* ── Notes section ── */}
        <FieldGroup>
          <NotesField
            value={asset.metadata?.userNotes || ""}
            canEdit={canEdit}
            onSave={(v) => saveField("metadata.userNotes", v)}
          />
        </FieldGroup>
      </div>
      <QRModal
        asset={asset}
        canEdit={canEdit}
        onRefresh={onRefresh}
        open={showQrModal}
        onOpenChange={setShowQrModal}
      />
    </Card>
  );
}

/* ── Notes Field (inline-editable textarea) ─────────────── */

function NotesField({
  value,
  canEdit,
  onSave,
}: {
  value: string;
  canEdit: boolean;
  onSave: (v: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const saveField = useSaveField(onSave);
  const fieldId = useId();

  useEffect(() => {
    setDraft(value);
  }, [value]);

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
