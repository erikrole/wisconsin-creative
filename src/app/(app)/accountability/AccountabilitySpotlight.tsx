"use client";

import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CrownIcon, MedalIcon, ShieldAlertIcon, SparklesIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { UserAvatar } from "@/components/UserAvatar";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type SortKey = "events" | "time" | "recent";

type SpotlightPerson = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  lateEventCount: number;
  activeOverdueCount: number;
  totalLateHours: number;
  lastIncidentAt: string;
};

function formatHours(hours: number) {
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainder = hours % 24;
  return remainder ? `${days}d ${remainder}h` : `${days}d`;
}

function scoreFor(person: SpotlightPerson, sort: SortKey, now: Date) {
  if (sort === "time") {
    return { value: formatHours(person.totalLateHours), label: "total late" };
  }
  if (sort === "recent") {
    return { value: formatRelativeTime(person.lastIncidentAt, now), label: "last incident" };
  }
  return {
    value: String(person.lateEventCount),
    label: `late event${person.lateEventCount === 1 ? "" : "s"}`,
  };
}

export function AccountabilitySpotlight({
  people,
  sort,
  scopeLabel,
  now,
  jeers,
}: {
  people: SpotlightPerson[];
  sort: SortKey;
  scopeLabel: string;
  now: Date;
  jeers: string[];
}) {
  const reduceMotion = useReducedMotion();
  const podium = people.slice(0, 3);

  return (
    <Card
      elevation="flat"
      className="mb-4 overflow-hidden border-[color-mix(in_oklch,var(--red)_24%,var(--border))]"
    >
      <div className="flex flex-col gap-3 border-b bg-[var(--red-bg)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md border border-[color-mix(in_oklch,var(--red)_24%,transparent)] bg-card text-[var(--red-text)]">
            <ShieldAlertIcon className="size-5" aria-hidden="true" />
          </div>
          <div>
            <h2 id="accountability-spotlight-title">The leaderboard nobody wants to lead</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Top three for {scopeLabel.toLowerCase()}. Return gear on time and vanish from the board.
            </p>
          </div>
        </div>
        <Badge variant="red" className="w-fit">
          Wrong leaderboard
        </Badge>
      </div>

      <CardContent className="p-3 sm:p-4">
        {podium.length === 0 ? (
          <div
            className="flex min-h-40 flex-col items-center justify-center rounded-md border border-dashed px-4 py-8 text-center"
            role="status"
          >
            <motion.span
              initial={reduceMotion ? false : { opacity: 0, rotate: -12, scale: 0.8 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              transition={{ duration: reduceMotion ? 0.12 : 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="mb-3 flex size-10 items-center justify-center rounded-full bg-[var(--green-bg)] text-[var(--green-text)]"
              aria-hidden="true"
            >
              <SparklesIcon className="size-5" />
            </motion.span>
            <p className="font-semibold">No one made the board. Beautifully boring.</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Keep returning gear on time and this section stays delightfully empty.
            </p>
          </div>
        ) : (
          <div
            className="grid gap-3 lg:grid-cols-[1.35fr_1fr_1fr]"
            aria-labelledby="accountability-spotlight-title"
            aria-live="polite"
          >
            <AnimatePresence initial={false} mode="popLayout">
              {podium.map((person, index) => {
                const rank = index + 1;
                const score = scoreFor(person, sort, now);
                const isLeader = rank === 1;

                return (
                  <motion.article
                    layout
                    key={`${sort}:${person.userId}:${rank}`}
                    initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
                    transition={{
                      duration: reduceMotion ? 0.12 : 0.24,
                      delay: reduceMotion ? 0 : index * 0.045,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className={cn(
                      "relative min-w-0 overflow-hidden rounded-md border p-4",
                      isLeader
                        ? "border-[color-mix(in_oklch,var(--red)_28%,var(--border))] bg-[color-mix(in_oklch,var(--red-bg)_58%,var(--card))]"
                        : "bg-card",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <UserAvatar
                          name={person.name}
                          avatarUrl={person.avatarUrl}
                          size={isLeader ? "lg" : "default"}
                          className="shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                            {isLeader ? (
                              <motion.span
                                initial={reduceMotion ? false : { rotate: -12, scale: 0.8 }}
                                animate={{ rotate: 0, scale: 1 }}
                                transition={{
                                  duration: reduceMotion ? 0.12 : 0.32,
                                  ease: [0.16, 1, 0.3, 1],
                                }}
                                aria-hidden="true"
                              >
                                <CrownIcon className="size-4 text-[var(--red-text)]" />
                              </motion.span>
                            ) : (
                              <MedalIcon className="size-4" aria-hidden="true" />
                            )}
                            Rank {rank}
                          </div>
                          <Link
                            href={`/users/${person.userId}`}
                            className="brand-identity mt-1 block truncate font-semibold text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          >
                            {person.name}
                          </Link>
                        </div>
                      </div>
                      {person.activeOverdueCount > 0 ? (
                        <Badge variant="red" size="sm" className="shrink-0">
                          {person.activeOverdueCount} out now
                        </Badge>
                      ) : null}
                    </div>

                    <div className="mt-5 flex items-end gap-2">
                      <span
                        className={cn(
                          "font-semibold tabular-nums",
                          isLeader ? "text-4xl text-[var(--red-text)]" : "text-3xl",
                        )}
                      >
                        {score.value}
                      </span>
                      <span className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        {score.label}
                      </span>
                    </div>
                    <p
                      className="mt-3 text-sm text-muted-foreground"
                      data-accountability-jeer
                    >
                      {jeers[index] ?? "Return gear on time to leave the board."}
                    </p>
                  </motion.article>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
