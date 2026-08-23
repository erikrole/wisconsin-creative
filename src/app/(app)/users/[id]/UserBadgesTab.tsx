"use client";

import { useMemo, useState, type ComponentType } from "react";
import {
  AlarmClock,
  AlarmClockCheck,
  Aperture,
  ArrowLeftRight,
  AlertCircle,
  AudioLines,
  Award,
  BadgeCheck,
  BatteryCharging,
  BatteryLow,
  Binoculars,
  Boxes,
  BusFront,
  Cable,
  Camera,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clapperboard,
  Clock3,
  CloudRain,
  Combine,
  Dumbbell,
  Flame,
  Gift,
  Focus,
  HardDrive,
  Handshake,
  Lightbulb,
  LockKeyhole,
  LifeBuoy,
  LayoutGrid,
  MoonStar,
  PackageCheck,
  PackageOpen,
  QrCode,
  Repeat2,
  ScanLine,
  ScanSearch,
  ShieldCheck,
  ShoppingCart,
  Shuffle,
  Sparkles,
  Timer,
  Star,
  Sunrise,
  Sunset,
  Ticket,
  Trash2,
  Trophy,
  Truck,
  UserCheck,
  Warehouse,
} from "lucide-react";
import { BadgeMedallion, type BadgeMedallionShape } from "@/components/badges/BadgeMedallion";
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
  id: string;
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
};

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
  shape: BadgeMedallionShape;
  countsTowardCompletion: boolean;
};

type BadgeShelf = AwardCollectionDefinition & {
  badges: UserBadge[];
  earnedCount: number;
  hiddenCount: number;
};

const iconMap: Record<string, ComponentType<{ className?: string }>> = {
  AlarmClock,
  AlarmClockCheck,
  Aperture,
  ArrowLeftRight,
  AudioLines,
  BadgeCheck,
  BatteryCharging,
  BatteryLow,
  Binoculars,
  Boxes,
  BusFront,
  Cable,
  Camera,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Clapperboard,
  Clock3,
  CloudRain,
  Combine,
  Dumbbell,
  Flame,
  Gift,
  Focus,
  HardDrive,
  Handshake,
  Lightbulb,
  LifeBuoy,
  LayoutGrid,
  MoonStar,
  PackageCheck,
  PackageOpen,
  QrCode,
  Repeat2,
  ScanLine,
  ScanSearch,
  ShieldCheck,
  ShoppingCart,
  Shuffle,
  Sparkles,
  Timer,
  Sunrise,
  Sunset,
  Ticket,
  Trophy,
  Truck,
  UserCheck,
  Warehouse,
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
    shape: "stack",
    countsTowardCompletion: true,
  },
  {
    key: "reliability",
    title: "Reliability",
    description: "On-time returns, clean streaks, and no-drama follow-through.",
    icon: AlarmClockCheck,
    shape: "coin",
    countsTowardCompletion: true,
  },
  {
    key: "scans",
    title: "Legacy Scan Awards",
    description: "Previously earned scan awards, preserved as history.",
    icon: ScanLine,
    shape: "hex",
    countsTowardCompletion: false,
  },
  {
    key: "teamwork",
    title: "Teamwork",
    description: "Trades, coverage, and event help.",
    icon: Handshake,
    shape: "shield",
    countsTowardCompletion: true,
  },
  {
    key: "staff_picks",
    title: "Staff Picks",
    description: "Manual awards, inside jokes, and custom recognition.",
    icon: Sparkles,
    shape: "hex",
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

function badgeMetaLine(badge: UserBadge) {
  if (badge.earned && badge.awardedAt) return `Earned ${formatDateFull(badge.awardedAt)}`;
  if (hasProgress(badge)) return `${badge.progressCurrent}/${badge.progressTarget}`;
  if (badge.threshold) return `${badge.threshold} required`;
  return badge.earned ? "Earned" : badge.trigger === "manual" ? "Staff recognition" : "Unlocks automatically";
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

function isManualBadge(badge: UserBadge) {
  return badge.source === "MANUAL" || (badge.kind === "RULE" && badge.trigger === "manual");
}

/// Every badge lives on exactly one shelf so the flat layout never repeats a
/// medallion. Staff recognition wins over thematic hints; automatic milestone
/// badges follow the checkout or shift workflow that actually earned them.
function primaryCollectionKey(badge: UserBadge): AwardCollectionKey {
  if (isManualBadge(badge)) return "staff_picks";
  if (badge.category === "MILESTONE" && badge.trigger === "checkout:opened") return "gear_flow";
  if (badge.category === "MILESTONE" && badge.trigger === "shift:completed") return "teamwork";
  if (badge.category === "MILESTONE") return "staff_picks";
  if (badge.category === "CHECKOUT") return "gear_flow";
  if (badge.category === "ON_TIME") return "reliability";
  if (badge.category === "SCAN") return "scans";
  if (badge.category === "TRADE" || badge.category === "SHIFT") return "teamwork";
  if (badge.key.includes("streak") || badge.key.includes("reliable") || badge.key.includes("zero_errors")) return "reliability";
  return "gear_flow";
}

function badgeShape(badge: UserBadge): BadgeMedallionShape {
  if (badge.category === "SCAN") return "hex";
  if (badge.category === "TRADE" || badge.category === "SHIFT") return "shield";
  if (badge.category === "CHECKOUT" || badge.category === "ON_TIME" || badge.trigger === "checkout:opened") return "stack";
  if (badge.trigger === "shift:completed") return "shield";
  if (isManualBadge(badge)) return "hex";
  return "coin";
}

function sortedForDisplay(badges: UserBadge[]) {
  return [...badges].sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;
    const aDate = a.awardedAt ? new Date(a.awardedAt).getTime() : 0;
    const bDate = b.awardedAt ? new Date(b.awardedAt).getTime() : 0;
    if (aDate !== bDate) return bDate - aDate;
    return a.sortOrder - b.sortOrder;
  });
}

function buildShelves(galleryBadges: UserBadge[], allBadges: UserBadge[]): BadgeShelf[] {
  const grouped = new Map<AwardCollectionKey, UserBadge[]>(
    awardCollectionDefinitions.map((definition) => [definition.key, []]),
  );

  for (const badge of galleryBadges) {
    grouped.get(primaryCollectionKey(badge))?.push(badge);
  }

  const hiddenByKey = new Map<AwardCollectionKey, number>();
  for (const badge of allBadges) {
    if (badge.earned || !badge.active || !isHiddenUntilEarnedBadge(badge.key)) continue;
    const key = primaryCollectionKey(badge);
    hiddenByKey.set(key, (hiddenByKey.get(key) ?? 0) + 1);
  }

  return awardCollectionDefinitions
    .map((definition): BadgeShelf => {
      const shelfBadges = sortedForDisplay(grouped.get(definition.key) ?? []);
      return {
        ...definition,
        badges: shelfBadges,
        earnedCount: shelfBadges.filter((badge) => badge.earned).length,
        hiddenCount: hiddenByKey.get(definition.key) ?? 0,
      };
    })
    .filter((shelf) => shelf.badges.length > 0 || shelf.hiddenCount > 0);
}

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
            <span className="text-3xl font-semibold tabular-nums">{completion}%</span>
            <span className="text-xs text-muted-foreground">of automatic goals</span>
          </div>
          <Progress value={completion} className="mt-2 h-1.5" aria-label="Badge catalog completion" />
        </div>
        <dl className="flex items-center gap-6 text-right">
          <div>
            <dt className="sr-only">Earned</dt>
            <dd className="text-xl font-semibold tabular-nums">{earned}</dd>
            <dd className="text-xs text-muted-foreground">Earned</dd>
          </div>
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

function BadgeTile({
  badge,
  selected,
  onSelect,
}: {
  badge: UserBadge;
  selected: boolean;
  onSelect: (badge: UserBadge) => void;
}) {
  const Icon = iconMap[badge.icon] ?? Trophy;
  const rarity = badge.rarity ?? getBadgeRarity(badge);
  const recentlyEarned = badge.earned && isRecentlyEarned(badge.awardedAt);

  return (
    <button
      type="button"
      onClick={() => onSelect(badge)}
      className={cn(
        "group relative flex w-full flex-col items-center gap-2 rounded-xl bg-card px-3 pb-4 pt-5 text-center shadow-[0_0_0_1px_var(--border)] outline-none transition-[transform,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_34px_color-mix(in_oklch,var(--foreground)_8%,transparent),0_0_0_1px_var(--border)] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]",
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
        shape={badgeShape(badge)}
        className={cn("size-14", recentlyEarned && "scale-[1.03]")}
        iconClassName="size-6"
      />
      <div className="min-w-0">
        <h3 className={cn("text-balance text-sm font-semibold leading-5", badge.earned ? "text-foreground" : "text-muted-foreground")}>
          {badge.name}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">{badgeMetaLine(badge)}</p>
      </div>
      {hasProgress(badge) ? (
        <Progress
          value={progressPercent(badge)}
          className="mt-1 h-1 w-full max-w-[120px] bg-muted [&_[data-slot=progress-indicator]]:bg-primary/70"
          aria-label={`${badge.name} progress`}
        />
      ) : null}
    </button>
  );
}

function SurpriseTile({ count }: { count: number }) {
  return (
    <div className="flex w-full flex-col items-center gap-2 rounded-xl bg-muted/30 px-3 pb-4 pt-5 text-center text-muted-foreground shadow-[0_0_0_1px_var(--border)]">
      <BadgeMedallion icon={Sparkles} earned={false} rarity="Rare" shape="hex" className="size-14 opacity-80" iconClassName="size-6" />
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-foreground">Surprise awards</h3>
        <p className="mt-1 text-xs">
          {count} hidden until earned
        </p>
      </div>
    </div>
  );
}

function ShelfSection({
  shelf,
  filter,
  selectedBadge,
  onSelect,
}: {
  shelf: BadgeShelf;
  filter: BadgeFilter;
  selectedBadge: UserBadge | null;
  onSelect: (badge: UserBadge) => void;
}) {
  const filteredBadges = filterBadges(shelf.badges, filter);
  const showSurpriseTile = shelf.hiddenCount > 0 && (filter === "all" || filter === "locked");
  if (filteredBadges.length === 0 && !showSurpriseTile) return null;
  const ShelfIcon = shelf.icon;

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
        {filteredBadges.map((badge) => (
          <StaggerItem key={badge.id}>
            <BadgeTile badge={badge} selected={selectedBadge?.id === badge.id} onSelect={onSelect} />
          </StaggerItem>
        ))}
        {showSurpriseTile ? (
          <StaggerItem>
            <SurpriseTile count={shelf.hiddenCount} />
          </StaggerItem>
        ) : null}
      </StaggerList>
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
  const Icon = badge ? iconMap[badge.icon] ?? Trophy : Trophy;
  const rarity = badge ? (badge.rarity ?? getBadgeRarity(badge)) : "Common";
  const progressValue = badge ? progressPercent(badge) : 0;
  const recentlyEarned = badge ? badge.earned && isRecentlyEarned(badge.awardedAt) : false;

  async function handleRevoke() {
    if (!badge || revokeBusy) return;
    setRevokeBusy(true);
    try {
      const res = await fetch(`/api/badges/award/${badge.id}`, { method: "DELETE" });
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
                <span className={cn("absolute inset-0 rounded-[2.75rem] opacity-35 blur-2xl", rarityAccentClass(rarity))} aria-hidden="true" />
                <span className="absolute inset-3 rounded-[2.25rem] bg-background/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.60),0_28px_56px_rgba(0,0,0,0.18)]" aria-hidden="true" />
                <BadgeMedallion
                  icon={Icon}
                  earned={badge.earned}
                  rarity={rarity}
                  shape={badgeShape(badge)}
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
                  <Badge variant={badgeRarityVariant(rarity)}>{rarity}</Badge>
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

              {(!badge.earned && !hasProgress(badge)) || canRevoke || (canAward && !badge.earned && badge.trigger === "manual") ? (
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
                      {canRevoke && badge.earned && badge.source === "MANUAL" ? (
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
    () => buildShelves(galleryBadges, data?.badges ?? []),
    [galleryBadges, data],
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
  const filteredShelfCount = shelves.filter((shelf) => {
    const showSurpriseTile = shelf.hiddenCount > 0 && (filter === "all" || filter === "locked");
    return filterBadges(shelf.badges, filter).length > 0 || showSurpriseTile;
  }).length;

  return (
    <div className="flex flex-col gap-6">
      <BadgeSummaryBand
        earned={earnedBadges.length}
        goalsEarned={automaticGoalsEarned}
        goals={automaticGoals.length}
        hidden={hiddenSurpriseCount}
      />

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

          {earnedBadges.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Recently earned awards get a soft glow for one week. Surprise awards stay hidden until earned.
            </p>
          ) : null}
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
