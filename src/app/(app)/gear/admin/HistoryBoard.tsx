"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { GearPastCycleDto } from "@/lib/gear-picks/types";

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const CARD = "overflow-hidden rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-card";
const HEAD = "text-[11px] font-bold uppercase tracking-[0.09em] text-[#6B6F7A] dark:text-muted-foreground";
const ROW = "grid grid-cols-[minmax(200px,2fr)_80px_64px_72px_80px_96px] items-center gap-3 border-b border-[#F0F1F3] px-5 py-2.5 text-sm last:border-b-0 dark:border-white/10";

/** Snapshots the live year into History; saving again replaces the earlier snapshot of the same year. */
function SaveYearButton() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      className="min-h-10"
      disabled={saving}
      onClick={async () => {
        const ok = await confirm({
          title: "Save this year to History?",
          message: "This saves a read-only copy of the current year's budget, items, receipts and people. Saving again replaces the earlier copy. The live year keeps working.",
          confirmLabel: "Save to History",
        });
        if (!ok) return;
        setSaving(true);
        try {
          const response = await fetch("/api/gear-picks/admin/history", { method: "POST" });
          if (handleAuthRedirect(response, "/gear/admin")) return;
          if (!response.ok) {
            toast.error(await parseErrorMessage(response, "Could not save this year. Try again."));
            return;
          }
          await queryClient.invalidateQueries({ queryKey: ["gear-picks", "admin", "history"] });
          toast.success("This year was saved to History.");
        } catch {
          toast.error("Couldn't reach the server. Try again.");
        } finally {
          setSaving(false);
        }
      }}
    >
      {saving ? "Saving…" : "Save this year to History"}
    </Button>
  );
}

/** Past years of UA gear, read-only: the budget outcome, what was planned and received, and who was on the list. */
export function HistoryBoard() {
  const { data, isLoading, isError, refetch } = useQuery<GearPastCycleDto[]>({
    queryKey: ["gear-picks", "admin", "history"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/gear-picks/admin/history", { signal });
      if (handleAuthRedirect(response, "/gear/admin")) return [];
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Could not load past years"));
      const json = await parseJsonSafely<{ data?: { cycles?: GearPastCycleDto[] } }>(response);
      if (!json?.data?.cycles) throw new Error("Past years response was incomplete");
      return json.data.cycles;
    },
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  if (isLoading) return <Skeleton className="h-64 w-full rounded-lg" aria-label="Loading past years" />;
  if (isError || !data) {
    return <EmptyState icon="wifi-off" title="Couldn't load past years" description="Check your connection and try again." actionLabel="Retry" onAction={() => void refetch()} />;
  }
  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3">
        <EmptyState icon="chart" compact title="No past years yet" description="Save the current year to keep a read-only copy here." />
        <SaveYearButton />
      </div>
    );
  }

  const cycle = data.find((candidate) => candidate.id === selected) ?? data[0]!;
  const needle = query.trim().toLowerCase();
  const items = cycle.items.filter((item) => !needle || `${item.itemName} ${item.colorLabel} ${item.sku}`.toLowerCase().includes(needle));
  const plannedUnits = cycle.items.reduce((sum, item) => sum + item.plannedQty, 0);
  const receivedUnits = cycle.items.reduce((sum, item) => sum + item.receivedQty, 0);
  const listedCents = cycle.items.reduce((sum, item) => sum + item.unitPriceCents * item.plannedQty, 0);
  const groups = [...new Set(cycle.people.map((person) => person.groupLabel))];

  return (
    <section aria-labelledby="gear-admin-history" className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="gear-admin-history" className="text-[22px] font-extrabold tracking-[-0.03em]">{cycle.title}</h2>
        <SaveYearButton />
        {data.length > 1 && (
          <div className="flex gap-0.5 rounded-[10px] bg-[#F0F1F3] p-[3px] dark:bg-white/10" role="group" aria-label="Choose a year">
            {data.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                aria-pressed={candidate.id === cycle.id}
                onClick={() => setSelected(candidate.id)}
                className={`min-h-9 rounded-lg px-3 py-1.5 text-[13px] font-bold ${candidate.id === cycle.id ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] dark:bg-card" : "text-[#60646C] dark:text-muted-foreground"}`}
              >
                {candidate.id}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Budget" value={usd(cycle.budgetCents)} helper="For the year" />
        <Stat label="Counted against it" value={usd(cycle.budgetedSpendCents)} helper="Spend on budgeted rows" />
        <Stat
          label={cycle.remainingCents < 0 ? "Over budget" : "Left"}
          value={usd(Math.abs(cycle.remainingCents))}
          helper="Budget minus counted spend"
          tone={cycle.remainingCents < 0 ? "red" : "green"}
        />
        <Stat label="Other spend" value={usd(cycle.otherSpendCents)} helper="Outside the budgeted rows" />
      </div>
      {cycle.note && <p className="mb-4 text-xs text-[#6B6F7A] dark:text-muted-foreground">{cycle.note}</p>}

      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-extrabold tracking-[-0.02em]">Items</h3>
        <span className="text-sm text-[#60646C] dark:text-muted-foreground">{plannedUnits} planned · {receivedUnits} received</span>
      </div>
      <Input type="search" aria-label="Search items" placeholder="Search items" className="mb-2 min-h-10 sm:max-w-xs" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className={`${CARD} mb-1 overflow-x-auto`}>
        <div className="min-w-[760px]">
          <div className={`${ROW} bg-[#FAFAFB] dark:bg-white/5`}>
            <span className={HEAD}>Item</span>
            <span className={`${HEAD} text-right`}>Price</span>
            <span className={`${HEAD} text-right`}>Planned</span>
            <span className={`${HEAD} text-right`}>Ordered</span>
            <span className={`${HEAD} text-right`}>Received</span>
            <span className={`${HEAD} text-right`}>At price</span>
          </div>
          {items.length === 0 && <div className="px-5 py-6 text-center text-sm text-[#60646C] dark:text-muted-foreground">No items match that search.</div>}
          {items.map((item) => (
            <div key={item.sku} className={ROW}>
              <span>
                <span className="font-bold">{item.itemName}</span>
                <span className="ml-2 text-xs text-[#6B6F7A] dark:text-muted-foreground">{item.colorLabel}</span>
                <span className="ml-2 font-mono text-[11px] text-[#6B6F7A] dark:text-muted-foreground">{item.sku}</span>
              </span>
              <span className="text-right font-mono text-[13px]">{item.unitPriceCents > 0 ? usd(item.unitPriceCents) : "—"}</span>
              <span className="text-right font-mono">{item.plannedQty}</span>
              <span className="text-right font-mono">{item.orderedQty}</span>
              <span className="text-right font-mono">{item.receivedQty}</span>
              <span className="text-right font-mono text-[13px]">{item.unitPriceCents > 0 ? usd(item.unitPriceCents * item.plannedQty) : "—"}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="mb-6 text-xs text-[#6B6F7A] dark:text-muted-foreground">
        Listed prices add up to {usd(listedCents)}. That doesn’t match the budget summary above, which only counts rows the old sheet marked as budgeted.
      </p>

      <h3 className="mb-2 text-base font-extrabold tracking-[-0.02em]">People · {cycle.people.length}</h3>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((group) => {
          const members = cycle.people.filter((person) => person.groupLabel === group);
          return (
            <details key={group} open className={`${CARD} group`}>
              <summary className="flex min-h-12 cursor-pointer items-center justify-between px-5 py-3 text-sm font-bold">
                {group}
                <span className="font-mono text-xs text-[#60646C] dark:text-muted-foreground">{members.length}</span>
              </summary>
              <ul className="border-t border-[#F0F1F3] dark:border-white/10">
                {members.map((person) => (
                  <li key={person.name} className="flex items-center justify-between gap-3 border-b border-[#F0F1F3] px-5 py-2 text-sm last:border-b-0 dark:border-white/10">
                    <span>
                      {person.name}
                      <span className="ml-2 text-xs text-[#6B6F7A] dark:text-muted-foreground">{person.fit}</span>
                    </span>
                    <span className="font-mono text-xs text-[#60646C] dark:text-muted-foreground">
                      {person.topSize ?? "no top"} · {person.shoeSize ?? "no shoe"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function Stat({ label, value, helper, tone }: { label: string; value: string; helper: string; tone?: "red" | "green" }) {
  return (
    <div className={`${CARD} p-4`}>
      <p className={HEAD}>{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tracking-[-0.03em] ${tone === "red" ? "text-[#C62A2F]" : tone === "green" ? "text-[#218358]" : ""}`}>{value}</p>
      <p className="mt-0.5 text-xs text-[#60646C] dark:text-muted-foreground">{helper}</p>
    </div>
  );
}
