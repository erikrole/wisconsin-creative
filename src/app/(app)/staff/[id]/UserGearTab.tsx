"use client";

import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useGearPicksMe, useUserGearPicks } from "@/hooks/use-gear-picks";
import { formatUsd } from "@/lib/gear-picks/catalog";
import type { GearPicksMeResponse } from "@/lib/gear-picks/types";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GearPickLineList } from "../../gear/GearPickLineList";

/**
 * Gear picks for a profile: your own (shared cache with /gear and the banner),
 * or anyone's for an admin. Null for everyone else, so no request is made.
 */
export function useProfileGearPicks(userId: string, isSelf: boolean, isAdmin: boolean) {
  const self = useGearPicksMe(isSelf);
  const other = useUserGearPicks(userId, !isSelf && isAdmin);
  const query = isSelf ? self : isAdmin ? other : null;
  return {
    data: query?.data ?? null,
    /** False while a fetch that could still reveal picks is in flight. */
    settled: !query || query.isFetched || query.isError,
  };
}

export default function UserGearTab({ data, isSelf }: { data: GearPicksMeResponse; isSelf: boolean }) {
  const { cycle, participant, submission } = data;
  if (!cycle || !participant) return null;

  const lines = (submission?.lines ?? []).map((line) => ({
    id: `${line.sku}:${line.size ?? ""}`,
    sku: line.sku,
    size: line.size,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
  }));
  const totalCents = submission?.totalCents ?? 0;
  const remainingCents = participant.allowanceCents - totalCents;
  const over = remainingCents < 0;
  const deadline = cycle.deadline ? formatDateTime(cycle.deadline) : null;
  const submittedAt = submission?.submittedAt ?? null;
  const hasDraft = lines.length > 0 && !submittedAt;

  const status = submittedAt
    ? `Submitted ${formatDateTime(submittedAt)}`
    : hasDraft
      ? "Draft, not submitted"
      : "Not started";
  const window = cycle.isOpen
    ? deadline
      ? `Picks can change until ${deadline}.`
      : "Picks can still change."
    : `Picks closed${deadline ? ` ${deadline}` : ""}.`;

  return (
    <Card className="mt-4">
      <CardHeader>
        <CardTitle>{cycle.title}</CardTitle>
        <CardDescription>
          {status} · {window}
        </CardDescription>
        <CardAction>
          <Badge variant={submittedAt ? "green" : hasDraft ? "orange" : "gray"}>
            {submittedAt ? "Submitted" : hasDraft ? "Draft" : "Not started"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <dl className="grid grid-cols-3 gap-3 border-y border-border px-6 py-3 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Picked</dt>
            <dd className="font-semibold tabular-nums">{formatUsd(totalCents)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Allowance</dt>
            <dd className="tabular-nums">{formatUsd(participant.allowanceCents)}</dd>
          </div>
          <div>
            <dt className={cn("text-xs", over ? "font-semibold text-[var(--red-text)]" : "text-muted-foreground")}>
              {over ? "Over by" : "Left"}
            </dt>
            <dd className={cn("tabular-nums", over && "font-semibold text-[var(--red-text)]")}>
              {formatUsd(Math.abs(remainingCents))}
            </dd>
          </div>
        </dl>

        {lines.length === 0 ? (
          <p className="px-6 py-8 text-sm text-muted-foreground">
            {isSelf ? "You haven't picked any gear yet." : "No gear picked yet."}
          </p>
        ) : (
          <GearPickLineList lines={lines} />
        )}

        {isSelf && cycle.isOpen && (
          <div className="border-t border-border px-6 pt-4">
            <Button asChild className="min-h-10">
              <Link href="/gear">
                {submittedAt ? "Change picks" : hasDraft ? "Finish picks" : "Choose gear"}
                <ArrowRightIcon data-icon="inline-end" />
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
