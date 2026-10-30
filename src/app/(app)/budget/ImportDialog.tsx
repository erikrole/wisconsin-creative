"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { BUDGET_CATEGORY_LABELS, fiscalYearLabel, formatCentsCompact } from "@/lib/budget/contract";
import type { ImportCandidate } from "@/lib/budget/import";
import { parseErrorMessage, parseJsonSafely } from "@/lib/errors";

const RESULT_STYLE = { ready: "text-[#218358]", check: "text-[#AB6400]", skipped: "text-muted-foreground" } as const;
const RESULT_LABEL = { ready: "Ready", check: "Check", skipped: "Skipped" } as const;

/** Upload a budget sheet, review what will be imported, then save. Nothing is saved until the last step. */
export function ImportDialog({
  budgetId,
  name,
  fiscalYear,
  onClose,
  onImported,
}: {
  budgetId: string;
  name: string;
  fiscalYear: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [unboughtAs, setUnboughtAs] = useState<"CANCELLED" | "PLANNED" | "PURCHASED">("PLANNED");
  const [sheets, setSheets] = useState<{ name: string; usable: boolean }[]>([]);
  const [sheet, setSheet] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [included, setIncluded] = useState<Set<number>>(new Set());
  const [pending, setPending] = useState(false);

  async function preview(tab?: string) {
    if (!file) return void toast.error("Choose an .xlsx or .csv file.");
    setPending(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("unboughtAs", unboughtAs);
      if (tab) form.set("sheet", tab);
      const response = await fetch(`/api/budget/${budgetId}/import`, { method: "POST", body: form });
      if (!response.ok) return void toast.error(await parseErrorMessage(response, "Couldn't read that file."));
      const json = await parseJsonSafely<{ data?: { sheet: string; sheets: { name: string; usable: boolean }[]; candidates: ImportCandidate[] } }>(response);
      const rows = json?.data?.candidates ?? [];
      setSheets(json?.data?.sheets ?? []);
      setSheet(json?.data?.sheet ?? null);
      setCandidates(rows);
      setIncluded(new Set(rows.filter((row) => row.result !== "skipped").map((row) => row.row)));
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function save() {
    const lines = (candidates ?? [])
      .filter((row) => included.has(row.row))
      .map((row) => ({
        description: row.description,
        category: row.category,
        status: row.status,
        supplier: row.supplier,
        unitCostCents: row.unitCostCents,
        unitCostKnown: row.unitCostKnown,
        plannedTotalKnown: row.budgetedCents !== null,
        plannedOverrideCents: row.budgetedCents,
        statusKnown: row.statusKnown,
        quantity: row.quantity,
        quantityBought: row.quantityBought,
        spentCents: row.spentCents,
        purchasedOn: row.purchasedOn,
        poNumber: row.poNumber,
        orderNumber: row.orderNumber,
        justification: row.note,
        unplanned: row.unplanned,
      }));
    if (lines.length === 0) return void toast.error("Nothing selected to import.");
    setPending(true);
    try {
      const response = await fetch(`/api/budget/${budgetId}/import`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lines }),
      });
      if (!response.ok) return void toast.error(await parseErrorMessage(response, "That import didn't save. Try again."));
      const json = await parseJsonSafely<{ data?: { created: number; updated: number } }>(response);
      toast.success(`Imported: ${json?.data?.created ?? 0} added, ${json?.data?.updated ?? 0} updated.`);
      onImported();
    } catch {
      toast.error("Couldn't reach the server. Try again.");
    } finally {
      setPending(false);
    }
  }

  const rows = candidates ?? [];
  const counts = { ready: 0, check: 0, skipped: 0 };
  for (const row of rows) counts[row.result] += 1;
  const toggle = (row: number) =>
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import into {name} · {fiscalYearLabel(fiscalYear)}</DialogTitle>
          <DialogDescription>Preview first. Nothing is saved until you confirm.</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {candidates === null ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="budget-import-file">Spreadsheet (.xlsx or .csv)</Label>
                <input id="budget-import-file" type="file" accept=".xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label>Lines with a budget, nothing spent, and no Status</Label>
                <NativeSelect value={unboughtAs} onChange={(event) => setUnboughtAs(event.target.value as "CANCELLED" | "PLANNED" | "PURCHASED")}>
                  <option value="CANCELLED">Treat as dropped</option>
                  <option value="PLANNED">Treat as planned</option>
                  <option value="PURCHASED">Mark bought; leave actual spend unknown</option>
                </NativeSelect>
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                Columns are matched by name: Item or Description, Category, Status, Quantity, Price Per Unit, Total Budgeted, Total Spent, Month Purchased, Supplier, PO. A workbook with a tab per year is fine; you pick the tab next. Running it again updates lines with the same name and won&apos;t add duplicates.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 rounded-xl border border-[#B8E3C8] bg-[#E6F6EB] px-4 py-2.5 text-sm text-[#18794E] dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
                <b>{counts.ready} ready.</b> {counts.check > 0 ? `${counts.check} need a look; they import as suggested unless you untick them.` : "Nothing needs a look."}
              </div>
              {sheets.length > 1 && (
                <div className="flex items-center gap-2 text-sm">
                  <Label htmlFor="budget-import-tab">Tab</Label>
                  <NativeSelect id="budget-import-tab" className="w-56" value={sheet ?? ""} disabled={pending} onChange={(event) => void preview(event.target.value)}>
                    {sheets.map((tab) => (
                      <option key={tab.name} value={tab.name} disabled={!tab.usable}>
                        {tab.name}
                        {tab.usable ? "" : " (no header row)"}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              )}
              <div className="max-h-[40vh] overflow-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-[0.09em] text-muted-foreground">
                    <tr>
                      <th className="w-8 px-3 py-2" />
                      <th className="px-2 py-2 text-left">Row</th>
                      <th className="px-2 py-2 text-left">Line</th>
                      <th className="px-2 py-2 text-right">Budgeted</th>
                      <th className="px-2 py-2 text-right">Spent</th>
                      <th className="px-2 py-2 text-left">Result</th>
                      <th className="px-2 py-2 text-left">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.row} className="border-t">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            aria-label={`Import row ${row.row}`}
                            checked={included.has(row.row)}
                            disabled={row.result === "skipped"}
                            onChange={() => toggle(row.row)}
                          />
                        </td>
                        <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{row.row}</td>
                        <td className="px-2 py-2 font-bold">
                          {row.description || "—"}
                          <span className="block text-xs font-normal text-muted-foreground">{BUDGET_CATEGORY_LABELS[row.category]}</span>
                        </td>
                        <td className="px-2 py-2 text-right font-mono text-xs">{row.budgetedCents === null ? "—" : formatCentsCompact(row.budgetedCents)}</td>
                        <td className="px-2 py-2 text-right font-mono text-xs">{row.spentCents === null ? "—" : formatCentsCompact(row.spentCents)}</td>
                        <td className={`px-2 py-2 text-xs font-bold ${RESULT_STYLE[row.result]}`}>{RESULT_LABEL[row.result]}</td>
                        <td className="px-2 py-2 text-xs text-muted-foreground">{row.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {candidates !== null && (
            <Button type="button" variant="ghost" onClick={() => setCandidates(null)} disabled={pending}>
              Choose another file
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {candidates === null ? (
            <Button type="button" onClick={() => void preview()} disabled={pending || !file}>
              Preview
            </Button>
          ) : (
            <Button type="button" className="bg-[#3E63DD] text-white hover:bg-[#3452B8]" onClick={() => void save()} disabled={pending || included.size === 0}>
              Import {included.size} {included.size === 1 ? "line" : "lines"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
