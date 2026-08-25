"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, KeyRound } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UserAvatar } from "@/components/UserAvatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatLicenseExpiryDate, licenseDaysUntilExpiry } from "@/lib/license-dates";
import { cn } from "@/lib/utils";
import type { LicenseCode, ActiveClaim } from "./types";

const MAX_SLOTS = 2;

const MASKED_CODE = "••••-••••-••••-••••";

function ExpiryDisplay({ expiresAt }: { expiresAt: string }) {
  const days = licenseDaysUntilExpiry(expiresAt);
  const dateStr = formatLicenseExpiryDate(expiresAt);

  if (days < 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="destructive" className="text-xs cursor-help">Expired</Badge>
        </TooltipTrigger>
        <TooltipContent>Expired {dateStr}</TooltipContent>
      </Tooltip>
    );
  }
  if (days <= 30) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="orange" className="text-xs cursor-help">
            {days <= 0 ? "Today" : `${days}d left`}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>Expires {dateStr}</TooltipContent>
      </Tooltip>
    );
  }
  return <span className="text-xs text-muted-foreground">{dateStr}</span>;
}

function HolderCell({
  claims,
  isAdmin,
  myClaimId,
}: {
  claims: ActiveClaim[];
  isAdmin: boolean;
  myClaimId: string | null;
}) {
  if (claims.length === 0) return <span className="text-muted-foreground text-sm">—</span>;

  return (
    <div className="flex min-w-0 flex-col gap-1">
      {claims.map((claim) => {
        const isOwn = myClaimId === claim.id;
        const showName = isAdmin || isOwn || claim.user !== null;
        const name = claim.user?.name ?? claim.occupantLabel ?? "Unknown";
        const avatarUrl = claim.user?.avatarUrl ?? null;

        return (
          <div key={claim.id} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            {showName ? (
              <UserAvatar name={name} avatarUrl={avatarUrl} size="xs" />
            ) : (
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden="true">
                <KeyRound className="size-3" />
              </span>
            )}
            <span className={cn("min-w-0 break-words text-sm leading-snug", !showName && "text-muted-foreground")}>
              {showName ? name : "Occupied"}
            </span>
            {isOwn && <span className="text-xs text-muted-foreground">(you)</span>}
            {claim.userId === null && isAdmin && (
              <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">unknown</Badge>
            )}
          </div>
        );
      })}
    </div>
  );
}

function LicenseStatusBadge({
  status,
  isOwn,
}: {
  status: LicenseCode["status"];
  isOwn: boolean;
}) {
  if (status === "AVAILABLE") return <Badge variant="green">Open</Badge>;
  if (status === "PARTIAL") return <Badge variant="blue">1/{MAX_SLOTS}</Badge>;
  if (status === "CLAIMED") {
    return <Badge variant="blue">{isOwn ? "Yours · 2/2" : "Full · 2/2"}</Badge>;
  }
  return <Badge variant="gray">Retired</Badge>;
}

function licenseToneClasses(code: LicenseCode, isOwn: boolean) {
  return cn(
    code.status === "AVAILABLE" && "bg-[var(--green-bg)]/60",
    code.status === "PARTIAL" && "bg-[var(--blue-bg)]/60",
    code.status === "CLAIMED" && "bg-[var(--blue-bg)]/40",
    code.status === "RETIRED" && "opacity-50",
    isOwn && "ring-1 ring-inset ring-[var(--blue)]/40",
  );
}

function MobileLicenseLoading({ showExpiry, showActions }: { showExpiry: boolean; showActions: boolean }) {
  return (
    <div className="grid gap-2 md:hidden" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <Card key={i} elevation="flat">
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-4 w-40 max-w-full" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            </div>
            <div className={cn("mt-4 grid gap-3 border-t pt-3", showExpiry && "grid-cols-2")}>
              <div className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
              {showExpiry && (
                <div className="space-y-2">
                  <Skeleton className="h-3 w-14" />
                  <Skeleton className="h-4 w-20" />
                </div>
              )}
            </div>
            <div className="mt-3 space-y-2">
              <Skeleton className="h-3 w-14" />
              <div className="flex items-center gap-2">
                <Skeleton className="size-6 rounded-full" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
            {showActions && (
              <div className="mt-4 flex border-t pt-3">
                <Skeleton className="ml-auto h-10 w-24 rounded-md" />
              </div>
            )}
          </CardContent>
        </Card>
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
  if (loading && codes.length === 0) {
    return (
      <>
        <MobileLicenseLoading showExpiry={showExpiry} showActions={isAdmin} />
        <div className="hidden overflow-x-auto rounded-md border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead>Holders</TableHead>
                {showExpiry && <TableHead className="w-32">Expires</TableHead>}
                {isAdmin && <TableHead className="w-28 text-right">Action</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-36 font-mono" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  {showExpiry && <TableCell><Skeleton className="h-4 w-16" /></TableCell>}
                  {isAdmin && <TableCell><Skeleton className="ml-auto h-10 w-24 rounded-md" /></TableCell>}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </>
    );
  }

  function getCodeState(code: LicenseCode) {
    const myActiveClaim = code.claims.find((claim) => claim.userId === currentUserId);
    const isOwn = !!myActiveClaim;
    const claimable = code.status === "AVAILABLE" || code.status === "PARTIAL";
    const studentCanClaim = claimable && !hasMyLicense;
    const adminCanInspect = isAdmin;
    const isClickable = studentCanClaim || adminCanInspect;
    const displayCode = isAdmin || isOwn ? code.code : MASKED_CODE;
    const actionLabel = adminCanInspect ? "Inspect" : "Claim";

    function handleClick() {
      if (!isClickable) return;
      if (isOwn) return onClickClaimed(code);
      if (adminCanInspect) return onClickClaimed(code);
      if (claimable && studentCanClaim) return onClickAvailable(code);
    }

    return {
      actionLabel,
      adminCanInspect,
      displayCode,
      handleClick,
      isClickable,
      isOwn,
      myActiveClaim,
      studentCanClaim,
    };
  }

  return (
    <>
      <div className="grid gap-2 md:hidden" role="list">
        {codes.map((code) => {
          const {
            actionLabel,
            displayCode,
            handleClick,
            isClickable,
            isOwn,
            myActiveClaim,
          } = getCodeState(code);

          const content = (
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-muted-foreground">License code</p>
                  <code className="mt-1 block break-all font-mono text-sm font-medium text-foreground">
                    {displayCode}
                  </code>
                  {code.label && (
                    <p className="mt-1 break-words text-xs text-muted-foreground">{code.label}</p>
                  )}
                  {code.accountEmail && isAdmin && (
                    <p className="mt-1 break-all text-xs text-muted-foreground">{code.accountEmail}</p>
                  )}
                </div>
                <LicenseStatusBadge status={code.status} isOwn={isOwn} />
              </div>

              <dl className={cn("mt-4 grid gap-3 border-t pt-3", showExpiry && "grid-cols-2")}>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Capacity</dt>
                  <dd className="mt-1 text-sm font-medium tabular-nums">
                    {code.claims.length}/{MAX_SLOTS} slots in use
                  </dd>
                </div>
                {showExpiry && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Expires</dt>
                    <dd className="mt-1">
                      {code.expiresAt ? (
                        <ExpiryDisplay expiresAt={code.expiresAt} />
                      ) : (
                        <span className="text-sm text-muted-foreground">—</span>
                      )}
                    </dd>
                  </div>
                )}
              </dl>

              <div className="mt-3">
                <p className="text-xs font-medium text-muted-foreground">Holders</p>
                <div className="mt-1">
                  <HolderCell
                    claims={code.claims}
                    isAdmin={isAdmin}
                    myClaimId={myActiveClaim?.id ?? null}
                  />
                </div>
              </div>

              {isAdmin && (
                <div className="mt-4 flex border-t pt-3">
                  <span className="ml-auto inline-flex min-h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium">
                    {isClickable ? (
                      <>
                        <Eye className="size-4" aria-hidden="true" />
                        {actionLabel}
                      </>
                    ) : (
                      <span className="text-xs font-normal text-muted-foreground">
                        {isOwn ? "In use" : "Unavailable"}
                      </span>
                    )}
                  </span>
                </div>
              )}
            </CardContent>
          );

          return (
            <div key={code.id} role="listitem">
              {isClickable ? (
                <Button
                  type="button"
                  variant="ghost"
                  className={cn(
                    "h-auto min-h-0 w-full flex-col items-stretch justify-start overflow-hidden whitespace-normal rounded-lg border p-0 text-left font-normal shadow-none hover:bg-muted/60 active:scale-[0.99]",
                    licenseToneClasses(code, isOwn),
                  )}
                  aria-label={`${actionLabel} license ${displayCode}`}
                  onClick={handleClick}
                >
                  {content}
                </Button>
              ) : (
                <Card
                  elevation="flat"
                  className={cn("overflow-hidden", licenseToneClasses(code, isOwn))}
                >
                  {content}
                </Card>
              )}
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto rounded-md border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead className="w-24">Status</TableHead>
              <TableHead>Holders</TableHead>
              {showExpiry && <TableHead className="w-32">Expires</TableHead>}
              {isAdmin && <TableHead className="w-28 text-right">Action</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {codes.map((code) => {
              const {
                actionLabel,
                adminCanInspect,
                displayCode,
                handleClick,
                isClickable,
                isOwn,
                myActiveClaim,
                studentCanClaim,
              } = getCodeState(code);

              const rowClass = cn(
                "transition-colors",
                licenseToneClasses(code, isOwn),
                isClickable && "cursor-pointer hover:bg-muted/60",
                !isClickable && "cursor-default"
              );

              return (
                <TableRow
                  key={code.id}
                  className={cn(rowClass, isClickable && "focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]")}
                  onClick={handleClick}
                  tabIndex={isClickable ? 0 : undefined}
                  aria-label={isClickable ? `${actionLabel} license ${displayCode}` : undefined}
                  onKeyDown={isClickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleClick(); } } : undefined}
                >
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="font-mono text-sm">{displayCode}</code>
                        {code.label && (
                          <span className="text-xs text-muted-foreground">{code.label}</span>
                        )}
                      </div>
                      {code.accountEmail && isAdmin && (
                        <span className="text-xs text-muted-foreground truncate">{code.accountEmail}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <LicenseStatusBadge status={code.status} isOwn={isOwn} />
                  </TableCell>
                  <TableCell>
                    <HolderCell
                      claims={code.claims}
                      isAdmin={isAdmin}
                      myClaimId={myActiveClaim?.id ?? null}
                    />
                  </TableCell>
                  {showExpiry && (
                    <TableCell>
                      {code.expiresAt ? (
                        <ExpiryDisplay expiresAt={code.expiresAt} />
                      ) : (
                        <span className="text-muted-foreground text-sm">—</span>
                      )}
                    </TableCell>
                  )}
                  {isAdmin && (
                    <TableCell className="text-right">
                      {adminCanInspect ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10"
                          onClick={(event) => { event.stopPropagation(); onClickClaimed(code); }}
                        >
                          <Eye data-icon="inline-start" />
                          Inspect
                        </Button>
                      ) : studentCanClaim ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-10"
                          onClick={(event) => { event.stopPropagation(); onClickAvailable(code); }}
                        >
                          <KeyRound data-icon="inline-start" />
                          Claim
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">{isOwn ? "In use" : "Unavailable"}</span>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
