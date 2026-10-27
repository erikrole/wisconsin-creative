"use client";

import { useRef, useState } from "react";
import { AlertTriangle, PencilLine, RefreshCcw } from "lucide-react";
import { toast } from "@/lib/toast";
import { useConfirm } from "@/components/ConfirmDialog";
import { QrCodeImage } from "@/components/QrCodeImage";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { BulkSkuDetail } from "./types";
import { useSyncedDraft } from "@/hooks/use-synced-draft";

export default function BulkSkuQrTab({
  sku,
  canEdit,
  onFieldSaved,
}: {
  sku: BulkSkuDetail;
  canEdit: boolean;
  onFieldSaved: (partial: Partial<BulkSkuDetail>) => void;
}) {
  const confirm = useConfirm();
  // A new bin code closes manual entry and drops any half-typed value.
  const [manualEntry, setManualEntry] = useSyncedDraft(sku.binQrCodeValue, () => false);
  const [draft, setDraft] = useSyncedDraft(sku.binQrCodeValue, () => "");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function replaceQrCode(value?: string) {
    if (savingRef.current) return;
    const nextValue = value?.trim();
    if (value !== undefined && !nextValue) return;

    const approved = await confirm({
      title: nextValue ? "Change item-family QR code?" : "Generate a new item-family QR code?",
      message: `Replace ${sku.binQrCodeValue}? The current bin label and every numbered unit label for ${sku.name} will stop scanning. Reprint those labels after saving. Unit numbers, status, and history will not change.`,
      confirmLabel: nextValue ? "Change QR code" : "Generate new QR",
      variant: "danger",
    });
    if (!approved) return;

    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch(`/api/bulk-skus/${sku.id}/qr-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextValue ? { value: nextValue } : {}),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to replace QR code"));
        return;
      }
      const json = await parseJsonSafely<{ data?: Pick<BulkSkuDetail, "id" | "binQrCodeValue"> }>(res);
      if (!json?.data?.binQrCodeValue) {
        toast.error("QR code changed, but the response was incomplete. Refresh before printing labels.");
        return;
      }

      onFieldSaved({ binQrCodeValue: json.data.binQrCodeValue });
      setManualEntry(false);
      setDraft("");
      toast.success("QR code replaced. Reprint the bin and unit labels.");
    } catch (error) {
      toast.error(error instanceof TypeError ? "You’re offline. Check your connection." : "Failed to replace QR code");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <div className="mt-3.5 grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="border-border/40 shadow-none">
        <CardHeader>
          <CardTitle>QR identity</CardTitle>
          <CardDescription>
            This base code identifies the family and produces every numbered unit QR.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <div className="w-fit rounded-lg bg-white p-3 ring-1 ring-black/10 dark:ring-white/10">
            <QrCodeImage value={sku.binQrCodeValue} size={184} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current code</p>
            <p className="mt-1 break-all font-mono text-lg font-semibold tracking-wide">{sku.binQrCodeValue}</p>

            {canEdit && !manualEntry && (
              <div className="mt-5 flex flex-wrap gap-2">
                <Button type="button" variant="destructive" onClick={() => replaceQrCode()} disabled={saving}>
                  <RefreshCcw className={saving ? "size-4 animate-spin" : "size-4"} aria-hidden="true" />
                  {saving ? "Generating…" : "Reset with new code"}
                </Button>
                <Button type="button" variant="outline" onClick={() => setManualEntry(true)} disabled={saving}>
                  <PencilLine className="size-4" aria-hidden="true" />
                  Enter a code
                </Button>
              </div>
            )}

            {canEdit && manualEntry && (
              <div className="mt-5 space-y-2">
                <label htmlFor="bulk-sku-qr-value" className="text-sm font-medium">Replacement code</label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="bulk-sku-qr-value"
                    name="binQrCodeValue"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    className="h-10 flex-1 font-mono"
                    placeholder="Scan, paste, or type a code"
                    autoComplete="off"
                    autoFocus
                    disabled={saving}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void replaceQrCode(draft);
                      if (event.key === "Escape") {
                        setManualEntry(false);
                        setDraft("");
                      }
                    }}
                  />
                  <Button type="button" onClick={() => replaceQrCode(draft)} disabled={saving || !draft.trim()}>
                    {saving ? "Saving…" : "Save code"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => { setManualEntry(false); setDraft(""); }}
                    disabled={saving}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="border-[var(--orange)]/30 bg-[var(--orange)]/[0.04] shadow-none">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-[var(--orange-text)]" aria-hidden="true" />
            <CardTitle className="text-base">Before you reset</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>Existing labels use this base code. After reset, they will no longer resolve to {sku.name}.</p>
          {sku.trackByNumber && (
            <p>
              Unit codes currently follow <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">{sku.binQrCodeValue}-&#123;unit#&#125;</code>.
              Reprint the bin label and all active unit labels after changing it.
            </p>
          )}
          <p>Inventory counts, unit numbers, checkout status, and history stay intact.</p>
        </CardContent>
      </Card>

      {sku.trackByNumber && sku.units.length > 0 && (
        <Card className="border-border/40 shadow-none lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Numbered unit QR preview</CardTitle>
            <CardDescription>
              These values update immediately when the family QR changes. Use the Units tab to export the Brother label CSV.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-4 print:grid-cols-3 print:gap-2">
              {sku.units.slice(0, 50).map((unit) => (
                <div
                  key={unit.id}
                  className="flex flex-col items-center gap-1.5 rounded-md border border-border/60 bg-background p-2 print:break-inside-avoid print:border-black print:p-1.5"
                >
                  <div className="text-3xl font-black leading-none tabular-nums text-foreground print:text-black">
                    {unit.unitNumber}
                  </div>
                  <QrCodeImage value={`${sku.binQrCodeValue}-${unit.unitNumber}`} size={92} />
                  <span className="font-mono text-[10px] text-muted-foreground print:text-black">{sku.name}</span>
                </div>
              ))}
              {sku.units.length > 50 && (
                <div className="col-span-full flex items-center justify-center text-xs text-muted-foreground">
                  Showing first 50 of {sku.units.length} units
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
