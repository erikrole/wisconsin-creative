"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UnlinkIcon, WalletIcon } from "lucide-react";
import { AssetImage } from "@/components/AssetImage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  BUDGET_CATEGORIES,
  BUDGET_CATEGORY_LABELS,
  BUDGET_LINE_STATUSES,
  BUDGET_STATUS_LABELS,
  parseDollarsToCents,
  fiscalYearLabel,
  fiscalYearOf,
  type BudgetCategoryValue,
  type BudgetLineStatusValue,
} from "@/lib/budget/contract";
import type { LineHistoryEntry } from "@/lib/services/budget";
import { parseErrorMessage, parseJsonSafely, readApiData } from "@/lib/errors";
import { type BudgetListItem, type LineView, type Suggestion, type SearchResult } from "./budget-view-types";

export function HistoryDialog({ line, onClose }: { line: LineView; onClose: () => void }) {
  const history = useQuery<LineHistoryEntry[]>({
    queryKey: ["budget", "history", line.id],
    queryFn: async ({ signal }) => readApiData(await fetch(`/api/budget/lines/${line.id}/history`, { signal }), "Could not load the history"),
  });
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>History</DialogTitle>
          <DialogDescription>{line.description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
          {history.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : history.isError ? (
            <p className="text-sm text-muted-foreground">{history.error.message}</p>
          ) : (history.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            (history.data ?? []).map((entry) => (
              <div key={entry.id} className="border-l-2 border-[#E8E8EC] pl-3">
                <div className="text-[13px] text-muted-foreground">
                  <b className="font-bold text-foreground">{entry.actorName ?? "Someone"}</b> ·{" "}
                  {new Date(entry.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </div>
                <ul className="mt-1 text-sm">
                  {entry.action === "create" ? <li>Added the line</li> : null}
                  {entry.action === "delete" ? <li>Deleted the line</li> : null}
                  {entry.action === "update" && entry.changes.length === 0 ? <li>Edited</li> : null}
                  {entry.action !== "delete" &&
                    entry.changes
                      .filter(() => entry.action === "update")
                      .map((change) => (
                        <li key={change.field}>
                          {change.label}: <span className="text-muted-foreground">{change.from}</span> → <b className="font-bold">{change.to}</b>
                        </li>
                      ))}
                </ul>
              </div>
            ))
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export function LineDialog({
  budgetId,
  line,
  uaCycles,
  onClose,
  onSaved,
}: {
  budgetId: string;
  line: LineView | null;
  uaCycles: { id: string; title: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    description: line?.description ?? "",
    category: line?.category ?? ("EQUIPMENT" as BudgetCategoryValue),
    status: line?.status ?? ("PLANNED" as BudgetLineStatusValue),
    supplier: line?.supplier ?? "",
    unitCost: centsToInput(line?.unitCostCents ?? null),
    quantity: String(line?.quantity ?? 1),
    spent: centsToInput(line?.spentCents ?? null),
    quantityBought: line?.quantityBought === null || line?.quantityBought === undefined ? "" : String(line.quantityBought),
    purchasedOn: line?.purchasedOn ?? "",
    poNumber: line?.poNumber ?? "",
    orderNumber: line?.orderNumber ?? "",
    linkUrl: line?.linkUrl ?? "",
    requesterNote: line?.requesterNote ?? "",
    justification: line?.justification ?? "",
    unplanned: line?.unplanned ?? false,
    recurring: line?.recurring ?? false,
    gearPickCycleId: line?.gearPickCycleId ?? "",
    refund: centsToInput(line?.refundCents ?? null),
  });
  const set = (key: Exclude<keyof typeof form, "unplanned" | "recurring">) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    const unitCostCents = parseDollarsToCents(form.unitCost);
    const quantity = Number(form.quantity);
    const spentCents = form.spent.trim() === "" ? null : parseDollarsToCents(form.spent);
    const refundCents = form.refund.trim() === "" ? null : parseDollarsToCents(form.refund);
    if (form.refund.trim() !== "" && refundCents === null) return void toast.error("Enter the refund in dollars.");
    if (!form.description.trim()) return void toast.error("Add a description.");
    if (unitCostCents === null) return void toast.error("Enter the unit cost in dollars, like 1299.50.");
    if (!Number.isInteger(quantity) || quantity < 1) return void toast.error("Quantity must be a whole number, 1 or more.");
    if (form.spent.trim() !== "" && spentCents === null) return void toast.error("Enter what was spent in dollars.");
    const quantityBought = form.quantityBought.trim() === "" ? null : Number(form.quantityBought);
    if (quantityBought !== null && (!Number.isInteger(quantityBought) || quantityBought < 0)) {
      return void toast.error("Quantity bought must be a whole number.");
    }

    const body = {
      description: form.description,
      category: form.category,
      status: form.status,
      supplier: form.supplier,
      unitCostCents,
      quantity,
      spentCents,
      quantityBought,
      purchasedOn: form.purchasedOn === "" ? null : form.purchasedOn,
      poNumber: form.poNumber,
      orderNumber: form.orderNumber,
      linkUrl: form.linkUrl,
      requesterNote: form.requesterNote,
      justification: form.justification,
      unplanned: form.unplanned,
      recurring: form.recurring,
      gearPickCycleId: form.gearPickCycleId === "" ? null : form.gearPickCycleId,
      refundCents,
    };
    setPending(true);
    try {
      const response = await fetch(line ? `/api/budget/lines/${line.id}` : `/api/budget/${budgetId}/lines`, {
        method: line ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That line wasn't saved. Try again."));
        return;
      }
      toast.success(line ? "Line updated." : "Line added.");
      onSaved();
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{line ? "Edit line" : "Add line"}</DialogTitle>
          <DialogDescription>Planned cost is unit cost times quantity. Add what was spent once it&apos;s bought.</DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Description">
              <Input value={form.description} onChange={(e) => set("description")(e.target.value)} maxLength={200} />
            </Field>
          </div>
          <Field label="Category">
            <NativeSelect value={form.category} onChange={(e) => set("category")(e.target.value)}>
              {BUDGET_CATEGORIES.map((value) => (
                <option key={value} value={value}>{BUDGET_CATEGORY_LABELS[value]}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Status">
            <NativeSelect value={form.status} onChange={(e) => set("status")(e.target.value)}>
              {BUDGET_LINE_STATUSES.map((value) => (
                <option key={value} value={value}>{BUDGET_STATUS_LABELS[value]}</option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Supplier">
            <Input value={form.supplier} onChange={(e) => set("supplier")(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Requested by">
            <Input value={form.requesterNote} onChange={(e) => set("requesterNote")(e.target.value)} maxLength={200} />
          </Field>
          {uaCycles.length > 0 && (
            <div className="sm:col-span-2">
              <Field label="Counts toward UA gear">
                <NativeSelect value={form.gearPickCycleId} onChange={(e) => set("gearPickCycleId")(e.target.value)}>
                  <option value="">No</option>
                  {uaCycles.map((cycle) => (
                    <option key={cycle.id} value={cycle.id}>Adds to the {cycle.title} Under Armour budget</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.unplanned}
              onChange={(e) => setForm((current) => ({ ...current, unplanned: e.target.checked }))}
            />
            Added after the plan was submitted (unplanned)
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.recurring}
              onChange={(e) => setForm((current) => ({ ...current, recurring: e.target.checked }))}
            />
            Repeats every year (offered when you create next year&apos;s budget)
          </label>
          <Field label="Unit cost ($)">
            <Input inputMode="decimal" value={form.unitCost} onChange={(e) => set("unitCost")(e.target.value)} />
          </Field>
          <Field label="Quantity">
            <Input inputMode="numeric" value={form.quantity} onChange={(e) => set("quantity")(e.target.value)} />
          </Field>
          <Field label="Spent ($)">
            <Input inputMode="decimal" value={form.spent} onChange={(e) => set("spent")(e.target.value)} />
          </Field>
          <Field label="Refund or credit ($)">
            <Input inputMode="decimal" value={form.refund} onChange={(e) => set("refund")(e.target.value)} />
          </Field>
          <Field label="Quantity bought">
            <Input inputMode="numeric" value={form.quantityBought} onChange={(e) => set("quantityBought")(e.target.value)} />
          </Field>
          <Field label="Purchased on">
            <Input type="date" value={form.purchasedOn} onChange={(e) => set("purchasedOn")(e.target.value)} />
          </Field>
          <Field label="PO number">
            <Input value={form.poNumber} onChange={(e) => set("poNumber")(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Order number">
            <Input value={form.orderNumber} onChange={(e) => set("orderNumber")(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Product link">
            <Input value={form.linkUrl} onChange={(e) => set("linkUrl")(e.target.value)} maxLength={2000} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Why it's needed">
              <Textarea value={form.justification} onChange={(e) => set("justification")(e.target.value)} maxLength={2000} rows={3} />
            </Field>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={() => void save()} disabled={pending}>{line ? "Save changes" : "Add line"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NewBudgetDialog({
  budgets,
  onClose,
  onCreated,
}: {
  budgets: BudgetListItem[];
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [copyFrom, setCopyFrom] = useState("");
  const [name, setName] = useState("Creative");
  const [fiscalYear, setFiscalYear] = useState("");
  const [allocation, setAllocation] = useState("");
  const [pending, setPending] = useState(false);

  async function create() {
    const allocationCents = allocation.trim() === "" ? null : parseDollarsToCents(allocation);
    if (allocation.trim() !== "" && allocationCents === null) return void toast.error("Enter the allocation in dollars.");
    setPending(true);
    try {
      const response = await fetch("/api/budget", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, fiscalYear, allocationCents, ...(copyFrom ? { copyRecurringFromBudgetId: copyFrom } : {}) }),
      });
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That budget wasn't created. Try again."));
        return;
      }
      const json = await parseJsonSafely<{ data?: { id: string } }>(response);
      toast.success("Budget created.");
      if (json?.data) onCreated(json.data.id);
      else onClose();
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            <WalletIcon className="mr-2 inline size-4" />
            New budget
          </DialogTitle>
          <DialogDescription>One budget per fiscal year, like Creative 2026-27 or Football 2026-27.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Fiscal year">
            <Input placeholder={fiscalYearOf(new Date())} value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} maxLength={7} />
            <p className="text-xs text-muted-foreground">{fiscalYearLabel(fiscalYear) !== fiscalYear ? fiscalYearLabel(fiscalYear) : "Fiscal years start July 1, so 2025-26 is Jul 2025 to Jun 2026."}</p>
          </Field>
          <Field label="Overall allocation ($, optional)">
            <Input inputMode="decimal" value={allocation} onChange={(e) => setAllocation(e.target.value)} />
          </Field>
          {budgets.length > 0 && (
            <Field label="Copy yearly lines from (optional)">
              <NativeSelect value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">Don&apos;t copy</option>
                {budgets.map((budget) => (
                  <option key={budget.id} value={budget.id}>{budget.name} · {fiscalYearLabel(budget.fiscalYear)}</option>
                ))}
              </NativeSelect>
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button type="button" onClick={() => void create()} disabled={pending}>Create budget</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const CONFIDENCE_VARIANT: Record<Suggestion["confidence"], "green" | "blue" | "gray"> = {
  high: "green",
  likely: "blue",
  possible: "gray",
};

export function LinksDialog({ line, onClose, onChanged }: { line: LineView; onClose: () => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const linkedKeys = new Set(line.links.map((link) => `${link.kind}:${link.targetId}`));

  const suggestions = useQuery<Suggestion[]>({
    queryKey: ["budget", "suggestions", line.id, line.links.length],
    queryFn: async ({ signal }) =>
      readApiData(await fetch(`/api/budget/lines/${line.id}/suggestions`, { signal }), "Could not load suggestions"),
  });
  const results = useQuery<SearchResult[]>({
    queryKey: ["budget", "item-search", search],
    enabled: search.trim().length >= 2,
    queryFn: async ({ signal }) =>
      readApiData(await fetch(`/api/budget/item-search?q=${encodeURIComponent(search.trim())}`, { signal }), "Search failed"),
  });

  async function link(target: { kind: "asset" | "bulk"; targetId: string; quantity?: number }) {
    const key = `${target.kind}:${target.targetId}`;
    setPendingKey(key);
    try {
      const response = await fetch(`/api/budget/lines/${line.id}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          target.kind === "asset"
            ? { assetId: target.targetId }
            : { bulkSkuId: target.targetId, quantity: target.quantity },
        ),
      });
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That link wasn't saved. Try again."));
        return;
      }
      toast.success("Linked.");
      await queryClient.invalidateQueries({ queryKey: ["budget", "suggestions", line.id] });
      onChanged();
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setPendingKey(null);
    }
  }

  async function unlink(linkId: string) {
    setPendingKey(linkId);
    try {
      const response = await fetch(`/api/budget/links/${linkId}`, { method: "DELETE" });
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That link wasn't removed. Try again."));
        return;
      }
      toast.success("Link removed.");
      onChanged();
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setPendingKey(null);
    }
  }

  const visibleSuggestions = (suggestions.data ?? []).filter((item) => !linkedKeys.has(`${item.kind}:${item.targetId}`));
  const visibleResults = (results.data ?? []).filter((item) => !linkedKeys.has(`${item.kind}:${item.targetId}`));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Items from this purchase</DialogTitle>
          <DialogDescription>
            {line.description}
            {line.poNumber ? ` · ${line.poNumber}` : ""}. Link the inventory this line bought.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Linked ({line.links.length})</h3>
            {line.links.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing linked yet.</p>
            ) : (
              line.links.map((item) => (
                <div key={item.id} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                  <AssetImage src={item.imageUrl} alt={item.label} size={40} />
                  <a className="min-w-0 flex-1 truncate font-medium hover:underline" href={item.href}>
                    {item.label}
                    {item.detail ? <span className="ml-2 text-xs text-muted-foreground">{item.detail}</span> : null}
                  </a>
                  {item.kind === "bulk" && <span className="text-xs text-muted-foreground">× {item.quantity}</span>}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Unlink ${item.label}`}
                    disabled={pendingKey === item.id}
                    onClick={() => void unlink(item.id)}
                  >
                    <UnlinkIcon />
                  </Button>
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Suggested</h3>
            {suggestions.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : visibleSuggestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No close matches yet. Matches use price, purchase date, PO or order number in item notes, and shared words.
              </p>
            ) : (
              visibleSuggestions.map((item) => (
                <div key={`${item.kind}:${item.targetId}`} className="flex items-start gap-3 rounded-md border px-3 py-2 text-sm">
                  <AssetImage src={item.imageUrl} alt={item.label} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{item.label}</span>
                      <Badge variant={CONFIDENCE_VARIANT[item.confidence]}>{item.confidence}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {[item.detail, ...item.reasons].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button
                    type="button"
                    disabled={pendingKey === `${item.kind}:${item.targetId}`}
                    onClick={() => void link({ kind: item.kind, targetId: item.targetId, quantity: item.suggestedQuantity })}
                  >
                    Link
                  </Button>
                </div>
              ))
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Find an item</h3>
            <Input
              placeholder="Search by tag, name, brand, model, or serial"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              maxLength={80}
            />
            {visibleResults.map((item) => (
              <div key={`${item.kind}:${item.targetId}`} className="flex items-center gap-3 rounded-md border px-3 py-2 text-sm">
                <AssetImage src={item.imageUrl} alt={item.label} size={40} />
                <span className="min-w-0 flex-1 truncate">
                  {item.label}
                  {item.detail ? <span className="ml-2 text-xs text-muted-foreground">{item.detail}</span> : null}
                </span>
                <Button
                  type="button"
                  disabled={pendingKey === `${item.kind}:${item.targetId}`}
                  onClick={() => void link({ kind: item.kind, targetId: item.targetId, quantity: line.quantityBought ?? line.quantity })}
                >
                  Link
                </Button>
              </div>
            ))}
          </section>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
