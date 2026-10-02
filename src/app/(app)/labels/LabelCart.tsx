"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  LABEL_KINDS,
  buildBrotherCsv,
  numberRangeRows,
  parseAssetTag,
  sdCardRows,
  type LabelKind,
  type LabelRow,
} from "@/lib/brother-label-csv";

/** One label in the print cart, editable in the review step before export. */
export type CartEntry = LabelRow & {
  id: string;
  title: string;
  name: string;
  primaryScanCode?: string;
};

const STORAGE_KEY = "labels.cart.v2";
const KIND_ORDER = Object.keys(LABEL_KINDS) as LabelKind[];

const isText = (value: unknown) => typeof value === "string";

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
    entry.kind in LABEL_KINDS
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

/** Lenses and SD cards get their own templates; everything else prints as a body label. */
export function kindForCategory(category: string | null | undefined): LabelKind {
  const name = (category ?? "").toLowerCase();
  if (name.includes("lens")) return "lens";
  if (name.includes("sd card")) return "sd";
  return "body";
}

export function newCartEntry(item: {
  id: string;
  title: string;
  name: string;
  qrCodeValue: string;
  primaryScanCode?: string;
  category?: string | null;
}): CartEntry {
  return {
    id: item.id,
    title: item.title,
    name: item.name,
    primaryScanCode: item.primaryScanCode,
    kind: kindForCategory(item.category),
    ...parseAssetTag(item.title),
    qrCodeValue: item.qrCodeValue,
    copies: 1,
  };
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

/** Cart persisted per browser so it survives searches, navigation and reloads. */
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
      // Storage blocked: the cart still works for this visit.
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

export function labelTotal(cart: CartEntry[]) {
  return cart.reduce((sum, entry) => sum + Math.max(1, entry.copies), 0);
}

function download(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function kindTotal(cart: CartEntry[], kind: LabelKind) {
  return labelTotal(cart.filter((entry) => entry.kind === kind));
}

function GeneratorRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-end gap-2">{children}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** SD card grids, free-text labels and number runs, none of which come from items. */
export function LabelGenerators({ onAdd }: { onAdd: (entries: CartEntry[]) => void }) {
  const [sdCamera, setSdCamera] = useState("");
  const [sdDept, setSdDept] = useState("");
  const [sdCount, setSdCount] = useState(4);
  const [sdSlots, setSdSlots] = useState("A,B");
  const [text, setText] = useState("");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(10);
  const [prefix, setPrefix] = useState("");

  return (
    <Card className="no-print mb-4 overflow-hidden" elevation="flat">
      <CardHeader className="border-b border-border/70">
        <div className="font-semibold">Add labels that aren&apos;t items</div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 p-3">
        <GeneratorRow>
          <Field label="SD camera">
            <Input className="w-28" value={sdCamera} onChange={(e) => setSdCamera(e.target.value)} placeholder="FX3" />
          </Field>
          <Field label="Dept">
            <Input className="w-20" value={sdDept} onChange={(e) => setSdDept(e.target.value)} placeholder="FB" />
          </Field>
          <Field label="Cards">
            <Input className="w-20" type="number" min={1} value={sdCount} onChange={(e) => setSdCount(Math.max(1, Number(e.target.value) || 1))} />
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
            <Plus className="mr-1.5 size-4" />
            SD cards
          </Button>
        </GeneratorRow>

        <GeneratorRow>
          <Field label="Generic labels (one per line)">
            <textarea
              className="min-h-10 w-64 rounded-md border border-input bg-transparent px-3 py-2 text-sm normal-case tracking-normal"
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
            <Plus className="mr-1.5 size-4" />
            Labels
          </Button>
        </GeneratorRow>

        <GeneratorRow>
          <Field label="Numbers from">
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
            <Plus className="mr-1.5 size-4" />
            Numbers
          </Button>
        </GeneratorRow>
      </CardContent>
    </Card>
  );
}

export function LabelCartReview({
  cart,
  onUpdate,
  onRemove,
  onClear,
}: {
  cart: CartEntry[];
  onUpdate: (id: string, patch: Partial<CartEntry>) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  if (cart.length === 0) return null;
  const kinds = KIND_ORDER.filter((kind) => cart.some((entry) => entry.kind === kind));

  return (
    <Card className="no-print mb-4 overflow-hidden" elevation="flat">
      <CardHeader className="flex flex-col gap-3 border-b border-border/70">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-semibold">Review print cart</div>
            <div className="text-xs text-muted-foreground">
              Each label type downloads as its own CSV, named for its P-touch template. Open the
              template, drop the CSV on the database bar, then print all records.
            </div>
          </div>
          <Button variant="ghost" size="sm" className="h-10" onClick={onClear}>
            Clear cart
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {kinds.map((kind) => (
            <Button
              key={kind}
              size="sm"
              className="h-10"
              onClick={() => download(LABEL_KINDS[kind].file, buildBrotherCsv(kind, cart))}
            >
              <Download className="mr-1.5 size-4" />
              {LABEL_KINDS[kind].file} ({kindTotal(cart, kind)})
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="max-h-[480px] overflow-y-auto p-0">
        {kinds.map((kind) => (
          <div key={kind}>
            <div className="sticky top-0 z-10 border-b border-border/60 bg-muted/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
              {LABEL_KINDS[kind].label} · {LABEL_KINDS[kind].template}
            </div>
            {cart
              .filter((entry) => entry.kind === kind)
              .map((entry) => {
                const missingQr = LABEL_KINDS[entry.kind].needsQr && !entry.qrCodeValue;
                return (
                  <div
                    key={entry.id}
                    className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2 last:border-0"
                  >
                    <div className="min-w-0 basis-full sm:basis-48 sm:flex-1">
                      <div className="truncate text-sm font-medium">{entry.title}</div>
                      <div className={missingQr ? "text-[11px] text-destructive" : "truncate font-mono text-[11px] text-muted-foreground"}>
                        {missingQr ? "No QR — skipped in CSV" : entry.qrCodeValue || entry.name}
                      </div>
                    </div>
                    <select
                      className="h-10 rounded-md border border-input bg-transparent px-2 text-sm"
                      value={entry.kind}
                      onChange={(e) => onUpdate(entry.id, { kind: e.target.value as LabelKind })}
                      aria-label={`Label type for ${entry.title}`}
                    >
                      {KIND_ORDER.map((option) => (
                        <option key={option} value={option}>
                          {LABEL_KINDS[option].label}
                        </option>
                      ))}
                    </select>
                    {entry.kind !== "text" && (
                      <Input
                        className="w-16"
                        value={entry.dept}
                        onChange={(e) => onUpdate(entry.id, { dept: e.target.value })}
                        placeholder="Dept"
                        aria-label={`Dept for ${entry.title}`}
                      />
                    )}
                    {entry.kind !== "numberTag" && (
                      <Input
                        className="w-32"
                        value={entry.model}
                        onChange={(e) => onUpdate(entry.id, { model: e.target.value })}
                        placeholder={entry.kind === "text" ? "Text" : entry.kind === "sd" ? "Camera" : "Model"}
                        aria-label={`Label text for ${entry.title}`}
                      />
                    )}
                    {entry.kind !== "text" && (
                      <Input
                        className="w-16"
                        value={entry.number}
                        onChange={(e) => onUpdate(entry.id, { number: e.target.value })}
                        placeholder="No."
                        aria-label={`Number for ${entry.title}`}
                      />
                    )}
                    <Input
                      className="w-16"
                      type="number"
                      min={1}
                      value={entry.copies}
                      onChange={(e) => onUpdate(entry.id, { copies: Math.max(1, Number(e.target.value) || 1) })}
                      aria-label={`Copies of ${entry.title}`}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-10"
                      onClick={() => onRemove(entry.id)}
                      aria-label={`Remove ${entry.title} from print cart`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                );
              })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
