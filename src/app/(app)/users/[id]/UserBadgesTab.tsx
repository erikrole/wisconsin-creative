"use client";

import { useMemo, useState, type ComponentType } from "react";
import {
  AlarmClockCheck,
  AlertCircle,
  Award,
  BadgeCheck,
  CalendarCheck2,
  ChevronDown,
  ChevronUp,
  Handshake,
  LockKeyhole,
  PackageCheck,
  ScanLine,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  UserCheck,
} from "lucide-react";
import { BadgeMedallion } from "@/components/badges/BadgeMedallion";
import { badgeIcon, isManualBadge } from "@/components/badges/badge-artwork";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { StaggerItem, StaggerList } from "@/components/ui/motion";
import { useFetch } from "@/hooks/use-fetch";
import { badgeRarityVariant, getBadgeRarity, isHiddenUntilEarnedBadge, type BadgeRarity } from "@/lib/badges/display";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";
import { formatDateFull } from "@/lib/format";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type UserBadge = {
  /** The `BadgeDefinition` id. Not the award row -- see `awardId`. */
  id: string;
  /** The `StudentBadge` row id, present only when earned. What revoke needs. */
  awardId?: string | null;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  kind: string;
  trigger: string;
  threshold: number | null;
  ruleKey: string | null;
  active: boolean;
  sortOrder: number;
  earned: boolean;
  awardedAt: string | null;
  source: "AUTO" | "MANUAL" | null;
  note: string | null;
  awardedByName: string | null;
  progressCurrent: number | null;
  progressTarget: number | null;
  /** Served by the API from real holder counts. Optional so an older payload
   *  still renders, falling back to the difficulty-based rating. */
  rarity?: BadgeRarity;
  holders?: number;
  /** True when `rarity` came from the difficulty fallback, not from scarcity. */
  rarityProvisional?: boolean;
};

/**
 * "12 people have this" -- what makes the rarity word above it believable.
 *
 * When the server says the rating is provisional, that sentence cannot be
 * written honestly: the word came from the difficulty fallback because nobody
 * holds the badge yet or the definition is still inside its 30-day proving
 * period. The v8 expansion adds 50 definitions at once, so a large share of the
 * catalog sits in that window at launch, and showing "Legendary" with no hedge
 * would present a guess in exactly the same voice as a measurement.
 */
function holdersLine(badge: UserBadge): string | null {
  if (badge.rarityProvisional) return "Too new to rate by scarcity yet";
  const holders = badge.holders;
  if (typeof holders !== "number" || holders <= 0) return null;
  return holders === 1 ? "1 person has this" : `${holders} people have this`;
}

type UserBadgesResponse = {
  userId: string;
  peerVisible: boolean;
  earnedCount: number;
  totalCount: number;
  badges: UserBadge[];
  disabled?: boolean;
};

type BadgeFilter = "all" | "earned" | "locked" | "manual" | "rare";
type AwardCollectionKey = "gear_flow" | "reliability" | "scans" | "teamwork" | "staff_picks";

type AwardCollectionDefinition = {
  key: AwardCollectionKey;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  countsTowardCompletion: boolean;
};

type BadgeShelf = AwardCollectionDefinition & {
  badges: UserBadge[];
  earnedCount: number;
};

const categoryLabel: Record<string, string> = {
  CHECKOUT: "Checkout",
  ON_TIME: "On-time returns",
  SCAN: "Scans",
  TRADE: "Trades",
  SHIFT: "Shifts",
  STREAK: "Streaks",
  MILESTONE: "Milestones",
};

const filterLabels: Record<BadgeFilter, string> = {
  all: "All",
  earned: "Earned",
  locked: "Locked",
  manual: "Manual",
  rare: "Rare",
};

const awardCollectionDefinitions: AwardCollectionDefinition[] = [
  {
    key: "gear_flow",
    title: "Gear Flow",
    description: "Checkout, pickup, full-kit, and clean handoff awards.",
    icon: PackageCheck,
    countsTowardCompletion: true,
  },
  {
    key: "reliability",
    title: "Reliability",
    description: "On-time returns, clean streaks, and no-drama follow-through.",
    icon: AlarmClockCheck,
    countsTowardCompletion: true,
  },
  {
    key: "scans",
    title: "Legacy Scan Awards",
    description: "Previously earned scan awards, preserved as history.",
    icon: ScanLine,
    countsTowardCompletion: false,
  },
  {
    key: "teamwork",
    title: "Teamwork",
    description: "Trades, coverage, and event help.",
    icon: Handshake,
    countsTowardCompletion: true,
  },
  {
    key: "staff_picks",
    title: "Staff Picks",
    description: "Manual awards, inside jokes, and custom recognition.",
    icon: Sparkles,
    countsTowardCompletion: false,
  },
];

function BadgeGridSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Card elevation="flat">
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
          <div className="min-w-[180px] flex-1">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="mt-3 h-1.5 w-full" />
          </div>
          <div className="flex gap-6">
            {[0, 1].map((index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton className="h-6 w-10" />
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      {[0, 1].map((shelf) => (
        <div key={shelf}>
          <Skeleton className="h-5 w-32" />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} className="flex flex-col items-center gap-3 rounded-xl bg-card p-4 shadow-[0_0_0_1px_var(--border)]">
                <Skeleton className="size-14 rounded-2xl" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function isRecentlyEarned(awardedAt: string | null) {
  if (!awardedAt) return false;
  const awardedAtMs = new Date(awardedAt).getTime();
  if (Number.isNaN(awardedAtMs)) return false;
  const age = Date.now() - awardedAtMs;
  return age >= 0 && age <= 7 * 86_400_000;
}

function readableCategory(category: string) {
  return categoryLabel[category] ?? category.toLowerCase().replaceAll("_", " ");
}

function hasProgress(badge: UserBadge) {
  return !badge.earned && badge.progressCurrent !== null && badge.progressTarget !== null && badge.progressTarget > 0;
}

function progressPercent(badge: UserBadge) {
  if (!hasProgress(badge)) return 0;
  return Math.min(100, Math.round((badge.progressCurrent! / badge.progressTarget!) * 100));
}

/**
 * The one line under a badge's name.
 *
 * A locked badge with no derivable progress used to read `25 required` or
 * `Unlocks automatically` -- twenty-five *what*, and unlocks from *what*. The
 * answer was already in the payload as `description` ("Checked out the same
 * item 25 times"), one click away in the detail dialog. With most of a
 * hundred-badge catalog locked for any given person, that is the difference
 * between a shelf worth reading and a wall of grey.
 */
function badgeMetaLine(badge: UserBadge) {
  if (badge.earned && badge.awardedAt) return `Earned ${formatDateFull(badge.awardedAt)}`;
  if (badge.earned) return "Earned";
  // Real progress beats prose: a number this person is moving is more useful
  // than the sentence describing the goal, and the bar below repeats it.
  if (hasProgress(badge)) return `${badge.progressCurrent}/${badge.progressTarget}`;
  if (badge.description) return badge.description;
  return badge.trigger === "manual" ? "Staff recognition" : "Unlocks automatically";
}

function rarityGlowClass(rarity: BadgeRarity) {
  if (rarity === "Legendary") return "shadow-[0_0_0_1px_var(--purple-text),0_0_34px_var(--purple-bg)]";
  if (rarity === "Rare") return "shadow-[0_0_0_1px_var(--orange-text),0_0_30px_var(--orange-bg)]";
  if (rarity === "Uncommon") return "shadow-[0_0_0_1px_var(--blue-text),0_0_26px_var(--blue-bg)]";
  return "shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_25%,transparent),0_0_22px_color-mix(in_oklch,var(--primary)_12%,transparent)]";
}

function rarityStageClass(rarity: BadgeRarity) {
  if (rarity === "Legendary") {
    return "bg-[radial-gradient(circle_at_22%_14%,var(--purple-bg),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.30),transparent_28%),linear-gradient(135deg,var(--background),var(--purple-bg))]";
  }
  if (rarity === "Rare") {
    return "bg-[radial-gradient(circle_at_22%_14%,var(--orange-bg),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.28),transparent_28%),linear-gradient(135deg,var(--background),var(--orange-bg))]";
  }
  if (rarity === "Uncommon") {
    return "bg-[radial-gradient(circle_at_22%_14%,var(--blue-bg),transparent_32%),radial-gradient(circle_at_82%_18%,rgba(255,255,255,0.26),transparent_28%),linear-gradient(135deg,var(--background),var(--blue-bg))]";
  }
  return "bg-[radial-gradient(circle_at_22%_14%,rgba(255,255,255,0.24),transparent_32%),linear-gradient(135deg,var(--background),var(--muted))]";
}

function rarityAccentClass(rarity: BadgeRarity) {
  if (rarity === "Legendary") return "bg-[var(--purple-text)] text-[var(--purple-bg)]";
  if (rarity === "Rare") return "bg-[var(--orange-text)] text-[var(--orange-bg)]";
  if (rarity === "Uncommon") return "bg-[var(--blue-text)] text-[var(--blue-bg)]";
  return "bg-primary text-primary-foreground";
}

/// Every badge lives on exactly one shelf so the flat layout never repeats a
/// medallion. Staff recognition wins over thematic hints; automatic milestone
/// badges follow the checkout or shift workflow that actually earned them.
function primaryCollectionKey(badge: UserBadge): AwardCollectionKey {
  if (isManualBadge(badge)) return "staff_picks";
  if (badge.category === "SCAN") return "scans";

  // Route by the workflow that earns it, before falling back to category. The
  // v8 expansion filed every return and trade rule under `MILESTONE`, and the
  // old `MILESTONE` catch-all swept them onto Staff Picks -- a shelf whose own
  // description reads "manual awards, inside jokes, and custom recognition",
  // and which is excluded from the earned/total count. Eleven automatic return
  // rules and two trade rules were sitting on the staff shelf.
  if (badge.trigger === "checkout:returned") return "reliability";
  if (badge.trigger === "checkout:opened") return "gear_flow";
  if (badge.trigger === "trade:completed" || badge.trigger === "shift:completed") return "teamwork";

  if (badge.category === "CHECKOUT") return "gear_flow";
  if (badge.category === "ON_TIME" || badge.category === "STREAK") return "reliability";
  if (badge.category === "TRADE" || badge.category === "SHIFT") return "teamwork";
  if (badge.key.includes("streak") || badge.key.includes("reliable") || badge.key.includes("zero_errors")) return "reliability";
  // Whatever is left is a rule with no workflow behind it -- an app-open
  // surprise or a one-off. Those belong with the inside jokes.
  return badge.category === "MILESTONE" ? "staff_picks" : "gear_flow";
}

/**
 * Earned first, newest first; then locked goals this person is actually moving,
 * nearest completion first; then the rest by catalog order.
 *
 * The middle rule is what makes a collapsed shelf worth collapsing: the first
 * rows show what you have and what you are closest to, rather than whichever
 * unstarted goal the catalog happened to sort first.
 */
function sortedForDisplay(badges: UserBadge[]) {
  return [...badges].sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;
    if (a.earned && b.earned) {
      const aDate = a.awardedAt ? new Date(a.awardedAt).getTime() : 0;
      const bDate = b.awardedAt ? new Date(b.awardedAt).getTime() : 0;
      if (aDate !== bDate) return bDate - aDate;
      return a.sortOrder - b.sortOrder;
    }
    const aStarted = hasProgress(a) && a.progressCurrent! > 0;
    const bStarted = hasProgress(b) && b.progressCurrent! > 0;
    if (aStarted !== bStarted) return aStarted ? -1 : 1;
    if (aStarted && bStarted) {
      const aShare = a.progressCurrent! / a.progressTarget!;
      const bShare = b.progressCurrent! / b.progressTarget!;
      if (aShare !== bShare) return bShare - aShare;
    }
    return a.sortOrder - b.sortOrder;
  });
}

function buildShelves(galleryBadges: UserBadge[]): BadgeShelf[] {
  const grouped = new Map<AwardCollectionKey, UserBadge[]>(
    awardCollectionDefinitions.map((definition) => [definition.key, []]),
  );

  for (const badge of galleryBadges) {
    grouped.get(primaryCollectionKey(badge))?.push(badge);
  }

  return awardCollectionDefinitions
    .map((definition): BadgeShelf => {
      const shelfBadges = sortedForDisplay(grouped.get(definition.key) ?? []);
      return {
        ...definition,
        badges: shelfBadges,
        earnedCount: shelfBadges.filter((badge) => badge.earned).length,
      };
    })
    .filter((shelf) => shelf.badges.length > 0);
}

/**
 * Leads with the count, not the percentage.
 *
 * The catalog is built to be mostly unearned -- 98 visible automatic goals once
 * the v8 expansion deploys -- so a percentage headline tells a genuinely strong
 * student "20%" and calls that their score. The count is the thing they earned;
 * the bar still carries the proportion for anyone who wants it.
 */
function BadgeSummaryBand({
  earned,
  goalsEarned,
  goals,
  hidden,
}: {
  earned: number;
  goalsEarned: number;
  goals: number;
  hidden: number;
}) {
  const completion = goals > 0 ? Math.round((goalsEarned / goals) * 100) : 0;

  return (
    <Card elevation="flat">
      <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-4 p-5">
        <div className="min-w-[180px] flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-3xl font-semibold tabular-nums">
              {earned}
              <span className="ml-1.5 text-base font-medium text-muted-foreground">
                {earned === 1 ? "badge" : "badges"}
              </span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {goalsEarned} of {goals} goals
            </span>
          </div>
          <Progress value={completion} className="mt-2 h-1.5" aria-label={`${goalsEarned} of ${goals} automatic goals earned`} />
        </div>
        <dl className="flex items-center gap-6 text-right">
          <div>
            <dt className="sr-only">Remaining</dt>
            <dd className="text-xl font-semibold tabular-nums">{Math.max(0, goals - goalsEarned)}</dd>
            <dd className="text-xs text-muted-foreground">Goals left</dd>
          </div>
          {hidden > 0 ? (
            <div>
              <dt className="sr-only">Hidden surprise awards</dt>
              <dd className="text-xl font-semibold tabular-nums">{hidden}</dd>
              <dd className="text-xs text-muted-foreground">Hidden</dd>
            </div>
          ) : null}
        </dl>
      </CardContent>
    </Card>
  );
}

/**
 * The visible goal this person is nearest to finishing.
 *
 * Ties break on how few steps are left, so "9 of 10" leads "90 of 100" rather
 * than whichever the catalog happened to sort first. Mirrors the native
 * `closestToEarned` row so both clients point at the same badge.
 */
function closestToEarned(badges: UserBadge[]): UserBadge | null {
  let best: UserBadge | null = null;
  let bestFraction = -1;
  let bestRemaining = Number.POSITIVE_INFINITY;

  for (const badge of badges) {
    if (!hasProgress(badge)) continue;
    const fraction = badge.progressCurrent! / badge.progressTarget!;
    const remaining = badge.progressTarget! - badge.progressCurrent!;
    if (fraction > bestFraction || (fraction === bestFraction && remaining < bestRemaining)) {
      best = badge;
      bestFraction = fraction;
      bestRemaining = remaining;
    }
  }

  return best;
}

function NextUpRow({
  badge,
  onSelect,
}: {
  badge: UserBadge;
  onSelect: (badge: UserBadge) => void;
}) {
  const Icon = badgeIcon(badge.icon);
  const rarity = badge.rarity ?? getBadgeRarity(badge);
  const remaining = badge.progressTarget! - badge.progressCurrent!;

  return (
    <button
      type="button"
      onClick={() => onSelect(badge)}
      className="group flex w-full items-center gap-4 rounded-xl bg-card px-4 py-3.5 text-left shadow-[0_0_0_1px_var(--border)] outline-none transition-[box-shadow,transform] duration-200 hover:shadow-[0_10px_28px_color-mix(in_oklch,var(--foreground)_7%,transparent),0_0_0_1px_var(--border)] focus-visible:ring-[3px] focus-visible:ring-ring/50"
      aria-label={`Closest goal: ${badge.name}, ${badge.progressCurrent} of ${badge.progressTarget}. Open badge details.`}
    >
      <BadgeMedallion
        icon={Icon}
        earned={false}
        rarity={rarity}
        className="size-11"
        iconClassName="size-5"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Closest goal
        </p>
        <h3 className="mt-0.5 truncate text-sm font-semibold leading-5">{badge.name}</h3>
        <Progress
          value={progressPercent(badge)}
          className="mt-2 h-1.5"
          aria-label={`${badge.name} progress`}
        />
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums">{badge.progressCurrent}/{badge.progressTarget}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {remaining === 1 ? "1 to go" : `${remaining} to go`}
        </p>
      </div>
    </button>
  );
}

function BadgeTile({
  badge,
  selected,
  onSelect,
}: {
  badge: UserBadge;
  selected: boolean;
  onSelect: (badge: UserBadge) => void;
}) {
  const Icon = badgeIcon(badge.icon);
  const rarity = badge.rarity ?? getBadgeRarity(badge);
  const recentlyEarned = badge.earned && isRecentlyEarned(badge.awardedAt);

  return (
    <button
      type="button"
      onClick={() => onSelect(badge)}
      className={cn(
        "group relative flex h-full w-full flex-col items-center gap-2 rounded-xl bg-card px-3 pb-4 pt-5 text-center shadow-[0_0_0_1px_var(--border)] outline-none transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_34px_color-mix(in_oklch,var(--foreground)_8%,transparent),0_0_0_1px_var(--border)] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]",
        !badge.earned && "bg-muted/30",
        recentlyEarned && rarityGlowClass(rarity),
        selected && "ring-[3px] ring-ring/30",
      )}
      aria-label={`${badge.name}, ${badge.earned ? "earned" : "locked"}. Open badge details.`}
    >
      {recentlyEarned ? (
        <Badge variant="green" size="sm" className="absolute right-2 top-2">New</Badge>
      ) : null}
      <BadgeMedallion
        icon={Icon}
        earned={badge.earned}
        rarity={rarity}
        className="size-14"
        iconClassName="size-6"
      />
      <div className="min-w-0">
        <h3 className={cn("line-clamp-2 min-h-10 text-balance text-sm font-semibold leading-5", badge.earned ? "text-foreground" : "text-muted-foreground")}>
          {badge.name}
        </h3>
        {/* Two lines, reserved whether the meta is a date, a count, or a
            requirement sentence, so a row of tiles keeps one baseline. */}
        <p className="mt-1 line-clamp-2 min-h-8 text-xs leading-4 text-muted-foreground tabular-nums">
          {badgeMetaLine(badge)}
        </p>
      </div>
      {hasProgress(badge) ? (
        <Progress
          value={progressPercent(badge)}
          className="mt-auto h-1 w-full max-w-[120px] bg-muted [&_[data-slot=progress-indicator]]:bg-primary/70"
          aria-label={`${badge.name} progress`}
        />
      ) : null}
    </button>
  );
}

/**
 * How many tiles a shelf shows before it asks. Two full rows at the widest
 * breakpoint, and the sort above guarantees those rows are the earned awards
 * and the goals nearest completion.
 *
 * The flat "every badge always visible" shelf was designed against a 30-badge
 * catalog. The catalog is 115 definitions now -- 98 of them visible once the
 * v8 expansion deploys -- which is 23 rows and roughly 4,600px of scrolling,
 * and for someone new almost every one of those tiles is an identical locked
 * disc. Collapsing is per shelf and per session; nothing is hidden from a
 * filter, because a filter is already the reader narrowing on purpose.
 */
const SHELF_PREVIEW_COUNT = 10;

function ShelfSection({
  shelf,
  filter,
  expanded,
  onToggleExpanded,
  selectedBadge,
  onSelect,
}: {
  shelf: BadgeShelf;
  filter: BadgeFilter;
  expanded: boolean;
  onToggleExpanded: (key: AwardCollectionKey) => void;
  selectedBadge: UserBadge | null;
  onSelect: (badge: UserBadge) => void;
}) {
  const filteredBadges = filterBadges(shelf.badges, filter);
  if (filteredBadges.length === 0) return null;
  const ShelfIcon = shelf.icon;

  const collapsible = filter === "all" && filteredBadges.length > SHELF_PREVIEW_COUNT;
  const visibleBadges = collapsible && !expanded
    ? filteredBadges.slice(0, SHELF_PREVIEW_COUNT)
    : filteredBadges;
  const hiddenByCollapse = filteredBadges.length - visibleBadges.length;

  return (
    <section aria-label={`${shelf.title} awards`}>
      <div className="flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]" aria-hidden="true">
            <ShelfIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold leading-5">{shelf.title}</h3>
            <p className="truncate text-xs text-muted-foreground">{shelf.description}</p>
          </div>
        </div>
        <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {shelf.countsTowardCompletion
            ? `${shelf.earnedCount}/${shelf.badges.length} earned`
            : `${shelf.earnedCount} earned`}
        </p>
      </div>
      <StaggerList className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {visibleBadges.map((badge) => (
          <StaggerItem key={badge.id} className="h-full">
            <BadgeTile badge={badge} selected={selectedBadge?.id === badge.id} onSelect={onSelect} />
          </StaggerItem>
        ))}
      </StaggerList>
      {collapsible ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-2.5 h-10 w-full text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onToggleExpanded(shelf.key)}
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3.5" aria-hidden="true" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="size-3.5" aria-hidden="true" />
              {`Show ${hiddenByCollapse} more in ${shelf.title}`}
            </>
          )}
        </Button>
      ) : null}
    </section>
  );
}

function BadgeDetailDialog({
  userId,
  badge,
  canRevoke = false,
  canAward = false,
  onOpenChange,
  onRevoke,
  onAwardRequest,
}: {
  userId: string;
  badge: UserBadge | null;
  canRevoke?: boolean;
  canAward?: boolean;
  onOpenChange: (open: boolean) => void;
  onRevoke?: (badgeId: string) => void;
  onAwardRequest?: (badge: UserBadge) => void;
}) {
  const [revokeBusy, setRevokeBusy] = useState(false);
  const Icon = badgeIcon(badge?.icon);
  const rarity = badge ? (badge.rarity ?? getBadgeRarity(badge)) : "Common";
  const progressValue = badge ? progressPercent(badge) : 0;
  const recentlyEarned = badge ? badge.earned && isRecentlyEarned(badge.awardedAt) : false;

  async function handleRevoke() {
    if (!badge || revokeBusy) return;
    // `badge.id` is the definition; the route resolves a `StudentBadge`. Sending
    // the wrong one made every revoke 404 with "Badge award not found".
    const awardId = badge.awardId;
    if (!awardId) {
      toast.error("This award cannot be revoked.");
      return;
    }
    setRevokeBusy(true);
    try {
      const res = await fetch(`/api/badges/award/${awardId}`, { method: "DELETE" });
      if (handleAuthRedirect(res, `/users/${userId}?tab=badges`)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Failed to revoke badge"));
        return;
      }
      onRevoke?.(badge.id);
      onOpenChange(false);
    } catch {
      toast.error("Network error. Badge was not revoked.");
    } finally {
      setRevokeBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(badge)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[720px] overflow-hidden border-0 p-0 shadow-[0_24px_80px_rgba(0,0,0,0.22),0_0_0_1px_var(--border)] sm:rounded-2xl">
        {badge ? (
          <>
            <DialogHeader className={cn("relative isolate block overflow-hidden border-b-0 px-6 pb-8 pt-10 shadow-[0_1px_0_0_color-mix(in_oklch,var(--border)_50%,transparent)] sm:px-10", rarityStageClass(rarity))}>
              <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(115deg,transparent_0%,rgba(255,255,255,0.40)_46%,transparent_58%)] motion-safe:animate-[badge-shine_4.8s_ease-in-out_infinite] motion-reduce:animate-none" />
              <div className="pointer-events-none absolute left-1/2 top-0 size-56 -translate-x-1/2 -translate-y-1/3 rounded-full bg-background/15 blur-3xl" />
              <div className="pointer-events-none absolute bottom-0 left-1/4 size-32 rounded-full bg-background/10 blur-2xl" />

              {/* Centered medallion stage */}
              <div className="relative mx-auto mb-6 flex size-44 items-center justify-center">
                {/* The stage is round because the medallion is. A squircle
                    plate behind a disc read as two competing shapes. */}
                <span className={cn("absolute inset-0 rounded-full opacity-35 blur-2xl", rarityAccentClass(rarity))} aria-hidden="true" />
                <span className="absolute inset-3 rounded-full bg-background/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.60),0_28px_56px_rgba(0,0,0,0.18)]" aria-hidden="true" />
                <BadgeMedallion
                  icon={Icon}
                  earned={badge.earned}
                  rarity={rarity}
                  className="size-32"
                  iconClassName="size-14"
                />
                {badge.earned ? (
                  <>
                    <Sparkles className="absolute -right-2 top-6 size-5 text-foreground/50 motion-safe:animate-[badge-float_2.8s_ease-in-out_infinite] motion-reduce:animate-none" aria-hidden="true" />
                    <Star className="absolute bottom-6 -left-2 size-4 text-foreground/40 motion-safe:animate-[badge-float_3.4s_ease-in-out_infinite] motion-reduce:animate-none" aria-hidden="true" />
                  </>
                ) : null}
              </div>

              {/* Centered text */}
              <div className="relative text-center">
                <div className="mb-4 flex flex-wrap justify-center gap-2">
                  <Badge variant={badge.earned ? "secondary" : "outline"}>{badge.earned ? "Earned" : "Locked"}</Badge>
                  <Badge variant={badgeRarityVariant(rarity)}>
                    {badge.rarityProvisional ? `${rarity} (provisional)` : rarity}
                  </Badge>
                  {badge.source === "MANUAL" ? <Badge variant="purple">Manual</Badge> : null}
                  {recentlyEarned ? <Badge variant="green">Fresh</Badge> : null}
                  {!badge.active && badge.earned ? <Badge variant="gray">Retired</Badge> : null}
                </div>
                <DialogTitle className="text-balance !text-3xl font-semibold leading-tight tracking-tight sm:!text-4xl">
                  {badge.name}
                </DialogTitle>
                <DialogDescription className="mx-auto mt-3 max-w-[48ch] text-pretty text-base leading-7 text-foreground/75">
                  {badge.description}
                </DialogDescription>
                {holdersLine(badge) ? (
                  <p className="mt-3 text-xs font-medium text-foreground/60 tabular-nums">
                    {holdersLine(badge)}
                  </p>
                ) : null}
              </div>
            </DialogHeader>
            <DialogBody className="bg-background px-6 pb-7 pt-5 sm:px-8">
              <div className="flex flex-wrap gap-4 rounded-2xl bg-muted/35 px-5 py-4 shadow-[inset_0_0_0_1px_var(--border)]">
                <DetailMetric icon={Trophy} label="Category" value={readableCategory(badge.category)} />
                <div className="w-px self-stretch bg-border/60" aria-hidden="true" />
                <DetailMetric icon={UserCheck} label="Source" value={badge.source === "MANUAL" ? "Manual award" : badge.earned ? "Automatic" : "Not earned"} />
                <div className="w-px self-stretch bg-border/60" aria-hidden="true" />
                <DetailMetric icon={CalendarCheck2} label="Earned date" value={badge.awardedAt ? formatDateFull(badge.awardedAt) : "Not earned yet"} />
              </div>

              {hasProgress(badge) ? (
                <div className="mt-5 rounded-2xl bg-muted/40 p-4 shadow-[inset_0_0_0_1px_var(--border)]">
                  <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                    <span className="font-medium text-foreground">Progress</span>
                    <span className="text-muted-foreground tabular-nums">{badge.progressCurrent}/{badge.progressTarget}</span>
                  </div>
                  <Progress value={progressValue} className="h-2" />
                </div>
              ) : null}

              {(badge.note || badge.awardedByName) ? (
                <div className="mt-5 flex gap-4 overflow-hidden rounded-2xl bg-muted/30 shadow-[inset_0_0_0_1px_var(--border)]">
                  <div
                    className={cn(
                      "w-1 shrink-0 rounded-l-2xl",
                      rarity === "Legendary" && "bg-[var(--purple-text)]/70",
                      rarity === "Rare" && "bg-[var(--orange-text)]/70",
                      rarity === "Uncommon" && "bg-[var(--blue-text)]/70",
                      rarity === "Common" && "bg-primary/40",
                    )}
                    aria-hidden="true"
                  />
                  <div className="py-5 pr-5">
                    <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      <BadgeCheck className="size-3.5" aria-hidden="true" />
                      Award note
                    </p>
                    {badge.note ? <p className="mt-3 text-pretty text-sm leading-6 text-foreground">{badge.note}</p> : null}
                    {badge.awardedByName ? (
                      <p className="mt-2 text-xs text-muted-foreground">-- {badge.awardedByName}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {(!badge.earned && !hasProgress(badge)) || (canRevoke && badge.source === "MANUAL" && Boolean(badge.awardId)) || (canAward && !badge.earned && badge.trigger === "manual") ? (
                <>
                  <Separator className="my-5" />
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {!badge.earned && !hasProgress(badge) ? (
                        <span className="inline-flex items-center gap-1">
                          <LockKeyhole className="size-3.5" aria-hidden="true" />
                          Unlocks from a qualifying workflow or staff recognition.
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {canAward && !badge.earned && badge.trigger === "manual" ? (
                        <Button className="h-10" variant="outline" onClick={() => onAwardRequest?.(badge)}>
                          <Award className="size-3.5" />
                          Award this badge
                        </Button>
                      ) : null}
                      {canRevoke && badge.earned && badge.source === "MANUAL" && badge.awardId ? (
                        <Button
                          variant="outline"
                          onClick={handleRevoke}
                          disabled={revokeBusy}
                          className="h-10 text-destructive hover:border-destructive hover:bg-destructive hover:text-destructive-foreground"
                        >
                          <Trash2 className="size-3.5" />
                          {revokeBusy ? "Revoking..." : "Revoke award"}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </>
              ) : null}
            </DialogBody>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DetailMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground shadow-[inset_0_0_0_1px_var(--border)]" aria-hidden="true">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-sm font-semibold text-foreground text-balance">{value}</p>
      </div>
    </div>
  );
}

function filterBadges(badges: UserBadge[], filter: BadgeFilter) {
  if (filter === "earned") return badges.filter((badge) => badge.earned);
  if (filter === "locked") return badges.filter((badge) => !badge.earned);
  if (filter === "manual") return badges.filter((badge) => badge.source === "MANUAL" || (badge.kind === "RULE" && badge.trigger === "manual"));
  if (filter === "rare") {
    return badges.filter((badge) => {
      const rarity = badge.rarity ?? getBadgeRarity(badge);
      return rarity === "Rare" || rarity === "Legendary";
    });
  }
  return badges;
}

export default function UserBadgesTab({
  userId,
  canRevoke = false,
  canAward = false,
  onAwardRequest,
}: {
  userId: string;
  canRevoke?: boolean;
  canAward?: boolean;
  onAwardRequest?: (badge: UserBadge) => void;
}) {
  const [filter, setFilter] = useState<BadgeFilter>("all");
  const [expandedShelves, setExpandedShelves] = useState<Set<AwardCollectionKey>>(new Set());
  const [selectedBadge, setSelectedBadge] = useState<UserBadge | null>(null);
  const [revision, setRevision] = useState(0);
  const { data, loading, error } = useFetch<UserBadgesResponse>({
    url: `/api/badges/user/${userId}?_r=${revision}`,
    returnTo: `/users/${userId}?tab=badges`,
    refetchOnFocus: false,
  });

  const galleryBadges = useMemo(() => {
    if (!data) return [];
    return data.badges.filter(
      (badge) => badge.earned || (badge.active && !isHiddenUntilEarnedBadge(badge.key)),
    );
  }, [data]);

  const shelves = useMemo(
    () => buildShelves(galleryBadges),
    [galleryBadges],
  );

  if (loading) {
    return <BadgeGridSkeleton />;
  }

  if (error || !data) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="size-4" />
        <AlertTitle>Badges unavailable</AlertTitle>
        <AlertDescription>
          This badge profile could not be loaded.
        </AlertDescription>
      </Alert>
    );
  }

  const earnedBadges = data.badges.filter((badge) => badge.earned);
  const automaticGoals = data.badges.filter(
    (badge) => badge.active && !isManualBadge(badge) && !isHiddenUntilEarnedBadge(badge.key),
  );
  const automaticGoalsEarned = automaticGoals.filter((badge) => badge.earned).length;
  const hiddenSurpriseCount = data.badges.filter(
    (badge) => !badge.earned && badge.active && isHiddenUntilEarnedBadge(badge.key),
  ).length;
  const filteredShelfCount = shelves.filter(
    (shelf) => filterBadges(shelf.badges, filter).length > 0,
  ).length;
  // Locked-only view already reads as a to-do list; the row would repeat a tile.
  const nextUp = filter === "all" ? closestToEarned(galleryBadges) : null;
  // A 0% band stacked on "Badges unavailable" is chrome measuring nothing.
  const hasCatalog = !data.disabled && data.badges.length > 0;

  return (
    <div className="flex flex-col gap-6">
      {hasCatalog ? (
        <BadgeSummaryBand
          earned={earnedBadges.length}
          goalsEarned={automaticGoalsEarned}
          goals={automaticGoals.length}
          hidden={hiddenSurpriseCount}
        />
      ) : null}

      {nextUp ? <NextUpRow badge={nextUp} onSelect={setSelectedBadge} /> : null}

      {data.disabled ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trophy />
            </EmptyMedia>
            <EmptyTitle>Badges unavailable</EmptyTitle>
            <EmptyDescription>
              Badge profiles will appear here after achievements are enabled.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : data.badges.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trophy />
            </EmptyMedia>
            <EmptyTitle>No badges yet</EmptyTitle>
            <EmptyDescription>
              Earned badges will appear here after badge definitions are seeded.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <ToggleGroup
            type="single"
            value={filter}
            onValueChange={(value) => {
              if (value) setFilter(value as BadgeFilter);
            }}
            className="flex-wrap"
            aria-label="Filter badges"
          >
            {(Object.keys(filterLabels) as BadgeFilter[]).map((key) => (
              <ToggleGroupItem key={key} value={key} aria-label={`Show ${filterLabels[key].toLowerCase()} badges`}>
                {filterLabels[key]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>

          {filteredShelfCount > 0 ? (
            <div className="flex flex-col gap-7">
              {shelves.map((shelf) => (
                <ShelfSection
                  key={shelf.key}
                  shelf={shelf}
                  filter={filter}
                  expanded={expandedShelves.has(shelf.key)}
                  onToggleExpanded={(key) =>
                    setExpandedShelves((current) => {
                      const next = new Set(current);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  selectedBadge={selectedBadge}
                  onSelect={setSelectedBadge}
                />
              ))}
            </div>
          ) : (
            <Empty className="min-h-[220px]">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {filter === "locked" ? <LockKeyhole /> : <Trophy />}
                </EmptyMedia>
                <EmptyTitle>No {filterLabels[filter].toLowerCase()} awards</EmptyTitle>
                <EmptyDescription>
                  Try another filter.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {/*
            One line for the whole page. This used to be a tile on every shelf
            that happened to hold a hidden definition -- four copies of the same
            sentence on one screen, for a count the summary band already reports.
          */}
          <p className="text-xs text-muted-foreground">
            {hiddenSurpriseCount > 0
              ? `${hiddenSurpriseCount} surprise ${hiddenSurpriseCount === 1 ? "award stays" : "awards stay"} hidden until earned. `
              : ""}
            Recently earned awards get a soft glow for one week.
          </p>
        </>
      )}

      <BadgeDetailDialog
        userId={userId}
        badge={selectedBadge}
        canRevoke={canRevoke}
        canAward={canAward}
        onOpenChange={(open) => {
          if (!open) setSelectedBadge(null);
        }}
        onRevoke={() => {
          setSelectedBadge(null);
          setRevision((r) => r + 1);
        }}
        onAwardRequest={onAwardRequest}
      />
    </div>
  );
}
