"use client";

import { AlertTriangleIcon } from "lucide-react";
import { UserAvatar } from "@/components/UserAvatar";
import { UserAvatarGroup } from "@/components/UserAvatarGroup";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PendingCrewClaim, PendingCrewTrade } from "@/lib/crew-pending-review";
import { AREA_LABELS } from "@/types/areas";
import { cn } from "@/lib/utils";

type ReviewRow = {
  id: string;
  kind: "claim" | "trade";
  notes?: string | null;
  user: { id: string; name: string; avatarUrl: string | null };
  hasConflict?: boolean;
  conflictNote?: string | null;
  detail?: string | null;
};

function rowsForOpenSlot(claims: PendingCrewClaim[]): ReviewRow[] {
  return claims.map((claim) => ({
    id: claim.id,
    kind: "claim",
    user: claim.user,
    hasConflict: claim.hasConflict,
    conflictNote: claim.conflictNote,
    detail: claim.area ? `Wants a ${AREA_LABELS[claim.area] ?? claim.area} slot` : "Wants this slot",
  }));
}

function rowsForTrade(trade: PendingCrewTrade): ReviewRow[] {
  if (!trade.claimedBy) return [];
  return [{
    id: trade.id,
    kind: "trade",
    notes: trade.notes,
    user: trade.claimedBy,
    detail: trade.area
      ? `Wants ${trade.postedBy.name}'s ${AREA_LABELS[trade.area] ?? trade.area} shift`
      : `Wants ${trade.postedBy.name}'s shift`,
  }];
}

export function CrewPendingReview({
  claims,
  trade,
  trades,
  canReview,
  reviewBlockedReason,
  disabled = false,
  actingId,
  onApprove,
  onDecline,
  className,
  showAvatars = true,
}: {
  claims?: PendingCrewClaim[];
  trade?: PendingCrewTrade | null;
  /** Several trades at once, for a whole event. */
  trades?: PendingCrewTrade[];
  canReview: boolean;
  reviewBlockedReason?: string | null;
  disabled?: boolean;
  actingId?: string | null;
  onApprove: (id: string, kind: "claim" | "trade") => void;
  onDecline: (id: string, kind: "claim" | "trade") => void;
  className?: string;
  /** Off for a whole-event trigger, where the avatars read as the crew. */
  showAvatars?: boolean;
}) {
  const rows = [
    ...(trade ? rowsForTrade(trade) : []),
    ...(trades ?? []).flatMap(rowsForTrade),
    ...rowsForOpenSlot(claims ?? []),
  ];
  if (rows.length === 0) return null;

  const onlyTrade = rows.length === 1 && rows[0]?.kind === "trade";
  const onlyClaims = rows.every((row) => row.kind === "claim");
  const title = onlyTrade
    ? "Trade request"
    : onlyClaims
      ? rows.length === 1 ? "1 claim" : `${rows.length} claims`
      : `${rows.length} to review`;
  const triggerLabel = canReview
    ? `Review ${title.toLowerCase()}`
    : title;
  const reviewEnabled = canReview && !reviewBlockedReason && !disabled;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className={cn("h-10 min-w-0 gap-1.5 px-1.5 font-normal", className)}
          disabled={disabled}
          aria-label={triggerLabel}
        >
          {showAvatars && (
            <UserAvatarGroup
              users={rows.map((row) => row.user)}
              max={3}
              size="sm"
              ariaLabel=""
              className="pointer-events-none"
            />
          )}
          <span className="truncate text-xs font-medium text-[var(--orange-text)]">
            {showAvatars ? (canReview ? "Review" : title) : title}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-w-[calc(100vw-2rem)] space-y-3 p-3" align="start">
        <div>
          <p className="text-sm font-medium">{title}</p>
          <p className="text-xs text-muted-foreground">
            {onlyTrade
              ? "Approving moves the shift to the claimant."
              : rows.length > 1
                ? "Approving one request for a slot declines the others."
                : "Approving assigns this student to the slot."}
          </p>
        </div>
        {reviewBlockedReason && (
          <p className="text-xs text-muted-foreground">{reviewBlockedReason}</p>
        )}
        {!canReview && !reviewBlockedReason && (
          <p className="text-xs text-muted-foreground">Needs Admin review.</p>
        )}
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const isApproving = actingId === `approve:${row.id}`;
            const isDeclining = actingId === `decline:${row.id}`;
            return (
              <li key={row.id} className="flex flex-col gap-2 rounded-md border border-border/60 bg-background px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <UserAvatar name={row.user.name} avatarUrl={row.user.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    <p className="truncate text-sm">{row.user.name}</p>
                    {row.detail && (
                      <p className="truncate text-xs text-muted-foreground">{row.detail}</p>
                    )}
                  </div>
                </div>
                {row.hasConflict && (
                  <p className="flex items-start gap-1.5 text-xs text-[var(--orange-text)]">
                    <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
                    <span>{row.conflictNote ?? "Schedule conflict"}</span>
                  </p>
                )}
                {row.notes && (
                  <p className="text-xs leading-relaxed text-muted-foreground">{row.notes}</p>
                )}
                {reviewEnabled && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      className="h-10 px-3 text-xs"
                      disabled={Boolean(actingId)}
                      onClick={() => onApprove(row.id, row.kind)}
                    >
                      {isApproving ? "Approving…" : "Approve"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 px-3 text-xs"
                      disabled={Boolean(actingId)}
                      onClick={() => onDecline(row.id, row.kind)}
                    >
                      {isDeclining ? "Declining…" : "Decline"}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
