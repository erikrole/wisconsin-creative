"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import ActivityTimeline, { type AuditEntry } from "@/components/ActivityTimeline";
import { handleAuthRedirect, isAbortError, parseJsonSafely } from "@/lib/errors";

type HistoryScope = "all" | "asset" | "booking";

const scopeLabels: Record<HistoryScope, string> = {
  all: "All",
  asset: "Item updates",
  booking: "Bookings",
};

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
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [scope, setScope] = useState<HistoryScope>("all");

  const scopedEndpoint = useMemo(() => {
    if (endpoint) return endpoint;
    const params = new URLSearchParams({ scope });
    return `/api/assets/${assetId}/activity?${params.toString()}`;
  }, [assetId, endpoint, scope]);

  const loadActivity = useCallback((signal?: AbortSignal, cursor?: string | null) => {
    const append = !!cursor;
    setLoading(true);
    setFetchError(false);

    const url = new URL(scopedEndpoint, window.location.origin);
    if (cursor) url.searchParams.set("cursor", cursor);

    fetch(url.toString(), { signal })
      .then((res) => {
        if (handleAuthRedirect(res)) return null;
        if (!res.ok) {
          setFetchError(true);
          return null;
        }
        return parseJsonSafely<{ data?: AuditEntry[]; nextCursor?: string | null }>(res);
      })
      .then((json) => {
        if (signal?.aborted) return;
        if (Array.isArray(json?.data)) {
          const entriesData = json.data;
          setEntries((prev) => append ? [...prev, ...entriesData] : entriesData);
          setNextCursor(json.nextCursor ?? null);
        } else {
          setFetchError(true);
        }
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setFetchError(true);
      })
      .finally(() => {
        if (!signal?.aborted) setLoading(false);
      });
  }, [scopedEndpoint]);

  useEffect(() => {
    const controller = new AbortController();
    setEntries([]);
    setNextCursor(null);
    loadActivity(controller.signal);
    return () => controller.abort();
  }, [loadActivity]);

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
          onClick={() => loadActivity()}
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
            hasMore={!!nextCursor}
            onLoadMore={() => loadActivity(undefined, nextCursor)}
            context="item"
            entityName={assetName}
          />
        </div>
      )}
    </div>
  );
}
