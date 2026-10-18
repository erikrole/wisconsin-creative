"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClockIcon, ExternalLinkIcon, LinkIcon, PencilIcon, PlusIcon, Trash2Icon, UnlinkIcon, WalletIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmDialog";
import { PageHeader } from "@/components/PageHeader";
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
  formatCentsCompact,
  parseDollarsToCents,
  fiscalYearLabel,
  fiscalYearOf,
  netSpentCents,
  plannedCents,
  varianceCents,
  type BudgetCategoryValue,
  type BudgetLineStatusValue,
  type BudgetSummary,
} from "@/lib/budget/contract";
import type { LineHistoryEntry } from "@/lib/services/budget";
import { LINE_SORT_LABELS, LINE_SORTS, filterAndSortLines, type LineSort } from "@/lib/budget/table";
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
  unplanned: boolean;
  refundCents: number | null;
  recurring: boolean;
  links: LinkView[];
};
type LinkView = {
  id: string;
  quantity: number;
  kind: "asset" | "bulk";
  targetId: string;
  label: string;
  imageUrl: string | null;
  detail: string | null;
  href: string;
};
type Suggestion = {
  kind: "asset" | "bulk";
  targetId: string;
  label: string;
  imageUrl: string | null;
  detail: string | null;
  href: string;
  suggestedQuantity: number;
  score: number;
  confidence: "high" | "likely" | "possible";
  reasons: string[];
};
type SearchResult = { kind: "asset" | "bulk"; targetId: string; label: string; imageUrl: string | null; detail: string | null };
type Detail = {
  budget: { id: string; name: string; fiscalYear: string; allocationCents: number | null; notes: string | null };
  lines: LineView[];
  summary: BudgetSummary;
};

const LIST_KEY = ["budget", "list"] as const;
const detailKey = (id: string) => ["budget", "detail", id] as const;

const GRID =
  "grid grid-cols-[20px_minmax(200px,1fr)_92px_40px_78px_88px_96px_78px_72px_112px_104px_116px] items-center gap-3 px-5";
const MONO = "font-mono text-xs";
const CATEGORY_COLORS = ["#3E63DD", "#8E4EC6", "#12A594", "#E5484D", "#F76B15", "#0090FF"];

const PILL_STYLES: Record<BudgetLineStatusValue, string> = {
  PLANNED: "bg-muted text-muted-foreground",
  ORDERED: "bg-[#EEF2FF] text-[#3E63DD] dark:bg-[#3E63DD]/20",
  PURCHASED: "bg-[#E6F6EB] text-[#18794E] dark:bg-emerald-500/15 dark:text-emerald-300",
  CANCELLED: "bg-muted text-muted-foreground",
};

function StatusPill({ status }: { status: BudgetLineStatusValue }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${PILL_STYLES[status]}`}>
      {BUDGET_STATUS_LABELS[status]}
    </span>
  );
}

const STAT_TONES = {
  default: "",
  accent: "text-[#3E63DD]",
  amber: "text-[#AB6400] dark:text-amber-400",
  green: "text-[#218358] dark:text-emerald-400",
  red: "text-[#C62A2F] dark:text-red-400",
} as const;

function StatCard({ label, value, tone = "default", helper }: { label: string; value: string; tone?: keyof typeof STAT_TONES; helper?: string }) {
  return (
    <div className="rounded-2xl border bg-card px-5 py-[18px]">
      <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">{label}</div>
      <div className={`mt-1.5 text-[32px] font-black leading-[1.05] tracking-[-0.04em] tabular-nums ${STAT_TONES[tone]}`}>{value}</div>
      {helper && <div className="mt-1 text-xs text-muted-foreground">{helper}</div>}
    </div>
  );
}

/** "May 28" from a YYYY-MM-DD date, without a timezone shift. */
function formatShortDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

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
  const [historyFor, setHistoryFor] = useState<LineView | null>(null);

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
                {budget.name} · {fiscalYearLabel(budget.fiscalYear)}
              </option>
            ))}
          </NativeSelect>
        )}
        <Button type="button" variant="outline" onClick={() => setBudgetDialog(true)}>
          <PlusIcon data-icon="inline-start" />
          New budget
        </Button>
        {activeId && (
          <Button type="button" className="bg-[#3E63DD] text-white hover:bg-[#3452B8]" onClick={() => setLineDialog({ line: null })}>
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
          onHistory={(line) => setHistoryFor(line)}
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
      {historyFor && <HistoryDialog line={historyFor} onClose={() => setHistoryFor(null)} />}
      {budgetDialog && (
        <NewBudgetDialog
          budgets={list.data ?? []}
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
  onHistory,
  onChanged,
}: {
  detail: Detail;
  focusLineId: string | null;
  onEdit: (line: LineView) => void;
  onLinks: (line: LineView) => void;
  onHistory: (line: LineView) => void;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const { summary, lines, budget } = detail;
  const cap = summary.allocationCents ?? summary.plannedCents;
  const over = summary.remainingCents < 0;
  const [onlyUnlinked, setOnlyUnlinked] = useState(false);
  const needItems = lines.filter((line) => unlinkedUnits(line) > 0);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<BudgetLineStatusValue | "ALL">("ALL");
  const [sort, setSort] = useState<LineSort>("entered");
  const shown = filterAndSortLines(onlyUnlinked ? needItems : lines, { query, status: statusFilter, sort });

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

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const toggleSelected = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectedLines = lines.filter((line) => selected.has(line.id));
  const allShownSelected = shown.length > 0 && shown.every((line) => selected.has(line.id));

  // "/" jumps to search, like most tools with a big table.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      event.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function bulk(body: { status?: BudgetLineStatusValue; category?: BudgetCategoryValue }, ids: string[]) {
    const response = await fetch(`/api/budget/${budget.id}/lines/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lineIds: ids, ...body }),
    });
    if (!response.ok) throw new Error(await parseErrorMessage(response, "That didn't save. Try again."));
    const json = await parseJsonSafely<{ data?: { previous: { id: string; status: BudgetLineStatusValue; category: BudgetCategoryValue }[] } }>(response);
    return json?.data?.previous ?? [];
  }

  /** Drop lines (their planned money returns to the budget) with a toast that puts them back. */
  async function dropSelected() {
    const targets = selectedLines.filter((line) => line.status !== "CANCELLED");
    if (targets.length === 0) return void toast.error("Those lines are already dropped.");
    const freed = targets.reduce((sum, line) => sum + (line.unplanned ? 0 : plannedCents(line)), 0);
    try {
      const previous = await bulk({ status: "CANCELLED" }, targets.map((line) => line.id));
      setSelected(new Set());
      onChanged();
      toast(`Dropped ${targets.length} ${targets.length === 1 ? "line" : "lines"}. ${formatCentsCompact(freed)} goes back to the budget.`, {
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              for (const status of new Set(previous.map((row) => row.status))) {
                await bulk({ status }, previous.filter((row) => row.status === status).map((row) => row.id));
              }
              onChanged();
              toast.success("Put back.");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Couldn't undo that.");
            }
          },
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't reach the server. Try again.");
    }
  }

  async function restoreSelected() {
    const targets = selectedLines.filter((line) => line.status === "CANCELLED");
    if (targets.length === 0) return void toast.error("None of those lines are dropped.");
    try {
      await bulk({ status: "PLANNED" }, targets.map((line) => line.id));
      setSelected(new Set());
      onChanged();
      toast.success("Restored to planned.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't reach the server. Try again.");
    }
  }

  async function recategorizeSelected(category: BudgetCategoryValue) {
    const ids = selectedLines.map((line) => line.id);
    try {
      const previous = await bulk({ category }, ids);
      setSelected(new Set());
      onChanged();
      toast(`Moved ${ids.length} ${ids.length === 1 ? "line" : "lines"} to ${BUDGET_CATEGORY_LABELS[category]}.`, {
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              for (const value of new Set(previous.map((row) => row.category))) {
                await bulk({ category: value }, previous.filter((row) => row.category === value).map((row) => row.id));
              }
              onChanged();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Couldn't undo that.");
            }
          },
        },
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't reach the server. Try again.");
    }
  }

  const submitted = summary.submittedCents;
  const vsSubmitted = summary.forecastCents - submitted;
  const stillPlanned = summary.counts.PLANNED + summary.counts.ORDERED;
  const pctSpent = cap > 0 ? Math.round((summary.spentCents / cap) * 100) : 0;
  const barTotal = Math.max(cap, summary.forecastCents, 1);
  const shownBudgeted = shown.filter((line) => !line.unplanned).reduce((sum, line) => sum + plannedCents(line), 0);
  const shownSpent = shown.reduce((sum, line) => sum + (netSpentCents(line) ?? 0), 0);

  return (
    <div className="flex flex-col gap-7">
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          label={summary.allocationCents === null ? "Planned" : "Allocated"}
          value={formatCentsCompact(cap)}
          helper={summary.allocationCents === null ? "No overall cap set" : undefined}
        />
        <StatCard label="Spent" value={formatCentsCompact(summary.spentCents)} tone="accent" />
        <StatCard
          label="Planned, not bought"
          value={formatCentsCompact(summary.outstandingCents)}
          tone="amber"
          helper={`${stillPlanned} ${stillPlanned === 1 ? "line" : "lines"} open`}
        />
        <StatCard label={over ? "Over by" : "Remaining"} value={formatCentsCompact(Math.abs(summary.remainingCents))} tone={over ? "red" : "green"} />
      </div>

      <section className="flex flex-col gap-3.5 rounded-2xl border bg-card p-5" aria-label="Where it went">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Where it went</h2>
          <span className="text-[13px] text-muted-foreground">{pctSpent}% of allocation spent</span>
        </div>
        <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label="Spend by category, then planned and unspent">
          {summary.byCategory.map((row, index) =>
            row.spentCents > 0 ? (
              <div key={row.category} style={{ flex: row.spentCents / barTotal, background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
            ) : null,
          )}
          {summary.outstandingCents > 0 && (
            <div
              style={{
                flex: summary.outstandingCents / barTotal,
                background: "repeating-linear-gradient(135deg,#F5D90A 0 4px,#FFEF5C 4px 8px)",
              }}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-muted-foreground">
          {summary.byCategory.map((row, index) => (
            <span key={row.category} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: CATEGORY_COLORS[index % CATEGORY_COLORS.length] }} />
              {BUDGET_CATEGORY_LABELS[row.category]} <b className="font-bold text-foreground">{formatCentsCompact(row.spentCents)}</b>
            </span>
          ))}
          {summary.outstandingCents > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-[#F5D90A]" />
              Planned <b className="font-bold text-foreground">{formatCentsCompact(summary.outstandingCents)}</b>
            </span>
          )}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        <span>
          Submitted plan <b className="font-bold text-foreground">{formatCentsCompact(submitted)}</b> <span className="opacity-70">fixed</span>
        </span>
        <span>
          Freed up <b className="font-bold text-[#218358]">{formatCentsCompact(summary.freedCents)}</b>
        </span>
        <span>
          Unplanned <b className="font-bold text-[#3E63DD]">{formatCentsCompact(summary.unplannedCents)}</b>
        </span>
        <span className="ml-auto">
          <b className={`font-bold ${vsSubmitted > 0 ? "text-[#C62A2F]" : "text-[#218358]"}`}>{formatCentsCompact(Math.abs(vsSubmitted))} {vsSubmitted > 0 ? "over" : "under"}</b>{" "}
          the submitted plan
        </span>
      </div>

      {needItems.length > 0 && (
        <div className="flex flex-wrap items-center gap-3.5 rounded-xl border border-[#F5E29A] bg-[#FFF8E1] px-4 py-3 text-sm text-[#5C4400] dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <span className="size-2 rounded-full bg-[#F5B800]" />
          <span className="min-w-0 flex-1 basis-72">
            <b className="font-bold">{needItems.reduce((sum, line) => sum + unlinkedUnits(line), 0)} bought units</b> aren&apos;t linked to an item yet. Linking fills in each item&apos;s order, PO and serial.
          </span>
          <button type="button" className="text-[13px] font-bold text-[#3E63DD] hover:underline" onClick={() => setOnlyUnlinked((value) => !value)}>
            {onlyUnlinked ? "Show all lines" : "Show only these →"}
          </button>
        </div>
      )}

      {lines.length === 0 ? (
        <EmptyState icon="clipboard" title="No lines yet" description={`Add the first planned expense for ${budget.name} ${fiscalYearLabel(budget.fiscalYear)}.`} />
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <Input
              ref={searchRef}
              aria-label="Search lines"
              placeholder="Search lines, suppliers, POs  ( / )"
              className="w-full rounded-[9px] sm:w-64"
              value={query}
              maxLength={80}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]" role="group" aria-label="Filter by status">
              {(["ALL", ...BUDGET_LINE_STATUSES] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={statusFilter === status}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-lg px-3.5 py-1.5 text-[13px] font-bold ${
                    statusFilter === status ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {status === "ALL" ? "All" : BUDGET_STATUS_LABELS[status]}
                </button>
              ))}
            </div>
            <NativeSelect aria-label="Sort lines" className="w-auto" value={sort} onChange={(event) => setSort(event.target.value as LineSort)}>
              {LINE_SORTS.map((value) => (
                <option key={value} value={value}>
                  Sort: {LINE_SORT_LABELS[value]}
                </option>
              ))}
            </NativeSelect>
            <span className="ml-auto text-[13px] text-muted-foreground" aria-live="polite">
              {shown.length === lines.length ? `${lines.length} lines` : `${shown.length} of ${lines.length} lines`}
            </span>
          </div>
          {selectedLines.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-[#1C2024] px-4 py-2.5 text-sm text-white" role="toolbar" aria-label="Bulk actions">
              <b>{selectedLines.length} selected</b>
              <span className="text-[#B9BBC6]">
                {formatCentsCompact(selectedLines.reduce((sum, line) => sum + (netSpentCents(line) ?? (line.unplanned ? 0 : plannedCents(line))), 0))}
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-4 font-bold">
                <select
                  aria-label="Change category"
                  className="rounded-md bg-white/10 px-2 py-1 text-white"
                  value=""
                  onChange={(event) => event.target.value && void recategorizeSelected(event.target.value as BudgetCategoryValue)}
                >
                  <option value="">Change category</option>
                  {BUDGET_CATEGORIES.map((value) => (
                    <option key={value} value={value} className="text-black">{BUDGET_CATEGORY_LABELS[value]}</option>
                  ))}
                </select>
                <button type="button" onClick={() => void restoreSelected()}>Restore</button>
                <button type="button" onClick={() => void dropSelected()}>Drop</button>
                <button type="button" className="font-normal text-[#B9BBC6]" onClick={() => setSelected(new Set())}>Clear</button>
              </span>
            </div>
          )}
          {shown.length === 0 ? (
            <EmptyState
              icon="search"
              title="No lines match"
              description="Try a different search or clear the filters."
              actionLabel="Clear filters"
              onAction={() => {
                setQuery("");
                setStatusFilter("ALL");
                setOnlyUnlinked(false);
              }}
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border bg-card" role="table" aria-label="Budget lines">
              <div className="min-w-[1300px]">
                <div role="row" className={`${GRID} border-b bg-muted/40 py-3 text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground`}>
                  <span role="columnheader">
                    <input
                      type="checkbox"
                      aria-label="Select all shown lines"
                      checked={allShownSelected}
                      onChange={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((line) => line.id)))}
                    />
                  </span>
                  <span role="columnheader">Line</span>
                  <span role="columnheader">Status</span>
                  <span role="columnheader" className="text-right">Qty</span>
                  <span role="columnheader" className="text-right">Each</span>
                  <span role="columnheader" className="text-right">Budgeted</span>
                  <span role="columnheader" className="text-right">Spent</span>
                  <span role="columnheader" className="text-right">Vs plan</span>
                  <span role="columnheader">Ordered</span>
                  <span role="columnheader">PO</span>
                  <span role="columnheader">Items</span>
                  <span role="columnheader" className="sr-only">Actions</span>
                </div>
                {shown.map((line) => {
                  const variance = varianceCents(line);
                  const dropped = line.status === "CANCELLED";
                  const unlinked = unlinkedUnits(line);
                  return (
                    <Fragment key={line.id}>
                      <div
                        role="row"
                        id={`line-${line.id}`}
                        data-state={line.id === focusLineId ? "selected" : undefined}
                        className={`${GRID} items-center border-b py-3.5 data-[state=selected]:bg-muted/50`}
                      >
                        <span role="cell">
                          <input
                            type="checkbox"
                            aria-label={`Select ${line.description}`}
                            checked={selected.has(line.id)}
                            onChange={() => toggleSelected(line.id)}
                          />
                        </span>
                        <div role="cell" className="flex min-w-0 items-center gap-3">
                          {line.links.some((link) => link.imageUrl) && (
                            <AssetImage src={line.links.find((link) => link.imageUrl)?.imageUrl} alt="" size={40} />
                          )}
                          <div className="min-w-0">
                            <div className={`flex items-center gap-2 text-[15px] font-bold ${dropped ? "text-muted-foreground line-through" : ""}`}>
                              <span className="truncate">{line.description}</span>
                              {line.unplanned && (
                                <span className="rounded-md bg-[#EEF2FF] px-1.5 py-0.5 text-[11px] font-bold text-[#3E63DD] no-underline dark:bg-[#3E63DD]/20">Unplanned</span>
                              )}
                              {line.linkUrl && (
                                <a href={line.linkUrl} target="_blank" rel="noreferrer noopener" aria-label="Open product link">
                                  <ExternalLinkIcon className="size-3.5 text-muted-foreground" />
                                </a>
                              )}
                            </div>
                            <p className="truncate text-[13px] text-muted-foreground">
                              {[line.supplier, BUDGET_CATEGORY_LABELS[line.category], line.requesterName ?? line.requesterNote].filter(Boolean).join(" · ")}
                            </p>
                          </div>
                        </div>
                        <span role="cell">
                          <StatusPill status={line.status} />
                        </span>
                        <span role="cell" className={`${MONO} text-right`}>{line.quantity}</span>
                        <span role="cell" className={`${MONO} text-right text-muted-foreground`}>{line.unplanned ? "—" : formatCentsCompact(line.unitCostCents)}</span>
                        <span role="cell" className={`${MONO} text-right ${dropped ? "text-muted-foreground" : ""}`}>
                          {line.unplanned ? "—" : formatCentsCompact(plannedCents(line))}
                        </span>
                        <span role="cell" className={`${MONO} text-right font-medium`}>
                          {line.spentCents === null ? "—" : formatCentsCompact(netSpentCents(line) ?? 0)}
                          {line.refundCents ? <span className="block text-[11px] font-normal text-[#218358]">refund −{formatCentsCompact(line.refundCents)}</span> : null}
                        </span>
                        <span role="cell" className={`${MONO} text-right ${variance === null ? "" : variance > 0 ? "text-[#C62A2F]" : variance < 0 ? "text-[#218358]" : ""}`}>
                          {variance === null || variance === 0 ? "—" : `${variance > 0 ? "+" : "−"}${formatCentsCompact(Math.abs(variance))}`}
                        </span>
                        <span role="cell" className="text-[13px] text-muted-foreground">{formatShortDate(line.purchasedOn)}</span>
                        <span role="cell" className={`${MONO} truncate text-muted-foreground`}>{line.poNumber ?? "—"}</span>
                        <span role="cell" className="text-[13px]">
                          {dropped ? (
                            <span className="text-muted-foreground">Frees {formatCentsCompact(plannedCents(line))}</span>
                          ) : line.status !== "PURCHASED" ? (
                            <span className="text-muted-foreground">After it&apos;s bought</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => onLinks(line)}
                              className={`font-bold hover:underline ${unlinked > 0 ? "text-[#AB6400] dark:text-amber-400" : "text-[#218358]"}`}
                            >
                              {line.links.length === 0
                                ? "Not linked"
                                : unlinked > 0
                                  ? `${(line.quantityBought ?? line.quantity) - unlinked} of ${line.quantityBought ?? line.quantity}`
                                  : "Linked"}
                            </button>
                          )}
                        </span>
                        <div role="cell" className="flex justify-end gap-1">
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Line history" onClick={() => onHistory(line)}>
                            <ClockIcon />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Edit line" onClick={() => onEdit(line)}>
                            <PencilIcon />
                          </Button>
                          <Button type="button" variant="ghost" size="icon-sm" aria-label="Delete line" onClick={() => void removeLine(line)}>
                            <Trash2Icon />
                          </Button>
                        </div>
                      </div>
                      {line.id === focusLineId && (
                        <div role="row" className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-5 py-3">
                          {line.links.map((link) => (
                            <a
                              key={link.id}
                              href={link.href}
                              className="flex items-center gap-2 rounded-lg border bg-background py-1.5 pl-1.5 pr-3 text-sm hover:bg-muted"
                            >
                              <AssetImage src={link.imageUrl} alt={link.label} size={32} />
                              <span className="font-medium">{link.label}</span>
                              {link.detail && <span className="text-xs text-muted-foreground">{link.detail}</span>}
                            </a>
                          ))}
                          {unlinked > 0 && (
                            <Button type="button" variant="outline" onClick={() => onLinks(line)}>
                              <LinkIcon />
                              Link {unlinked} more
                            </Button>
                          )}
                        </div>
                      )}
                    </Fragment>
                  );
                })}
                <div role="row" className={`${GRID} bg-muted/40 py-3.5 text-[13px] font-bold text-muted-foreground`}>
                  <span role="cell" />
                  <span role="cell">Total shown</span>
                  <span role="cell" />
                  <span role="cell" />
                  <span role="cell" />
                  <span role="cell" className={`${MONO} text-right text-foreground`}>{formatCentsCompact(shownBudgeted)}</span>
                  <span role="cell" className={`${MONO} text-right text-foreground`}>{formatCentsCompact(shownSpent)}</span>
                  <span role="cell" className={`${MONO} text-right ${shownSpent - shownBudgeted > 0 ? "text-[#C62A2F]" : "text-[#218358]"}`}>
                    {shownSpent - shownBudgeted === 0 ? "—" : `${shownSpent - shownBudgeted > 0 ? "+" : "−"}${formatCentsCompact(Math.abs(shownSpent - shownBudgeted))}`}
                  </span>
                  <span role="cell" />
                  <span role="cell" />
                  <span role="cell" />
                  <span role="cell" />
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryDialog({ line, onClose }: { line: LineView; onClose: () => void }) {
  const history = useQuery<LineHistoryEntry[]>({
    queryKey: ["budget", "history", line.id],
    queryFn: async ({ signal }) => readJson(await fetch(`/api/budget/lines/${line.id}/history`, { signal }), "Could not load the history"),
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
    unplanned: line?.unplanned ?? false,
    recurring: line?.recurring ?? false,
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

function NewBudgetDialog({
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
