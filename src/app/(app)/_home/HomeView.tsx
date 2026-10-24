"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import {
  AlertCircleIcon,
  ArrowLeftRightIcon,
  CalendarDaysIcon,
  CalendarOffIcon,
  CalendarPlusIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  FilePenLineIcon,
  PackageCheckIcon,
  PackageOpenIcon,
  PackagePlusIcon,
  PackageXIcon,
  PlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/UserAvatar";
import { cn } from "@/lib/utils";
import {
  dayHeading,
  greeting,
  startsIn,
  todayLabel,
  type ActivityRow,
  type AttentionItem,
  type AttentionTarget,
  type CoverageRow,
  type CrewRow,
  type GearRow,
  type HomeRole,
  type HomeTone,
  type QuickAction,
  type SummaryMetric,
  type TradeRow,
  type UpNextItem,
} from "./home-model";

/** A section's data: undefined hides it, the rest are its three states. */
export type Slot<T> =
  | { state: "loading" }
  | { state: "error"; onRetry: () => void }
  | { state: "ready"; rows: T };

/** Students' upcoming dated "can't work" entries, plus the names of weekly ones. */
export type CantWorkSlot = Slot<{ away: CantWorkRow[]; weekly: string[] }>;
export type CantWorkRow = { id: string; title: string; when: string };

export type HomeSync = { label: string; live: boolean; description?: string };

export type HomeViewProps = {
  role: HomeRole | null;
  name: string | null;
  now: Date;
  canReserve: boolean;
  /** One sentence under the greeting about today. Null while loading. */
  dayLine?: string | null;
  sync?: HomeSync | null;
  updatedLabel?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Full-page failure: nothing trustworthy to show. */
  pageError?: false | "network" | "server";
  onRetry?: () => void;
  banners?: ReactNode;
  summary?: Slot<SummaryMetric[]>;
  attention?: Slot<AttentionItem[]>;
  upNext?: Slot<UpNextItem[]>;
  upNextEmpty?: { title: string; description: string; href: string; action: string };
  /** Students only: days they can't work, kept one tap away every day. */
  cantWork?: CantWorkSlot;
  onAddCantWork?: () => void;
  myGear?: Slot<GearRow[]>;
  myGearHref?: string;
  coverage?: Slot<CoverageRow[]>;
  teamGear?: Slot<{ rows: GearRow[]; total: number }>;
  trades?: Slot<TradeRow[]>;
  crew?: Slot<CrewRow[]>;
  /** Latest kiosk pickups and returns; staff and admins only. */
  activity?: Slot<ActivityRow[]>;
  tradesHref?: string;
  notice?: ReactNode;
  onTarget: (target: AttentionTarget) => void;
  onSelectBooking: (bookingId: string) => void;
  /** One-tap trade decisions; rows hide the button when this is absent. */
  onQuick?: (quick: QuickAction) => void;
  busyTradeId?: string | null;
  /** Overdue reminders; rows hide the button when this is absent. */
  onRemind?: (bookingId: string) => void;
  remindingId?: string | null;
  remindedIds?: ReadonlySet<string>;
};

const TONE_TILE: Record<HomeTone, string> = {
  critical: "bg-[var(--red-bg)] text-[var(--red-text)]",
  warning: "bg-[var(--orange-bg)] text-[var(--orange-text)]",
  info: "bg-[var(--blue-bg)] text-[var(--blue-text)]",
  neutral: "bg-muted text-muted-foreground",
};

const TONE_TEXT: Record<HomeTone, string> = {
  critical: "text-[var(--red-text)]",
  warning: "text-[var(--orange-text)]",
  info: "text-[var(--blue-text)]",
  neutral: "text-muted-foreground",
};

const ATTENTION_ICON = {
  overdue: AlertCircleIcon,
  due: ClockIcon,
  pickup: PackageOpenIcon,
  trade: ArrowLeftRightIcon,
  gear: PackagePlusIcon,
  damage: TriangleAlertIcon,
  draft: FilePenLineIcon,
  lost: PackageXIcon,
} as const;

const ROW =
  "group flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left no-underline transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50";

const ATTENTION_PREVIEW = 5;

export function HomeView(props: HomeViewProps) {
  const { role, now, pageError, onRetry } = props;
  const teamGearInMain = !props.activity;
  const hasPrimary = Boolean(props.attention || props.upNext || props.cantWork);
  const hasSecondary = Boolean(props.activity || (teamGearInMain && props.teamGear));
  const hasAside = Boolean(props.myGear || props.trades || props.crew || props.coverage || (!teamGearInMain && props.teamGear));
  const splitColumns = (hasPrimary || hasSecondary) && hasAside;
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 pb-8" data-home>
      <HomeHeader {...props} />
      {props.banners}
      {pageError ? (
        <HomeCard>
          <StateBlock
            icon={pageError === "network" ? WifiOffIcon : AlertCircleIcon}
            title={pageError === "network" ? "You’re offline" : "Couldn’t load your home"}
            description={pageError === "network"
              ? "Check your connection, then try again."
              : "Counts and due times are unavailable. Try again before relying on them."}
            action={onRetry ? <Button variant="outline" className="h-10" onClick={onRetry}>Try again</Button> : null}
          />
        </HomeCard>
      ) : (
        <>
          {props.notice}
          {props.summary && <SummaryStrip slot={props.summary} />}
          <div className={cn(
            "grid items-start gap-5",
            splitColumns && "xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]",
            splitColumns && hasPrimary && hasSecondary && "xl:grid-rows-[min-content_1fr]",
          )}>
            {hasPrimary && <div className="flex min-w-0 flex-col gap-5">
              {props.attention && (
                <AttentionSection
                  slot={props.attention}
                  onTarget={props.onTarget}
                  onQuick={props.onQuick}
                  busyTradeId={props.busyTradeId}
                  onRemind={props.onRemind}
                  remindingId={props.remindingId}
                  remindedIds={props.remindedIds}
                />
              )}
              {props.upNext && (
                <UpNextSection slot={props.upNext} now={now} empty={props.upNextEmpty} onTarget={props.onTarget} />
              )}
              {props.cantWork && <CantWorkSection slot={props.cantWork} onAdd={props.onAddCantWork} />}
            </div>}
            {hasAside && <div className={cn(
              "flex min-w-0 flex-col gap-5",
              splitColumns && hasPrimary && hasSecondary && "xl:col-start-2 xl:row-start-1 xl:row-span-2",
            )}>
              {props.myGear && (
                <GearSection
                  title={role === "STUDENT" || role === "COLLABORATOR" ? "My gear" : "Checked out to you"}
                  href={props.myGearHref ?? "/checkouts?mine=true"}
                  slot={props.myGear}
                  emptyTitle="Nothing checked out"
                  emptyDescription={props.canReserve ? "Reserve gear for your next shoot." : "Gear you pick up at the kiosk shows here."}
                  emptyAction={props.canReserve ? (
                    <Button asChild variant="outline" className="h-10">
                      <Link href="/reservations/new"><PlusIcon data-icon="inline-start" />Reserve gear</Link>
                    </Button>
                  ) : null}
                  onSelectBooking={props.onSelectBooking}
                />
              )}
              {props.trades && (
                <TradesSection slot={props.trades} href={props.tradesHref ?? "/schedule"} onQuick={props.onQuick} busyTradeId={props.busyTradeId} />
              )}
              {props.crew && <CrewSection slot={props.crew} />}
              {props.coverage && <CoverageSection slot={props.coverage} />}
              {!teamGearInMain && props.teamGear && <TeamGearSection slot={props.teamGear} onSelectBooking={props.onSelectBooking} />}
            </div>}
            {hasSecondary && <div className={cn(
              "flex min-w-0 flex-col gap-5",
              splitColumns && hasPrimary && "xl:col-start-1 xl:row-start-2",
            )}>
              {props.activity && <ActivitySection slot={props.activity} onSelectBooking={props.onSelectBooking} />}
              {teamGearInMain && props.teamGear && <TeamGearSection slot={props.teamGear} onSelectBooking={props.onSelectBooking} />}
            </div>}
          </div>
        </>
      )}
    </div>
  );
}

/* ── Header ─────────────────────────────────────────────── */

function HomeHeader({ name, now, canReserve, dayLine, sync, updatedLabel, refreshing, onRefresh }: HomeViewProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pt-1">
      <div className="min-w-0">
        <p className="text-[13px] font-bold text-muted-foreground">{todayLabel(now)}</p>
        <h1 className="mt-0.5 text-[28px]! leading-tight text-foreground max-md:text-[24px]!">
          {greeting(now, name)}
        </h1>
        {dayLine !== undefined && (
          dayLine === null
            ? <Skeleton className="mt-2 h-4 w-72 max-w-full bg-muted" aria-hidden="true" />
            : <p className="mt-1 text-[15px] text-muted-foreground" data-day-line>{dayLine}</p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(sync || updatedLabel) && (
          <span
            className="flex h-10 items-center gap-2 px-1 text-[13px] text-muted-foreground"
            title={sync?.description}
          >
            {sync && (
              <span
                aria-hidden="true"
                className={cn("size-2 rounded-full", sync.live ? "bg-[var(--green)]" : "bg-[var(--orange)]")}
              />
            )}
            <span>{[sync?.label, updatedLabel].filter(Boolean).join(" · ")}</span>
          </span>
        )}
        {onRefresh && (
          <Button
            variant="ghost"
            size="icon"
            className="size-10 text-muted-foreground hover:text-foreground"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh home"
          >
            <RefreshCwIcon className={cn("size-4", refreshing && "animate-spin")} />
          </Button>
        )}
        {canReserve && (
          // Home's one brand-led action wears Badger red, not the wc-fresh blue.
          <Button asChild className="h-10 bg-[var(--brand-red)] text-white hover:bg-[var(--brand-red-hover)]">
            <Link href="/reservations/new"><PlusIcon data-icon="inline-start" />New reservation</Link>
          </Button>
        )}
      </div>
    </header>
  );
}

/* ── Building blocks ────────────────────────────────────── */

function HomeCard({ children, className, ...rest }: React.ComponentProps<"section">) {
  return (
    <section className={cn("overflow-hidden rounded-xl border bg-card shadow-xs", className)} {...rest}>
      {children}
    </section>
  );
}

function SectionHeader({ id, title, count, href, linkLabel = "View all" }: {
  id: string;
  title: string;
  count?: number | null;
  href?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 px-4 pt-3 pb-1">
      <h2 id={id} className="flex items-baseline gap-2 text-[15px]! leading-none text-foreground">
        {title}
        {count != null && count > 0 && (
          <span className="text-[13px] font-bold tabular-nums text-muted-foreground">{count}</span>
        )}
      </h2>
      {href && (
        <Link
          href={href}
          className="-mr-2 flex min-h-10 items-center gap-0.5 rounded-md px-2 text-[13px] font-bold text-muted-foreground no-underline transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {linkLabel}
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

function StateBlock({ icon: Icon, title, description, action, tone = "neutral", compact = false }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: HomeTone | "positive";
  compact?: boolean;
}) {
  return (
    <div className={cn("flex", compact ? "items-start gap-3 px-4 pt-3 pb-4" : "flex-col items-center gap-1 px-6 py-8 text-center")}>
      <span
        aria-hidden="true"
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full",
          compact ? "size-8" : "mb-2 size-10",
          tone === "positive" ? "bg-[var(--green-bg)] text-[var(--green-text)]" : TONE_TILE[tone],
        )}
      >
        <Icon className={compact ? "size-4" : "size-5"} />
      </span>
      <div className={cn("flex min-w-0 flex-col gap-1", compact ? "flex-1" : "items-center")}>
        <p className="text-sm font-bold text-foreground">{title}</p>
        {description && <p className="max-w-[320px] text-[13px] text-muted-foreground">{description}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

function SectionError({ what, onRetry }: { what: string; onRetry: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-4">
      <p className="text-[13px] text-muted-foreground">Couldn&rsquo;t load {what}.</p>
      <Button variant="outline" className="h-10" onClick={onRetry}>Retry</Button>
    </div>
  );
}

function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="flex flex-col" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
          <Skeleton className="size-8 shrink-0 rounded-lg bg-muted" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/2 bg-muted" />
            <Skeleton className="h-3 w-1/3 bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Summary ────────────────────────────────────────────── */

function SummaryStrip({ slot }: { slot: Slot<SummaryMetric[]> }) {
  if (slot.state === "error") {
    return (
      <HomeCard aria-label="Summary">
        <SectionError what="counts" onRetry={slot.onRetry} />
      </HomeCard>
    );
  }
  const metrics = slot.state === "ready" ? slot.rows : null;
  return (
    <HomeCard aria-label="Summary" aria-busy={metrics === null}>
      <div className="grid grid-cols-4 divide-x max-md:grid-cols-2 max-md:divide-x-0 max-md:[&>*:nth-child(odd)]:border-r max-md:[&>*:nth-child(-n+2)]:border-b">
        {(metrics ?? Array.from({ length: 4 }, () => null)).map((m, i) => m ? (
          <Link
            key={m.id}
            href={m.href}
            className="group flex min-w-0 flex-col gap-1 px-4 py-3.5 text-foreground no-underline transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
          >
            <span className="truncate text-[13px] font-bold text-muted-foreground">{m.label}</span>
            <span className={cn("text-[28px] leading-none font-black tabular-nums", m.tone === "neutral" ? "text-foreground" : TONE_TEXT[m.tone])}>
              {m.value ?? "–"}
            </span>
            <span className="truncate text-xs text-muted-foreground">{m.detail}</span>
          </Link>
        ) : (
          <div key={i} className="flex flex-col gap-2 px-4 py-3.5" aria-hidden="true">
            <Skeleton className="h-3 w-16 bg-muted" />
            <Skeleton className="h-7 w-10 bg-muted" />
            <Skeleton className="h-3 w-24 bg-muted" />
          </div>
        ))}
      </div>
    </HomeCard>
  );
}

/* ── Needs attention ────────────────────────────────────── */

function QuickButton({ quick, onQuick, busy }: { quick?: QuickAction; onQuick?: (q: QuickAction) => void; busy: boolean }) {
  if (!quick || !onQuick) return null;
  return (
    <Button
      variant="outline"
      className="mr-3 h-10 shrink-0"
      disabled={busy}
      onClick={() => onQuick(quick)}
      aria-label={`${quick.label}: ${quick.confirmTitle.replace(/\?$/, "")}`}
    >
      {busy ? "Working\u2026" : quick.label}
    </Button>
  );
}

function RemindButton({ remind, onRemind, busy, sent }: {
  remind?: AttentionItem["remind"];
  onRemind?: (bookingId: string) => void;
  busy: boolean;
  sent: boolean;
}) {
  if (!remind || !onRemind) return null;
  return (
    <Button
      variant="outline"
      className="mr-3 h-10 shrink-0"
      disabled={busy || sent}
      onClick={() => onRemind(remind.bookingId)}
      aria-label={sent ? `Reminder sent to ${remind.person}` : `Remind ${remind.person} to return it`}
      title={sent ? "Reminder sent" : `Send ${remind.person} a return reminder`}
    >
      {sent ? <><CheckIcon data-icon="inline-start" className="text-[var(--green-text)]" />Reminded</> : busy ? "Sending\u2026" : "Remind"}
    </Button>
  );
}

function AttentionSection({ slot, onTarget, onQuick, busyTradeId, onRemind, remindingId, remindedIds }: {
  slot: Slot<AttentionItem[]>;
  onTarget: (t: AttentionTarget) => void;
  onQuick?: (q: QuickAction) => void;
  busyTradeId?: string | null;
  onRemind?: (bookingId: string) => void;
  remindingId?: string | null;
  remindedIds?: ReadonlySet<string>;
}) {
  const [expanded, setExpanded] = useState(false);
  const rows = slot.state === "ready" ? slot.rows : [];
  const visible = expanded ? rows : rows.slice(0, ATTENTION_PREVIEW);
  const hidden = rows.length - visible.length;
  return (
    <HomeCard aria-labelledby="home-attention">
      <SectionHeader id="home-attention" title="Needs attention" count={slot.state === "ready" ? rows.length : null} />
      {slot.state === "loading" ? (
        <RowsSkeleton rows={3} />
      ) : slot.state === "error" ? (
        <SectionError what="what needs attention" onRetry={slot.onRetry} />
      ) : rows.length === 0 ? (
        <StateBlock
          compact
          icon={CheckIcon}
          tone="positive"
          title="You’re all caught up"
          description="Nothing is overdue or waiting on you right now."
        />
      ) : (
        <>
          <ul className="flex flex-col pb-1.5">
            {visible.map((item) => (
              <li key={item.id} className="flex items-center">
                <AttentionRow item={item} onTarget={onTarget} />
                <QuickButton quick={item.quick} onQuick={onQuick} busy={busyTradeId === item.quick?.tradeId} />
                <RemindButton
                  remind={item.remind}
                  onRemind={onRemind}
                  busy={remindingId === item.remind?.bookingId}
                  sent={Boolean(item.remind && remindedIds?.has(item.remind.bookingId))}
                />
              </li>
            ))}
          </ul>
          {(hidden > 0 || expanded) && rows.length > ATTENTION_PREVIEW && (
            <div className="border-t px-2 py-1">
              <Button
                variant="ghost"
                className="h-10 w-full text-[13px] font-bold text-muted-foreground"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
              >
                {expanded ? "Show less" : `Show ${hidden} more`}
              </Button>
            </div>
          )}
        </>
      )}
    </HomeCard>
  );
}

function AttentionRow({ item, onTarget }: { item: AttentionItem; onTarget: (t: AttentionTarget) => void }) {
  const Icon = ATTENTION_ICON[item.icon];
  const body = (
    <>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", TONE_TILE[item.tone])}>
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold text-foreground">{item.title}</span>
        <span className="truncate text-[13px] text-muted-foreground">{item.detail}</span>
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-[13px] font-bold text-muted-foreground transition-colors group-hover:text-foreground">
        <span className={item.quick || item.remind ? "sr-only" : "max-sm:sr-only"}>{item.action}</span>
        <ChevronRightIcon className="size-4" aria-hidden="true" />
      </span>
    </>
  );
  if (item.target.kind === "link") {
    return <Link href={item.target.href} className={cn(ROW, "min-w-0 flex-1")}>{body}</Link>;
  }
  const target = item.target;
  return <button type="button" className={cn(ROW, "min-w-0 flex-1 cursor-pointer")} onClick={() => onTarget(target)}>{body}</button>;
}

/* ── Up next ────────────────────────────────────────────── */

function UpNextSection({ slot, now, empty, onTarget }: {
  slot: Slot<UpNextItem[]>;
  now: Date;
  empty?: HomeViewProps["upNextEmpty"];
  onTarget: (t: AttentionTarget) => void;
}) {
  const groups: Array<{ day: string; rows: UpNextItem[] }> = [];
  // The first commitment in the next two days gets the spotlight, like a
  // calendar's "Up next"; the rest stay a plain list.
  const first = slot.state === "ready" ? slot.rows[0] : undefined;
  const featured = first && new Date(first.startsAt).getTime() - now.getTime() < 48 * 3_600_000 ? first : null;
  if (slot.state === "ready") {
    for (const row of slot.rows) {
      if (row === featured) continue;
      const day = dayHeading(row.startsAt, now, row.allDay);
      const last = groups[groups.length - 1];
      if (last?.day === day) last.rows.push(row);
      else groups.push({ day, rows: [row] });
    }
  }
  return (
    <HomeCard aria-labelledby="home-up-next">
      <SectionHeader id="home-up-next" title="Up next" href="/schedule?myShifts=true" linkLabel="Schedule" />
      {slot.state === "loading" ? (
        <RowsSkeleton rows={3} />
      ) : slot.state === "error" ? (
        <SectionError what="your schedule" onRetry={slot.onRetry} />
      ) : groups.length === 0 && !featured ? (
        <StateBlock
          compact
          icon={CalendarDaysIcon}
          title={empty?.title ?? "Nothing on your calendar"}
          description={empty?.description ?? "Shifts and gear pickups you’re part of show up here."}
          action={empty ? (
            <Button asChild variant="outline" className="h-10"><Link href={empty.href}>{empty.action}</Link></Button>
          ) : null}
        />
      ) : (
        <div className="flex flex-col pb-1.5">
          {featured && <FeaturedNext row={featured} now={now} onTarget={onTarget} />}
          {groups.map((group) => (
            <div key={group.day} className="flex flex-col">
              <p className="px-4 pt-2.5 pb-1 text-xs font-bold text-muted-foreground">{group.day}</p>
              <ul className="flex flex-col">
                {group.rows.map((row) => (
                  <li key={row.id}><UpNextRow row={row} onTarget={onTarget} /></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </HomeCard>
  );
}

function FeaturedNext({ row, now, onTarget }: { row: UpNextItem; now: Date; onTarget: (t: AttentionTarget) => void }) {
  const day = dayHeading(row.startsAt, now, row.allDay);
  const soon = startsIn(row.startsAt, now);
  const target = row.target;
  const action = row.kind === "pickup" ? "View pickup" : row.kind === "shift" ? "Open event" : "Open";
  return (
    <div className="mx-3 mt-1 mb-2 flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg bg-foreground/[0.045] px-4 py-3.5" data-featured-next>
      <div className="flex min-w-[min(100%,220px)] flex-1 basis-[220px] flex-col gap-0.5">
        <p className="flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", row.kind === "pickup" ? "bg-[var(--purple)]" : "bg-[var(--accent)]")} />
          {row.kind === "pickup" ? "Next pickup" : "Next up"} · {soon === "now" ? "happening now" : soon}
        </p>
        <p className="truncate text-base font-black text-foreground">{row.title}</p>
        <p className="truncate text-[13px] text-muted-foreground">
          {[`${day}${row.allDay ? "" : `, ${row.time}`}`, row.detail].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {row.badge && (
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", TONE_TILE[row.badge.tone])}>{row.badge.label}</span>
        )}
        {target.kind === "link" ? (
          <Button asChild variant="outline" className="h-10 bg-card">
            <Link href={target.href}>{action}</Link>
          </Button>
        ) : (
          <Button variant="outline" className="h-10 bg-card" onClick={() => onTarget(target)}>{action}</Button>
        )}
      </div>
    </div>
  );
}

function UpNextRow({ row, onTarget }: { row: UpNextItem; onTarget: (t: AttentionTarget) => void }) {
  const body = (
    <>
      <span className="w-[68px] shrink-0 text-[13px] font-bold tabular-nums text-foreground">{row.time}</span>
      <span
        aria-hidden="true"
        className={cn("w-[3px] self-stretch rounded-full", row.kind === "shift" ? "bg-[var(--accent)]" : "bg-[var(--purple)]")}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-bold text-foreground">{row.title}</span>
        <span className="truncate text-[13px] text-muted-foreground">{row.detail}</span>
      </span>
      {row.badge && (
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-bold", TONE_TILE[row.badge.tone])}>
          {row.badge.label}
        </span>
      )}
    </>
  );
  if (row.target.kind === "link") return <Link href={row.target.href} className={ROW}>{body}</Link>;
  const target = row.target;
  return <button type="button" className={cn(ROW, "cursor-pointer")} onClick={() => onTarget(target)}>{body}</button>;
}

const CANT_WORK_PREVIEW = 3;

function CantWorkSection({ slot, onAdd }: { slot: CantWorkSlot; onAdd?: () => void }) {
  const away = slot.state === "ready" ? slot.rows.away : [];
  const weekly = slot.state === "ready" ? slot.rows.weekly : [];
  const empty = slot.state === "ready" && away.length === 0;
  return (
    <HomeCard aria-labelledby="home-cant-work" data-cant-work>
      <SectionHeader id="home-cant-work" title="Can’t work" count={away.length} href="/welcome/availability" linkLabel="All times" />
      {slot.state === "loading" ? (
        <RowsSkeleton rows={2} />
      ) : slot.state === "error" ? (
        <SectionError what="the days you can’t work" onRetry={slot.onRetry} />
      ) : (
        <div className="flex flex-col pb-1.5">
          {empty ? (
            <div className="flex items-start gap-3 px-4 py-2.5">
              <span aria-hidden="true" className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <CalendarOffIcon className="size-4" />
              </span>
              <p className="text-[13px] text-muted-foreground">
                Away for a trip, an exam or another job? Add it so you aren’t scheduled then.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col">
              {away.slice(0, CANT_WORK_PREVIEW).map((row) => (
                <li key={row.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
                  <span aria-hidden="true" className="w-[3px] self-stretch rounded-full bg-[var(--orange)]" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-bold text-foreground">{row.title}</span>
                    <span className="truncate text-[13px] tabular-nums text-muted-foreground">{row.when}</span>
                  </span>
                </li>
              ))}
              {away.length > CANT_WORK_PREVIEW && (
                <li className="px-4 pb-1 text-[13px] text-muted-foreground">+{away.length - CANT_WORK_PREVIEW} more</li>
              )}
            </ul>
          )}
          {weekly.length > 0 && (
            <p className="truncate px-4 pt-1 text-[13px] text-muted-foreground" data-cant-work-weekly>
              Every week: {weekly.join(", ")}
            </p>
          )}
          {onAdd && (
            <div className="px-4 pt-2 pb-2">
              <Button variant="outline" className="h-10" onClick={onAdd}>
                <CalendarPlusIcon data-icon="inline-start" />
                Add days you can’t work
              </Button>
            </div>
          )}
        </div>
      )}
    </HomeCard>
  );
}

/* ── Right rail ─────────────────────────────────────────── */

function GearSection({ title, href, slot, emptyTitle, emptyDescription, emptyAction, onSelectBooking }: {
  title: string;
  href: string;
  slot: Slot<GearRow[]>;
  emptyTitle: string;
  emptyDescription: string;
  emptyAction: ReactNode;
  onSelectBooking: (id: string) => void;
}) {
  return (
    <HomeCard aria-labelledby="home-my-gear">
      <SectionHeader
        id="home-my-gear"
        title={title}
        count={slot.state === "ready" ? slot.rows.length : null}
        href={slot.state === "ready" && slot.rows.length > 0 ? href : undefined}
      />
      {slot.state === "loading" ? (
        <RowsSkeleton rows={2} />
      ) : slot.state === "error" ? (
        <SectionError what="your gear" onRetry={slot.onRetry} />
      ) : slot.rows.length === 0 ? (
        <StateBlock compact icon={PackageCheckIcon} title={emptyTitle} description={emptyDescription} action={emptyAction} />
      ) : (
        <GearList rows={slot.rows} onSelectBooking={onSelectBooking} />
      )}
    </HomeCard>
  );
}

function GearList({ rows, onSelectBooking }: { rows: GearRow[]; onSelectBooking: (id: string) => void }) {
  return (
    <ul className="flex flex-col pb-1.5">
      {rows.map((row) => (
        <li key={row.id}>
          <button type="button" className={cn(ROW, "cursor-pointer")} onClick={() => onSelectBooking(row.id)}>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-bold text-foreground">{row.title}</span>
              <span className="truncate text-[13px] text-muted-foreground">
                {[row.person, row.detail].filter(Boolean).join(" · ")}
              </span>
            </span>
            <span className={cn("shrink-0 text-[13px] font-bold tabular-nums", row.tone === "neutral" ? "text-muted-foreground" : TONE_TEXT[row.tone])}>
              {row.due}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TradesSection({ slot, href, onQuick, busyTradeId }: {
  slot: Slot<TradeRow[]>;
  href: string;
  onQuick?: (q: QuickAction) => void;
  busyTradeId?: string | null;
}) {
  return (
    <HomeCard aria-labelledby="home-trades">
      <SectionHeader
        id="home-trades"
        title="Open trades"
        count={slot.state === "ready" ? slot.rows.length : null}
        href={href}
        linkLabel="Trade Board"
      />
      {slot.state === "loading" ? (
        <RowsSkeleton rows={2} />
      ) : slot.state === "error" ? (
        <SectionError what="trades" onRetry={slot.onRetry} />
      ) : slot.rows.length === 0 ? (
        <StateBlock compact icon={ArrowLeftRightIcon} title="No open trades" description="Shifts a teammate posts that you can pick up appear here." />
      ) : (
        <ul className="flex flex-col pb-1.5">
          {slot.rows.map((row) => (
            <li key={row.id} className="flex items-center">
              <Link href={href} className={cn(ROW, "min-w-0 flex-1")}>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--blue-bg)] text-[var(--blue-text)]">
                  <ArrowLeftRightIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-bold text-foreground">{row.title}</span>
                  <span className="truncate text-[13px] text-muted-foreground">{row.detail}</span>
                </span>
              </Link>
              <QuickButton quick={row.quick} onQuick={onQuick} busy={busyTradeId === row.quick?.tradeId} />
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

function CrewSection({ slot }: { slot: Slot<CrewRow[]> }) {
  return (
    <HomeCard aria-labelledby="home-crew">
      <SectionHeader id="home-crew" title="Working today" href="/staff/today" linkLabel="Today" />
      {slot.state === "loading" ? (
        <RowsSkeleton rows={2} />
      ) : slot.state === "error" ? (
        <SectionError what="today’s crew" onRetry={slot.onRetry} />
      ) : slot.rows.length === 0 ? (
        <StateBlock compact icon={CalendarDaysIcon} title="No one is on today" description="Published shifts for today show here with who’s working." />
      ) : (
        <ul className="flex flex-col pb-1.5">
          {slot.rows.map((row) => (
            <li key={row.id}>
              <Link href="/staff/today" className={ROW}>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-bold text-foreground">{row.title}</span>
                  <span className="flex items-center gap-1.5 truncate text-[13px] text-muted-foreground">
                    {row.live && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[var(--green)]" />}
                    {row.when}
                  </span>
                </span>
                <AvatarStack people={row.people} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

function ActivitySection({ slot, onSelectBooking }: { slot: Slot<ActivityRow[]>; onSelectBooking: (id: string) => void }) {
  return (
    <HomeCard aria-labelledby="home-activity">
      <SectionHeader id="home-activity" title="Recent activity" href="/bookings?tab=checkouts" linkLabel="Bookings" />
      {slot.state === "loading" ? (
        <RowsSkeleton rows={3} />
      ) : slot.state === "error" ? (
        <SectionError what="recent activity" onRetry={slot.onRetry} />
      ) : slot.rows.length === 0 ? (
        <StateBlock compact icon={ClockIcon} title="Quiet so far" description="Kiosk pickups and returns from the last day show here." />
      ) : (
        <ul className="flex flex-col pb-1.5">
          {slot.rows.map((row) => (
            <li key={row.id}>
              <button type="button" className={cn(ROW, "cursor-pointer")} onClick={() => onSelectBooking(row.bookingId)}>
                <UserAvatar name={row.who} avatarUrl={row.person?.avatarUrl ?? null} size="default" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm text-foreground">
                    <span className="font-bold">{row.who}</span>{" "}
                    <span className={row.kind === "returned" ? "text-[var(--green-text)]" : "text-muted-foreground"}>{row.verb}</span>
                  </span>
                  <span className="truncate text-[13px] text-muted-foreground">{row.title}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{row.ago}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </HomeCard>
  );
}

function AvatarStack({ people }: { people: CrewRow["people"] }) {
  const shown = people.slice(0, 4);
  const extra = people.length - shown.length;
  return (
    <span className="flex shrink-0 items-center" title={people.map((p) => p.name).join(", ")} aria-label={`${people.length} working`}>
      {shown.map((p) => (
        <UserAvatar key={p.id} name={p.name} avatarUrl={p.avatarUrl} size="default" className="-ml-1 ring-2 ring-card first:ml-0" />
      ))}
      {extra > 0 && <span className="ml-1.5 text-xs font-bold tabular-nums text-muted-foreground">+{extra}</span>}
    </span>
  );
}

function CoverageSection({ slot }: { slot: Slot<CoverageRow[]> }) {
  return (
    <HomeCard aria-labelledby="home-coverage">
      <SectionHeader id="home-coverage" title="Coming up" href="/schedule" linkLabel="Schedule" />
      {slot.state === "loading" ? (
        <RowsSkeleton rows={3} />
      ) : slot.state === "error" ? (
        <SectionError what="events" onRetry={slot.onRetry} />
      ) : slot.rows.length === 0 ? (
        <StateBlock compact icon={CalendarDaysIcon} title="No events this week" description="Synced games and events land here with crew coverage." />
      ) : (
        <ul className="flex flex-col pb-1.5">
          {slot.rows.map((row) => {
            const pct = row.total > 0 ? Math.round((row.filled / row.total) * 100) : 0;
            const full = row.total > 0 && row.filled >= row.total;
            return (
              <li key={row.id}>
                <Link href={`/events/${row.id}`} className={ROW}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-bold text-foreground">{row.title}</span>
                    <span className="truncate text-[13px] text-muted-foreground">{row.when}</span>
                  </span>
                  {row.total > 0 ? (
                    <span className="flex w-[72px] shrink-0 flex-col items-end gap-1" aria-label={`${row.filled} of ${row.total} shifts filled`}>
                      <span className={cn("text-[13px] font-bold tabular-nums", full ? "text-[var(--green-text)]" : "text-foreground")}>
                        {row.filled}/{row.total}
                      </span>
                      <span className="h-1 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <span
                          className={cn("block h-full rounded-full", full ? "bg-[var(--green)]" : "bg-[var(--orange)]")}
                          style={{ width: `${pct}%` }}
                        />
                      </span>
                    </span>
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">No crew</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </HomeCard>
  );
}

function TeamGearSection({ slot, onSelectBooking }: {
  slot: Slot<{ rows: GearRow[]; total: number }>;
  onSelectBooking: (id: string) => void;
}) {
  return (
    <HomeCard aria-labelledby="home-team-gear">
      <SectionHeader
        id="home-team-gear"
        title="Team gear out"
        count={slot.state === "ready" ? slot.rows.total : null}
        href="/bookings?tab=checkouts"
      />
      {slot.state === "loading" ? (
        <RowsSkeleton rows={3} />
      ) : slot.state === "error" ? (
        <SectionError what="team gear" onRetry={slot.onRetry} />
      ) : slot.rows.rows.length === 0 ? (
        <StateBlock compact icon={PackageCheckIcon} title="Everything is on the shelf" description="No one has gear checked out." />
      ) : (
        <GearList rows={slot.rows.rows} onSelectBooking={onSelectBooking} />
      )}
    </HomeCard>
  );
}

/* ── Loading shell (route-level) ────────────────────────── */

export function HomeSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 pb-8" aria-busy="true" aria-label="Loading home">
      <div className="flex flex-col gap-2 pt-1">
        <Skeleton className="h-3.5 w-40 bg-muted" />
        <Skeleton className="h-7 w-64 bg-muted" />
      </div>
      <SummaryStrip slot={{ state: "loading" }} />
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <HomeCard><RowsSkeleton rows={4} /></HomeCard>
        <HomeCard><RowsSkeleton rows={3} /></HomeCard>
      </div>
    </div>
  );
}
