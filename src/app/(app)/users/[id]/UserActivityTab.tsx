"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useFetch } from "@/hooks/use-fetch";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AlertCircle } from "lucide-react";
import ActivityTimeline, { type AuditEntry } from "@/components/ActivityTimeline";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";

type ActivityResponse = { data: AuditEntry[]; nextCursor: string | null };

type Filter = "all" | "account" | "bookings" | "equipment";

const FILTER_OPTIONS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "account", label: "Account" },
  { key: "bookings", label: "Bookings" },
  { key: "equipment", label: "Equipment" },
];

const ACCOUNT_ACTIONS = new Set([
  "login",
  "logout",
  "registered",
  "password_reset_requested",
  "password_reset_completed",
  "password_reset_self",
  "password_change",
  "role_changed",
  "kiosk_activated",
  "user_activated",
  "user_deactivated",
]);

const EQUIPMENT_ENTITY_TYPES = new Set([
  "asset",
  "bulk_sku",
  "bulk_sku_unit",
  "kit",
]);

function matchesFilter(entry: AuditEntry, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "account") {
    return entry.entityType === "user" || ACCOUNT_ACTIONS.has(entry.action);
  }
  if (filter === "bookings") {
    return entry.entityType === "booking";
  }
  if (filter === "equipment") {
    return Boolean(entry.entityType && EQUIPMENT_ENTITY_TYPES.has(entry.entityType));
  }
  return true;
}

export default function UserActivityTab({ userId }: { userId: string }) {
  const [extras, setExtras] = useState<AuditEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const loadingMoreRef = useRef(false);

  const {
    data,
    loading,
    error,
    reload,
  } = useFetch<ActivityResponse>({
    url: `/api/users/${userId}/activity`,
    transform: (json) => ({
      data: (json as ActivityResponse).data ?? [],
      nextCursor: (json as ActivityResponse).nextCursor ?? null,
    }),
  });

  const allEntries: AuditEntry[] = useMemo(
    () => [...(data?.data ?? []), ...extras],
    [data?.data, extras],
  );
  const cursor =
    extras.length > 0 ? nextCursor : data?.nextCursor ?? null;

  const filtered = useMemo(
    () => allEntries.filter((e) => matchesFilter(e, filter)),
    [allEntries, filter],
  );

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetch(
        `/api/users/${userId}/activity?cursor=${encodeURIComponent(cursor)}`,
      );
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error("Failed to load more activity");
        return;
      }
      const json = await parseJsonSafely<ActivityResponse>(res);
      if (json?.data) setExtras((prev) => [...prev, ...json.data]);
      setNextCursor(json?.nextCursor ?? null);
    } catch {
      toast.error("Network error");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [userId, cursor]);

  if (error && !data) {
    return (
      <div className="py-10 px-5 flex justify-center">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="size-4" />
          <AlertTitle>Failed to load activity</AlertTitle>
          <AlertDescription className="mt-2">
            <p className="mb-3">
              Something went wrong loading the activity history.
            </p>
            <Button variant="outline" className="h-10" onClick={reload}>
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Pre-filter empty when the user has activity but the current scope is empty
  const emptyMessage =
    allEntries.length > 0 && filtered.length === 0
      ? "No matching activity in this view."
      : "No activity recorded yet.";

  return (
    <div className="mt-2">
      {/* Filter chips */}
      <div className="px-3 py-2.5 border-b border-border/30">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(v) => {
            if (v) setFilter(v as Filter);
          }}
          className="h-7"
        >
          {FILTER_OPTIONS.map(({ key, label }) => (
            <ToggleGroupItem
              key={key}
              value={key}
              className="h-6 text-xs px-2.5"
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <ActivityTimeline
        entries={filtered}
        loading={loading || loadingMore}
        hasMore={!!cursor}
        onLoadMore={loadMore}
        context="user"
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
