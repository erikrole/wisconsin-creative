"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SortingState } from "@tanstack/react-table";

export type ItemTypeFilter = "all" | "serialized" | "unit-tracked" | "quantity-tracked";

export type FilterState = {
  search: string;
  statusFilter: Set<string>;
  locationFilter: Set<string>;
  categoryFilter: Set<string>;
  brandFilter: Set<string>;
  departmentFilter: Set<string>;
  sorting: SortingState;
  hasActiveFilters: boolean;
};

export type FilterActions = {
  setSearch: (value: string) => void;
  setStatusFilter: (value: Set<string>) => void;
  setLocationFilter: (value: Set<string>) => void;
  setCategoryFilter: (value: Set<string>) => void;
  setBrandFilter: (value: Set<string>) => void;
  setDepartmentFilter: (value: Set<string>) => void;
  setSorting: (value: SortingState) => void;
  clearAllFilters: () => void;
};

function readSet(params: URLSearchParams, key: string): Set<string> {
  return new Set(params.getAll(key).filter(Boolean));
}

function readItemType(params: URLSearchParams): ItemTypeFilter {
  const raw = params.get("type");
  if (raw === "bulk") return "unit-tracked";
  if (raw === "serialized" || raw === "unit-tracked" || raw === "quantity-tracked") return raw;
  return "all";
}

export const DEFAULT_ITEMS_SORT_ID = "popular";

function defaultItemsSorting(): SortingState {
  return [{ id: DEFAULT_ITEMS_SORT_ID, desc: false }];
}

export function normalizeItemsSorting(sorting: SortingState): SortingState {
  return sorting.length === 0 ? defaultItemsSorting() : sorting;
}

function isDefaultItemsSorting(sorting: SortingState): boolean {
  const current = sorting[0];
  return sorting.length === 1 && current?.id === DEFAULT_ITEMS_SORT_ID && current.desc === false;
}

function readSorting(params: URLSearchParams): SortingState {
  const sort = params.get("sort");
  const order = params.get("order");
  if (sort) return [{ id: sort, desc: order === "desc" }];
  return defaultItemsSorting();
}

function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function sortingEqual(a: SortingState, b: SortingState) {
  if (a.length !== b.length) return false;
  return a.every((sort, index) => sort.id === b[index]?.id && sort.desc === b[index]?.desc);
}

export function useUrlFilters() {
  const searchParams = useSearchParams();
  const searchSignature = searchParams.toString();
  const lastObservedSearchSignatureRef = useRef(searchSignature);
  const skipNextWriteRef = useRef(false);

  // Search commits arrive pre-debounced from DebouncedSearchInput, so this is
  // already the settled query value.
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(() => readSet(searchParams, "status"));
  const [locationFilter, setLocationFilter] = useState<Set<string>>(() => readSet(searchParams, "location"));
  const [categoryFilter, setCategoryFilter] = useState<Set<string>>(() => readSet(searchParams, "category"));
  const [brandFilter, setBrandFilter] = useState<Set<string>>(() => readSet(searchParams, "brand"));
  const [departmentFilter, setDepartmentFilter] = useState<Set<string>>(() => readSet(searchParams, "department"));
  const [itemType, setItemType] = useState<ItemTypeFilter>(() => readItemType(searchParams));
  const [showAccessories, setShowAccessories] = useState(() => searchParams.get("accessories") === "1");
  const [favoritesOnly, setFavoritesOnly] = useState(() => searchParams.get("favorites") === "1");
  const [sorting, setSorting] = useState<SortingState>(() => readSorting(searchParams));

  useEffect(() => {
    if (lastObservedSearchSignatureRef.current === searchSignature) return;
    lastObservedSearchSignatureRef.current = searchSignature;
    skipNextWriteRef.current = true;

    const nextSearch = searchParams.get("q") ?? "";
    setSearch((current) => (current === nextSearch ? current : nextSearch));

    const nextStatus = readSet(searchParams, "status");
    const nextLocation = readSet(searchParams, "location");
    const nextCategory = readSet(searchParams, "category");
    const nextBrand = readSet(searchParams, "brand");
    const nextDepartment = readSet(searchParams, "department");
    setStatusFilter((current) => (setsEqual(current, nextStatus) ? current : nextStatus));
    setLocationFilter((current) => (setsEqual(current, nextLocation) ? current : nextLocation));
    setCategoryFilter((current) => (setsEqual(current, nextCategory) ? current : nextCategory));
    setBrandFilter((current) => (setsEqual(current, nextBrand) ? current : nextBrand));
    setDepartmentFilter((current) => (setsEqual(current, nextDepartment) ? current : nextDepartment));

    const nextItemType = readItemType(searchParams);
    setItemType((current) => (current === nextItemType ? current : nextItemType));
    const nextShowAccessories = searchParams.get("accessories") === "1";
    setShowAccessories((current) => (current === nextShowAccessories ? current : nextShowAccessories));
    const nextFavoritesOnly = searchParams.get("favorites") === "1";
    setFavoritesOnly((current) => (current === nextFavoritesOnly ? current : nextFavoritesOnly));
    const nextSorting = readSorting(searchParams);
    setSorting((current) => (sortingEqual(current, nextSorting) ? current : nextSorting));
  }, [searchParams, searchSignature]);

  const hasActiveFilters =
    statusFilter.size > 0 ||
    locationFilter.size > 0 ||
    categoryFilter.size > 0 ||
    brandFilter.size > 0 ||
    departmentFilter.size > 0 ||
    favoritesOnly ||
    showAccessories ||
    itemType !== "all";

  // Sync filters to URL search params
  useEffect(() => {
    if (skipNextWriteRef.current) {
      skipNextWriteRef.current = false;
      return;
    }

    const params = new URLSearchParams(window.location.search);
    [
      "q",
      "status",
      "location",
      "category",
      "brand",
      "department",
      "type",
      "accessories",
      "favorites",
      "sort",
      "order",
    ].forEach((key) => params.delete(key));

    if (search) params.set("q", search);
    statusFilter.forEach((v) => params.append("status", v));
    locationFilter.forEach((v) => params.append("location", v));
    categoryFilter.forEach((v) => params.append("category", v));
    brandFilter.forEach((v) => params.append("brand", v));
    departmentFilter.forEach((v) => params.append("department", v));
    if (itemType !== "all") params.set("type", itemType);
    if (showAccessories) params.set("accessories", "1");
    if (favoritesOnly) params.set("favorites", "1");
    if (sorting.length > 0 && !isDefaultItemsSorting(sorting)) {
      params.set("sort", sorting[0]!.id);
      if (sorting[0]!.desc) params.set("order", "desc");
    }
    const qs = params.toString();
    const newUrl = qs ? `?${qs}` : window.location.pathname;
    window.history.replaceState(null, "", newUrl);
  }, [search, statusFilter, locationFilter, categoryFilter, brandFilter, departmentFilter, itemType, showAccessories, favoritesOnly, sorting]);

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setStatusFilter(new Set());
    setLocationFilter(new Set());
    setCategoryFilter(new Set());
    setBrandFilter(new Set());
    setDepartmentFilter(new Set());
    setFavoritesOnly(false);
    setShowAccessories(false);
    setItemType("all");
  }, []);

  // Stable serialized keys for dependency tracking
  const statusKey = [...statusFilter].sort().join(",");
  const locationKey = [...locationFilter].sort().join(",");
  const categoryKey = [...categoryFilter].sort().join(",");
  const brandKey = [...brandFilter].sort().join(",");
  const departmentKey = [...departmentFilter].sort().join(",");
  const sortKey = sorting.length > 0 ? `${sorting[0]!.id}:${sorting[0]!.desc}` : "";

  return {
    // State
    itemType,
    favoritesOnly,
    showAccessories,
    search,
    statusFilter,
    locationFilter,
    categoryFilter,
    brandFilter,
    departmentFilter,
    sorting,
    hasActiveFilters,
    // Serialized keys for effect dependencies
    statusKey,
    locationKey,
    categoryKey,
    brandKey,
    departmentKey,
    sortKey,
    // Actions
    setItemType,
    setFavoritesOnly,
    setShowAccessories,
    setSearch,
    setStatusFilter,
    setLocationFilter,
    setCategoryFilter,
    setBrandFilter,
    setDepartmentFilter,
    setSorting,
    clearAllFilters,
  };
}
