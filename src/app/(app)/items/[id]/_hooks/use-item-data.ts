"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useBreadcrumbLabel } from "@/components/BreadcrumbContext";
import { toast } from "@/lib/toast";
import { useCurrentUser } from "@/hooks/use-current-user";
import { ITEM_CHANGE_SYNC_EVENT, type ItemChangeSyncEventDetail } from "@/hooks/use-item-change-sync";
import {
  classifyError,
  isAbortError,
  handleAuthRedirect,
  parseJsonSafely,
  type FetchErrorKind,
} from "@/lib/errors";

import type { AssetDetail, CategoryOption } from "../types";
import type { DepartmentOption } from "../ItemInfoTab";

function normalizeAssetDetail(asset: AssetDetail): AssetDetail {
  return {
    ...asset,
    updatedAt: asset.updatedAt ?? "",
    type: asset.type ?? asset.category?.name ?? "",
    brand: asset.brand ?? "",
    model: asset.model ?? "",
    serialNumber: asset.serialNumber ?? null,
    qrCodeValue: asset.qrCodeValue ?? "",
    purchaseDate: asset.purchaseDate ?? null,
    purchasePrice: asset.purchasePrice ?? null,
    warrantyDate: asset.warrantyDate ?? null,
    residualValue: asset.residualValue ?? null,
    status: asset.status ?? asset.computedStatus,
    isFavorited: asset.isFavorited ?? false,
    notes: asset.notes ?? null,
    linkUrl: asset.linkUrl ?? null,
    department: asset.department ?? null,
    availableForReservation: asset.availableForReservation ?? true,
    availableForCheckout: asset.availableForCheckout ?? false,
    availableForCustody: asset.availableForCustody ?? false,
    collaboratorVisible: asset.collaboratorVisible ?? true,
    metadata: asset.metadata ?? null,
    activeBooking: asset.activeBooking ?? null,
    hasBookingHistory: asset.hasBookingHistory ?? false,
    parentAsset: asset.parentAsset ?? null,
    firmwareWatch: asset.firmwareWatch ?? null,
    accessories: asset.accessories ?? [],
    upcomingReservations: asset.upcomingReservations ?? [],
    history: asset.history ?? [],
  };
}

export type UseItemDataReturn = {
  asset: AssetDetail | null;
  setAsset: React.Dispatch<React.SetStateAction<AssetDetail | null>>;
  fetchError: FetchErrorKind | "not-found" | false;
  refreshing: boolean;
  lastRefreshed: Date | null;
  currentUserRole: string;
  categories: CategoryOption[];
  departments: DepartmentOption[];
  locations: { id: string; name: string }[];
  now: Date;
  loadAsset: () => void;
  loadCategories: () => void;
  loadDepartments: () => void;
  loadLocations: () => void;
  canEdit: boolean;
};

export default function useItemData(id: string): UseItemDataReturn {
  const { setBreadcrumbLabel } = useBreadcrumbLabel();
  const [asset, setAsset] = useState<AssetDetail | null>(null);
  const { data: currentUser } = useCurrentUser();
  const currentUserRole = currentUser?.role ?? "";
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [locations, setLocations] = useState<{ id: string; name: string }[]>([]);
  const [fetchError, setFetchError] = useState<FetchErrorKind | "not-found" | false>(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const abortRef = useRef<AbortController | null>(null);
  const hasLoadedOnce = useRef(false);
  const fetchErrorRef = useRef<FetchErrorKind | "not-found" | false>(false);

  const loadAsset = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const isRefresh = hasLoadedOnce.current;
    if (isRefresh) setRefreshing(true);

    fetch(`/api/assets/${id}`, { signal: controller.signal })
      .then((res) => {
        if (controller.signal.aborted) return null;
        if (handleAuthRedirect(res, `/items/${id}`)) return null;
        if (res.status === 404) {
          if (!isRefresh) { fetchErrorRef.current = "not-found"; setFetchError("not-found"); }
          return null;
        }
        if (!res.ok) throw new Error("server");
        return parseJsonSafely<{ data?: AssetDetail }>(res);
      })
      .then((json) => {
        if (!json || controller.signal.aborted) {
          if (!hasLoadedOnce.current && !controller.signal.aborted && !fetchErrorRef.current) {
            fetchErrorRef.current = "server";
            setFetchError("server");
          }
          return;
        }
        if (json?.data) {
          const normalized = normalizeAssetDetail(json.data);
          setAsset(normalized);
          setBreadcrumbLabel(json.data.assetTag);
          fetchErrorRef.current = false;
          setFetchError(false);
          setLastRefreshed(new Date());
          hasLoadedOnce.current = true;
        } else if (!isRefresh) {
          fetchErrorRef.current = "server";
          setFetchError("server");
        }
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        if (isRefresh) {
          toast.error("Failed to refresh — your data may be stale.");
        } else {
          const kind = classifyError(err);
          fetchErrorRef.current = kind;
          setFetchError(kind);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setRefreshing(false);
      });
  }, [id, setBreadcrumbLabel]);

  const loadCategories = useCallback(() => {
    fetch("/api/categories")
      .then((res) => res.ok ? parseJsonSafely<{ data?: CategoryOption[] }>(res) : null)
      .then((json) => { if (Array.isArray(json?.data)) setCategories(json.data); })
      .catch(() => {});
  }, []);

  const loadDepartments = useCallback(() => {
    fetch("/api/departments")
      .then((res) => res.ok ? parseJsonSafely<{ data?: DepartmentOption[] }>(res) : null)
      .then((json) => { if (Array.isArray(json?.data)) setDepartments(json.data); })
      .catch(() => {});
  }, []);

  const loadLocations = useCallback(() => {
    fetch("/api/locations")
      .then((res) => res.ok ? parseJsonSafely<{ data?: { id: string; name: string }[] }>(res) : null)
      .then((json) => { if (Array.isArray(json?.data)) setLocations(json.data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadAsset();
    loadCategories();
    loadDepartments();
    loadLocations();
    return () => { abortRef.current?.abort(); };
  }, [loadAsset, loadCategories, loadDepartments, loadLocations]);

  // Live countdown tick every 60 seconds + refresh on tab focus
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60_000);
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        setNow(new Date());
        // Refresh asset data when tab becomes visible
        if (hasLoadedOnce.current) loadAsset();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [loadAsset]);

  useEffect(() => {
    function onItemChange(event: Event) {
      const detail = (event as CustomEvent<ItemChangeSyncEventDetail>).detail;
      if (detail?.changedAssetIds.includes(id)) loadAsset();
    }

    window.addEventListener(ITEM_CHANGE_SYNC_EVENT, onItemChange);
    return () => window.removeEventListener(ITEM_CHANGE_SYNC_EVENT, onItemChange);
  }, [id, loadAsset]);

  const canEdit = currentUserRole === "ADMIN" || currentUserRole === "STAFF";

  return {
    asset,
    setAsset,
    fetchError,
    refreshing,
    lastRefreshed,
    currentUserRole,
    categories,
    departments,
    locations,
    now,
    loadAsset,
    loadCategories,
    loadDepartments,
    loadLocations,
    canEdit,
  };
}
