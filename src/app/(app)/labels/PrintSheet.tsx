"use client";

import { useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Download, Minus, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LABEL_KINDS, type LabelKind } from "@/lib/brother-label-csv";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { LabelPreview } from "./LabelPreview";
import {
  KIND_ORDER,
  MAX_COPIES,
  clampCopies,
  entryKind,
  entryRows,
  printableCount,
  printsUnits,
  selectedUnitNumbers,
  sheetRows,
  templateFiles,
  type CartEntry,
  type SheetUnit,
  type UnitsBySku,
} from "./label-sheet";

const unitsKey = (skuId: string) => ["label-units", skuId] as const;

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
  URL.revokeObjectURL(url);
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

function EntryEditor({ entry, onUpdate }: { entry: CartEntry; onUpdate: (patch: Partial<CartEntry>) => void }) {
  return (
    <div className="mt-3 grid grid-cols-[72px_1fr_72px] gap-2">
      <Input value={entry.dept} onChange={(e) => onUpdate({ dept: e.target.value })} placeholder="Dept" aria-label={`Dept for ${entry.title}`} />
      <Input value={entry.model} onChange={(e) => onUpdate({ model: e.target.value })} placeholder="Model" aria-label={`Model for ${entry.title}`} />
      <Input value={entry.number} onChange={(e) => onUpdate({ number: e.target.value })} placeholder="No." aria-label={`Number for ${entry.title}`} />
      <NativeSelect
        className="col-span-3"
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
    </div>
  );
}

function SheetEntry({
  entry,
  units,
  unitsFailed,
  downloadedTags,
  onUpdate,
  onRemove,
  onMarkPrinted,
}: {
  entry: CartEntry;
  units: SheetUnit[] | undefined;
  unitsFailed: boolean;
  downloadedTags: boolean;
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
  const labels = printableCount(entryRows(entry, units));
  const missingQr = LABEL_KINDS[entryKind(entry)].needsQr && !entry.qrCodeValue;
  const active = units?.filter((unit) => unit.status !== "RETIRED") ?? [];
  const unprinted = active.filter((unit) => !unit.labelPrintedAt).length;
  const firstUnit = unitNumbers[0];

  const meta = unitMode
    ? !units
      ? unitsFailed
        ? "Units could not load"
        : "Loading units…"
      : unitNumbers.length === 0
        ? "Every unit already has a label"
        : `${plural(unitNumbers.length, "unit label")} · ${unitNumbers[0]}–${unitNumbers.at(-1)}`
    : missingQr
      ? "No QR code, so the CSV skips it"
      : entry.qrCodeValue || entry.name;

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        {unitMode ? (
          <LabelPreview kind="numberTag" dept="" model="" number={firstUnit ? String(firstUnit) : "#"} qrCodeValue={firstUnit ? `${family!.binQrCodeValue}-${firstUnit}` : ""} />
        ) : (
          <LabelPreview kind={entry.kind} dept={entry.dept} model={entry.model} number={entry.number} qrCodeValue={entry.qrCodeValue} />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-bold">{entry.title}</div>
              <div className={cn("truncate text-xs", missingQr || unitsFailed ? "text-destructive" : "text-muted-foreground", !unitMode && !missingQr && "font-mono")}>
                {meta}
              </div>
            </div>
            <div className="-mr-2 -mt-1 flex shrink-0">
              {!unitMode && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("size-9 text-muted-foreground", editing && "text-foreground")}
                  onClick={() => setEditing((value) => !value)}
                  aria-label={`Edit label text for ${entry.title}`}
                  aria-pressed={editing}
                >
                  <Pencil className="size-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="size-9 text-muted-foreground" onClick={onRemove} aria-label={`Remove ${entry.title}`}>
                <X className="size-4" />
              </Button>
            </div>
          </div>

          {family?.trackByNumber && (
            <ToggleGroup
              type="single"
              value={family.mode}
              onValueChange={(mode) => mode && onUpdate({ family: { ...family, mode: mode as "family" | "units" } })}
              className="mt-2 w-full [&>button]:min-h-8 [&>button]:flex-1 [&>button]:text-xs"
              aria-label={`What to print for ${entry.title}`}
            >
              <ToggleGroupItem value="family">Family label</ToggleGroupItem>
              <ToggleGroupItem value="units">Unit labels</ToggleGroupItem>
            </ToggleGroup>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {unitMode ? (
              <ToggleGroup
                type="single"
                value={family!.unitScope}
                onValueChange={(scope) => scope && onUpdate({ family: { ...family!, unitScope: scope as "unprinted" | "all" } })}
                className="[&>button]:min-h-8 [&>button]:text-xs"
                aria-label={`Which units of ${entry.title}`}
              >
                <ToggleGroupItem value="unprinted">Not printed{units ? ` · ${unprinted}` : ""}</ToggleGroupItem>
                <ToggleGroupItem value="all">All{units ? ` · ${active.length}` : ""}</ToggleGroupItem>
              </ToggleGroup>
            ) : (
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

          {unitMode && downloadedTags && family!.unitScope === "unprinted" && unitNumbers.length > 0 && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-[var(--accent-soft)] px-3 py-2 text-xs">
              <span>Stuck these on?</span>
              <Button
                size="sm"
                className="h-10"
                disabled={marking}
                onClick={async () => {
                  setMarking(true);
                  try {
                    await onMarkPrinted(unitNumbers);
                  } finally {
                    setMarking(false);
                  }
                }}
              >
                <Check className="size-3.5" />
                {marking ? "Marking…" : `Mark ${unitNumbers.length} printed`}
              </Button>
            </div>
          )}

          {editing && !unitMode && <EntryEditor entry={entry} onUpdate={onUpdate} />}
        </div>
      </div>
    </li>
  );
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
  const rows = useMemo(() => sheetRows(cart, unitsBySku), [cart, unitsBySku]);
  const files = useMemo(() => templateFiles(rows), [rows]);
  const total = printableCount(rows);
  const groups = KIND_ORDER.map((kind) => ({
    kind,
    entries: cart.filter((entry) => entryKind(entry) === kind),
  })).filter((group) => group.entries.length > 0);

  const markPrinted = async (entry: CartEntry, unitNumbers: number[]) => {
    const skuId = entry.family!.skuId;
    try {
      const res = await fetch(`/api/bulk-skus/${skuId}/units/labels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitNumbers, printed: true }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) throw new Error("server");
      const json = await parseJsonSafely<{ data?: { updated?: number } }>(res);
      toast.success(`${plural(json?.data?.updated ?? unitNumbers.length, "unit")} of ${entry.title} marked printed`);
      await queryClient.invalidateQueries({ queryKey: unitsKey(skuId) });
    } catch {
      toast.error("Could not mark those labels printed. Try again.");
    }
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
            <LabelPreview kind="body" dept="FB" model="FX3" number="1" qrCodeValue="wisconsin-creative" size="md" />
            <LabelPreview kind="numberTag" dept="" model="" number="12" qrCodeValue="wisconsin-creative-12" className="opacity-60" />
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
                    downloadedTags={downloaded.has("numberTag")}
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
              <Button
                key={file.kind}
                variant={index === 0 ? "default" : "outline"}
                className="h-10 justify-between"
                disabled={loading}
                onClick={() => {
                  download(file.file, file.csv);
                  setDownloaded((prev) => new Set(prev).add(file.kind));
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {downloaded.has(file.kind) ? <Check className="size-4" /> : <Download className="size-4" />}
                  <span className="truncate">{file.file}</span>
                </span>
                <span className="tabular-nums opacity-80">{plural(file.labels, "label")}</span>
              </Button>
            ))
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            In P-touch Editor, open the template with the same name, connect the CSV as its database, then print all
            records.
          </p>
        </footer>
      )}
    </section>
  );
}
