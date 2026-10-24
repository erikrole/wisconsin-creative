"use client";

import { useQuery } from "@tanstack/react-query";
import {
  compareFootballGamedayKits,
} from "@/lib/football-gameday-kits";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";

export type BookingKitOption = {
  id: string;
  name: string;
  sportCode: string | null;
  gamedayRole: string | null;
  contents: number;
};

type KitsResult = { kits: BookingKitOption[]; suggestedKitId: string | null };

const NO_KITS: BookingKitOption[] = [];

async function fetchKits(locationId: string, requesterUserId: string | undefined, signal: AbortSignal): Promise<KitsResult> {
  const params = new URLSearchParams({ location_id: locationId, limit: "100" });
  if (requesterUserId) params.set("requester_user_id", requesterUserId);
  const res = await fetch(`/api/kits?${params}`, { signal });
  if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
  if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to load kits"));
  const json = await parseJsonSafely<{
    suggestedKitId?: string | null;
    data?: Array<{
      id: string;
      name: string;
      sportCode?: string | null;
      gamedayRole?: string | null;
      _count?: { members?: number; bulkMembers?: number };
    }>;
  }>(res);
  const mapped = (json?.data || []).map((kit) => ({
    id: kit.id,
    name: kit.name,
    sportCode: kit.sportCode ?? null,
    gamedayRole: kit.gamedayRole ?? null,
    contents: (kit._count?.members ?? 0) + (kit._count?.bulkMembers ?? 0),
  }));
  return {
    kits: mapped
      .filter((kit) => kit.contents > 0)
      .sort(compareFootballGamedayKits),
    suggestedKitId: json?.suggestedKitId ?? null,
  };
}

export function useKitFetching({
  locationId,
  requesterUserId,
  open,
}: {
  locationId: string;
  requesterUserId?: string;
  open: boolean;
}) {
  const enabled = Boolean(locationId) && open;
  const query = useQuery({
    queryKey: ["booking-kits", locationId, requesterUserId ?? null],
    queryFn: ({ signal }) => fetchKits(locationId, requesterUserId, signal),
    enabled,
  });

  // A failed read stays distinct from a true no-kit result so the step can offer Retry.
  const kitsLoadError: false | "network" | "server" = enabled && query.isError ? (query.error instanceof TypeError ? "network" : "server") : false;
  const result = enabled && !query.isError ? query.data : undefined;

  return {
    kits: result?.kits ?? NO_KITS,
    suggestedKitId: result?.suggestedKitId ?? null,
    kitsLoading: enabled && query.isPending,
    kitsLoadError,
    retryKits: () => void query.refetch(),
  };
}
