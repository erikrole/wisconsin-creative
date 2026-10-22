"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LABEL_KINDS, numberRangeRows, sdCardRows, type LabelRow } from "@/lib/brother-label-csv";
import { cn } from "@/lib/utils";
import type { CartEntry } from "./label-sheet";

const STORAGE_KEY = "labels.cart.v2";
const MAX_SD_CARDS = 100;

const isText = (value: unknown) => typeof value === "string";

function isFamilySource(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object") return false;
  const family = value as Record<string, unknown>;
  return (
    isText(family.skuId) &&
    isText(family.binQrCodeValue) &&
    typeof family.trackByNumber === "boolean" &&
    typeof family.onHand === "number" &&
    (family.mode === "family" || family.mode === "units") &&
    (family.unitScope === "unprinted" || family.unitScope === "all" || family.unitScope === "pick") &&
    (family.unitPick === undefined || isText(family.unitPick)) &&
    (family.unitKind === undefined || family.unitKind === "battery" || family.unitKind === "numberTag")
  );
}

/** Drops stored rows from older builds or hand-edited storage instead of crashing the page. */
function isCartEntry(value: unknown): value is CartEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    isText(entry.id) &&
    isText(entry.title) &&
    isText(entry.dept) &&
    isText(entry.model) &&
    isText(entry.number) &&
    isText(entry.qrCodeValue) &&
    typeof entry.copies === "number" &&
    typeof entry.kind === "string" &&
    entry.kind in LABEL_KINDS &&
    isFamilySource(entry.family)
  );
}

function readStoredCart(): CartEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isCartEntry) : [];
  } catch {
    return [];
  }
}

let generatedSeq = 0;
function generatedEntries(rows: LabelRow[]): CartEntry[] {
  const stamp = Date.now().toString(36);
  return rows.map((row) => {
    generatedSeq += 1;
    const title = [row.dept, row.model, row.kind === "text" ? "" : row.number].filter(Boolean).join(" ");
    return { ...row, id: `gen-${stamp}-${generatedSeq}`, title, name: LABEL_KINDS[row.kind].label };
  });
}

/** Print sheet persisted per browser so it survives searches, navigation and reloads. */
export function useLabelCart() {
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCart(readStoredCart());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Storage blocked: the sheet still works for this visit.
    }
  }, [cart, hydrated]);

  const has = useCallback((id: string) => cart.some((entry) => entry.id === id), [cart]);
  const add = useCallback(
    (entries: CartEntry[]) =>
      setCart((prev) => {
        const ids = new Set(prev.map((entry) => entry.id));
        return [...prev, ...entries.filter((entry) => !ids.has(entry.id))];
      }),
    [],
  );
  const remove = useCallback(
    (id: string) => setCart((prev) => prev.filter((entry) => entry.id !== id)),
    [],
  );
  const update = useCallback(
    (id: string, patch: Partial<CartEntry>) =>
      setCart((prev) => prev.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))),
    [],
  );
  const clear = useCallback(() => setCart([]), []);

  return { cart, hydrated, has, add, remove, update, clear };
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-xs font-medium text-muted-foreground", className)}>
      {label}
      {children}
    </label>
  );
}

function GeneratorBlock({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border/70 px-4 py-4 first:border-t-0">
      <div>
        <div className="text-sm font-bold">{title}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
      </div>
      <div className="flex flex-wrap items-end gap-2">{children}</div>
    </div>
  );
}

/** SD card grids, free-text labels and number runs, none of which come from items. */
export function LabelGenerators({ onAdd }: { onAdd: (entries: CartEntry[]) => void }) {
  const [open, setOpen] = useState(false);
  const [sdCamera, setSdCamera] = useState("");
  const [sdDept, setSdDept] = useState("");
  const [sdCount, setSdCount] = useState(4);
  const [sdSlots, setSdSlots] = useState("A,B");
  const [text, setText] = useState("");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(10);
  const [prefix, setPrefix] = useState("");

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="no-print overflow-hidden rounded-[var(--radius)] border border-border bg-card"
    >
      <CollapsibleTrigger className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span>
          <span className="block text-sm font-bold">Labels that aren&apos;t items</span>
          <span className="block text-xs text-muted-foreground">SD card sets, plain text and number runs</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/70">
        <GeneratorBlock title="SD cards" hint="One label per card and slot, like FX3 1A, 1B, 2A.">
          <Field label="Camera">
            <Input className="w-28" value={sdCamera} onChange={(e) => setSdCamera(e.target.value)} placeholder="FX3" />
          </Field>
          <Field label="Dept">
            <Input className="w-20" value={sdDept} onChange={(e) => setSdDept(e.target.value)} placeholder="FB" />
          </Field>
          <Field label="Cards">
            <Input className="w-20" type="number" min={1} max={MAX_SD_CARDS} value={sdCount} onChange={(e) => setSdCount(Math.min(MAX_SD_CARDS, Math.max(1, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Slots">
            <Input className="w-24" value={sdSlots} onChange={(e) => setSdSlots(e.target.value)} placeholder="A,B" />
          </Field>
          <Button
            variant="outline"
            className="h-10"
            disabled={!sdCamera.trim()}
            onClick={() =>
              onAdd(
                generatedEntries(
                  sdCardRows(
                    sdCamera.trim(),
                    sdDept.trim().toUpperCase(),
                    sdCount,
                    sdSlots.split(",").map((slot) => slot.trim()).filter(Boolean),
                  ),
                ),
              )
            }
          >
            <Plus className="size-4" />
            Add
          </Button>
        </GeneratorBlock>

        <GeneratorBlock title="Text labels" hint="One label per line, no QR.">
          <Field label="Lines" className="min-w-0 flex-1">
            <Textarea
              className="min-h-10 w-full sm:w-72"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"FB\nMBB"}
              rows={2}
            />
          </Field>
          <Button
            variant="outline"
            className="h-10"
            disabled={!text.trim()}
            onClick={() => {
              const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
              onAdd(
                generatedEntries(
                  lines.map((line) => ({ kind: "text", dept: "", model: line, number: "", qrCodeValue: "", copies: 1 })),
                ),
              );
              setText("");
            }}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </GeneratorBlock>

        <GeneratorBlock title="Number run" hint="Plain numbers, up to 500 at a time.">
          <Field label="From">
            <Input className="w-20" type="number" value={from} onChange={(e) => setFrom(Number(e.target.value) || 0)} />
          </Field>
          <Field label="To">
            <Input className="w-20" type="number" value={to} onChange={(e) => setTo(Number(e.target.value) || 0)} />
          </Field>
          <Field label="Prefix">
            <Input className="w-20" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="#" />
          </Field>
          <Button
            variant="outline"
            className="h-10"
            disabled={Math.abs(to - from) > 499}
            onClick={() => onAdd(generatedEntries(numberRangeRows(from, to, prefix, "text")))}
          >
            <Plus className="size-4" />
            Add
          </Button>
        </GeneratorBlock>
      </CollapsibleContent>
    </Collapsible>
  );
}
