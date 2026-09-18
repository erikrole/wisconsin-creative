"use client";

import { useCallback, useEffect, useState } from "react";
import {
  compareFootballGamedayKits,
} from "@/lib/football-gameday-kits";
import { handleAuthRedirect, isAbortError, parseErrorMessage, parseJsonSafely } from "@/lib/errors";

export type BookingKitOption = {
  id: string;
  name: string;
  sportCode: string | null;
  gamedayRole: string | null;
  contents: number;
};

export function useKitFetching({
  locationId,
  requesterUserId,
  open,
}: {
  locationId: string;
  requesterUserId?: string;
  open: boolean;
}) {
  const [kits, setKits] = useState<BookingKitOption[]>([]);
  const [suggestedKitId, setSuggestedKitId] = useState<string | null>(null);
  const [kitsLoading, setKitsLoading] = useState(false);
  const [kitsLoadError, setKitsLoadError] = useState<false | "network" | "server">(false);
  const [kitsReloadKey, setKitsReloadKey] = useState(0);
  const retryKits = useCallback(() => setKitsReloadKey((value) => value + 1), []);

  useEffect(() => {
    if (!locationId || !open) {
      setKits([]);
      setSuggestedKitId(null);
      setKitsLoading(false);
      setKitsLoadError(false);
      return;
    }
    const controller = new AbortController();
    setKits([]);
    setSuggestedKitId(null);
    setKitsLoading(true);
    setKitsLoadError(false);
    const params = new URLSearchParams({ location_id: locationId, limit: "100" });
    if (requesterUserId) params.set("requester_user_id", requesterUserId);
    fetch(`/api/kits?${params}`, { signal: controller.signal })
      .then(async (res) => {
        if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
        if (!res.ok) throw new Error(await parseErrorMessage(res, "Failed to load kits"));
        return parseJsonSafely<{
          suggestedKitId?: string | null;
          data?: Array<{
            id: string;
            name: string;
            sportCode?: string | null;
            gamedayRole?: string | null;
            _count?: { members?: number; bulkMembers?: number };
          }>;
        }>(res);
      })
      .then((json) => {
        if (controller.signal.aborted) return;
        const mapped = (json?.data || []).map((kit) => ({
          id: kit.id,
          name: kit.name,
          sportCode: kit.sportCode ?? null,
          gamedayRole: kit.gamedayRole ?? null,
          contents: (kit._count?.members ?? 0) + (kit._count?.bulkMembers ?? 0),
        }));
        setKits(
          mapped
            .filter((kit) => kit.contents > 0)
            .sort(compareFootballGamedayKits),
        );
        setSuggestedKitId(json?.suggestedKitId ?? null);
        setKitsLoadError(false);
        setKitsLoading(false);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setKits([]);
        setSuggestedKitId(null);
        setKitsLoadError(err instanceof TypeError ? "network" : "server");
        setKitsLoading(false);
      });
    return () => controller.abort();
  }, [locationId, requesterUserId, open, kitsReloadKey]);

  return { kits, suggestedKitId, kitsLoading, kitsLoadError, retryKits };
}
