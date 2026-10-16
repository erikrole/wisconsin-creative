"use client";

import { Eye, KeyRound, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StaggerItem, StaggerList } from "@/components/ui/motion";
import { UserAvatar } from "@/components/UserAvatar";
import { formatLicenseExpiryDate, licenseDaysUntilExpiry } from "@/lib/license-dates";
import { cn } from "@/lib/utils";
import type { ActiveClaim, LicenseCode } from "./types";

const MAX_SLOTS = 2;

const MASKED_CODE = "••••-••••-••••-••••";

function ExpiryChip({ expiresAt }: { expiresAt: string }) {
  const days = licenseDaysUntilExpiry(expiresAt);
  const dateStr = formatLicenseExpiryDate(expiresAt);

  if (days < 0) return <Badge variant="destructive" className="text-xs">Expired {dateStr}</Badge>;
  if (days <= 30) {
    return (
      <Badge variant="orange" className="text-xs">
        {days <= 0 ? "Expires today" : `${days}d left`} · {dateStr}
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">Renews {dateStr}</span>;
}

/** One seat of the two-machine activation: filled with the holder, or an open outline. */
function SlotSeat({
  claim,
  isAdmin,
  isOwn,
}: {
  claim: ActiveClaim | null;
  isAdmin: boolean;
  isOwn: boolean;
}) {
  if (!claim) {
    return (
      <div className="flex min-h-11 items-center gap-2 rounded-lg border border-dashed border-[var(--green)]/50 px-2.5 text-sm text-[var(--green-text)]">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-[var(--green)]/60" aria-hidden="true" />
        Open slot
      </div>
    );
  }

  const showName = isAdmin || isOwn || claim.user !== null;
  const name = claim.user?.name ?? claim.occupantLabel ?? "Unknown";

  return (
    <div
      className={cn(
        "flex min-h-11 min-w-0 items-center gap-2 rounded-lg border px-2.5 text-sm",
        isOwn ? "border-[var(--blue)]/50 bg-background font-medium" : "bg-background/70",
      )}
    >
      {showName ? (
        <UserAvatar name={name} avatarUrl={claim.user?.avatarUrl ?? null} size="xs" />
      ) : (
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
          <Lock className="size-3" />
        </span>
      )}
      <span className={cn("min-w-0 flex-1 truncate", !showName && "text-muted-foreground")}>
        {showName ? name : "In use"}
      </span>
      {isOwn && <span className="text-xs text-muted-foreground">you</span>}
      {claim.userId === null && isAdmin && (
        <Badge variant="outline" className="h-4 px-1.5 py-0 text-[10px]">unknown</Badge>
      )}
    </div>
  );
}

function statusLabel(status: LicenseCode["status"], isOwn: boolean) {
  if (isOwn) return { text: "Yours", variant: "blue" as const };
  if (status === "AVAILABLE") return { text: "Open", variant: "green" as const };
  if (status === "PARTIAL") return { text: "1 slot left", variant: "green" as const };
  if (status === "CLAIMED") return { text: "Full", variant: "gray" as const };
  return { text: "Retired", variant: "gray" as const };
}

function toneClasses(code: LicenseCode, isOwn: boolean) {
  return cn(
    code.status === "AVAILABLE" && "border-[var(--green)]/30 bg-[var(--green-bg)]/50",
    code.status === "PARTIAL" && "border-[var(--green)]/30 bg-[var(--green-bg)]/30",
    code.status === "CLAIMED" && "bg-[var(--blue-bg)]/40",
    code.status === "RETIRED" && "opacity-50",
    isOwn && "border-[var(--blue)]/60 ring-1 ring-[var(--blue)]/30",
  );
}

function LicenseCardLoading({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <Skeleton className="h-11 w-full rounded-lg" />
          <Skeleton className="h-11 w-full rounded-lg" />
        </div>
      ))}
    </div>
  );
}

type Props = {
  codes: LicenseCode[];
  loading: boolean;
  currentUserId: string | null;
  isAdmin: boolean;
  hasMyLicense: boolean;
  onClickAvailable: (code: LicenseCode) => void;
  onClickClaimed: (code: LicenseCode) => void;
  showExpiry?: boolean;
};

export function LicenseTable({
  codes,
  loading,
  currentUserId,
  isAdmin,
  hasMyLicense,
  onClickAvailable,
  onClickClaimed,
  showExpiry = false,
}: Props) {
  if (loading && codes.length === 0) return <LicenseCardLoading />;

  return (
    <StaggerList className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {codes.map((code) => {
        const myActiveClaim = code.claims.find((claim) => claim.userId === currentUserId);
        const isOwn = !!myActiveClaim;
        const claimable = code.status === "AVAILABLE" || code.status === "PARTIAL";
        const studentCanClaim = claimable && !hasMyLicense;
        const adminCanInspect = isAdmin;
        const isClickable = studentCanClaim || adminCanInspect;
        const displayCode = isAdmin || isOwn ? code.code : MASKED_CODE;
        const actionLabel = adminCanInspect ? "Inspect" : "Claim";
        const status = statusLabel(code.status, isOwn);

        function handleClick() {
          if (!isClickable) return;
          if (isOwn || adminCanInspect) return onClickClaimed(code);
          if (studentCanClaim) return onClickAvailable(code);
        }

        const seats = Array.from({ length: MAX_SLOTS }, (_, i) => code.claims[i] ?? null);

        const content = (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <code className="block break-all font-mono text-sm font-semibold tracking-wide text-foreground">
                  {displayCode}
                </code>
                {code.label && <p className="mt-0.5 break-words text-xs text-muted-foreground">{code.label}</p>}
                {code.accountEmail && isAdmin && (
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">{code.accountEmail}</p>
                )}
              </div>
              <Badge variant={status.variant} className="shrink-0">{status.text}</Badge>
            </div>

            <div className="mt-3 grid gap-1.5" aria-label={`${code.claims.length} of ${MAX_SLOTS} slots in use`}>
              {seats.map((claim, i) => (
                <SlotSeat
                  key={claim?.id ?? `open-${i}`}
                  claim={claim}
                  isAdmin={isAdmin}
                  isOwn={!!claim && claim.id === myActiveClaim?.id}
                />
              ))}
            </div>

            <div className="mt-3 flex min-h-8 items-center justify-between gap-2">
              {showExpiry && code.expiresAt ? <ExpiryChip expiresAt={code.expiresAt} /> : <span />}
              {isClickable ? (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                  {adminCanInspect ? <Eye className="size-4" aria-hidden="true" /> : <KeyRound className="size-4" aria-hidden="true" />}
                  {actionLabel}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{isOwn ? "Your license" : claimable ? "Return yours to switch" : "No open slots"}</span>
              )}
            </div>
          </>
        );

        const cardClass = cn("block w-full rounded-xl border p-4 text-left transition-[background-color,transform] duration-150", toneClasses(code, isOwn));

        return (
          <StaggerItem key={code.id}>
            {isClickable ? (
              <Button
                type="button"
                variant="ghost"
                className={cn(cardClass, "h-auto whitespace-normal font-normal shadow-none hover:bg-muted/60 active:scale-[0.99]")}
                aria-label={`${actionLabel} license ${displayCode}`}
                onClick={handleClick}
              >
                {content}
              </Button>
            ) : (
              <div className={cardClass}>{content}</div>
            )}
          </StaggerItem>
        );
      })}
    </StaggerList>
  );
}
