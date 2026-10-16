"use client";

import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { formatLicenseExpiryDate, licenseDaysUntilExpiry } from "@/lib/license-dates";
import { cn } from "@/lib/utils";
import type { LicenseCode } from "./types";

const MAX_SLOTS = 2;

function ExpiryChip({ expiresAt }: { expiresAt: string }) {
  const days = licenseDaysUntilExpiry(expiresAt);
  const dateStr = formatLicenseExpiryDate(expiresAt);
  if (days < 0) return <Badge variant="destructive" className="text-xs">Expired {dateStr}</Badge>;
  if (days <= 30) {
    return <Badge variant="orange" className="text-xs">{days <= 0 ? "Expires today" : `${days}d left`}</Badge>;
  }
  return <span className="text-xs text-muted-foreground">{dateStr}</span>;
}

/** Two seats as avatars: a filled seat shows its holder, an open seat is a dashed ring. */
function Seats({ code }: { code: LicenseCode }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`${code.claims.length} of ${MAX_SLOTS} slots in use`}>
      {Array.from({ length: MAX_SLOTS }, (_, i) => {
        const claim = code.claims[i];
        if (!claim) {
          return <span key={`open-${i}`} className="size-7 rounded-full border border-dashed border-[var(--green)]/60" title="Open slot" />;
        }
        const name = claim.user?.name ?? claim.occupantLabel ?? "Unknown";
        return <UserAvatar key={claim.id} name={name} avatarUrl={claim.user?.avatarUrl ?? null} size="sm" />;
      })}
    </div>
  );
}

function holderNames(code: LicenseCode) {
  if (code.claims.length === 0) return "Open";
  return code.claims.map((claim) => claim.user?.name ?? claim.occupantLabel ?? "Unknown").join(" · ");
}

type Props = {
  codes: LicenseCode[];
  loading: boolean;
  onInspect: (code: LicenseCode) => void;
};

/** Staff management list: one dense row per license code. */
export function LicenseTable({ codes, loading, onInspect }: Props) {
  if (loading && codes.length === 0) {
    return (
      <div className="divide-y rounded-xl border" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 p-3">
            <Skeleton className="h-4 w-44" />
            <Skeleton className="ml-auto size-7 rounded-full" />
            <Skeleton className="size-7 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card" role="list">
      {codes.map((code) => (
        <li key={code.id}>
          <Button
            type="button"
            variant="ghost"
            className={cn(
              "h-auto min-h-14 w-full justify-start gap-3 whitespace-normal rounded-none px-3 py-2.5 text-left font-normal",
              code.status === "RETIRED" && "opacity-50",
            )}
            aria-label={`Inspect license ${code.code}`}
            onClick={() => onInspect(code)}
          >
            <span className="min-w-0 flex-1">
              <code className="block break-all font-mono text-sm font-semibold">{code.code}</code>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {[code.label, holderNames(code)].filter(Boolean).join(" · ")}
              </span>
            </span>
            <Seats code={code} />
            <span className="hidden w-28 shrink-0 justify-end sm:flex">
              {code.status === "RETIRED" ? (
                <Badge variant="gray">Retired</Badge>
              ) : code.expiresAt ? (
                <ExpiryChip expiresAt={code.expiresAt} />
              ) : null}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </Button>
        </li>
      ))}
    </ul>
  );
}
