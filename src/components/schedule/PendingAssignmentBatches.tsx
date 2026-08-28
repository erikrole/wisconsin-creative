"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcwIcon, TimerIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { BulkAssignmentBatch } from "@/lib/services/bulk-assignment-batches";
import { sportLabel } from "@/lib/sports";

function minutesUntil(iso: string) {
  return Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60_000));
}

function scopeLabel(batch: BulkAssignmentBatch) {
  if (batch.sportCodes.length === 0) return "All sports";
  if (batch.sportCodes.length <= 2) return batch.sportCodes.map(sportLabel).join(", ");
  return `${batch.sportCodes.length} sports`;
}

export function usePendingAssignmentBatches(enabled: boolean) {
  const [batches, setBatches] = useState<BulkAssignmentBatch[]>([]);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/schedule/bulk-assignment/batches");
      if (handleAuthRedirect(response)) return;
      if (!response.ok) return;
      const json = await parseJsonSafely<{ data?: { batches?: BulkAssignmentBatch[] } }>(response);
      setBatches(json?.data?.batches ?? []);
    } catch {
      // A failed poll is not worth interrupting the assignment flow for.
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  return { batches: batches.filter((batch) => batch.cancellable), refresh };
}

/**
 * Applying stages a batch and starts a ten-minute release timer. That window is
 * the only chance to take it back, so it needs to be visible from the same
 * place the batch was created rather than living only in the release workflow.
 */
export function PendingAssignmentBatches({
  batches,
  onChanged,
}: {
  batches: BulkAssignmentBatch[];
  onChanged: () => void;
}) {
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function cancel(batch: BulkAssignmentBatch) {
    if (cancellingId) return;
    setCancellingId(batch.id);
    try {
      const response = await fetch(`/api/schedule/bulk-assignment/batches/${batch.id}/cancel`, { method: "POST" });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "That batch could not be cancelled."));
        return;
      }
      const json = await parseJsonSafely<{ data?: { cancelledEvents?: number; untouchedEvents?: number } }>(response);
      const cancelled = json?.data?.cancelledEvents ?? 0;
      const untouched = json?.data?.untouchedEvents ?? 0;
      toast.success(
        untouched > 0
          ? `Cancelled ${cancelled} event${cancelled === 1 ? "" : "s"}; ${untouched} had already been edited and were left alone.`
          : `Cancelled ${cancelled} event${cancelled === 1 ? "" : "s"} before release.`,
      );
      onChanged();
    } catch {
      toast.error("Could not reach the server. The batch was not cancelled.");
    } finally {
      setCancellingId(null);
    }
  }

  if (batches.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--orange-text)]/30 bg-[var(--orange-bg)]/40 p-3">
      <div className="flex items-center gap-2">
        <TimerIcon className="size-4 text-[var(--orange-text)]" />
        <span className="text-sm font-medium">Staged, not yet released</span>
      </div>
      {batches.map((batch) => {
        const minutes = minutesUntil(batch.releaseAt);
        return (
          <div key={batch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-background/70 px-3 py-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{scopeLabel(batch)}</span>
                <Badge variant="gray" size="sm">
                  {batch.assignmentCount} assignment{batch.assignmentCount === 1 ? "" : "s"}
                </Badge>
                <Badge variant="gray" size="sm">
                  {batch.eventCount} event{batch.eventCount === 1 ? "" : "s"}
                </Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {minutes === 0 ? "Releasing to workers now" : `Releases to workers in ${minutes} minute${minutes === 1 ? "" : "s"}`}
                {batch.createdByName ? ` · staged by ${batch.createdByName}` : ""}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-10 shrink-0"
              disabled={cancellingId === batch.id}
              onClick={() => void cancel(batch)}
            >
              <RotateCcwIcon data-icon="inline-start" className="size-3.5" />
              {cancellingId === batch.id ? "Cancelling…" : "Cancel"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
