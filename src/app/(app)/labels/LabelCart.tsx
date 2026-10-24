"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
    Number.isSafeInteger(entry.copies) && Number(entry.copies) >= 1 && Number(entry.copies) <= 500 &&
    isText(entry.name) &&
    typeof entry.kind === "string" &&
    Object.hasOwn(LABEL_KINDS, entry.kind) &&
    isFamilySource(entry.family)
  );
}

function readStoredCart(raw: string | null): CartEntry[] {
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || !parsed.every(isCartEntry)) throw new Error("This saved sheet could not be read. Your current selections are still available in this tab.");
  return parsed;
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

/** Account-owned drafts use a cross-tab lock and compare the saved value before writing. */
export function useLabelCart(actorId: string | undefined) {
  const [cart, setCart] = useState<CartEntry[]>([]), [hydrated, setHydrated] = useState(false);
  const [storageError, setStorageError] = useState(""), [conflict, setConflict] = useState(false);
  const [undoCart, setUndoCart] = useState<CartEntry[] | null>(null), [hasLegacy, setHasLegacy] = useState(false);
  const current = useRef<CartEntry[]>([]), expected = useRef<string | null>(null), keyRef = useRef<string | null>(null);
  const queue = useRef(Promise.resolve()), blocked = useRef(false);
  const load = useCallback(() => {
    if (!actorId) return;
    const key = `labels.cart.v3:${actorId}`; keyRef.current = key;
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(key); const next = readStoredCart(raw);
      expected.current = raw; current.current = next; setCart(next); setUndoCart(null);
      blocked.current = false; setConflict(false); setStorageError("");
      setHasLegacy(localStorage.getItem(STORAGE_KEY) !== null);
    } catch (error) {
      // Remember what was there so "Retry saving sheet" can replace an unreadable sheet instead of reporting a tab conflict.
      expected.current = raw; blocked.current = true; setStorageError(error instanceof Error ? error.message : "The saved sheet is unavailable.");
    }
    setHydrated(true);
  }, [actorId]);
  useEffect(() => {
    setHydrated(false); current.current = []; setCart([]); setUndoCart(null); blocked.current = false; keyRef.current = null;
    load();
    const storage = (event: StorageEvent) => {
      if (event.key === keyRef.current || event.key === null) {
        blocked.current = true; setConflict(true); setStorageError("This sheet changed in another tab. Choose which version to keep before printing.");
      }
    };
    window.addEventListener("storage", storage); return () => { window.removeEventListener("storage", storage); };
  }, [load]);
  const persist = useCallback((next: CartEntry[], replace = false, retry = false) => {
    const key = keyRef.current;
    if (!key) return;
    queue.current = queue.current.then(async () => {
      if (keyRef.current !== key || (blocked.current && !retry)) return;
      const save = async () => {
        const actual = localStorage.getItem(key);
        if (!replace && actual !== expected.current) { blocked.current = true; setConflict(true); throw new Error("This sheet changed in another tab. Choose which version to keep before printing."); }
        const raw = JSON.stringify(next); localStorage.setItem(key, raw); expected.current = raw;
        blocked.current = false; setConflict(false); setStorageError("");
      };
      try {
        if (navigator.locks) await navigator.locks.request(`qr-print-sheet:${key}`, save); else await save();
      } catch (error) { blocked.current = true; setStorageError(error instanceof Error ? error.message : "The sheet could not save. Keep this tab open and retry."); }
    });
  }, []);
  const change = useCallback((transform: (previous: CartEntry[]) => CartEntry[], undoable = false) => {
    if (!keyRef.current) return;
    const previous = current.current, next = transform(previous);
    if (undoable) setUndoCart(previous);
    current.current = next; setCart(next); persist(next);
  }, [persist]);
  const has = useCallback((id: string) => cart.some((entry) => entry.id === id), [cart]);
  const add = useCallback((entries: CartEntry[]) => change((previous) => {
    const ids = new Set(previous.map((entry) => entry.id)); return [...previous, ...entries.filter((entry) => !ids.has(entry.id))];
  }), [change]);
  const remove = useCallback((id: string) => change((previous) => previous.filter((entry) => entry.id !== id), true), [change]);
  const update = useCallback((id: string, patch: Partial<CartEntry>) => change((previous) => previous.map((entry) => entry.id === id ? { ...entry, ...patch } : entry)), [change]);
  const clear = useCallback(() => change(() => [], true), [change]);
  const undo = useCallback(() => {
    if (!undoCart) return;
    const restore = undoCart; setUndoCart(null);
    change((previous) => {
      const existing = new Map(previous.map((entry) => [entry.id, entry]));
      const restoredIds = new Set(restore.map((entry) => entry.id));
      return [...restore.map((entry) => existing.get(entry.id) ?? entry), ...previous.filter((entry) => !restoredIds.has(entry.id))];
    });
  }, [undoCart, change]);
  const retrySave = useCallback(() => persist(current.current, conflict, true), [persist, conflict]);
  const importLegacy = useCallback(() => {
    try {
      add(readStoredCart(localStorage.getItem(STORAGE_KEY)));
      // The older sheet now lives in the account sheet; leaving it would re-offer the import on every visit.
      localStorage.removeItem(STORAGE_KEY); setHasLegacy(false);
    }
    catch { setStorageError("The older sheet could not be read. It has been preserved."); }
  }, [add]);
  return { cart, hydrated, has, add, remove, update, clear, undo, canUndo: Boolean(undoCart), storageError, conflict, reloadSaved: load, retrySave, hasLegacy, importLegacy };
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
        <h3 className="text-sm font-bold">{title}</h3>
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
  const validRange = Number.isSafeInteger(from) && Number.isSafeInteger(to) && Math.abs(to - from) <= 499;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="no-print overflow-hidden rounded-[var(--radius)] border border-border bg-card"
    >
      <CollapsibleTrigger className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <span>
          <span className="block text-sm font-bold">Custom labels</span>
          <span className="block text-xs text-muted-foreground">SD card sets, text and numbers</span>
        </span>
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-border/70">
        <GeneratorBlock title="SD cards" hint="One label per card and slot, like FX3 1A, 1B, 2A.">
          <Field label="Camera">
            <Input className="w-28" value={sdCamera} onChange={(e) => setSdCamera(e.target.value)} placeholder="FX3" />
          </Field>
          <Field label="Department">
            <Input className="w-20" value={sdDept} onChange={(e) => setSdDept(e.target.value)} placeholder="FB" />
          </Field>
          <Field label="Cards">
            <Input className="w-20" type="number" min={1} max={MAX_SD_CARDS} step={1} value={sdCount} onChange={(e) => setSdCount(Math.min(MAX_SD_CARDS, Math.max(1, Math.floor(Number(e.target.value) || 1))))} />
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
            Add SD labels
          </Button>
        </GeneratorBlock>

        <GeneratorBlock title="Text labels" hint="One label for each line of text.">
          <Field label="Lines" className="min-w-0 flex-1">
            <Textarea
              className="min-h-20 w-full"
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
            Add text labels
          </Button>
        </GeneratorBlock>

        <GeneratorBlock title="Number run" hint="Plain numbers, up to 500 at a time.">
          <Field label="From">
            <Input className="w-20" type="number" step={1} value={from} onChange={(e) => setFrom(Number(e.target.value) || 0)} aria-invalid={validRange ? undefined : true} />
          </Field>
          <Field label="To">
            <Input className="w-20" type="number" step={1} value={to} onChange={(e) => setTo(Number(e.target.value) || 0)} aria-invalid={validRange ? undefined : true} />
          </Field>
          <Field label="Prefix">
            <Input className="w-20" value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="#" />
          </Field>
          <Button
            variant="outline"
            className="h-10"
            disabled={!validRange}
            onClick={() => onAdd(generatedEntries(numberRangeRows(from, to, prefix, "text")))}
          >
            <Plus className="size-4" />
            Add number labels
          </Button>
          {!validRange && <p role="status" className="w-full text-xs text-destructive">Use whole numbers, up to 500 labels at a time.</p>}
        </GeneratorBlock>
      </CollapsibleContent>
    </Collapsible>
  );
}
