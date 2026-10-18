"use client";

import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { BUDGET_CATEGORY_LABELS, fiscalYearLabel, formatCentsCompact, type BudgetCategoryValue } from "@/lib/budget/contract";
import { monthlySpend, overPlanLines, supplierTotals, type InsightLine } from "@/lib/budget/insights";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { BudgetTrendRow } from "@/lib/services/budget";

type Summary = {
  plannedCents: number;
  submittedCents: number;
  spentCents: number;
  outstandingCents: number;
  forecastCents: number;
  allocationCents: number | null;
  byCategory: { category: BudgetCategoryValue; plannedCents: number; spentCents: number }[];
};

const card = "rounded-2xl border bg-card p-5";
const label = "text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground";
const CATEGORY_COLORS = ["#3E63DD", "#8E4EC6", "#12A594", "#E5484D", "#F76B15", "#0090FF"];

export function InsightsPanel({
  name,
  fiscalYear,
  summary,
  lines,
  unlinkedLines,
}: {
  name: string;
  fiscalYear: string;
  summary: Summary;
  lines: InsightLine[];
  unlinkedLines: number;
}) {
  const trend = useQuery<BudgetTrendRow[]>({
    queryKey: ["budget", "trend", name],
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/budget/trend?name=${encodeURIComponent(name)}`, { signal });
      if (handleAuthRedirect(response, "/budget")) throw new Error("Signing in again");
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Could not load the yearly totals"));
      const json = await parseJsonSafely<{ data?: BudgetTrendRow[] }>(response);
      return json?.data ?? [];
    },
  });

  const { months, undatedCents } = monthlySpend(lines);
  const peak = Math.max(...months.map((month) => month.spentCents), 1);
  const suppliers = supplierTotals(lines).slice(0, 6);
  const supplierPeak = Math.max(...suppliers.map((row) => row.spentCents), 1);
  const over = overPlanLines(lines);
  const cap = summary.allocationCents ?? summary.plannedCents;
  const projectedPct = cap > 0 ? Math.round((summary.forecastCents / cap) * 100) : 0;
  const attention = [
    over.length > 0 && {
      tone: "#E5484D",
      text: `${over.length} ${over.length === 1 ? "line costs" : "lines cost"} more than budgeted (+${formatCentsCompact(
        over.reduce((sum, line) => sum + ((line.spentCents ?? 0) - (line.refundCents ?? 0) - line.unitCostCents * line.quantity), 0),
      )} total)`,
    },
    unlinkedLines > 0 && { tone: "#F5B800", text: `${unlinkedLines} ${unlinkedLines === 1 ? "bought line has" : "bought lines have"} units not linked to an item yet` },
  ].filter(Boolean) as { tone: string; text: string }[];
  const years = trend.data ?? [];
  const yearPeak = Math.max(...years.map((row) => Math.max(row.submittedCents, row.forecastCents)), 1);

  return (
    <div className="flex flex-col gap-5">
      <section className={card} aria-label="Needs attention">
        <div className={label}>Needs attention</div>
        {attention.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Nothing needs you. Every bought line is at or under plan and linked.</p>
        ) : (
          attention.map((item) => (
            <div key={item.text} className="flex items-center gap-3 border-b py-3 text-sm last:border-b-0">
              <span className="size-2 rounded-full" style={{ background: item.tone }} />
              {item.text}
            </div>
          ))
        )}
      </section>

      <div className="grid gap-3.5 lg:grid-cols-[1.6fr_1fr]">
        <section className={card} aria-label="Spending by month">
          <div className="flex items-baseline justify-between">
            <div className={label}>Spending by month</div>
            <span className="text-[13px] text-muted-foreground">{fiscalYearLabel(fiscalYear)}</span>
          </div>
          <div className="mt-4 flex gap-1.5" role="img" aria-label="Spending by month, July to June">
            {months.map((month) => (
              <div key={month.label} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex h-[150px] w-full items-end">
                  <div
                    className="w-full rounded-t-[5px] bg-[#3E63DD]"
                    style={{ height: month.spentCents === 0 ? 2 : Math.max(4, (month.spentCents / peak) * 150), opacity: month.spentCents === 0 ? 0.15 : 1 }}
                    title={`${month.label}: ${formatCentsCompact(month.spentCents)}`}
                  />
                </div>
                <span className="text-[11px] text-muted-foreground">{month.label}</span>
              </div>
            ))}
          </div>
          {undatedCents > 0 && <p className="mt-3 text-xs text-muted-foreground">{formatCentsCompact(undatedCents)} has no order date and isn&apos;t shown.</p>}
        </section>

        <section className={card} aria-label="By category">
          <div className={label}>By category</div>
          <div className="mt-4 flex flex-col gap-4">
            {summary.byCategory.length === 0 && <p className="text-sm text-muted-foreground">No spending yet.</p>}
            {summary.byCategory.map((row, index) => {
              const pct = row.plannedCents > 0 ? Math.min(100, Math.round((row.spentCents / row.plannedCents) * 100)) : 0;
              const tone = row.plannedCents > 0 && row.spentCents > row.plannedCents ? "#E5484D" : pct >= 80 ? "#F5B800" : CATEGORY_COLORS[index % CATEGORY_COLORS.length];
              return (
                <div key={row.category}>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span className="font-bold">{BUDGET_CATEGORY_LABELS[row.category]}</span>
                    <span className="font-mono text-[13px]">
                      {formatCentsCompact(row.spentCents)} <span className="text-muted-foreground">of {formatCentsCompact(row.plannedCents)}</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-muted">
                    <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: tone }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Bars turn amber at 80% of what was planned for the category and red when over.</p>
        </section>
      </div>

      <section className={card} aria-label="Forecast">
        <div className={label}>Forecast</div>
        <div className="mt-2 flex flex-wrap items-baseline gap-3">
          <span className={`text-[32px] font-black tracking-[-0.04em] ${cap - summary.forecastCents < 0 ? "text-[#C62A2F]" : "text-[#218358]"}`}>
            {formatCentsCompact(Math.abs(cap - summary.forecastCents))}
          </span>
          <span className="text-sm text-muted-foreground">
            {cap - summary.forecastCents < 0 ? "over" : "left"} of {formatCentsCompact(cap)} once everything planned is bought
          </span>
        </div>
        <div className="mt-3.5 flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
          <div style={{ flex: Math.max(summary.spentCents, 0), background: "#3E63DD" }} />
          <div style={{ flex: Math.max(summary.outstandingCents, 0), background: "repeating-linear-gradient(135deg,#F5D90A 0 4px,#FFEF5C 4px 8px)" }} />
          <div style={{ flex: Math.max(cap - summary.forecastCents, 0) }} />
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-5 text-[13px] text-muted-foreground">
          <span>Spent <b className="text-foreground">{formatCentsCompact(summary.spentCents)}</b></span>
          <span>Still planned <b className="text-foreground">{formatCentsCompact(summary.outstandingCents)}</b></span>
          <span className="ml-auto">Projected to finish at {formatCentsCompact(summary.forecastCents)} ({projectedPct}%).</span>
        </div>
      </section>

      <div className="grid gap-3.5 lg:grid-cols-2">
        <section className={card} aria-label="Suppliers">
          <div className={label}>Suppliers</div>
          <div className="mt-3 flex flex-col gap-3">
            {suppliers.length === 0 && <p className="text-sm text-muted-foreground">No purchases yet.</p>}
            {suppliers.map((row) => (
              <div key={row.supplier}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-bold">{row.supplier}</span>
                  <span className="font-mono text-[13px]">
                    {formatCentsCompact(row.spentCents)} <span className="text-muted-foreground">· {row.orders} {row.orders === 1 ? "order" : "orders"}</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div className="h-1.5 rounded-full bg-[#3E63DD]" style={{ width: `${(row.spentCents / supplierPeak) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className={card} aria-label="Year over year">
          <div className={label}>Year over year · {name}</div>
          <div className="mt-3 flex flex-col gap-3.5">
            {trend.isLoading && <Skeleton className="h-24 w-full" />}
            {trend.isError && <p className="text-sm text-muted-foreground">{trend.error.message}</p>}
            {years.map((row) => (
              <div key={row.fiscalYear}>
                <div className="mb-1 flex justify-between text-sm">
                  <span className="font-bold">{fiscalYearLabel(row.fiscalYear).split(" · ")[0]}</span>
                  <span className="font-mono text-[13px]">
                    {formatCentsCompact(row.forecastCents)} <span className="text-muted-foreground">of {formatCentsCompact(row.submittedCents)} submitted</span>
                  </span>
                </div>
                <div className="relative h-2 rounded-full bg-muted">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-[#C9D6FB]" style={{ width: `${(row.submittedCents / yearPeak) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-[#3E63DD]" style={{ width: `${(row.forecastCents / yearPeak) * 100}%`, maxWidth: "100%" }} />
                </div>
              </div>
            ))}
            {!trend.isLoading && years.length === 1 && <p className="text-xs text-muted-foreground">Add earlier years to compare them here.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
