"use client";

import { useMemo, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ActivityTimeline, { type AuditEntry } from "@/components/ActivityTimeline";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";

type HistoryScope = "all" | "asset" | "booking";

const scopeLabels: Record<HistoryScope, string> = {
  all: "All",
  asset: "Item updates",
  booking: "Bookings",
};

type ActivityPage = { data: AuditEntry[]; nextCursor: string | null };

async function fetchActivityPage(endpoint: string, cursor: string | null, signal: AbortSignal): Promise<ActivityPage> {
  const url = new URL(endpoint, window.location.origin);
  if (cursor) url.searchParams.set("cursor", cursor);
  const res = await fetch(url.toString(), { signal });
  if (handleAuthRedirect(res)) throw new DOMException("Auth redirect", "AbortError");
  if (!res.ok) throw new Error("Failed to load activity history");
  const json = await parseJsonSafely<{ data?: AuditEntry[]; nextCursor?: string | null }>(res);
  if (!Array.isArray(json?.data)) throw new Error("Failed to load activity history");
  return { data: json.data, nextCursor: json.nextCursor ?? null };
}

/* ── Activity Feed Component ── */

export default function ActivityFeed({
  assetId,
  assetName,
  endpoint,
}: {
  assetId: string;
  assetName?: string;
  endpoint?: string;
}) {
  const [scope, setScope] = useState<HistoryScope>("all");

  const scopedEndpoint = useMemo(() => {
    if (endpoint) return endpoint;
    const params = new URLSearchParams({ scope });
    return `/api/assets/${assetId}/activity?${params.toString()}`;
  }, [assetId, endpoint, scope]);

  const activity = useInfiniteQuery({
    queryKey: ["item-activity", scopedEndpoint],
    queryFn: ({ pageParam, signal }) => fetchActivityPage(scopedEndpoint, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 0,
  });
  const entries = useMemo(
    () => activity.data?.pages.flatMap((page) => page.data) ?? [],
    [activity.data],
  );
  const loading = activity.isFetching;
  const fetchError = activity.isError || activity.isFetchNextPageError;

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-10">
        <Spinner className="size-8" />
      </div>
    );
  }

  if (fetchError && entries.length === 0) {
    return (
      <Empty className="py-8 border-0">
        <AlertTriangle className="size-8 text-muted-foreground opacity-50 mx-auto mb-2" />
        <EmptyDescription>Failed to load activity history.</EmptyDescription>
        <Button
          variant="outline"
          className="h-10 mt-3"
          onClick={() => void activity.refetch()}
        >
          Retry
        </Button>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {!endpoint && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <ToggleGroup
            type="single"
            value={scope}
            onValueChange={(value) => value && setScope(value as HistoryScope)}
            className="w-fit rounded-md border bg-background p-0.5"
          >
            {(Object.keys(scopeLabels) as HistoryScope[]).map((key) => (
              <ToggleGroupItem key={key} value={key} className="h-8 px-3 text-xs">
                {scopeLabels[key]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Badge variant="gray" size="sm" className="w-fit">
            {entries.length} shown
          </Badge>
        </div>
      )}

      {fetchError && entries.length > 0 && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Could not load older entries. Try again.
        </div>
      )}

      {entries.length === 0 ? (
        <Empty className="py-8 border-0">
          <EmptyDescription>No activity recorded for this scope.</EmptyDescription>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-md border border-border/40">
          <ActivityTimeline
            entries={entries}
            loading={loading}
            hasMore={activity.hasNextPage}
            onLoadMore={() => void activity.fetchNextPage()}
            context="item"
            entityName={assetName}
          />
        </div>
      )}
    </div>
  );
}
