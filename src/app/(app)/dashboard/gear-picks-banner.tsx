"use client";

import Link from "next/link";
import { ArrowRightIcon, ShirtIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGearPicksMe } from "@/hooks/use-gear-picks";
import { formatUsd } from "@/lib/gear-picks/catalog";
import { formatDateTime } from "@/lib/format";

/**
 * Nudges a gear pick participant who hasn't submitted while the cycle is open.
 * Drafts still count as "not submitted" so a half-finished list isn't forgotten.
 */
export function GearPicksBanner() {
  const { data } = useGearPicksMe();

  if (!data?.cycle?.isOpen || !data.participant || data.submission?.submittedAt) return null;

  const allowance = formatUsd(data.participant.allowanceCents);
  const hasDraft = Boolean(data.submission && data.submission.lines.length > 0);
  const deadline = data.cycle.deadline ? formatDateTime(data.cycle.deadline) : null;

  return (
    <section
      aria-labelledby="gear-picks-banner-title"
      className="relative mb-4 overflow-hidden rounded-lg border border-[var(--red-text)]/20 bg-[var(--red-bg)]/[0.04] dark:bg-[var(--red-bg)]/[0.08]"
    >
      <div className="absolute bottom-0 left-0 top-0 w-[3px] bg-[var(--red-text)]" aria-hidden="true" />

      <div className="flex min-h-10 items-center justify-between gap-3 border-b border-[var(--red-text)]/15 px-4">
        <div className="flex min-w-0 items-center gap-2">
          <ShirtIcon className="size-3.5 shrink-0 text-[var(--red-text)]" aria-hidden="true" />
          <span
            className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--red-text)]"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Under Armour gear
          </span>
          <Badge variant={hasDraft ? "orange" : "red"} size="sm">
            {hasDraft ? "Draft saved" : "Not started"}
          </Badge>
        </div>
        {deadline && (
          <span className="hidden shrink-0 text-[10.5px] text-muted-foreground/60 sm:inline">
            Due {deadline}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2
            id="gear-picks-banner-title"
            className="text-[13px] font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)", fontWeight: 600 }}
          >
            Pick your 2027–28 UA gear
          </h2>
          <p className="mt-0.5 text-[12px] leading-5 text-muted-foreground">
            You have {allowance} to spend on top of your standard issue.
            {deadline ? ` Submit your picks by ${deadline}.` : " Submit your picks when you're ready."}
          </p>
        </div>

        <Button asChild variant="outline" className="min-h-10 w-full sm:w-auto">
          <Link href="/gear">
            Choose gear
            <ArrowRightIcon data-icon="inline-end" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
