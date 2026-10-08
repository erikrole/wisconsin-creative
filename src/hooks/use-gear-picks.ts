"use client";

import { useQuery } from "@tanstack/react-query";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import type { GearPicksMeResponse } from "@/lib/gear-picks/types";

type ApiEnvelope = { data?: GearPicksMeResponse };

export const GEAR_PICKS_ME_QUERY_KEY = ["gear-picks", "me"] as const;

/** The signed-in person's UA gear pick cycle, participation, and saved list. */
export function useGearPicksMe(enabled = true) {
  return useQuery<GearPicksMeResponse | null>({
    queryKey: GEAR_PICKS_ME_QUERY_KEY,
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/gear-picks/me", { signal });
      if (handleAuthRedirect(response)) return null;
      // Collaborators have no gear pick access; treat it as "not participating".
      if (response.status === 403) return null;
      if (!response.ok) throw new Error("Could not load your gear picks");
      const json = await parseJsonSafely<ApiEnvelope>(response);
      if (!json?.data) throw new Error("Gear picks response was incomplete");
      return json.data;
    },
    staleTime: 30_000,
  });
}

/** Someone else's picks, for an admin on their profile. Self views use `useGearPicksMe`. */
export function useUserGearPicks(userId: string, enabled = true) {
  return useQuery<GearPicksMeResponse | null>({
    queryKey: ["gear-picks", "user", userId],
    enabled,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/gear-picks/users/${encodeURIComponent(userId)}`, { signal });
      if (handleAuthRedirect(response)) return null;
      if (response.status === 403) return null;
      if (!response.ok) throw new Error("Could not load gear picks");
      const json = await parseJsonSafely<ApiEnvelope>(response);
      if (!json?.data) throw new Error("Gear picks response was incomplete");
      return json.data;
    },
    staleTime: 30_000,
  });
}
