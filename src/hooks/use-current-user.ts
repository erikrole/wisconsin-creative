"use client";

import { useQuery } from "@tanstack/react-query";
import { parseJsonSafely } from "@/lib/errors";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  affiliation?: string | null;
  collaboratorProfile?: string | null;
  collaboratorPolicy?: {
    id: string;
    affiliationKey: string;
    displayName: string;
    badgeLabel: string;
    status: "ACTIVE" | "SUSPENDED";
    version: number;
  } | null;
  capabilities?: string[];
  avatarUrl?: string | null;
  forcePasswordChange?: boolean;
  preview?: {
    actualRole: "ADMIN";
    role: "STAFF" | "STUDENT" | "COLLABORATOR";
    readOnly: true;
    expiresAt: number;
  };
  canViewUsageAnalytics?: boolean;
};

export function useCurrentUser(initialUser?: CurrentUser) {
  return useQuery<CurrentUser | null>({
    queryKey: ["me"],
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/me", { signal });
      if (!res.ok) return null;
      const json = await parseJsonSafely<{
        user?: CurrentUser | null;
        canViewUsageAnalytics?: boolean;
      }>(res);
      if (!json?.user) return null;
      return {
        ...json.user,
        canViewUsageAnalytics: json.canViewUsageAnalytics === true,
      };
    },
    initialData: initialUser ?? undefined,
    staleTime: 5 * 60_000,
  });
}
