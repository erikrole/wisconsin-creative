"use client";

import { Lato } from "next/font/google";
import { AlertTriangleIcon, CheckIcon, InfoIcon } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// The board renders inside a Sheet portal, outside any page layout, so it carries
// the wc-fresh theme itself.
const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export type BoardTab = "available" | "mine" | "review" | "history";

export type BoardAction = {
  label: string;
  busyLabel: string;
  variant: "primary" | "outline" | "danger";
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
};

export type BoardNotice = { tone: "warn" | "block" | "info"; text: string };

/** One shift or trade, already reduced to what the row shows. */
export type BoardRow = {
  key: string;
  /** ISO start, used for the date tile and the day grouping. */
  startsAt: string;
  title: string;
  detail: string | null;
  times: string;
  area: string;
  /** Who this row is about: the poster, claimant or requester. */
  person: { name: string; avatarUrl?: string | null } | null;
  /** One sentence on what is happening, e.g. "Maya wants to take Sam's shift". */
  summary: string;
  note: string | null;
  notices: BoardNotice[];
  status: { label: string; variant: BadgeProps["variant"] } | null;
  muted?: boolean;
  actions: BoardAction[];
  /** A quiet destructive action, such as cancelling your own post. */
  menuAction?: BoardAction;
};

export type BoardTabSpec = { id: BoardTab; label: string; count: number; rows: BoardRow[] };

type Props = {
  tabs: BoardTabSpec[];
  tab: BoardTab;
  onTab: (tab: BoardTab) => void;
  loading: boolean;
  /** Set when a load failed; the board says so instead of showing a stale list. */
  errors: { text: string; retryLabel: string; onRetry: () => void; busy: boolean }[];
  needsReview: { busy: boolean; onReview: () => void } | null;
  toolbar?: React.ReactNode;
  intro?: string | null;
  /** Anchor for "Today" / "Tomorrow"; injectable so screenshots are stable. */
  now?: Date;
};

const EMPTY_COPY: Record<BoardTab, { title: string; description: string }> = {
  available: {
    title: "Nothing to pick up",
    description: "Open shifts and trades from your area show up here the moment they are posted.",
  },
  mine: {
    title: "Nothing in motion",
    description: "Shifts you post, and claims you are waiting on, are tracked here.",
  },
  review: {
    title: "All caught up",
    description: "Claims and requests that need a decision land here, soonest shift first.",
  },
  history: {
    title: "No history yet",
    description: "Completed and cancelled trades appear here.",
  },
};

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(iso: string, now: Date) {
  const date = new Date(iso);
  const diff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  const base = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  if (diff === 0) return `Today · ${base}`;
  if (diff === 1) return `Tomorrow · ${base}`;
  return base;
}

function DateTile({ iso, muted }: { iso: string; muted?: boolean }) {
  const date = new Date(iso);
  return (
    <div
      className={cn(
        "flex size-11 shrink-0 flex-col items-center justify-center rounded-lg border border-border/60 bg-muted/40 leading-none",
        muted && "opacity-60",
      )}
      aria-hidden
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {date.toLocaleDateString("en-US", { weekday: "short" })}
      </span>
      <span className="mt-1 text-base font-semibold tabular-nums">{date.getDate()}</span>
    </div>
  );
}

const NOTICE_STYLE: Record<BoardNotice["tone"], string> = {
  warn: "text-[var(--orange-text)]",
  block: "text-destructive",
  info: "text-muted-foreground",
};

function Row({ row }: { row: BoardRow }) {
  return (
    <article className={cn("flex gap-3 px-4 py-3.5 transition-colors hover:bg-muted/25", row.muted && "bg-muted/10")}>
      <DateTile iso={row.startsAt} muted={row.muted} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className={cn("truncate text-sm font-semibold leading-tight", row.muted && "text-muted-foreground")}>
              {row.title}
              {row.detail && <span className="font-normal text-muted-foreground"> · {row.detail}</span>}
            </h3>
            <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
              {row.times} · {row.area}
            </p>
          </div>
          {row.status && (
            <Badge variant={row.status.variant} size="sm" className="shrink-0">
              {row.status.label}
            </Badge>
          )}
        </div>

        <div className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
          {row.person && <UserAvatar name={row.person.name} avatarUrl={row.person.avatarUrl} size="xs" />}
          <span className="min-w-0">{row.summary}</span>
        </div>

        {row.note && (
          <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground">
            “{row.note}”
          </p>
        )}

        {row.notices.map((notice) => (
          <p key={notice.text} className={cn("flex items-start gap-1.5 text-xs leading-relaxed", NOTICE_STYLE[notice.tone])}>
            {notice.tone === "info" ? (
              <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            ) : (
              <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
            )}
            <span>{notice.text}</span>
          </p>
        ))}

        {(row.actions.length > 0 || row.menuAction) && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {row.actions.map((action) => (
              <Button
                key={action.label}
                className="h-10 gap-1.5"
                variant={action.variant === "primary" ? "default" : "outline"}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.variant === "primary" && !action.busy && <CheckIcon className="size-3.5" />}
                {action.busy ? action.busyLabel : action.label}
              </Button>
            ))}
            {row.menuAction && (
              <Button
                variant="ghost"
                className="-ml-2 h-10 text-muted-foreground hover:text-destructive"
                disabled={row.menuAction.disabled}
                onClick={row.menuAction.onClick}
              >
                {row.menuAction.busy ? row.menuAction.busyLabel : row.menuAction.label}
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Skeletons() {
  return (
    <div className="divide-y divide-border/50">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex gap-3 px-4 py-3.5">
          <Skeleton className="size-11 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TradeBoardView({ tabs, tab, onTab, loading, errors, needsReview, toolbar, intro, now }: Props) {
  const anchor = now ?? new Date();
  const active = tabs.find((item) => item.id === tab) ?? tabs[0];
  const rows = active?.rows ?? [];

  const groups: { label: string; rows: BoardRow[] }[] = [];
  for (const row of rows) {
    const label = dayLabel(row.startsAt, anchor);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <div className={cn("wc-fresh flex flex-col gap-3 bg-transparent", lato.variable)}>
      {needsReview && (
        <div role="alert" className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          <p>The last action could not be confirmed. It may already have completed. Review the refreshed work before another action.</p>
          <Button variant="outline" className="mt-2 h-10" disabled={needsReview.busy} onClick={needsReview.onReview}>
            Review latest work
          </Button>
        </div>
      )}
      {intro && <p className="px-0.5 text-sm leading-snug text-muted-foreground">{intro}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Trade Board" className="inline-flex rounded-lg bg-muted p-0.5">
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              type="button"
              aria-selected={item.id === tab}
              onClick={() => onTab(item.id)}
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors",
                item.id === tab && "bg-background text-foreground shadow-sm",
              )}
            >
              {item.label}
              {item.count > 0 && (
                <span
                  className={cn(
                    "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold tabular-nums",
                    item.id === "review" ? "bg-[var(--orange-bg)] text-[var(--orange-text)]" : "bg-foreground/10",
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          ))}
        </div>
        {toolbar}
      </div>

      {errors.map((error) => (
        <div
          key={error.text}
          className="flex items-center justify-between gap-3 rounded-lg bg-[var(--orange-bg)] px-3 py-2.5 text-sm text-[var(--orange-text)]"
        >
          <span className="flex min-w-0 items-center gap-2">
            <AlertTriangleIcon className="size-4 shrink-0" />
            <span>{error.text}</span>
          </span>
          <Button className="h-10" variant="outline" disabled={error.busy} onClick={error.onRetry}>
            {error.busy ? "Retrying..." : error.retryLabel}
          </Button>
        </div>
      ))}

      <div className="overflow-hidden rounded-xl border border-border/60 bg-card">
        {loading && rows.length === 0 ? (
          <Skeletons />
        ) : rows.length === 0 ? (
          <EmptyState icon={tab === "review" ? "check" : "clipboard"} {...EMPTY_COPY[tab]} compact />
        ) : (
          groups.map((group) => (
            <section key={group.label} className="border-b border-border/50 last:border-b-0">
              <p className="bg-muted/30 px-4 py-1.5 font-sans text-xs font-medium tracking-normal text-muted-foreground">{group.label}</p>
              <div className="divide-y divide-border/50">
                {group.rows.map((row) => (
                  <Row key={row.key} row={row} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
