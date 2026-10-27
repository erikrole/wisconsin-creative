"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdleReady } from "@/hooks/use-idle-ready";
import { AnnouncementDialog } from "@/components/announcements/AnnouncementDialog";
import type { ActiveAnnouncement } from "@/lib/announcements";

const QUERY_KEY = ["announcement", "active"] as const;

/** Re-check when someone comes back to a tab after this long. */
const RECHECK_AFTER_MS = 30 * 60_000;

/**
 * Shows the newest announcement this person hasn't dismissed. It reads on page
 * load and again only when a person returns to a tab that has been away for 30
 * minutes. There is no polling, so an idle tab never wakes the database.
 */
export function AnnouncementSplash({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const idleReady = useIdleReady();

  const { data } = useQuery<ActiveAnnouncement | null>({
    queryKey: QUERY_KEY,
    enabled: enabled && idleReady,
    staleTime: RECHECK_AFTER_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/announcements/active?platform=web", { signal });
      if (!res.ok) return null;
      const json = (await res.json()) as { data: ActiveAnnouncement | null };
      return json.data;
    },
  });

  const dismiss = useCallback(
    async (announcement: ActiveAnnouncement) => {
      // Close now; when more are waiting, the next one loads after the save.
      queryClient.setQueryData(QUERY_KEY, null);
      try {
        const res = await fetch(`/api/announcements/${announcement.id}/dismiss`, { method: "POST" });
        if (res.ok && announcement.remaining > 0) await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      } catch {
        // Offline: it shows again next time, which is the safe failure.
      }
    },
    [queryClient],
  );

  if (!data) return null;

  const openCta = () => {
    void dismiss(data);
    if (!data.ctaUrl) return;
    if (data.ctaUrl.startsWith("/")) router.push(data.ctaUrl);
    else window.open(data.ctaUrl, "_blank", "noopener,noreferrer");
  };

  return <AnnouncementDialog announcement={data} onCta={openCta} onDismiss={() => void dismiss(data)} />;
}
