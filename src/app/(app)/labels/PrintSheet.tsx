"use client";

import { useId, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Download, FileDown, Minus, Pencil, Plus, RotateCcw, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { LABEL_KINDS, type LabelKind } from "@/lib/brother-label-csv";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { LabelPreview } from "./LabelPreview";
import { USBPrintControls } from "./USBPrintControls";
import { usePrintPreflight } from "./use-print-preflight";
import {
  preparedSheet,
  KIND_ORDER,
  MAX_COPIES,
  clampCopies,
  entryKind,
  entryPrintIssue,
  entryRows,
  parseUnitPick,
  printableCount,
  printsUnits,
  selectedUnitNumbers,
  templateFiles,
  textEdited,
  unitKindOf,
  unknownPickedNumbers,
  UNIT_KINDS,
  type CartEntry,
  type SheetUnit,
  type UnitKind,
  type UnitScope,
  type UnitsBySku,
} from "./label-sheet";

const unitsKey = (skuId: string) => ["label-units", skuId] as const;

/** Matches the `unitNumbers` cap in markBulkUnitLabelsSchema. */
const MARK_BATCH = 500;

async function readUnits(skuId: string, signal?: AbortSignal): Promise<SheetUnit[]> {
  const res = await fetch(`/api/bulk-skus/${skuId}/units`, { signal });
  if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
  if (!res.ok) throw new Error("server");
  const json = await parseJsonSafely<{ data?: SheetUnit[] }>(res);
  if (!Array.isArray(json?.data) || !json.data.every((unit) =>
    Number.isSafeInteger(unit.unitNumber) && unit.unitNumber > 0 && typeof unit.status === "string" &&
    (unit.labelPrintedAt === null || typeof unit.labelPrintedAt === "string")
  )) throw new Error("server");
  return json.data;
}

/** Unit lists for every numbered family on the sheet that prints unit labels. */
export function useSheetUnits(cart: CartEntry[]) {
  const skuIds = Array.from(
    new Set(cart.filter(printsUnits).map((entry) => entry.family!.skuId)),
  );
  const results = useQueries({
    queries: skuIds.map((skuId) => ({
      queryKey: unitsKey(skuId),
      queryFn: ({ signal }: { signal?: AbortSignal }) => readUnits(skuId, signal),
    })),
  });
  const unitsBySku: UnitsBySku = {};
  const failed = new Set<string>();
  skuIds.forEach((skuId, index) => {
    unitsBySku[skuId] = results[index]?.data;
    if (results[index]?.isError) failed.add(skuId);
  });
  const loading = results.some((result) => result.isPending);
  const retry = () => { results.forEach((result) => { if (result.isError) void result.refetch(); }); };
  return { unitsBySku, loading, failed, retry };
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  // Revoking in the same tick can cancel the download in Safari and Firefox.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function plural(count: number, word: string) {
  return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
}

function Stepper({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <div className="inline-flex h-10 items-center rounded-full border border-border bg-background focus-within:ring-[3px] focus-within:ring-ring/50">
      <button
        type="button"
        className="grid size-10 cursor-pointer place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none disabled:cursor-default disabled:opacity-40"
        onClick={() => onChange(clampCopies(value - 1))}
        disabled={value <= 1}
        aria-label={`One fewer ${label}`}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        className="h-full w-10 bg-transparent text-center text-sm font-bold tabular-nums outline-none"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(clampCopies(Number(e.target.value.replace(/\D/g, "")) || 1))}
        aria-label={`Copies of ${label}`}
      />
      <button
        type="button"
        className="grid size-10 cursor-pointer place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none disabled:cursor-default disabled:opacity-40"
        onClick={() => onChange(clampCopies(value + 1))}
        disabled={value >= MAX_COPIES}
        aria-label={`One more ${label}`}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

const LINE_FIELDS: Partial<Record<LabelKind, { key: "dept" | "model" | "number"; label: string; placeholder: string }[]>> = {
  body: [
    { key: "dept", label: "Top line", placeholder: "Dept, or blank" },
    { key: "model", label: "Middle line", placeholder: "Model" },
    { key: "number", label: "Bottom line", placeholder: "Number" },
  ],
  lens: [
    { key: "dept", label: "Top line", placeholder: "Dept, or blank" },
    { key: "model", label: "Middle line", placeholder: "Lens" },
    { key: "number", label: "Bottom line", placeholder: "Number" },
  ],
  sd: [
    { key: "dept", label: "Top line", placeholder: "Dept, or blank" },
    { key: "model", label: "Middle line", placeholder: "Camera" },
    { key: "number", label: "Bottom line", placeholder: "Card, like 1A" },
  ],
  text: [{ key: "model", label: "Text", placeholder: "Label text" }],
  numberTag: [{ key: "number", label: "Number", placeholder: "12" }],
  battery: [{ key: "number", label: "Number", placeholder: "12" }],
};

function EntryEditor({ entry, onUpdate }: { entry: CartEntry; onUpdate: (patch: Partial<CartEntry>) => void }) {
  const fields = LINE_FIELDS[entry.kind] ?? [];
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-lg border border-border bg-[var(--bg-surface)]/60 p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {fields.map((field) => (
          <label key={field.key} className={cn("flex flex-col gap-1 text-xs font-medium text-muted-foreground", fields.length === 1 && "sm:col-span-3")}>
            {field.label}
            <Input
              value={entry[field.key]}
              onChange={(e) => onUpdate({ [field.key]: e.target.value })}
              placeholder={field.placeholder}
              aria-label={`${field.label} for ${entry.title}`}
            />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
        Template
        <NativeSelect
          value={entry.kind}
          onChange={(e) => onUpdate({ kind: e.target.value as LabelKind })}
          aria-label={`Template for ${entry.title}`}
        >
          {KIND_ORDER.map((kind) => (
            <option key={kind} value={kind}>
              {LABEL_KINDS[kind].label}
            </option>
          ))}
        </NativeSelect>
      </label>
      <p className="text-xs text-muted-foreground">
        Only the printed text changes. The QR code stays the item&apos;s, so it still scans to the right gear.
      </p>
      {textEdited(entry) && entry.original && (
        <Button
          variant="ghost"
          size="sm"
          className="h-10 self-start px-2 text-xs text-[var(--accent)]"
          onClick={() => onUpdate({ ...entry.original })}
        >
          <RotateCcw className="size-3.5" />
          Reset to item
        </Button>
      )}
    </div>
  );
}

function SheetEntry({
  entry,
  units,
  unitsFailed,
  downloadedUnits,
  onUpdate,
  onRemove,
  onMarkPrinted,
  renderIssue,
}: {
  entry: CartEntry;
  units: SheetUnit[] | undefined;
  unitsFailed: boolean;
  renderIssue?: string;
  /** Unit numbers in the CSV that was downloaded for this entry, still unmarked. Null when there is nothing to mark. */
  downloadedUnits: number[] | null;
  onUpdate: (patch: Partial<CartEntry>) => void;
  onRemove: () => void;
  onMarkPrinted: (numbers: number[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [marking, setMarking] = useState(false);
  const issueId = useId();
  const family = entry.family;
  const unitMode = printsUnits(entry);
  const counted = family && !family.trackByNumber;
  const unitNumbers = selectedUnitNumbers(entry, units);
  const unknown = unknownPickedNumbers(entry, units);
  const pickInvalid = family?.unitScope === "pick" ? parseUnitPick(family.unitPick ?? "").invalid : [];
  const issue = entryPrintIssue(entry, units) || renderIssue;
  const labels = printableCount(entryRows(entry, units));
  const kind = entryKind(entry);
  const missingQr = LABEL_KINDS[kind].needsQr && !(unitMode ? family?.binQrCodeValue : entry.qrCodeValue)?.trim();
  const active = units?.filter((unit) => unit.status !== "RETIRED") ?? [];
  const unprinted = active.filter((unit) => !unit.labelPrintedAt).length;
  const firstUnit = unitNumbers[0];
  const edited = textEdited(entry);
  const toMark = (downloadedUnits ?? []).filter((n) => units?.some((u) => u.unitNumber === n && u.status !== "RETIRED" && !u.labelPrintedAt));
  const canMark = unitMode && !unitsFailed && toMark.length > 0;

  const meta = unitMode
    ? !units
      ? unitsFailed
        ? "Units could not load"
        : "Loading units…"
      : unitNumbers.length === 0
        ? active.length === 0
          ? "No active units to label"
          : family?.unitScope === "pick"
          ? "Type unit numbers to print"
          : "Every unit already has a label"
        : issue
          ? "Fix unit selection before printing"
          : `${plural(unitNumbers.length, "unit label")} · ${compactRanges(unitNumbers)}`
    : missingQr
      ? "An item QR code is required"
      : entry.qrCodeValue || entry.name;

  return (
    <li className="px-4 py-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-bold">{entry.title}</span>
            {edited && (
              <span className="shrink-0 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--accent)]">
                Edited
              </span>
            )}
          </div>
          <div className={cn("truncate text-xs", missingQr || unitsFailed ? "text-destructive" : "text-muted-foreground", !unitMode && !missingQr && "font-mono")}>
            {meta}
          </div>
        </div>
        <div className="-mr-2 -mt-1 flex shrink-0">
          {!unitMode && (
            <Button
              variant="ghost"
              size="icon"
              className={cn("size-10 text-muted-foreground", editing && "bg-muted text-foreground")}
              onClick={() => setEditing((value) => !value)}
              aria-label={`Edit printed text for ${entry.title}`}
              aria-pressed={editing}
            >
              <Pencil className="size-3.5" />
            </Button>
          )}
          <Button variant="ghost" size="icon" className="size-10 text-muted-foreground" onClick={onRemove} aria-label={`Remove ${entry.title}`}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <div className="mt-3">
        {unitMode && !firstUnit ? <p className="rounded-lg bg-muted/40 p-4 text-xs text-muted-foreground">Choose active unit numbers to preview a label.</p> : (
          <Dialog>
            <DialogTrigger asChild>
              <button
                type="button"
                className="group flex w-full cursor-pointer flex-col gap-3 rounded-lg border border-border/70 bg-muted/35 p-4 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                aria-label={`Enlarge label preview for ${entry.title}`}
              >
                <span className="flex w-full items-center justify-between text-xs text-muted-foreground">
                  <span>{unitMode ? `Unit ${firstUnit} preview` : "Label preview"}</span>
                  <ZoomIn className="size-3.5 transition-colors group-hover:text-foreground" />
                </span>
                <span className="grid min-h-20 w-full place-items-center">
                  <LabelPreview kind={kind} dept={unitMode ? "" : entry.dept} model={unitMode ? "" : entry.model} number={unitMode ? String(firstUnit) : entry.number} qrCodeValue={unitMode ? `${family!.binQrCodeValue}-${firstUnit}` : entry.qrCodeValue} />
                </span>
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-[640px]">
              <DialogHeader className="block">
                <DialogTitle>{entry.title}</DialogTitle>
                <DialogDescription className="mt-1">{unitMode ? `Unit ${firstUnit} · ` : ""}{LABEL_KINDS[kind].label} · 12 mm white-on-black tape</DialogDescription>
              </DialogHeader>
              <div className="grid min-h-60 place-items-center bg-muted/35 px-6 py-10">
                <LabelPreview kind={kind} dept={unitMode ? "" : entry.dept} model={unitMode ? "" : entry.model} number={unitMode ? String(firstUnit) : entry.number} qrCodeValue={unitMode ? `${family!.binQrCodeValue}-${firstUnit}` : entry.qrCodeValue} height={152} />
              </div>
              <p className="px-6 pb-6 text-center text-xs text-muted-foreground">Gotham XNarrow Bold{LABEL_KINDS[kind].needsQr ? " · Medium Small QR" : ""}. This preview matches the USB print layout.</p>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {issue && (!unitMode || (units && family?.unitScope !== "pick")) && (
        <p role="status" className="mt-2 text-xs text-destructive">{issue}</p>
      )}

      {family?.trackByNumber && (
        <ToggleGroup
          type="single"
          value={family.mode}
          onValueChange={(mode) => mode && onUpdate({ family: { ...family, mode: mode as "family" | "units" } })}
          className="mt-2 w-full [&>button]:min-h-10 [&>button]:flex-1 [&>button]:text-xs"
          aria-label={`What to print for ${entry.title}`}
        >
          <ToggleGroupItem value="family">Family label</ToggleGroupItem>
          <ToggleGroupItem value="units">Unit labels</ToggleGroupItem>
        </ToggleGroup>
      )}

      {unitMode && (
        <div className="mt-2 flex flex-col gap-2">
          <ToggleGroup
            type="single"
            value={family!.unitScope}
            onValueChange={(scope) => scope && onUpdate({ family: { ...family!, unitScope: scope as UnitScope } })}
            className="w-full [&>button]:min-h-10 [&>button]:flex-1 [&>button]:text-xs"
            aria-label={`Which units of ${entry.title}`}
          >
            <ToggleGroupItem value="unprinted">Not printed{units ? ` · ${unprinted}` : ""}</ToggleGroupItem>
            <ToggleGroupItem value="all">All{units ? ` · ${active.length}` : ""}</ToggleGroupItem>
            <ToggleGroupItem value="pick">Pick numbers</ToggleGroupItem>
          </ToggleGroup>
          {family!.unitScope === "pick" && (
            <div className="flex flex-col gap-1">
              <Input
                value={family!.unitPick ?? ""}
                onChange={(e) => onUpdate({ family: { ...family!, unitPick: e.target.value } })}
                placeholder="7, or 12-18, or 3, 9, 20-24"
                aria-invalid={issue ? true : undefined}
                aria-describedby={issue ? issueId : undefined}
                aria-label={`Unit numbers of ${entry.title} to print`}
              />
              {issue && (
                <p id={issueId} role="status" className="text-xs text-destructive">
                  {[
                    pickInvalid.length > 0 ? `Can't read ${pickInvalid.slice(0, 4).join(", ")}. ${issue}` : "",
                    unknown.length > 0 ? `No active unit ${compactRanges(unknown)}` : "",
                  ]
                    .filter(Boolean)
                    .join(". ") || issue}
                </p>
              )}
            </div>
          )}
          <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            Template
            <NativeSelect
              className="w-auto"
              value={unitKindOf(entry)}
              onChange={(e) => onUpdate({ family: { ...family!, unitKind: e.target.value as UnitKind } })}
              aria-label={`Unit label template for ${entry.title}`}
            >
              {UNIT_KINDS.map((option) => (
                <option key={option} value={option}>
                  {LABEL_KINDS[option].label}
                </option>
              ))}
            </NativeSelect>
          </label>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {!unitMode && (
          <>
            <Stepper value={clampCopies(entry.copies)} onChange={(copies) => onUpdate({ copies })} label={`${entry.title} label`} />
            {counted && family.onHand > 1 && entry.copies !== clampCopies(family.onHand) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10 px-2 text-xs text-[var(--accent)]"
                onClick={() => onUpdate({ copies: clampCopies(family.onHand) })}
              >
                One per item · {family.onHand.toLocaleString()}
              </Button>
            )}
          </>
        )}
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">{plural(labels, "label")}</span>
      </div>

      {canMark && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-[var(--accent-soft)] px-3 py-2 text-xs">
          <span>Printed and applied?</span>
          <Button
            size="sm"
            className="h-10"
            disabled={marking}
            onClick={async () => {
              setMarking(true);
              try {
                await onMarkPrinted(toMark);
              } finally {
                setMarking(false);
              }
            }}
          >
            <Check className="size-3.5" />
            {marking ? "Marking…" : `Mark ${toMark.length} printed`}
          </Button>
        </div>
      )}

      {editing && !unitMode && <EntryEditor entry={entry} onUpdate={onUpdate} />}
    </li>
  );
}

/** "1–4, 7, 9–12" from sorted numbers. */
function compactRanges(numbers: number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < numbers.length) {
    let j = i;
    while (j + 1 < numbers.length && numbers[j + 1] === numbers[j]! + 1) j += 1;
    parts.push(j > i ? `${numbers[i]}–${numbers[j]}` : String(numbers[i]));
    i = j + 1;
  }
  return parts.length > 4 ? `${parts.slice(0, 4).join(", ")}…` : parts.join(", ");
}

export function PrintSheet({
  cart,
  onUpdate,
  onRemove,
  onClear,
  className,
  onUndo, canUndo, draftIssue, draftActions,
}: {
  onUndo?: () => void; canUndo?: boolean; draftIssue?: string; draftActions?: React.ReactNode;
  cart: CartEntry[];
  onUpdate: (id: string, patch: Partial<CartEntry>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const { unitsBySku, loading, failed, retry } = useSheetUnits(cart);
  const [downloaded, setDownloaded] = useState<Partial<Record<LabelKind, string>>>({});
  // Exactly which units went out in a downloaded CSV, per family, so "Mark printed"
  // never covers units that were added or re-picked after the download.
  const [exportedUnits, setExportedUnits] = useState<Record<string, number[]>>({});
  const { data: me } = useCurrentUser();
  const canMarkPrinted = me?.role === "ADMIN" || me?.role === "STAFF";
  const prepared = preparedSheet(cart, unitsBySku);
  const { rows, groups, labels: usbLabels, total } = prepared;
  const preflight = usePrintPreflight(usbLabels);
  const files = useMemo(() => total <= 500 ? templateFiles(rows) : [], [rows, total]);
  const choicesBlocked = loading || failed.size > 0 || cart.some((entry) => entryPrintIssue(entry, entry.family ? unitsBySku[entry.family.skuId] : undefined));
  const blocked = Boolean(choicesBlocked || draftIssue || (total > 0 && !preflight.ready));

  const markPrinted = async (entry: CartEntry, unitNumbers: number[]) => {
    const skuId = entry.family!.skuId;
    let updated = 0;
    try {
      // The route takes at most MARK_BATCH unit numbers per call.
      for (let i = 0; i < unitNumbers.length; i += MARK_BATCH) {
        const res = await fetch(`/api/bulk-skus/${skuId}/units/labels`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unitNumbers: unitNumbers.slice(i, i + MARK_BATCH), printed: true }),
        });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) throw new Error("server");
        const json = await parseJsonSafely<{ data?: { updated?: number } }>(res);
        updated += json?.data?.updated ?? 0;
      }
      toast.success(`${plural(updated, "unit")} of ${entry.title} marked printed`);
      setExportedUnits((prev) => {
        const next = { ...prev };
        delete next[skuId];
        return next;
      });
    } catch {
      toast.error(
        updated > 0
          ? `Marked ${plural(updated, "unit")}, then stopped. Try again for the rest.`
          : "Could not mark those labels printed. Try again.",
      );
    } finally {
      await queryClient.invalidateQueries({ queryKey: unitsKey(skuId) });
    }
  };

  const recordExport = (kind: LabelKind) => {
    const exported: Record<string, number[]> = {};
    for (const entry of cart) {
      if (!printsUnits(entry) || entryKind(entry) !== kind) continue;
      const skuId = entry.family!.skuId;
      exported[skuId] = Array.from(new Set([...(exported[skuId] ?? []), ...selectedUnitNumbers(entry, unitsBySku[skuId])]));
    }
    setExportedUnits((prev) => {
      const next = { ...prev };
      for (const [skuId, numbers] of Object.entries(exported)) next[skuId] = Array.from(new Set([...(prev[skuId] ?? []), ...numbers]));
      return next;
    });
  };

  return (
    <section
      id="print-sheet"
      aria-label="Print sheet"
      className={cn("no-print flex flex-col overflow-y-auto rounded-[var(--radius)] border border-border bg-card", className)}
    >
      <header className="sticky top-0 z-20 flex shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-card px-4 py-3">
        <div>
          <h2 className="text-base">Print sheet</h2>
          <p className="text-xs tabular-nums text-muted-foreground">
            {cart.length === 0 ? "Ready when you are" : `${plural(total, "label")} · ${plural(cart.length, "selection")}`}
          </p>
        </div>
        <div className="flex items-center gap-1">{canUndo && <Button variant="ghost" size="sm" className="h-10" onClick={onUndo}><RotateCcw className="size-3.5" />Undo</Button>}
        {cart.length > 0 && (
          <Button variant="ghost" size="sm" className="h-10 text-muted-foreground" onClick={onClear}>
            Clear
          </Button>
        )}</div>
      </header>
      {(draftIssue || draftActions) && <div className="flex flex-col gap-2 border-b border-border px-4 py-3 text-xs">{draftIssue && <p role="alert" className="text-destructive">{draftIssue}</p>}{draftActions}</div>}

      {cart.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
          <div className="flex flex-col items-center gap-1.5 opacity-80">
            <LabelPreview kind="body" dept="FB" model="FX3" number="1" qrCodeValue="c62a82d7" />
          </div>
          <div>
            <div className="text-sm font-bold">Your labels appear here</div>
            <p className="mx-auto mt-1 max-w-64 text-xs text-muted-foreground">
              Add items or families from the list, set how many, then print straight to the Brother over USB.
            </p>
          </div>
        </div>
      ) : (
        <div className="shrink-0">
          <ul className="divide-y divide-border/60">
            {groups.flatMap((group) => [
              <li key={`heading-${group.kind}`} className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-[var(--bg-surface)]/90 px-4 py-1.5 text-xs font-bold text-muted-foreground backdrop-blur">
                <span>{LABEL_KINDS[group.kind].label}</span>
                <span className="font-normal tabular-nums">
                  {plural(printableCount(rows.filter((row) => row.kind === group.kind)), "label")}
                </span>
              </li>,
              ...group.entries.map((entry) => (
                <SheetEntry
                  key={entry.id}
                  entry={entry}
                  units={entry.family ? unitsBySku[entry.family.skuId] : undefined}
                  renderIssue={preflight.issues[entry.id]}
                  unitsFailed={Boolean(entry.family && failed.has(entry.family.skuId))}
                  downloadedUnits={
                    canMarkPrinted && entry.family && printsUnits(entry) ? exportedUnits[entry.family.skuId] ?? null : null
                  }
                  onUpdate={(patch) => onUpdate(entry.id, patch)}
                  onRemove={() => onRemove(entry.id)}
                  onMarkPrinted={(numbers) => markPrinted(entry, numbers)}
                />
              )),
            ])}
          </ul>
        </div>
      )}

      <footer className="flex shrink-0 flex-col gap-2 border-t border-border/70 bg-[var(--bg-surface)]/60 px-4 py-3">
          {failed.size > 0 ? (
            <div role="alert" className="flex items-center justify-between gap-2 text-xs text-destructive">
              <span>Unit numbers could not load. Printing is paused to keep the sheet complete.</span>
              <Button variant="outline" size="sm" className="h-10 shrink-0" onClick={retry}>Try again</Button>
            </div>
          ) : choicesBlocked && !loading ? (
            <p role="status" className="text-xs text-destructive">Fix the label choices above before printing.</p>
          ) : null}
          {total > 0 && total <= 500 && !choicesBlocked && !draftIssue && <p role="status" className="text-xs text-muted-foreground">{preflight.ready ? "Ready · Text, font and QR identities checked · Prints in sheet order" : Object.keys(preflight.issues).length ? "Fix the label issues above before printing." : `Checking ${preflight.done} of ${Math.min(total, 500)} labels…`}</p>}
          {Object.keys(preflight.issues).length > 0 && <Button variant="outline" size="sm" className="h-10" onClick={preflight.retry}>Retry label checks</Button>}
          <USBPrintControls labels={usbLabels} total={total} blocked={Boolean(blocked)} onCompleted={(label) => {
            if (!label.unit) return;
            const { skuId, number } = label.unit;
            setExportedUnits((prev) => ({ ...prev, [skuId]: Array.from(new Set([...(prev[skuId] ?? []), number])) }));
          }} />
          <details className="text-xs">
            <summary className="cursor-pointer py-2 text-muted-foreground">Export CSV for P-touch Editor</summary>
          <div className="flex flex-col gap-2 pt-1">
          {files.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {loading ? "Loading unit numbers…" : "Nothing on the sheet can print yet."}
            </p>
          ) : (
            files.map((file) => (
              <div key={file.kind} className="flex gap-2">
                <Button
                  variant="outline"
                  className="h-10 min-w-0 flex-1 justify-between"
                  disabled={Boolean(blocked)}
                  aria-label={`Download ${file.file}, ${plural(file.labels, "label")}${downloaded[file.kind] === file.csv ? ", current version downloaded" : downloaded[file.kind] ? ", updated since last download" : ""}`}
                  onClick={() => {
                    download(file.file, file.csv);
                    setDownloaded((prev) => ({ ...prev, [file.kind]: file.csv }));
                    recordExport(file.kind);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {downloaded[file.kind] === file.csv ? <Check className="size-4" /> : <Download className="size-4" />}
                    <span className="truncate">{file.file}</span>
                  </span>
                  <span className="tabular-nums opacity-80">{plural(file.labels, "label")}</span>
                </Button>
                <Button variant="outline" size="icon" className="size-10 shrink-0" asChild>
                  <a href={file.templateHref} download={file.template} aria-label={`Download the ${file.template} template`} title={`Template: ${file.template}`}>
                    <FileDown className="size-4" />
                  </a>
                </Button>
              </div>
            ))
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            Open the matching template in P-touch Editor (the file button). If asked to locate its database,
            choose Reopen, then Browse and select the CSV. Keep the header row option checked. Confirm a record
            and its text fit before printing. CSV templates use their own layout. A single-record CSV may not merge in P-touch; use USB printing instead.
          </p>
          </div>
          </details>
        </footer>
    </section>
  );
}
