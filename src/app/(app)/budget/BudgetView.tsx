"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ExternalLinkIcon, LinkIcon, PencilIcon, PlusIcon, Trash2Icon, UnlinkIcon, WalletIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmDialog";
import { OperationalMetricCard } from "@/components/OperationalFeedback";
import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  BUDGET_CATEGORIES,
  BUDGET_CATEGORY_LABELS,
  BUDGET_LINE_STATUSES,
  BUDGET_STATUS_LABELS,
  formatCents,
  parseDollarsToCents,
  plannedCents,
  type BudgetCategoryValue,
  type BudgetLineStatusValue,
  type BudgetSummary,
} from "@/lib/budget/contract";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";

type BudgetListItem = { id: string; name: string; fiscalYear: string; allocationCents: number | null; lineCount: number };
type LineView = {
  id: string;
  category: BudgetCategoryValue;
  status: BudgetLineStatusValue;
  description: string;
  supplier: string | null;
  unitCostCents: number;
  quantity: number;
  quantityBought: number | null;
  spentCents: number | null;
  purchasedOn: string | null;
  orderNumber: string | null;
  poNumber: string | null;
  linkUrl: string | null;
  justification: string | null;
  requesterUserId: string | null;
  requesterName: string | null;
  requesterNote: string | null;
  links: LinkView[];
};
type LinkView = {
  id: string;
  quantity: number;
  kind: "asset" | "bulk";
  targetId: string;
  label: string;
  detail: string | null;
  href: string;
};
type Suggestion = {
  kind: "asset" | "bulk";
  targetId: string;
  label: string;
  detail: string | null;
  href: string;
  suggestedQuantity: number;
  score: number;
  confidence: "high" | "likely" | "possible";
  reasons: string[];
};
type SearchResult = { kind: "asset" | "bulk"; targetId: string; label: string; detail: string | null };
type Detail = {
  budget: { id: string; name: string; fiscalYear: string; allocationCents: number | null; notes: string | null };
  lines: LineView[];
  summary: BudgetSummary;
};

const LIST_KEY = ["budget", "list"] as const;
const detailKey = (id: string) => ["budget", "detail", id] as const;

const STATUS_VARIANT: Record<BudgetLineStatusValue, "gray" | "blue" | "green" | "red"> = {
  PLANNED: "gray",
  ORDERED: "blue",
  PURCHASED: "green",
  CANCELLED: "red",
};

async function readJson<T>(response: Response, fallback: string): Promise<T> {
  if (handleAuthRedirect(response, "/budget")) throw new Error("Signing in again");
  if (!response.ok) throw new Error(await parseErrorMessage(response, fallback));
  const json = await parseJsonSafely<{ data?: T }>(response);
  if (!json?.data) throw new Error(fallback);
  return json.data;
}

/** Units still unlinked on a bought line: what was bought minus the units already tied to items. */
export function unlinkedUnits(line: Pick<LineView, "status" | "quantity" | "quantityBought" | "links">): number {
  if (line.status !== "PURCHASED") return 0;
  const linked = line.links.reduce((sum, link) => sum + link.quantity, 0);
  return Math.max(0, (line.quantityBought ?? line.quantity) - linked);
}

export function BudgetView({ initialBudgetId = null, focusLineId = null }: { initialBudgetId?: string | null; focusLineId?: string | null }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lineDialog, setLineDialog] = useState<{ line: LineView | null } | null>(null);
  const [budgetDialog, setBudgetDialog] = useState(false);
  const [linksFor, setLinksFor] = useState<string | null>(null);

  const list = useQuery<BudgetListItem[]>({
    queryKey: LIST_KEY,
    queryFn: async ({ signal }) => readJson(await fetch("/api/budget", { signal }), "Could not load budgets"),
  });
  const activeId = selectedId ?? initialBudgetId ?? list.data?.[0]?.id ?? null;
  const detail = useQuery<Detail>({
    queryKey: detailKey(activeId ?? ""),
    enabled: activeId !== null,
    queryFn: async ({ signal }) =>
      readJson(await fetch(`/api/budget/${activeId}`, { signal }), "Could not load this budget"),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["budget"] });

  return (
    <>
      <PageHeader title="Budget" description="Planned and actual spend by fiscal year. Admins only.">
        {list.data && list.data.length > 0 && (
          <NativeSelect
            aria-label="Budget"
            className="w-auto min-w-48"
            value={activeId ?? ""}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {list.data.map((budget) => (
              <option key={budget.id} value={budget.id}>
                {budget.name} {budget.fiscalYear}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button type="button" variant="outline" onClick={() => setBudgetDialog(true)}>
          <PlusIcon data-icon="inline-start" />
          New budget
        </Button>
        {activeId && (
          <Button type="button" onClick={() => setLineDialog({ line: null })}>
            <PlusIcon data-icon="inline-start" />
            Add line
          </Button>
        )}
      </PageHeader>

      {list.isLoading || (activeId !== null && detail.isLoading) ? (
        <Skeleton className="h-64 w-full" />
      ) : list.isError || detail.isError ? (
        <EmptyState
          icon="wifi-off"
          title="Couldn't load the budget"
          description={(list.error ?? detail.error)?.message}
          actionLabel="Try again"
          onAction={() => void refresh()}
        />
      ) : !activeId || !detail.data ? (
        <EmptyState
          icon="folder"
          title="No budgets yet"
          description="Create one for a fiscal year, like Creative 2026-27, then add its lines."
          actionLabel="New budget"
          onAction={() => setBudgetDialog(true)}
        />
      ) : (
        <BudgetBody
          detail={detail.data}
          focusLineId={focusLineId}
          onEdit={(line) => setLineDialog({ line })}
          onLinks={(line) => setLinksFor(line.id)}
          onChanged={() => void refresh()}
        />
      )}

      {lineDialog && activeId && (
        <LineDialog
          budgetId={activeId}
          line={lineDialog.line}
          onClose={() => setLineDialog(null)}
          onSaved={() => {
            setLineDialog(null);
            void refresh();
          }}
        />
      )}
      {linksFor && detail.data && detail.data.lines.some((line) => line.id === linksFor) && (
        <LinksDialog
          line={detail.data.lines.find((line) => line.id === linksFor)!}
          onClose={() => setLinksFor(null)}
          onChanged={() => void refresh()}
        />
      )}
      {budgetDialog && (
        <NewBudgetDialog
          onClose={() => setBudgetDialog(false)}
          onCreated={(id) => {
            setBudgetDialog(false);
            setSelectedId(id);
            void refresh();
          }}
        />
      )}
    </>
  );
}

function BudgetBody({
  detail,
  focusLineId,
  onEdit,
  onLinks,
  onChanged,
}: {
  detail: Detail;
  focusLineId: string | null;
  onEdit: (line: LineView) => void;
  onLinks: (line: LineView) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const { summary, lines, budget } = detail;
  const cap = summary.allocationCents ?? summary.plannedCents;
  const over = summary.remainingCents < 0;
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const needItems = lines.filter((line) => unlinkedUnits(line) > 0);
  const shown = onlyUnlinked ? needItems : lines;

  useEffect(() => {
    if (!focusLineId) return;
    document.getElementById(`line-${focusLineId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusLineId, lines.length]);

  async function removeLine(line: LineView) {
    const ok = await confirm({
      title: "Delete this line?",
      message: `"${line.description}" will be removed from the budget. This is recorded in the audit log.`,
      confirmLabel: "Delete line",
      variant: "danger",
    });
    if (!ok) return;
    try {
      const response = await fetch(`/api/budget/lines/${line.id}`, { method: "DELETE" });
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That line wasn't deleted. Try again."));
        return;
      }
      toast.success("Line deleted.");
      onChanged();
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OperationalMetricCard
          label={summary.allocationCents === null ? "Planned" : "Allocation"}
          value={formatCents(cap)}
          helper={summary.allocationCents === null ? "No overall cap set" : `${formatCents(summary.plannedCents)} planned`}
        />
        <OperationalMetricCard label="Spent" value={formatCents(summary.spentCents)} tone="blue" />
        <OperationalMetricCard
          label="Still to spend"
          value={formatCents(summary.outstandingCents)}
          helper={`${summary.counts.PLANNED + summary.counts.ORDERED} lines open`}
        />
        <OperationalMetricCard
          label={over ? "Over by" : "Remaining"}
          value={formatCents(Math.abs(summary.remainingCents))}
          tone={over ? "red" : "green"}
          helper={`Forecast ${formatCents(summary.forecastCents)}`}
        />
      </div>

      {summary.byCategory.length > 0 && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-4">
            <h2 className="text-sm font-semibold">By category</h2>
            {summary.byCategory.map((row) => {
              const pct = row.plannedCents > 0 ? Math.round((row.spentCents / row.plannedCents) * 100) : 0;
              return (
                <div key={row.category} className="grid grid-cols-[minmax(0,12rem)_1fr_auto] items-center gap-3 text-sm">
                  <span className="truncate">{BUDGET_CATEGORY_LABELS[row.category]}</span>
                  <Progress value={pct} aria-label={`${BUDGET_CATEGORY_LABELS[row.category]} spent`} />
                  <span className="tabular-nums text-muted-foreground">
                    {formatCents(row.spentCents)} of {formatCents(row.plannedCents)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {needItems.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <span>
              {needItems.length} bought {needItems.length === 1 ? "line has" : "lines have"} units not linked to an item yet.
              Linking lets each item show its order, serial number, and fiscal year.
            </span>
            <Button type="button" variant="outline" onClick={() => setOnlyUnlinked((value) => !value)}>
              {onlyUnlinked ? "Show all lines" : "Show only these"}
            </Button>
          </CardContent>
        </Card>
      )}

      {lines.length === 0 ? (
        <EmptyState icon="clipboard" title="No lines yet" description={`Add the first planned expense for ${budget.name} ${budget.fiscalYear}.`} />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Planned</TableHead>
                  <TableHead className="text-right">Spent</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((line) => (
                  <TableRow
                    key={line.id}
                    id={`line-${line.id}`}
                    data-state={line.id === focusLineId ? "selected" : undefined}
                    className={line.status === "CANCELLED" ? "opacity-60" : undefined}
                  >
                    <TableCell className="max-w-80">
                      <div className="flex items-center gap-1.5 font-medium">
                        <span className="truncate">{line.description}</span>
                        {line.linkUrl && (
                          <a href={line.linkUrl} target="_blank" rel="noreferrer noopener" aria-label="Open product link">
                            <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
                          </a>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {[line.supplier, line.requesterName ?? line.requesterNote].filter(Boolean).join(" · ")}
                      </p>
                    </TableCell>
                    <TableCell>{BUDGET_CATEGORY_LABELS[line.category]}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[line.status]}>{BUDGET_STATUS_LABELS[line.status]}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCents(plannedCents(line))}
                      {line.quantity > 1 && (
                        <span className="block text-xs text-muted-foreground">
                          {line.quantity} × {formatCents(line.unitCostCents)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {line.spentCents === null ? "—" : formatCents(line.spentCents)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{line.poNumber ?? "—"}</TableCell>
                    <TableCell>
                      <Button type="button" variant="ghost" onClick={() => onLinks(line)}>
                        <LinkIcon />
                        {line.links.length === 0 ? "Link" : `${line.links.length} linked`}
                      </Button>
                      {unlinkedUnits(line) > 0 && (
                        <span className="block text-xs text-amber-600 dark:text-amber-400">
                          {unlinkedUnits(line)} not linked
                        </span>
                      )}
                      {line.links.some((link) => link.detail) && (
                        <span className="block max-w-56 truncate text-xs text-muted-foreground">
                          {line.links.map((link) => link.detail).filter(Boolean).join(", ")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit line" onClick={() => onEdit(line)}>
                          <PencilIcon />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete line" onClick={() => void removeLine(line)}>
                          <Trash2Icon />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
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

function LineDialog({
  budgetId,
  line,
  onClose,
  onSaved,
}: {
  budgetId: string;
  line: LineView | null;
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
  });
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    const unitCostCents = parseDollarsToCents(form.unitCost);
    const quantity = Number(form.quantity);
    const spentCents = form.spent.trim() === "" ? null : parseDollarsToCents(form.spent);
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
          <Field label="Unit cost ($)">
            <Input inputMode="decimal" value={form.unitCost} onChange={(e) => set("unitCost")(e.target.value)} />
          </Field>
          <Field label="Quantity">
            <Input inputMode="numeric" value={form.quantity} onChange={(e) => set("quantity")(e.target.value)} />
          </Field>
          <Field label="Spent ($)">
            <Input inputMode="decimal" value={form.spent} onChange={(e) => set("spent")(e.target.value)} />
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

function NewBudgetDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
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
        body: JSON.stringify({ name, fiscalYear, allocationCents }),
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
          <DialogDescription>One budget per pot of money and fiscal year, like Creative 2026-27 or Football 2026-27.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Fiscal year">
            <Input placeholder="2026-27" value={fiscalYear} onChange={(e) => setFiscalYear(e.target.value)} maxLength={7} />
          </Field>
          <Field label="Overall allocation ($, optional)">
            <Input inputMode="decimal" value={allocation} onChange={(e) => setAllocation(e.target.value)} />
          </Field>
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

function LinksDialog({ line, onClose, onChanged }: { line: LineView; onClose: () => void; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const linkedKeys = new Set(line.links.map((link) => `${link.kind}:${link.targetId}`));

  const suggestions = useQuery<Suggestion[]>({
    queryKey: ["budget", "suggestions", line.id, line.links.length],
    queryFn: async ({ signal }) =>
      readJson(await fetch(`/api/budget/lines/${line.id}/suggestions`, { signal }), "Could not load suggestions"),
  });
  const results = useQuery<SearchResult[]>({
    queryKey: ["budget", "item-search", search],
    enabled: search.trim().length >= 2,
    queryFn: async ({ signal }) =>
      readJson(await fetch(`/api/budget/item-search?q=${encodeURIComponent(search.trim())}`, { signal }), "Search failed"),
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
                <div key={item.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
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
                <div key={`${item.kind}:${item.targetId}`} className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
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
              <div key={`${item.kind}:${item.targetId}`} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
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
