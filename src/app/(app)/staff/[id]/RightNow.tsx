"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Award, CalendarDays, Camera } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { formatDateTime } from "@/lib/format";

type RightNow = {
  nextShift: { summary: string; location: string | null; area: string; startsAt: string; endsAt: string; live: boolean } | null;
  holding: { id: string; title: string; dueAt: string; overdue: boolean }[];
};

type BadgeProgress = {
  earned: boolean;
  active: boolean;
  name: string;
  progressCurrent: number | null;
  progressTarget: number | null;
};

/** The unearned badge closest to done, if any is at least started. */
function nearestBadge(badges: BadgeProgress[]): BadgeProgress | null {
  let best: BadgeProgress | null = null;
  let bestRatio = 0;
  for (const badge of badges) {
    if (badge.earned || !badge.active || !badge.progressTarget || !badge.progressCurrent) continue;
    const ratio = badge.progressCurrent / badge.progressTarget;
    if (ratio < 1 && ratio > bestRatio) {
      best = badge;
      bestRatio = ratio;
    }
  }
  return best;
}

function Tile({ tone, icon, label, title, detail }: { tone: "green" | "blue" | "amber"; icon: ReactNode; label: string; title: string; detail: string }) {
  const palette = {
    green: { bg: "bg-[#e6f6eb]", fg: "text-[#1b6e47]" },
    blue: { bg: "bg-[#e8eeff]", fg: "text-[#2f4bb0]" },
    amber: { bg: "bg-[#fff1d6]", fg: "text-[#8a5200]" },
  }[tone];
  return (
    <div className="flex min-w-0 flex-1 basis-64 items-start gap-3.5 rounded-xl border bg-card p-4 shadow-xs">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${palette.bg} ${palette.fg}`} aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <div className={`text-xs font-black uppercase tracking-wide ${palette.fg}`}>{label}</div>
        <div className="mt-0.5 truncate text-base font-black tracking-tight">{title}</div>
        <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

/**
 * The top of a profile, read first: what is happening with this person right now. A tile only
 * shows when there is something to say, and the whole row disappears when there is nothing.
 */
export default function RightNow({ userId, enabled }: { userId: string; enabled: boolean }) {
  const { data } = useFetch<RightNow>({
    url: `/api/users/${userId}/right-now`,
    enabled,
    refetchOnFocus: false,
    transform: (json) => (json.data as RightNow | undefined) ?? { nextShift: null, holding: [] },
  });
  const badges = useFetch<BadgeProgress[]>({
    url: `/api/badges/user/${userId}`,
    enabled,
    refetchOnFocus: false,
    transform: (json) => {
      const badges = (json.data as { badges?: unknown } | undefined)?.badges;
      return Array.isArray(badges) ? (badges as BadgeProgress[]) : [];
    },
  });

  const shift = data?.nextShift ?? null;
  const holding = data?.holding ?? [];
  const badge = nearestBadge(badges.data ?? []);
  if (!shift && holding.length === 0 && !badge) return null;

  const firstOut = holding[0];
  return (
    <section aria-label="Right now" className="flex flex-wrap gap-4">
      {shift && (
        <Tile
          tone="green"
          icon={<CalendarDays className="size-5" />}
          label={shift.live ? "On shift now" : "Next shift"}
          title={shift.summary}
          detail={[formatDateTime(shift.startsAt), shift.location].filter(Boolean).join(" · ")}
        />
      )}
      {firstOut && (
        <Link href={`/checkouts/${firstOut.id}`} className="contents text-foreground no-underline">
          <Tile
            tone="blue"
            icon={<Camera className="size-5" />}
            label="Holding"
            title={holding.length > 1 ? `${firstOut.title} and ${holding.length - 1} more` : firstOut.title}
            detail={`${firstOut.overdue ? "Overdue" : "Due"} ${formatDateTime(firstOut.dueAt)}`}
          />
        </Link>
      )}
      {badge && (
        <Tile
          tone="amber"
          icon={<Award className="size-5" />}
          label="Almost there"
          title={badge.name}
          detail={`${badge.progressCurrent} of ${badge.progressTarget}`}
        />
      )}
    </section>
  );
}
