"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { parseDollarsToCents } from "@/lib/gear-picks/catalog";
import type { GearPickBudgetDto } from "@/lib/gear-picks/types";

type Props = {
  title: string;
  budget: GearPickBudgetDto;
  pending: boolean;
  onSave: (budgetCents: number, confirmed: boolean, studentKitCents: number) => Promise<boolean>;
};

const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

const CARD = "rounded-[14px] border border-[#E8E8EC] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/10 dark:bg-card";
const LABEL = "text-[11px] font-bold uppercase tracking-[0.09em] text-[#60646C] dark:text-muted-foreground";

/** Admin-only budget summary for the cycle: budget, committed picks, what's left. */
export function AllotmentOverview({ title, budget, pending, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState("");
  const [kitAmount, setKitAmount] = useState("");
  const [confirmed, setConfirmed] = useState(budget.confirmed);
  const parsed = parseDollarsToCents(amount);
  const parsedKit = parseDollarsToCents(kitAmount);
  const invalid = amount.length > 0 && (parsed === null || parsed > 100_000_000);
  const kitInvalid = kitAmount.length > 0 && (parsedKit === null || parsedKit > 100_000);

  const over = budget.remainingCents < 0;
  const usedPct = budget.availableCents > 0 ? Math.min(100, (budget.committedCents / budget.availableCents) * 100) : 0;

  function startEdit() {
    setAmount((budget.budgetCents / 100).toFixed(2));
    setKitAmount((budget.studentKitCents / 100).toFixed(2));
    setConfirmed(budget.confirmed);
    setEditing(true);
  }

  async function save() {
    if (parsed === null || parsed > 100_000_000 || parsedKit === null || parsedKit > 100_000) return;
    if (await onSave(parsed, confirmed, parsedKit)) setEditing(false);
  }

  return (
    <section aria-labelledby="allotment-overview" className="mb-4 flex flex-col gap-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <h2 id="allotment-overview" className="text-[22px] font-extrabold tracking-[-0.03em]">Budget</h2>
          <span className="rounded-lg border border-[#E0E1E6] bg-white px-3 py-1 text-[13px] font-medium text-[#60646C] dark:border-white/10 dark:bg-card dark:text-muted-foreground">{title}</span>
          {!budget.confirmed && (
            <span className="rounded-full bg-[#FFF1BD] px-2.5 py-0.5 text-xs font-bold text-[#AB6400]">Placeholder</span>
          )}
        </div>
        {!editing && (
          <Button variant="outline" className="min-h-10" onClick={startEdit} disabled={pending}>
            Edit budget
          </Button>
        )}
      </div>

      {editing ? (
        <div className={`${CARD} flex flex-col gap-4 p-5`}>
          <div className="grid gap-1.5 sm:max-w-xs">
            <label htmlFor="allotment-budget" className="text-sm font-bold">Under Armour allotment</label>
            <Input
              id="allotment-budget"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-invalid={invalid}
              className="text-right font-mono"
            />
            <p className={`text-xs ${invalid ? "text-[#C62A2F]" : "text-[#60646C] dark:text-muted-foreground"}`}>
              {invalid
                ? "Enter a dollar amount like 5500 or 5,500.00."
                : budget.topUpCents > 0
                  ? `Creative top-ups (${usd(budget.topUpCents)}) come from the Budget page and are added on top.`
                  : "Creative money for UA gear is added from a line on the Budget page."}
            </p>
          </div>
          <div className="grid gap-1.5 sm:max-w-xs">
            <label htmlFor="allotment-student-kit" className="text-sm font-bold">Student kit price</label>
            <Input
              id="allotment-student-kit"
              inputMode="decimal"
              value={kitAmount}
              onChange={(event) => setKitAmount(event.target.value)}
              aria-invalid={kitInvalid}
              className="text-right font-mono"
            />
            <p className={`text-xs ${kitInvalid ? "text-[#C62A2F]" : "text-[#60646C] dark:text-muted-foreground"}`}>
              {kitInvalid ? "Enter a dollar amount up to $1,000." : "Zip, polo and shoe budget, for each student on the list."}
            </p>
          </div>
          <div className="flex items-center justify-between gap-4 sm:max-w-xs">
            <div>
              <div className="text-sm font-bold">Confirmed</div>
              <div className="text-[13px] text-[#60646C] dark:text-muted-foreground">Turns the placeholder tag off</div>
            </div>
            <Switch checked={confirmed} onCheckedChange={setConfirmed} aria-label="Budget confirmed" />
          </div>
          <div className="flex gap-2.5">
            <Button className="min-h-10" onClick={() => void save()} disabled={pending || parsed === null || invalid || parsedKit === null || kitInvalid}>Save</Button>
            <Button variant="outline" className="min-h-10" onClick={() => setEditing(false)} disabled={pending}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-3">
          <div className={`${CARD} px-5 py-[18px]`}>
            <div className={LABEL}>Total budget</div>
            <div className="mt-1.5 text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] tabular-nums">{usd(budget.availableCents)}</div>
            <div className="mt-2 text-[13px] text-[#60646C] dark:text-muted-foreground">
              {budget.topUpCents > 0
                ? `UA ${usd(budget.budgetCents)} · Creative ${usd(budget.topUpCents)}`
                : budget.confirmed ? "Confirmed" : "Placeholder until confirmed"}
            </div>
          </div>
          <div className={`${CARD} px-5 py-[18px]`}>
            <div className={LABEL}>Committed so far</div>
            <div className="mt-1.5 text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] tabular-nums">{usd(budget.committedCents)}</div>
            <div className="mt-2 text-[13px] text-[#60646C] dark:text-muted-foreground">Picks {usd(budget.picksCents)} · Student kits {usd(budget.studentKitsCents)}</div>
          </div>
          <div className={`${CARD} px-5 py-[18px]`}>
            <div className={LABEL}>Left</div>
            <div className={`mt-1.5 text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] tabular-nums ${over ? "text-[#C62A2F]" : "text-[#218358]"}`}>
              {over ? `−${usd(-budget.remainingCents)}` : usd(budget.remainingCents)}
            </div>
            <div className="mt-2 text-[13px] text-[#60646C] dark:text-muted-foreground">
              {over ? "Over budget" : "Core kit and standard issue aren’t counted yet"}
            </div>
          </div>
        </div>
      )}

      {!editing && (
        <div
          className="h-3.5 overflow-hidden rounded-full bg-[#F0F1F3] dark:bg-white/10"
          role="img"
          aria-label={`${usd(budget.committedCents)} of ${usd(budget.availableCents)} committed`}
        >
          <div className={`h-full rounded-full ${over ? "bg-[#C62A2F]" : "bg-[#12A594]"}`} style={{ width: `${usedPct}%` }} />
        </div>
      )}

      {!editing && budget.topUps.length > 0 && (
        <div className={`${CARD} px-5 py-3.5`}>
          <div className={LABEL}>From the Creative budget</div>
          <ul className="mt-2 flex flex-col divide-y divide-[#F0F1F3] dark:divide-white/10">
            {budget.topUps.map((topUp) => (
              <li key={topUp.lineId} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/budget?b=${topUp.budgetId}&line=${topUp.lineId}`} className="min-w-0 hover:underline">
                  <span className="block truncate font-bold">{topUp.description}</span>
                  <span className="block text-[13px] text-[#60646C] dark:text-muted-foreground">{topUp.budgetLabel}</span>
                </Link>
                <span className="shrink-0 font-bold tabular-nums">{usd(topUp.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
