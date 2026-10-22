"use client";

import { useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Download, FileDown, Minus, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LABEL_KINDS, type LabelKind } from "@/lib/brother-label-csv";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";
import { LabelPreview } from "./LabelPreview";
import {
  KIND_ORDER,
  MAX_COPIES,
  clampCopies,
  entryKind,
  entryRows,
  parseUnitPick,
  printableCount,
  printsUnits,
  selectedUnitNumbers,
  sheetRows,
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
  return json?.data ?? [];
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
  const loading = results.some((result) => result.isLoading);
  return { unitsBySku, loading, failed };
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
    <div className="inline-flex h-9 items-center rounded-full border border-border bg-background">
      <button
        type="button"
        className="grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40"
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
        className="grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground hover:text-foreground disabled:cursor-default disabled:opacity-40"
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
              {LABEL_KINDS[kind].template}
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
}: {
  entry: CartEntry;
  units: SheetUnit[] | undefined;
  unitsFailed: boolean;
  /** Unit numbers in the CSV that was downloaded for this entry, still unmarked. Null when there is nothing to mark. */
  downloadedUnits: number[] | null;
  onUpdate: (patch: Partial<CartEntry>) => void;
  onRemove: () => void;
  onMarkPrinted: (numbers: number[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [marking, setMarking] = useState(false);
  const family = entry.family;
  const unitMode = printsUnits(entry);
  const counted = family && !family.trackByNumber;
  const unitNumbers = selectedUnitNumbers(entry, units);
  const unknown = unknownPickedNumbers(entry, units);
  const pickInvalid = family?.unitScope === "pick" ? parseUnitPick(family.unitPick ?? "").invalid : [];
  const labels = printableCount(entryRows(entry, units));
  const kind = entryKind(entry);
  const missingQr = LABEL_KINDS[kind].needsQr && !entry.qrCodeValue;
  const active = units?.filter((unit) => unit.status !== "RETIRED") ?? [];
  const unprinted = active.filter((unit) => !unit.labelPrintedAt).length;
  const firstUnit = unitNumbers[0];
  const edited = textEdited(entry);
  const toMark = (downloadedUnits ?? []).filter((n) => !units?.find((u) => u.unitNumber === n)?.labelPrintedAt);
  const canMark = unitMode && toMark.length > 0;

  const meta = unitMode
    ? !units
      ? unitsFailed
        ? "Units could not load"
        : "Loading units…"
      : unitNumbers.length === 0
        ? family?.unitScope === "pick"
          ? "Type unit numbers to print"
          : "Every unit already has a label"
        : `${plural(unitNumbers.length, "unit label")} · ${compactRanges(unitNumbers)}`
    : missingQr
      ? "No QR code, so the CSV skips it"
      : entry.qrCodeValue || entry.name;

  return (
    <li className="px-4 py-3">
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

      <div className="mt-2 overflow-x-auto pb-1">
        {unitMode ? (
          <LabelPreview
            kind={kind}
            dept=""
            model=""
            number={firstUnit ? String(firstUnit) : "1"}
            qrCodeValue={`${family!.binQrCodeValue}-${firstUnit ?? 1}`}
          />
        ) : (
          <button
            type="button"
            className="block cursor-pointer rounded-[4px] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            onClick={() => setEditing(true)}
            aria-label={`Edit printed text for ${entry.title}`}
          >
            <LabelPreview kind={kind} dept={entry.dept} model={entry.model} number={entry.number} qrCodeValue={entry.qrCodeValue} />
          </button>
        )}
      </div>

      {family?.trackByNumber && (
        <ToggleGroup
          type="single"
          value={family.mode}
          onValueChange={(mode) => mode && onUpdate({ family: { ...family, mode: mode as "family" | "units" } })}
          className="mt-2 w-full [&>button]:min-h-9 [&>button]:flex-1 [&>button]:text-xs"
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
            className="w-full [&>button]:min-h-9 [&>button]:flex-1 [&>button]:text-xs"
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
                inputMode="numeric"
                aria-label={`Unit numbers of ${entry.title} to print`}
              />
              {(pickInvalid.length > 0 || unknown.length > 0) && (
                <p className="text-xs text-destructive">
                  {[
                    pickInvalid.length > 0 ? `Can't read ${pickInvalid.join(", ")}` : "",
                    unknown.length > 0 ? `No active unit ${compactRanges(unknown)}` : "",
                  ]
                    .filter(Boolean)
                    .join(". ")}
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
                  {LABEL_KINDS[option].template}
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
          <span>Stuck these on?</span>
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
}: {
  cart: CartEntry[];
  onUpdate: (id: string, patch: Partial<CartEntry>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const { unitsBySku, loading, failed } = useSheetUnits(cart);
  const [downloaded, setDownloaded] = useState<Set<LabelKind>>(new Set());
  // Exactly which units went out in a downloaded CSV, per family, so "Mark printed"
  // never covers units that were added or re-picked after the download.
  const [exportedUnits, setExportedUnits] = useState<Record<string, number[]>>({});
  const { data: me } = useCurrentUser();
  const canMarkPrinted = me?.role === "ADMIN" || me?.role === "STAFF";
  const rows = useMemo(() => sheetRows(cart, unitsBySku), [cart, unitsBySku]);
  const files = useMemo(() => templateFiles(rows), [rows]);
  const total = printableCount(rows);
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    entries: cart.filter((entry) => entryKind(entry) === kind),
  })).filter((group) => group.entries.length > 0);

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
    setExportedUnits((prev) => ({ ...prev, ...exported }));
  };

  return (
    <section
      id="print-sheet"
      aria-label="Print sheet"
      className={cn("no-print flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card", className)}
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <h2 className="text-base">Print sheet</h2>
          <p className="text-xs tabular-nums text-muted-foreground">
            {cart.length === 0 ? "Nothing added yet" : `${plural(total, "label")} from ${plural(cart.length, "line")}`}
          </p>
        </div>
        {cart.length > 0 && (
          <Button variant="ghost" size="sm" className="h-10 text-muted-foreground" onClick={onClear}>
            Clear
          </Button>
        )}
      </header>

      {cart.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
          <div className="flex flex-col items-center gap-1.5 opacity-80">
            <LabelPreview kind="body" dept="FB" model="FX3" number="1" qrCodeValue="wisconsin-creative" height={56} />
            <LabelPreview kind="battery" dept="" model="" number="12" qrCodeValue="wisconsin-creative-12" className="opacity-60" />
          </div>
          <div>
            <div className="text-sm font-bold">Pick gear to label</div>
            <p className="mx-auto mt-1 max-w-64 text-xs text-muted-foreground">
              Add items or families from the list. Set how many, then download a CSV for each P-touch template.
            </p>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.kind}>
              <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/60 bg-[var(--bg-surface)]/90 px-4 py-1.5 text-xs font-bold text-muted-foreground backdrop-blur">
                <span>{LABEL_KINDS[group.kind].template}</span>
                <span className="font-normal tabular-nums">
                  {plural(printableCount(rows.filter((row) => row.kind === group.kind)), "label")}
                </span>
              </div>
              <ul className="divide-y divide-border/60">
                {group.entries.map((entry) => (
                  <SheetEntry
                    key={entry.id}
                    entry={entry}
                    units={entry.family ? unitsBySku[entry.family.skuId] : undefined}
                    unitsFailed={Boolean(entry.family && failed.has(entry.family.skuId))}
                    downloadedUnits={
                      canMarkPrinted && entry.family && printsUnits(entry) ? exportedUnits[entry.family.skuId] ?? null : null
                    }
                    onUpdate={(patch) => onUpdate(entry.id, patch)}
                    onRemove={() => onRemove(entry.id)}
                    onMarkPrinted={(numbers) => markPrinted(entry, numbers)}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {cart.length > 0 && (
        <footer className="flex flex-col gap-2 border-t border-border/70 bg-[var(--bg-surface)]/60 px-4 py-3">
          {files.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {loading ? "Loading unit numbers…" : "Nothing on the sheet can print yet."}
            </p>
          ) : (
            files.map((file, index) => (
              <div key={file.kind} className="flex gap-2">
                <Button
                  variant={index === 0 ? "default" : "outline"}
                  className="h-10 min-w-0 flex-1 justify-between"
                  disabled={loading}
                  onClick={() => {
                    download(file.file, file.csv);
                    setDownloaded((prev) => new Set(prev).add(file.kind));
                    recordExport(file.kind);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {downloaded.has(file.kind) ? <Check className="size-4" /> : <Download className="size-4" />}
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
            Open the matching template in P-touch Editor (the file button next to each CSV), connect the CSV as its
            database, then print all records.
          </p>
        </footer>
      )}
    </section>
  );
}
