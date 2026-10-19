"use client";

import { UserAvatar } from "@/components/UserAvatar";
import { formatRelativeTime } from "@/lib/format";
import type { LicenseCode } from "./types";

/** Student view: who is using Photo Mechanic right now. No codes, no per-code detail. */
export function LicenseHolders({ codes, currentUserId }: { codes: LicenseCode[]; currentUserId: string | null }) {
  const holders = codes
    .filter((code) => code.status !== "RETIRED")
    .flatMap((code) => code.claims)
    .filter((claim) => claim.user !== null)
    .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt));

  if (holders.length === 0) return null;

  return (
    <section aria-label="Who has a license">
      <h3 className="px-1 text-sm font-medium text-muted-foreground">In use now · {holders.length}</h3>
      <ul className="mt-2 divide-y rounded-xl border bg-card" role="list">
        {holders.map((claim) => (
          <li key={claim.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
            <UserAvatar name={claim.user!.name} avatarUrl={claim.user!.avatarUrl} size="sm" />
            <span className="min-w-0 flex-1 truncate text-sm">
              {claim.user!.name}
              {claim.userId === currentUserId && <span className="ml-1.5 text-xs text-muted-foreground">you</span>}
            </span>
            <span className="text-xs text-muted-foreground">{formatRelativeTime(claim.claimedAt, new Date())}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
