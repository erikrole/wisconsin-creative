"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2Icon } from "lucide-react";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GEAR_CATALOG } from "@/lib/gear-picks/catalog";
import { buildOrderPlan } from "@/lib/gear-picks/order";
import { orderPhase, receivingRows, type OrderPhase, type ReceivingRow } from "@/lib/gear-picks/receiving";
import type { GearPickAdminParticipant, GearPickAdminStudent, GearPickOrderDto, GearPickReceiptDto } from "@/lib/gear-picks/types";

type Change =
  | { action: "setOrder"; placedAt: string | null; poNumber: string | null; orderNumber: string | null; expectedAt: string | null }
  | { action: "addReceipt"; sku: string; size: string | null; quantity: number; receivedAt: string; note?: string | null }
  | { action: "removeReceipt"; receiptId: string };

type Props = {
  participants: GearPickAdminParticipant[];
  students: GearPickAdminStudent[];
  order: GearPickOrderDto;
  receipts: GearPickReceiptDto[];
  pending: boolean;
  onApply: (change: Change, success: string) => Promise<boolean>;
};

const CARD = "overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-card";
const HEAD = "text-[11px] font-bold uppercase tracking-[0.09em] text-[#6B6F7A] dark:text-muted-foreground";
const ROW = "grid grid-cols-[minmax(180px,1.6fr)_64px_72px_72px_72px_minmax(150px,1fr)] items-center gap-3 border-b border-[#F0F1F3] px-5 py-3 text-sm last:border-b-0 dark:border-white/10";

const PHASES: { key: OrderPhase; label: string }[] = [
  { key: "PLANNING", label: "Planning" },
  { key: "ORDERED", label: "Ordered" },
  { key: "RECEIVING", label: "Receiving" },
  { key: "RECEIVED", label: "Received" },
];

/** A date input holds a local day; store it at local noon so the day survives time zones. */
const dayToIso = (day: string) => (day ? new Date(`${day}T12:00:00`).toISOString() : null);
const isoToDay = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const todayIso = () => new Date(`${isoToDay(new Date().toISOString())}T12:00:00`).toISOString();
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** The order record (EQ places the order, the site records it) and receiving against the plan. */
export function OrderTracking({ participants, students, order, receipts, pending, onApply }: Props) {
  const plan = useMemo(() => buildOrderPlan(participants, GEAR_CATALOG.kits, students), [participants, students]);
  const rows = useMemo(() => receivingRows(plan, receipts), [plan, receipts]);
  const phase = orderPhase(order, rows);
  const orderedPieces = rows.reduce((sum, row) => sum + row.ordered, 0);
  const receivedPieces = rows.reduce((sum, row) => sum + row.received, 0);

  return (
    <section aria-labelledby="gear-admin-tracking" className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="gear-admin-tracking" className="text-[22px] font-extrabold tracking-[-0.03em]">Order and receiving</h2>
        <ol className="flex gap-1" aria-label="Order phase">
          {PHASES.map((item) => (
            <li
              key={item.key}
              aria-current={item.key === phase ? "step" : undefined}
              className={`rounded-lg px-2.5 py-1 text-xs font-bold ${item.key === phase ? "bg-[#3E63DD] text-white" : "bg-[#F0F1F3] text-[#60646C] dark:bg-white/10 dark:text-muted-foreground"}`}
            >
              {item.label}
            </li>
          ))}
        </ol>
      </div>
      <OrderRecord order={order} pending={pending} onApply={onApply} />
      <ReceivingTable rows={rows} receipts={receipts} orderedPieces={orderedPieces} receivedPieces={receivedPieces} pending={pending} onApply={onApply} />
    </section>
  );
}

function OrderRecord({ order, pending, onApply }: Pick<Props, "order" | "pending" | "onApply">) {
  const [poNumber, setPoNumber] = useState(order.poNumber ?? "");
  const [orderNumber, setOrderNumber] = useState(order.orderNumber ?? "");
  const [placed, setPlaced] = useState(isoToDay(order.placedAt));
  const [expected, setExpected] = useState(isoToDay(order.expectedAt));
  useEffect(() => {
    setPoNumber(order.poNumber ?? "");
    setOrderNumber(order.orderNumber ?? "");
    setPlaced(isoToDay(order.placedAt));
    setExpected(isoToDay(order.expectedAt));
  }, [order]);
  const changed =
    poNumber.trim() !== (order.poNumber ?? "") ||
    orderNumber.trim() !== (order.orderNumber ?? "") ||
    placed !== isoToDay(order.placedAt) ||
    expected !== isoToDay(order.expectedAt);

  return (
    <div className={`${CARD} mb-3 p-5`}>
      <p className="mb-3 text-sm text-[#60646C] dark:text-muted-foreground">
        The Equipment department places the order, usually in October, and gear arrives months later. Record it here so everyone can see where it stands.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="PO number" id="gear-po">
          <Input id="gear-po" className="min-h-10" value={poNumber} maxLength={60} onChange={(event) => setPoNumber(event.target.value)} />
        </Field>
        <Field label="Order number" id="gear-order-number">
          <Input id="gear-order-number" className="min-h-10" value={orderNumber} maxLength={60} onChange={(event) => setOrderNumber(event.target.value)} />
        </Field>
        <Field label="Order placed" id="gear-placed">
          <Input id="gear-placed" type="date" className="min-h-10" value={placed} onChange={(event) => setPlaced(event.target.value)} />
        </Field>
        <Field label="Expected arrival" id="gear-expected">
          <Input id="gear-expected" type="date" className="min-h-10" value={expected} onChange={(event) => setExpected(event.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex justify-end">
        <Button
          className="min-h-10"
          disabled={pending || !changed}
          onClick={() =>
            void onApply(
              { action: "setOrder", placedAt: dayToIso(placed), poNumber: poNumber.trim() || null, orderNumber: orderNumber.trim() || null, expectedAt: dayToIso(expected) },
              "Order details saved.",
            )
          }
        >
          Save order details
        </Button>
      </div>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-bold text-[#60646C] dark:text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function ReceivingTable({
  rows,
  receipts,
  orderedPieces,
  receivedPieces,
  pending,
  onApply,
}: Pick<Props, "receipts" | "pending" | "onApply"> & { rows: ReceivingRow[]; orderedPieces: number; receivedPieces: number }) {
  const confirm = useConfirm();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | "left">("all");
  const [query, setQuery] = useState("");
  const keyOf = (row: ReceivingRow) => `${row.sku}|${row.size ?? ""}`;
  const leftCount = rows.filter((row) => row.outstanding > 0).length;
  const needle = query.trim().toLowerCase();
  const shown = rows.filter(
    (row) => (filter === "all" || row.outstanding > 0) && (!needle || `${row.itemName} ${row.colorLabel} ${row.size ?? ""}`.toLowerCase().includes(needle)),
  );
  const nameFor = (sku: string) => rows.find((row) => row.sku === sku)?.itemName ?? sku;

  return (
    <>
      <div className="mb-2 mt-5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-extrabold tracking-[-0.02em]">Receiving</h3>
        <span className="text-sm text-[#60646C] dark:text-muted-foreground">{receivedPieces} of {orderedPieces} pieces received</span>
      </div>
      {rows.length > 0 && (
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Input
            type="search"
            aria-label="Search items to receive"
            placeholder="Search items or sizes"
            className="min-h-10 sm:max-w-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex gap-0.5 rounded-[10px] bg-[#F0F1F3] p-[3px] dark:bg-white/10" role="group" aria-label="Filter items">
            {([["all", `All ${rows.length}`], ["left", `Still to arrive ${leftCount}`]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={`rounded-lg px-3 py-1.5 text-[13px] font-bold ${filter === key ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-card" : "text-[#60646C] dark:text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <div className={`${CARD} px-5 py-8 text-center text-sm text-[#60646C] dark:text-muted-foreground`}>Nothing to receive yet.</div>
      ) : (
        <div className={`${CARD} overflow-x-auto`}>
          <div className="min-w-[760px]">
            <div className={`${ROW} bg-[#FAFAFB] dark:bg-white/5`}>
              <span className={HEAD}>Item</span>
              <span className={HEAD}>Size</span>
              <span className={`${HEAD} text-right`}>Ordered</span>
              <span className={`${HEAD} text-right`}>Received</span>
              <span className={`${HEAD} text-right`}>Left</span>
              <span className={HEAD}>Check in</span>
            </div>
            {shown.length === 0 && (
              <div className="px-5 py-6 text-center text-sm text-[#60646C] dark:text-muted-foreground">
                {needle ? "No items match that search." : "Everything has arrived."}
              </div>
            )}
            {shown.map((row) => {
              const key = keyOf(row);
              const draft = drafts[key] ?? "";
              const quantity = Number.parseInt(draft, 10);
              const valid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 500;
              return (
                <div key={key} className={ROW}>
                  <span>
                    <span className="font-bold">{row.itemName}</span>
                    {row.colorLabel && <span className="ml-2 text-xs text-[#8B8D98]">{row.colorLabel}</span>}
                    {row.ordered === 0 && <span className="ml-2 text-xs font-bold text-[#AB6400]">Not on order</span>}
                  </span>
                  <span className="font-mono text-[13px]">{row.size ?? "—"}</span>
                  <span className="text-right font-mono">{row.ordered}</span>
                  <span className="text-right font-mono">{row.received}</span>
                  <span className={`text-right font-mono ${row.outstanding < 0 ? "text-[#AB6400]" : row.outstanding === 0 ? "text-[#218358]" : ""}`}>
                    {row.outstanding < 0 ? `+${-row.outstanding}` : row.outstanding === 0 ? "Done" : row.outstanding}
                  </span>
                  <span className="flex gap-1.5">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={500}
                      aria-label={`Quantity received for ${row.itemName} ${row.size ?? ""}`}
                      className="min-h-10 w-20"
                      value={draft}
                      onChange={(event) => setDrafts((current) => ({ ...current, [key]: event.target.value }))}
                    />
                    <Button
                      className="min-h-10"
                      variant="outline"
                      disabled={pending || !valid}
                      onClick={async () => {
                        const ok = await onApply(
                          { action: "addReceipt", sku: row.sku, size: row.size, quantity, receivedAt: todayIso() },
                          `${quantity} × ${row.itemName} ${row.size ?? ""} checked in.`,
                        );
                        if (ok) setDrafts((current) => ({ ...current, [key]: "" }));
                      }}
                    >
                      Receive
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {receipts.length > 0 && (
        <div className="mt-3">
          <h3 className="mb-2 text-sm font-bold">Check-ins</h3>
          <ul className={`${CARD} divide-y divide-[#F0F1F3] dark:divide-white/10`}>
            {receipts.slice(0, 10).map((receipt) => (
              <li key={receipt.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <span>
                  <span className="font-bold">{receipt.quantity} × {nameFor(receipt.sku)}</span>
                  <span className="ml-2 font-mono text-xs text-[#60646C] dark:text-muted-foreground">{receipt.size ?? ""}</span>
                  <span className="ml-2 text-xs text-[#8B8D98]">{shortDate(receipt.receivedAt)}{receipt.receivedBy ? ` · ${receipt.receivedBy}` : ""}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-9"
                  disabled={pending}
                  aria-label={`Remove check-in of ${receipt.quantity} ${nameFor(receipt.sku)}`}
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Remove this check-in?",
                      message: "The pieces go back to outstanding. The change is recorded in the audit log.",
                      confirmLabel: "Remove",
                      variant: "danger",
                    });
                    if (ok) await onApply({ action: "removeReceipt", receiptId: receipt.id }, "Check-in removed.");
                  }}
                >
                  <Trash2Icon className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
          {receipts.length > 10 && <p className="mt-1 text-xs text-[#8B8D98]">Showing the latest 10 of {receipts.length}.</p>}
        </div>
      )}
    </>
  );
}
