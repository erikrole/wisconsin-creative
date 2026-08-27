"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

export type ClaimViewerRequest = {
  id: string;
  status: string;
  hasConflict?: boolean;
  conflictNote?: string | null;
};

type Props = {
  shiftId: string;
  workerType: string;
  startsAt: string;
  isAssigned: boolean;
  viewerRequest?: ClaimViewerRequest | null;
  canClaim: boolean;
  isPublished: boolean;
  compact?: boolean;
  className?: string;
  onChanged?: () => void | Promise<void>;
};

/**
 * The one student open-slot action used by Schedule disclosure rows and Event
 * detail. The server remains authoritative; this helper only prevents stale
 * duplicate clicks and makes the approval-first state visible after a refresh.
 */
export function ClaimShiftAction({
  shiftId,
  workerType,
  startsAt,
  isAssigned,
  viewerRequest,
  canClaim,
  isPublished,
  compact = false,
  className,
  onChanged,
}: Props) {
  const [acting, setActing] = useState<"claim" | "withdraw" | null>(null);
  const actingRef = useRef<"claim" | "withdraw" | null>(null);
  const isPending = viewerRequest?.status === "REQUESTED";
  const isFuture = Number.isFinite(Date.parse(startsAt)) && Date.parse(startsAt) > Date.now();
  const canRequest = canClaim
    && workerType === "ST"
    && !isAssigned
    && !isPending
    && isPublished
    && isFuture;

  if (canClaim && isPending && viewerRequest) {
    return (
      <div className={cn("flex items-center gap-2", className)} aria-live="polite">
        <Badge variant="orange" size="sm">Awaiting approval</Badge>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("text-xs text-muted-foreground", compact ? "h-8 px-2" : "h-9 px-2")}
          disabled={acting !== null}
          onClick={(event) => {
            event.stopPropagation();
            if (actingRef.current) return;
            actingRef.current = "withdraw";
            setActing("withdraw");
            void (async () => {
              try {
                const response = await fetch(`/api/shift-assignments/${viewerRequest.id}/withdraw`, {
                  method: "PATCH",
                });
                if (handleAuthRedirect(response)) return;
                if (!response.ok) {
                  throw new Error(await parseErrorMessage(response, "Could not withdraw request"));
                }
                toast.success("Request withdrawn");
                await onChanged?.();
              } catch (error) {
                toast.error(error instanceof TypeError
                  ? "You're offline - the request was not withdrawn"
                  : error instanceof Error ? error.message : "Could not withdraw request");
              } finally {
                actingRef.current = null;
                setActing(null);
              }
            })();
          }}
        >
          {acting === "withdraw" ? "Withdrawing..." : "Withdraw"}
        </Button>
      </div>
    );
  }

  if (!canRequest) return null;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(compact ? "h-8 px-2 text-xs" : "h-9 text-xs", className)}
      disabled={acting !== null}
      onClick={(event) => {
        event.stopPropagation();
        if (actingRef.current) return;
        actingRef.current = "claim";
        setActing("claim");
        void (async () => {
          try {
            const response = await fetch("/api/shift-assignments/pickup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ shiftId }),
            });
            if (handleAuthRedirect(response)) return;
            if (!response.ok) {
              throw new Error(await parseErrorMessage(response, "Could not request this shift"));
            }
            toast.success("Request sent for Admin approval");
            await onChanged?.();
          } catch (error) {
            toast.error(error instanceof TypeError
              ? "You're offline - the request was not sent"
              : error instanceof Error ? error.message : "Could not request this shift");
          } finally {
            actingRef.current = null;
            setActing(null);
          }
        })();
      }}
    >
      {acting === "claim" ? "Claiming..." : "Claim shift"}
    </Button>
  );
}
