"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import type { ActiveAnnouncement } from "@/lib/announcements";

const QUERY_KEY = ["announcement", "active"] as const;

/**
 * Shows the newest announcement this person hasn't dismissed. It reads once per
 * page load: no polling and no refetch on focus, so it never wakes the database
 * for an idle tab.
 */
export function AnnouncementSplash({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data } = useQuery<ActiveAnnouncement | null>({
    queryKey: QUERY_KEY,
    enabled,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
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
      // Close now; the next unseen announcement, if any, loads after the save.
      queryClient.setQueryData(QUERY_KEY, null);
      try {
        const res = await fetch(`/api/announcements/${announcement.id}/dismiss`, { method: "POST" });
        if (res.ok) await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
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

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : void dismiss(data))}>
      <DialogContent showCloseButton={false} className="max-w-[460px] sm:rounded-2xl">
        <DialogTitle className="sr-only">{data.title}</DialogTitle>
        <DialogDescription className="sr-only">{data.kindLabel} announcement</DialogDescription>
        <AnnouncementCard headingHidden announcement={data} onCta={openCta} onDismiss={() => void dismiss(data)} />
      </DialogContent>
    </Dialog>
  );
}
