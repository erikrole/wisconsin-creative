"use client";

import { useState } from "react";
import { CrewPendingReview } from "@/components/shift-detail/CrewPendingReview";
import { toast } from "@/lib/toast";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import type { CalendarEntry } from "./types";

/**
 * Admin's inline decision on an event's claimed trades and open-slot requests,
 * without opening the event or the Trade Board.
 */
export function EntryPendingReview({
  entry,
  canReview,
  onReviewed,
}: {
  entry: CalendarEntry;
  canReview: boolean;
  onReviewed?: () => void | Promise<void>;
}) {
  const [actingId, setActingId] = useState<string | null>(null);
  const pending = entry.pendingReview;
  if (!canReview || !pending || pending.claims.length + pending.trades.length === 0) return null;

  async function review(id: string, kind: "claim" | "trade", decision: "approve" | "decline") {
    const name = kind === "claim"
      ? pending?.claims.find((claim) => claim.id === id)?.user.name
      : pending?.trades.find((trade) => trade.id === id)?.claimedBy?.name;
    setActingId(`${decision}:${id}`);
    try {
      const path = kind === "claim" ? `/api/shift-assignments/${id}` : `/api/shift-trades/${id}`;
      const res = await fetch(`${path}/${decision}`, { method: "PATCH" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, `Could not ${decision} this request`));
      } else {
        toast.success(decision === "approve"
          ? kind === "claim" ? `${name ?? "Student"} is on the schedule` : "Trade approved"
          : kind === "claim" ? `Request declined for ${name ?? "student"}` : "Claim declined");
      }
      await onReviewed?.();
    } catch {
      toast.error("The response was lost. Check the schedule before trying again.");
      await onReviewed?.();
    } finally {
      setActingId(null);
    }
  }

  return (
    <CrewPendingReview
      claims={pending.claims}
      trades={pending.trades}
      canReview={canReview}
      showAvatars={false}
      reviewBlockedReason={entry.hasWorkingCopy ? "Release or discard crew edits before reviewing." : null}
      actingId={actingId}
      onApprove={(id, kind) => void review(id, kind, "approve")}
      onDecline={(id, kind) => void review(id, kind, "decline")}
    />
  );
}
