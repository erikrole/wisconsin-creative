"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Award, CalendarDays, Camera } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { formatDateTime } from "@/lib/format";

type RightNow = {
  nextShift: {
    summary: string;
    location: string | null;
    area: string;
    startsAt: string;
    endsAt: string;
    live: boolean;
  } | null;
  holding: { id: string; title: string; dueAt: string; overdue: boolean }[];
  week: { summary: string; area: string; startsAt: string; endsAt: string }[];
  performance: { checkouts: number; onTimeRate: number | null };
};

const EMPTY: RightNow = {
  nextShift: null,
  holding: [],
  week: [],
  performance: { checkouts: 0, onTimeRate: null },
};

const AREA_DOT: Record<string, string> = {
  VIDEO: "#3e63dd",
  PHOTO: "#8e4ec6",
  GRAPHICS: "#d6409f",
  SOCIAL: "#12a594",
  COMMS: "#e5a200",
  LIVE_PRODUCTION: "#f76808",
};

const dayFmt = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

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
    if (
      badge.earned ||
      !badge.active ||
      !badge.progressTarget ||
      !badge.progressCurrent
    )
      continue;
    const ratio = badge.progressCurrent / badge.progressTarget;
    if (ratio < 1 && ratio > bestRatio) {
      best = badge;
      bestRatio = ratio;
    }
  }
  return best;
}

function Tile({
  tone,
  icon,
  label,
  title,
  detail,
}: {
  tone: "green" | "blue" | "amber";
  icon: ReactNode;
  label: string;
  title: string;
  detail: string;
}) {
  const palette = {
    green: { bg: "bg-[#e6f6eb]", fg: "text-[#1b6e47]" },
    blue: { bg: "bg-[#e8eeff]", fg: "text-[#2f4bb0]" },
    amber: { bg: "bg-[#fff1d6]", fg: "text-[#8a5200]" },
  }[tone];
  return (
    <div className="flex min-w-0 flex-1 basis-64 items-start gap-3.5 rounded-xl border bg-card p-4 shadow-xs">
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${palette.bg} ${palette.fg}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <div
          className={`text-xs font-black uppercase tracking-wide ${palette.fg}`}
        >
          {label}
        </div>
        <div className="mt-0.5 truncate text-base font-black tracking-tight">
          {title}
        </div>
        <div className="mt-0.5 truncate text-[13px] text-muted-foreground">
          {detail}
        </div>
      </div>
    </div>
  );
}

/**
 * The top of a profile, read first: what is happening with this person right now. A tile only
 * shows when there is something to say, and the whole row disappears when there is nothing.
 */
export default function RightNow({
  userId,
  enabled,
}: {
  userId: string;
  enabled: boolean;
}) {
  const { data } = useFetch<RightNow>({
    url: `/api/users/${userId}/right-now`,
    enabled,
    refetchOnFocus: false,
    transform: (json) => (json.data as RightNow | undefined) ?? EMPTY,
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
  const week = data?.week ?? [];
  const performance = data?.performance ?? EMPTY.performance;
  const earned = (badges.data ?? []).filter((b) => b.earned).length;
  const showCards = week.length > 0 || performance.checkouts > 0 || earned > 0;
  if (!shift && holding.length === 0 && !badge && !showCards) return null;

  const firstOut = holding[0];
  return (
    <div className="space-y-4">
      {(shift || firstOut || badge) && (
        <section aria-label="Right now" className="flex flex-wrap gap-4">
          {shift && (
            <Tile
              tone="green"
              icon={<CalendarDays className="size-5" />}
              label={shift.live ? "On shift now" : "Next shift"}
              title={shift.summary}
              detail={[formatDateTime(shift.startsAt), shift.location]
                .filter(Boolean)
                .join(" · ")}
            />
          )}
          {firstOut && (
            <Link
              href={`/checkouts/${firstOut.id}`}
              className="contents text-foreground no-underline"
            >
              <Tile
                tone="blue"
                icon={<Camera className="size-5" />}
                label="Holding"
                title={
                  holding.length > 1
                    ? `${firstOut.title} and ${holding.length - 1} more`
                    : firstOut.title
                }
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
      )}
      {showCards && (
        <section
          aria-label="This week and performance"
          className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(14rem,1fr)]"
        >
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black tracking-tight">This week</h3>
              <Link
                href="/schedule"
                className="text-[13px] font-bold text-[#2f4bb0] no-underline"
              >
                Open schedule
              </Link>
            </div>
            {week.length === 0 ? (
              <p className="mt-3 text-[13px] text-muted-foreground">
                No shifts in the next 7 days.
              </p>
            ) : (
              <ul className="mt-2 divide-y">
                {week.map((w, i) => (
                  <li
                    key={`${w.startsAt}-${i}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2.5"
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ background: AREA_DOT[w.area] ?? "#8b8d98" }}
                      aria-hidden="true"
                    />
                    <span className="w-28 shrink-0 text-[13px] font-bold">
                      {dayFmt.format(new Date(w.startsAt))}
                    </span>
                    <span className="order-last basis-full truncate pl-[1.375rem] text-[13px] sm:order-none sm:flex-1 sm:basis-0 sm:pl-0">
                      {w.summary}
                    </span>
                    <span className="ml-auto shrink-0 text-[13px] text-muted-foreground sm:ml-0">
                      {timeFmt.format(new Date(w.startsAt))} –{" "}
                      {timeFmt.format(new Date(w.endsAt))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="rounded-xl border bg-card p-4 shadow-xs">
            <h3 className="text-base font-black tracking-tight">Performance</h3>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center md:grid-cols-1 md:text-left">
              <div>
                <dd className="text-2xl font-black tracking-tight">
                  {performance.onTimeRate === null
                    ? "—"
                    : `${performance.onTimeRate}%`}
                </dd>
                <dt className="text-xs text-muted-foreground">
                  On-time returns
                </dt>
              </div>
              <div>
                <dd className="text-2xl font-black tracking-tight">
                  {performance.checkouts}
                </dd>
                <dt className="text-xs text-muted-foreground">Checkouts</dt>
              </div>
              <div>
                <dd className="text-2xl font-black tracking-tight">{earned}</dd>
                <dt className="text-xs text-muted-foreground">Badges earned</dt>
              </div>
            </dl>
          </div>
        </section>
      )}
    </div>
  );
}
