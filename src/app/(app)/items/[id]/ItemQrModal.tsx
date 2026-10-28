"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { useCopyFeedback } from "@/hooks/use-copy-feedback";
import { useInvalidateItemCatalog } from "@/hooks/use-item-cache-invalidation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Check, Copy, Download, PencilLine, RefreshCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import type { AssetDetail } from "./types";
import { useConfirm } from "@/components/ConfirmDialog";

/* ── QR Code Visual ─────────────────────────────────────── */

export function QRCodeCanvas({
  value,
  size,
  margin = 2,
}: {
  value: string;
  size: number;
  margin?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!value || !canvasRef.current) return;
    setLoaded(false);
    import("qrcode").then((QRCode) => {
      if (!canvasRef.current) return;
      QRCode.toCanvas(canvasRef.current, value, { width: size, margin }, () => {
        setLoaded(true);
      });
    });
  }, [value, size, margin]);

  if (!value) return null;
  return (
    <canvas
      ref={canvasRef}
      className="qr-canvas"
      style={{ opacity: loaded ? 1 : 0 }}
    />
  );
}

/* ── QR Modal ──────────────────────────────────────────── */

export function QRModal({
  asset,
  canEdit,
  onRefresh,
  open,
  onOpenChange,
}: {
  asset: AssetDetail;
  canEdit: boolean;
  onRefresh: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const confirmDialog = useConfirm();
  const invalidateItemCatalog = useInvalidateItemCatalog();
  const [manualEntry, setManualEntry] = useState(false);
  const [qrDraft, setQrDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const {
    copiedKey,
    copy: copyWithFeedback,
    reset: resetCopyFeedback,
  } = useCopyFeedback(1600);
  const copied = copiedKey === "qr";
  const savingRef = useRef(false);

  function beginSave() {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setError("");
    return true;
  }

  function endSave() {
    savingRef.current = false;
    setSaving(false);
  }

  useEffect(() => {
    resetCopyFeedback();
    if (open) {
      setManualEntry(false);
      setQrDraft("");
      setError("");
    }
  }, [open, resetCopyFeedback]);

  async function copyCode() {
    if (!asset.qrCodeValue) return;
    const result = await copyWithFeedback(asset.qrCodeValue, "qr");
    if (result === "failed") {
      toast.error("Could not copy the QR code", {
        description: "Select the visible code and copy it manually.",
      });
    }
  }

  async function downloadPng() {
    if (!asset.qrCodeValue) return;
    const QRCode = await import("qrcode");
    const dataUrl = await QRCode.toDataURL(asset.qrCodeValue, { width: 1024, margin: 2 });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = `${asset.assetTag.replace(/[^\w-]+/g, "_")}-qr.png`;
    link.click();
  }

  async function generateQR() {
    if (asset.qrCodeValue) {
      const ok = await confirmDialog({
        title: "Generate new QR code",
        message: `Replace ${asset.qrCodeValue} with a new code? Printed labels with the current code will stop resolving to this item.`,
        confirmLabel: "Generate",
        variant: "danger",
      });
      if (!ok) return;
    }
    if (!beginSave()) return;
    try {
      const res = await fetch(`/api/assets/${asset.id}/generate-qr`, {
        method: "POST",
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed");
        setError(msg);
        return;
      }
      invalidateItemCatalog();
      onRefresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      endSave();
    }
  }

  async function saveManualQR() {
    if (savingRef.current) return;
    if (!qrDraft.trim()) {
      setManualEntry(false);
      return;
    }
    if (!beginSave()) return;
    try {
      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrCodeValue: qrDraft.trim() }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed");
        setError(msg);
        return;
      }
      setManualEntry(false);
      setQrDraft("");
      invalidateItemCatalog();
      onRefresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      endSave();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <div>
            <DialogTitle>QR Code</DialogTitle>
            <DialogDescription>Identity details for {asset.assetTag}</DialogDescription>
          </div>
        </DialogHeader>
        <DialogBody className="py-5">
          <div className="flex flex-col items-center">
            {asset.qrCodeValue ? (
              <div className="rounded-lg bg-white p-2.5 ring-1 ring-black/10 dark:ring-white/10">
                <QRCodeCanvas value={asset.qrCodeValue} size={204} />
              </div>
            ) : (
              <div className="flex size-[224px] items-center justify-center rounded-lg bg-muted/25 text-sm text-muted-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
                No QR code yet
              </div>
            )}
            {asset.qrCodeValue && (
              <div className="mt-3 flex items-center gap-0.5">
                <span className="font-mono text-base font-semibold tracking-wide">
                  {asset.qrCodeValue}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:text-foreground"
                  onClick={copyCode}
                  aria-label={copied ? "Copied QR code" : `Copy QR code ${asset.qrCodeValue}`}
                >
                  {copied ? (
                    <Check className="size-3.5 text-[var(--green-text)]" aria-hidden="true" />
                  ) : (
                    <Copy className="size-3.5" aria-hidden="true" />
                  )}
                </Button>
              </div>
            )}
          </div>
          {canEdit && !manualEntry && (
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" className="h-10" onClick={generateQR} disabled={saving}>
                <RefreshCcw className={cn("size-3.5", saving && "animate-spin")} aria-hidden="true" />
                {saving ? "Generating..." : "Generate new QR"}
              </Button>
              <Button className="h-10"
                variant="outline"
                onClick={() => setManualEntry(true)}
                disabled={saving}
              >
                <PencilLine className="size-3.5" aria-hidden="true" />
                Enter manually
              </Button>
            </div>
          )}
          {canEdit && manualEntry && (
            <div className="mt-4 flex gap-2">
              <Input
                value={qrDraft}
                onChange={(e) => setQrDraft(e.target.value)}
                placeholder="Paste or type QR code..."
                className="flex-1 font-mono"
                disabled={saving}
                aria-busy={saving}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveManualQR();
                  if (e.key === "Escape") setManualEntry(false);
                }}
                autoFocus
              />
              <Button className="h-10" onClick={saveManualQR} disabled={saving} loading={saving}>
                Save
              </Button>
              <Button
                variant="outline"
                className="h-10"
                onClick={() => {
                  setManualEntry(false);
                  setQrDraft("");
                  setError("");
                }}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          )}
          {error && (
            <div className="text-destructive text-sm mt-3 text-center">
              {error}
            </div>
          )}
        </DialogBody>
        {asset.qrCodeValue && (
          <DialogFooter>
            <Button variant="outline" onClick={downloadPng}>
              <Download className="size-4" aria-hidden="true" />
              Download PNG
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ── Scan Value Row (click-to-copy identity value) ──────── */

export function ScanValueRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <>
      <dt className="flex h-8 items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="flex h-8 min-w-0 items-center">
        <button
          type="button"
          onClick={onCopy}
          className="group/copy flex h-8 min-w-0 max-w-full items-center gap-1.5 rounded-sm pr-1 font-mono text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={copied ? `Copied ${label}` : `Copy ${label} ${value}`}
        >
          <span className="min-w-0 truncate">{value}</span>
          {copied ? (
            <Check className="size-3 shrink-0 text-[var(--green-text)]" aria-hidden="true" />
          ) : (
            <Copy
              className="size-3 shrink-0 opacity-50 transition-opacity group-hover/copy:opacity-100"
              aria-hidden="true"
            />
          )}
        </button>
      </dd>
    </>
  );
}
