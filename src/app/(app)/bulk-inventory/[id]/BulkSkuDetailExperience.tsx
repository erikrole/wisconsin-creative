"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import EmptyState from "@/components/EmptyState";
import { FadeUp } from "@/components/ui/motion";
import { BulkSkuHeader } from "./_components/BulkSkuHeader";
import { BulkSkuInfoTab } from "./BulkSkuInfoTab";
import { BulkSkuOverviewCard } from "./BulkSkuOverviewCard";
import useBulkSkuData from "./_hooks/use-bulk-sku-data";
import { useInvalidateItemCatalog } from "@/hooks/use-item-cache-invalidation";
import { useItemChangeSync } from "@/hooks/use-item-change-sync";
import { parseDetailTab, serializeDetailTab, useUrlState } from "@/hooks/use-url-state";
import ActivityFeed from "../../items/[id]/ItemHistoryTab";

const BulkSkuUnitsTab = dynamic(() => import("./BulkSkuUnitsTab"), { ssr: false });
const BulkSkuQrTab = dynamic(() => import("./BulkSkuQrTab"), { ssr: false });
const BulkSkuSettingsTab = dynamic(() => import("./BulkSkuSettingsTab"), { ssr: false });

type TabKey = "info" | "units" | "qr" | "history" | "settings";

const allTabDefs: Array<{ key: TabKey; label: string }> = [
  { key: "info", label: "Info" },
  { key: "units", label: "Units" },
  { key: "qr", label: "QR" },
  { key: "history", label: "History" },
  { key: "settings", label: "Settings" },
];

export function BulkSkuDetailExperience({
  id,
  operationsHref,
}: {
  id: string;
  operationsHref?: string;
}) {
  const [activeTab, setActiveTab] = useUrlState<TabKey>(
    "tab",
    (raw) => parseDetailTab(raw, allTabDefs, "info"),
    (tab) => serializeDetailTab(tab, "info"),
  );

  const { sku, setSku, fetchError, refreshing, canEdit, loadSku } = useBulkSkuData(id);
  const invalidateItemCatalog = useInvalidateItemCatalog();
  useItemChangeSync();

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
  }

  useEffect(() => {
    if (!sku) return;
    const tabIsVisible =
      activeTab === "info" ||
      activeTab === "history" ||
      (activeTab === "units" && sku.trackByNumber) ||
      (activeTab === "qr" && canEdit) ||
      (activeTab === "settings" && canEdit);

    if (!tabIsVisible) {
      setActiveTab("info");
    }
  }, [activeTab, canEdit, setActiveTab, sku]);

  if (fetchError && !sku) {
    return (
      <EmptyState
        icon="box"
        title={fetchError === "not-found" ? "Item not found" : "Something went wrong"}
        description={fetchError === "not-found" ? "This item may have been deleted." : "We couldn't load this item."}
        actionLabel="Back to Items"
        actionHref="/items"
      />
    );
  }

  if (!sku) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-9 w-96 mt-4" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6 mt-4">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  const tabDefs: Array<{ key: TabKey; label: string; hidden?: boolean }> = [
    { key: "info", label: "Info" },
    { key: "units", label: "Units", hidden: !sku.trackByNumber },
    { key: "qr", label: "QR", hidden: !canEdit },
    { key: "history", label: "History" },
    { key: "settings", label: "Settings", hidden: !canEdit },
  ];
  const visibleTabs = tabDefs.filter((tab) => !tab.hidden);

  return (
    <FadeUp>
      <div className="mx-auto w-full max-w-7xl">
        <BulkSkuHeader
          sku={sku}
          refreshing={refreshing}
          canEdit={canEdit}
          onRefresh={loadSku}
          operationsHref={operationsHref}
          onImageChanged={(url) => {
            setSku((prev) => prev ? { ...prev, imageUrl: url } : prev);
            invalidateItemCatalog();
          }}
        />

        <Tabs value={activeTab} onValueChange={(v) => switchTab(v as TabKey)}>
          <TabsList className="sticky top-0 z-10 overflow-x-auto bg-background/95 backdrop-blur-sm scrollbar-hide">
            {visibleTabs.map((tab) => (
              <TabsTrigger
                key={tab.key}
                value={tab.key}
                className="relative shrink-0 border-b-transparent data-[state=active]:border-b-transparent after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-[var(--wi-red)] after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100"
              >
                <span style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}>{tab.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {activeTab === "info" && (
          <div className="mt-3.5 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
            <BulkSkuOverviewCard sku={sku} onOpenUnits={() => switchTab("units")} />
            <BulkSkuInfoTab
              sku={sku}
              canEdit={canEdit}
              onFieldSaved={(partial) => {
                setSku((prev) => prev ? { ...prev, ...partial } : prev);
                invalidateItemCatalog();
              }}
              onManageQr={() => switchTab("qr")}
            />
          </div>
        )}

        {activeTab === "units" && sku.trackByNumber && (
          <BulkSkuUnitsTab
            sku={sku}
            canEdit={canEdit}
            onRefresh={loadSku}
            onUnitsAdded={(count) => {
              invalidateItemCatalog();
              setSku((prev) =>
                prev ? { ...prev, onHand: prev.onHand + count, availableQuantity: prev.availableQuantity + count } : prev
              );
            }}
          />
        )}

        {activeTab === "qr" && (
          <BulkSkuQrTab
            sku={sku}
            canEdit={canEdit}
            onFieldSaved={(partial) => {
              setSku((prev) => prev ? { ...prev, ...partial } : prev);
              invalidateItemCatalog();
            }}
          />
        )}

        {activeTab === "history" && (
          <Card className="mt-3.5 max-w-4xl border-border/40 shadow-none">
            <CardHeader><CardTitle>Item history</CardTitle></CardHeader>
            <CardContent className="p-4">
              <ActivityFeed
                assetId={sku.id}
                assetName={sku.name}
                endpoint={`/api/bulk-skus/${sku.id}/activity`}
              />
            </CardContent>
          </Card>
        )}

        {activeTab === "settings" && canEdit && (
          <BulkSkuSettingsTab
            sku={sku}
            onRefresh={() => {
              invalidateItemCatalog();
              void loadSku();
            }}
          />
        )}
      </div>
    </FadeUp>
  );
}
