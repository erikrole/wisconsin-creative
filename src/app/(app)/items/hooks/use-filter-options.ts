"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { buildCategoryPathOptions } from "@/lib/category-options";
import { useCurrentUser } from "@/hooks/use-current-user";
import type { CategoryOption } from "@/types/category";

type Location = { id: string; name: string };
type Department = { id: string; name: string };
type Kit = { id: string; name: string };
type ItemsPageRole = "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";

type ItemsPageInitData = {
  user: { role: ItemsPageRole };
  locations: Location[];
  departments: Department[];
  categories: CategoryOption[];
  brands: string[];
  kits: Kit[];
};

export type ItemsPageInitResponse = {
  data: ItemsPageInitData;
  partialFailures: string[];
};

export function itemsPageInitQueryKey(userId: string) {
  return ["items-page-init", userId] as const;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNamedOption(value: unknown): value is Location | Department | Kit {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isCategoryOption(value: unknown): value is CategoryOption {
  return isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.parentId === null || typeof value.parentId === "string");
}

function isItemsPageRole(value: unknown): value is ItemsPageRole {
  return value === "ADMIN" || value === "STAFF" || value === "STUDENT" || value === "COLLABORATOR";
}

function parseItemsPageInitResponse(value: unknown): ItemsPageInitResponse | null {
  if (!isRecord(value) || !isRecord(value.data)) return null;
  const { data } = value;
  const user = data.user;
  if (!isRecord(user)) return null;
  if (
    !isItemsPageRole(user.role) ||
    !Array.isArray(data.locations) || !data.locations.every(isNamedOption) ||
    !Array.isArray(data.departments) || !data.departments.every(isNamedOption) ||
    !Array.isArray(data.categories) || !data.categories.every(isCategoryOption) ||
    !Array.isArray(data.brands) || !data.brands.every((brand) => typeof brand === "string") ||
    !Array.isArray(data.kits) || !data.kits.every(isNamedOption)
  ) {
    return null;
  }

  return {
    data: {
      user: { role: user.role },
      locations: data.locations,
      departments: data.departments,
      categories: data.categories,
      brands: data.brands,
      kits: data.kits,
    },
    partialFailures: Array.isArray(value.partialFailures)
      ? value.partialFailures.filter((failure): failure is string => typeof failure === "string")
      : [],
  };
}

export async function fetchItemsPageInit(signal?: AbortSignal): Promise<ItemsPageInitResponse> {
  const response = await fetch("/api/items-page-init", { signal });
  if (handleAuthRedirect(response, "/items")) {
    throw new DOMException("Auth redirect", "AbortError");
  }
  if (!response.ok) throw new Error("Failed to load item controls");

  const json = await parseJsonSafely<unknown>(response);
  const parsed = parseItemsPageInitResponse(json);
  if (!parsed) throw new Error("Invalid item controls response");
  return parsed;
}

export function mergeItemsPageInitResponse(
  next: ItemsPageInitResponse,
  previous?: ItemsPageInitResponse,
): ItemsPageInitResponse {
  if (!previous || next.partialFailures.length === 0) return next;

  const failed = new Set(next.partialFailures);
  return {
    ...next,
    data: {
      ...next.data,
      locations: failed.has("locations") ? previous.data.locations : next.data.locations,
      departments: failed.has("departments") ? previous.data.departments : next.data.departments,
      categories: failed.has("categories") ? previous.data.categories : next.data.categories,
      brands: failed.has("brands") ? previous.data.brands : next.data.brands,
      kits: failed.has("kits") ? previous.data.kits : next.data.kits,
    },
  };
}

export function canEditItems(role: string | undefined) {
  return role === "ADMIN" || role === "STAFF";
}

export function canEditItemsForCurrentUser(
  currentUserRole: string | undefined,
  bootstrapRole: string | undefined,
) {
  return currentUserRole === bootstrapRole && canEditItems(bootstrapRole);
}

export function getItemsControlRecoveryMode(
  initialError: unknown,
  refreshError: unknown,
  partialFailures: readonly string[],
) {
  if (initialError) return "initial" as const;
  if (partialFailures.length > 0) return "partial" as const;
  if (refreshError) return "refresh" as const;
  return null;
}

export type BulkActionReferenceAvailability = {
  locations: boolean;
  categories: boolean;
  kits: boolean;
};

export function getBulkActionReferenceAvailability(
  partialFailures: readonly string[],
): BulkActionReferenceAvailability {
  const failed = new Set(partialFailures);
  return {
    locations: !failed.has("locations"),
    categories: !failed.has("categories"),
    kits: !failed.has("kits"),
  };
}

export function useFilterOptions() {
  const queryClient = useQueryClient();
  const { data: currentUser, isLoading: currentUserLoading } = useCurrentUser();
  const queryKey = itemsPageInitQueryKey(currentUser?.id ?? "unknown-user");
  const { data, error, isFetching, isLoading, refetch } = useQuery<ItemsPageInitResponse>({
    queryKey,
    queryFn: async ({ signal }) => {
      const next = await fetchItemsPageInit(signal);
      const previous = queryClient.getQueryData<ItemsPageInitResponse>(queryKey);
      return mergeItemsPageInitResponse(next, previous);
    },
    enabled: Boolean(currentUser?.id),
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
    staleTime: 60_000,
  });

  const initData = data?.data;
  const userRole = initData?.user.role;
  const categories = initData?.categories ?? [];

  return {
    locations: initData?.locations ?? [],
    departments: initData?.departments ?? [],
    categories,
    brands: initData?.brands ?? [],
    kits: initData?.kits ?? [],
    userRole: userRole ?? "",
    canEdit: canEditItemsForCurrentUser(currentUser?.role, userRole),
    categoryOptions: buildCategoryPathOptions(categories),
    loading: currentUserLoading || isLoading,
    refreshing: isFetching && !isLoading,
    initialError: error && !data ? error : null,
    refreshError: error && data ? error : null,
    partialFailures: data?.partialFailures ?? [],
    retry: () => { void refetch(); },
  };
}
