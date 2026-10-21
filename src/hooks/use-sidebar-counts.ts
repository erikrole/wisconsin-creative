"use client";

import { useQuery } from "@tanstack/react-query";
import { parseJsonSafely } from "@/lib/errors";

export type SidebarCounts = { openWishes: number; reportedLicenses: number; openProblems?: number };

/** Quiet "needs attention" counts for the sidebar. Only staff and admins have anything to act on. */
export function useSidebarCounts(enabled: boolean) {
  return useQuery<SidebarCounts | null>({
    queryKey: ["sidebar-counts"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/sidebar/counts", { signal });
      if (!res.ok) return null;
      const json = await parseJsonSafely<{ data?: SidebarCounts }>(res);
      return json?.data ?? null;
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}
