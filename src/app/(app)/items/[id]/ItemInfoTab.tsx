"use client";

import { useCallback, useState } from "react";
import { toast } from "@/lib/toast";
import { useCopyFeedback } from "@/hooks/use-copy-feedback";
import { useInvalidateItemCatalog } from "@/hooks/use-item-cache-invalidation";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import type { AssetDetail, CategoryOption } from "./types";
import { FieldGroup } from "@/components/SaveableField";
import { FirmwareWatchPanel } from "./FirmwareWatchPanel";
import { CurrencyInputField, LinkField, NotesField, SaveableCategoryField, SaveableDatePickerField, SaveableNativeSelectField, TextInputField } from "./ItemInfoFields";
import { QRCodeCanvas, QRModal, ScanValueRow } from "./ItemQrModal";
import { parseUsdDraft } from "./item-info-format";

/* ── Item Info Card (tab entry point) ───────────────────── */

export type LocationOption = { id: string; name: string };

export type DepartmentOption = { id: string; name: string };

export default function ItemInfoCard({
  asset,
  canEdit,
  currentUserRole,
  categories,
  departments,
  locations,
  onFieldSaved,
  onRefresh,
  onCategoriesChanged,
}: {
  asset: AssetDetail;
  canEdit: boolean;
  currentUserRole: string;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  locations: LocationOption[];
  onFieldSaved: (updated: Partial<AssetDetail>) => void;
  onRefresh: () => void;
  onCategoriesChanged: () => void;
}) {
  const [showQrModal, setShowQrModal] = useState(false);
  const { copiedKey: copiedScanValue, copy: copyWithFeedback } = useCopyFeedback(1600);
  const invalidateItemCatalog = useInvalidateItemCatalog();
  const saveField = useCallback(
    async (patchKey: string, value: string) => {
      const body: Record<string, unknown> = {};
      if (patchKey === "purchasePrice" || patchKey === "residualValue") {
        const normalized = parseUsdDraft(value);
        body[patchKey] = normalized ? Number(normalized) : null;
      } else if (patchKey.startsWith("metadata.")) {
        const metaKey = patchKey.split(".")[1]!; // guaranteed by startsWith("metadata.") check
        const currentMeta = asset.metadata || {};
        const newMeta = { ...currentMeta, [metaKey]: value || undefined };
        body.notes = JSON.stringify(newMeta);
      } else {
        const nullableKeys = new Set(["name", "serialNumber", "purchaseDate", "warrantyDate", "linkUrl"]);
        body[patchKey] = nullableKeys.has(patchKey) ? value || null : value;
      }

      const res = await fetch(`/api/assets/${asset.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Save failed");
        throw new Error(msg);
      }

      if (patchKey.startsWith("metadata.")) {
        const metaKey = patchKey.split(".")[1]!; // guaranteed by startsWith("metadata.") check
        onFieldSaved({ metadata: { ...asset.metadata, [metaKey]: value } });
      } else {
        const nullableKeys = new Set(["name", "serialNumber", "purchaseDate", "warrantyDate", "linkUrl"]);
        const numericKeys = new Set(["purchasePrice", "residualValue"]);
        const nextValue = numericKeys.has(patchKey)
          ? value
            ? Number(parseUsdDraft(value))
            : null
          : nullableKeys.has(patchKey)
            ? value || null
            : value;
        onFieldSaved({
          [patchKey]: nextValue,
        } as Partial<AssetDetail>);
      }
      invalidateItemCatalog();
    },
    [asset.id, asset.metadata, invalidateItemCatalog, onFieldSaved],
  );

  async function saveCategory(categoryId: string) {
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categoryId: categoryId || null }),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to save category"));
    invalidateItemCatalog();
    onRefresh();
  }

  async function saveDepartment(departmentId: string) {
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ departmentId: departmentId || null }),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to save department"));
    invalidateItemCatalog();
    onRefresh();
  }

  async function saveLocation(locationId: string) {
    const res = await fetch(`/api/assets/${asset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId }),
    });
    if (handleAuthRedirect(res)) return;
    if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to save location"));
    invalidateItemCatalog();
    onRefresh();
  }

  /** Compute fiscal year from a date string (FY begins July 1) */
  function computeFiscalYear(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "";
    const month = d.getMonth(); // 0-indexed
    const year = d.getFullYear();
    // FY begins July 1: dates in Jul-Dec belong to FY (year+1), Jan-Jun belong to FY (year)
    return String(month >= 6 ? year + 1 : year);
  }

  function getFiscalYearOptions() {
    const today = new Date();
    const currentFiscalYear = today.getMonth() >= 6 ? today.getFullYear() + 1 : today.getFullYear();
    const existing = asset.metadata?.fiscalYearPurchased;
    const years = new Set<string>();
    for (let year = currentFiscalYear + 2; year >= 2000; year -= 1) {
      years.add(String(year));
    }
    if (existing) years.add(existing);
    return [...years]
      .sort((a, b) => Number(b) - Number(a))
      .map((year) => ({ value: year, label: year }));
  }

  async function copyScanValue(kind: "qr" | "serial", value: string) {
    if (!value) return;
    const result = await copyWithFeedback(value, kind);
    if (result === "failed") {
      toast.error(`Could not copy the ${kind === "qr" ? "QR code" : "serial number"}`, {
        description: "Select the visible value and copy it manually.",
      });
    }
  }

  return (
    <Card className="details-card border-border/40">
      <div className="border-b border-border/30 p-2.5">
        <div className="rounded-md bg-muted/25 px-3 py-2.5 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <div className="grid grid-cols-[minmax(0,1fr)_88px] items-start gap-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold">Identity</div>
                <Badge variant="outline" size="sm" className="rounded-sm bg-background text-muted-foreground">
                  Admin
                </Badge>
              </div>
              <dl className="mt-2 grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 text-xs">
                {asset.qrCodeValue ? (
                  <ScanValueRow
                    label="QR"
                    value={asset.qrCodeValue}
                    copied={copiedScanValue === "qr"}
                    onCopy={() => copyScanValue("qr", asset.qrCodeValue)}
                  />
                ) : (
                  <>
                    <dt className="flex h-8 items-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">QR</dt>
                    <dd className="flex h-8 min-w-0 items-center">
                      <span className="font-mono text-muted-foreground">No QR code</span>
                    </dd>
                  </>
                )}
                {asset.serialNumber && (
                  <ScanValueRow
                    label="Serial"
                    value={asset.serialNumber}
                    copied={copiedScanValue === "serial"}
                    onCopy={() => copyScanValue("serial", asset.serialNumber ?? "")}
                  />
                )}
                {asset.firmwareWatch && (
                  <FirmwareWatchPanel
                    asset={asset}
                    canEdit={canEdit}
                    firmwareWatch={asset.firmwareWatch}
                    onSaveInstalledVersion={(v) => saveField("metadata.installedFirmwareVersion", v)}
                  />
                )}
              </dl>
            </div>
            <div className="flex w-[88px] shrink-0 flex-col items-stretch">
              <button
                type="button"
                className="group flex aspect-square w-full items-center justify-center rounded-md bg-background p-1 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] outline-none transition-[background-color,box-shadow,transform] hover:bg-muted/50 active:scale-[0.96] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                onClick={() => setShowQrModal(true)}
                aria-label={canEdit ? "Open QR code details" : "View QR code"}
              >
                {asset.qrCodeValue ? (
                  <QRCodeCanvas value={asset.qrCodeValue} size={72} margin={1} />
                ) : (
                  <span className="text-xs text-muted-foreground">QR</span>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="py-1">
        <FieldGroup label="Product">
          <TextInputField
            label="Asset tag"
            value={asset.assetTag}
            canEdit={canEdit}
            onSave={(v) => saveField("assetTag", v)}
          />
          <TextInputField
            label="Product name"
            value={asset.name || ""}
            placeholder="Add product name"
            canEdit={canEdit}
            onSave={(v) => saveField("name", v)}
          />
          <TextInputField
            label="Brand"
            value={asset.brand}
            placeholder="Add brand"
            canEdit={canEdit}
            onSave={(v) => saveField("brand", v)}
          />
          <TextInputField
            label="Model"
            value={asset.model}
            placeholder="Add model"
            canEdit={canEdit}
            onSave={(v) => saveField("model", v)}
          />
          <TextInputField
            label="Serial"
            value={asset.serialNumber}
            canEdit={canEdit}
            onSave={(v) => saveField("serialNumber", v)}
            mono
            warnDuplicate={{ field: "serialNumber", assetId: asset.id }}
          />
          <TextInputField
            label="UW asset tag"
            value={asset.metadata?.uwAssetTag || ""}
            placeholder="Add UW asset tag"
            canEdit={canEdit}
            onSave={(v) => saveField("metadata.uwAssetTag", v)}
          />
        </FieldGroup>
        <FieldGroup label="Organization">
          <SaveableNativeSelectField
            label="Department"
            value={asset.department?.id || ""}
            options={departments.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="Select department"
            canEdit={canEdit}
            onSave={saveDepartment}
          />
          <SaveableCategoryField
            currentId={asset.category?.id || ""}
            displayName={asset.category?.name || ""}
            canEdit={canEdit}
            categories={categories}
            onSave={saveCategory}
            onCategoriesChanged={onCategoriesChanged}
          />
          <SaveableNativeSelectField
            label="Location"
            value={asset.location.id}
            options={locations.map((l) => ({ value: l.id, label: l.name }))}
            placeholder="Select location"
            canEdit={canEdit}
            onSave={saveLocation}
          />
        </FieldGroup>
        {/* ── Procurement fields (hidden from students) ── */}
        {currentUserRole !== "STUDENT" && (
          <FieldGroup label="Procurement">
            <SaveableDatePickerField
              label="Purchase date"
              value={
                asset.purchaseDate
                  ? asset.purchaseDate.slice(0, 10)
                  : ""
              }
              canEdit={canEdit}
              onSave={async (v) => {
                await saveField("purchaseDate", v);
                if (v) {
                  const fy = computeFiscalYear(v);
                  if (fy) await saveField("metadata.fiscalYearPurchased", fy);
                }
              }}
            />
            <SaveableNativeSelectField
              label="Fiscal year"
              value={asset.metadata?.fiscalYearPurchased || ""}
              options={getFiscalYearOptions()}
              placeholder="Select fiscal year"
              canEdit={canEdit}
              onSave={(v) => saveField("metadata.fiscalYearPurchased", v)}
            />
            <CurrencyInputField
              label="Purchase price"
              value={asset.purchasePrice}
              placeholder="0.00"
              canEdit={canEdit}
              onSave={(v) => saveField("purchasePrice", v)}
            />
            <LinkField
              label="Link"
              value={asset.linkUrl || ""}
              placeholder="Add product link"
              canEdit={canEdit}
              onSave={(v) => saveField("linkUrl", v)}
            />
          </FieldGroup>
        )}
        {/* ── Notes section ── */}
        <FieldGroup>
          <NotesField
            value={asset.metadata?.userNotes || ""}
            canEdit={canEdit}
            onSave={(v) => saveField("metadata.userNotes", v)}
          />
        </FieldGroup>
      </div>
      <QRModal
        asset={asset}
        canEdit={canEdit}
        onRefresh={onRefresh}
        open={showQrModal}
        onOpenChange={setShowQrModal}
      />
    </Card>
  );
}
