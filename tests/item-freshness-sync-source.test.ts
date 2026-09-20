import { describe, expect, it } from "vitest";
import { source } from "./_helpers/source";

describe("item freshness sync source contract", () => {
  it("forces the Items list query to verify server truth on mount", () => {
    const hook = source("src/app/(app)/items/hooks/use-items-query.ts");

    expect(hook).toMatch(/queryKey,[\s\S]*?staleTime:\s*60_000,[\s\S]*?refetchOnMount:\s*"always"/);
  });

  it("polls the lightweight item change signal instead of the heavy assets route", () => {
    const hook = source("src/hooks/use-item-change-sync.ts");

    expect(hook).toContain('"/api/items/changes"');
    expect(hook).not.toContain('"/api/assets"');
    expect(hook).toContain("ITEM_CHANGE_SYNC_INTERVAL_MS = 60_000");
    expect(hook).toContain("useOperationalPollingActivity()");
    expect(hook).toContain('pollingState !== "active"');
  });

  it("invalidates list, picker, serialized detail, and item-family detail caches", () => {
    const hook = source("src/hooks/use-item-change-sync.ts");

    expect(hook).toContain('queryKey: ["items"]');
    expect(hook).toContain('queryKey: ["form-options"]');
    expect(hook).toContain('queryKey: ["item", assetId]');
    expect(hook).toContain('queryKey: ["bulkSku", bulkSkuId]');
    expect(hook).toContain("ITEM_CHANGE_SYNC_EVENT");
    expect(hook).toContain("window.dispatchEvent");
  });

  it("wires item change sync into the Items list and item detail routes", () => {
    const list = source("src/app/(app)/items/page.tsx");
    const detail = source("src/app/(app)/items/[id]/page.tsx");
    const bulkDetail = source("src/app/(app)/bulk-inventory/[id]/BulkSkuDetailExperience.tsx");

    expect(list).toContain('import { useItemChangeSync } from "@/hooks/use-item-change-sync"');
    expect(list).toContain("useItemChangeSync();");
    expect(detail).toContain('import { useItemChangeSync } from "@/hooks/use-item-change-sync"');
    expect(detail).toContain("useItemChangeSync();");
    expect(bulkDetail).toContain('import { useItemChangeSync } from "@/hooks/use-item-change-sync"');
    expect(bulkDetail).toContain("useItemChangeSync();");
  });

  it("refreshes open serialized and item-family detail views when their ids change", () => {
    const serializedHook = source("src/app/(app)/items/[id]/_hooks/use-item-data.ts");
    const bulkHook = source("src/app/(app)/bulk-inventory/[id]/_hooks/use-bulk-sku-data.ts");

    expect(serializedHook).toContain("ITEM_CHANGE_SYNC_EVENT");
    expect(serializedHook).toContain("window.addEventListener(ITEM_CHANGE_SYNC_EVENT");
    expect(serializedHook).toContain("changedAssetIds.includes(id)");
    expect(serializedHook).toContain("loadAsset()");
    expect(bulkHook).toContain("ITEM_CHANGE_SYNC_EVENT");
    expect(bulkHook).toContain("window.addEventListener(ITEM_CHANGE_SYNC_EVENT");
    expect(bulkHook).toContain("changedBulkSkuIds.includes(id)");
    expect(bulkHook).toContain("loadSku()");
  });

  it("marks item-family caches stale after detail mutations", () => {
    const serializedActions = source("src/app/(app)/items/[id]/_hooks/use-item-actions.ts");
    const serializedInfo = source("src/app/(app)/items/[id]/ItemInfoTab.tsx");
    const bulkInfo = source("src/app/(app)/bulk-inventory/[id]/BulkSkuInfoTab.tsx");

    expect(serializedActions).toContain('import { useInvalidateItemCatalog } from "@/hooks/use-item-cache-invalidation"');
    expect(serializedActions).toContain("invalidateItemCatalog();");
    expect(serializedInfo).toContain('import { useInvalidateItemCatalog } from "@/hooks/use-item-cache-invalidation"');
    expect(serializedInfo).toContain("invalidateItemCatalog();");
    expect(bulkInfo).toContain('import { useInvalidateItemCatalog } from "@/hooks/use-item-cache-invalidation"');
    expect(bulkInfo).toContain("invalidateItemCatalog();");
  });

  it("serves item changes from Asset, BulkSku, and audit-log cursors", () => {
    const route = source("src/app/api/items/changes/route.ts");

    expect(route).toContain('requirePermission(user.role, "asset", "view")');
    expect(route).toContain('requirePermission(user.role, "bulk_sku", "view")');
    expect(route).toContain('db.asset.findMany');
    expect(route).toContain('db.bulkSku.findMany');
    expect(route).toContain('db.auditLog.findMany');
    expect(route).toContain('"asset"');
    expect(route).toContain('"bulk_sku"');
    expect(route).toContain("encodeCursor(cursorDate)");
    expect(route).toContain("changedAssetIds");
    expect(route).toContain("changedBulkSkuIds");
  });
});
