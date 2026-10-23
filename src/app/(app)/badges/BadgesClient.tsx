"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, ChevronDown, ChevronUp, Info, Search, Sparkles, Trophy, X } from "lucide-react";
import { BadgeMedallion } from "@/components/badges/BadgeMedallion";
import { badgeIcon } from "@/components/badges/badge-artwork";
import { awardCollectionDefinitions, primaryCollectionKey } from "@/components/badges/badge-collections";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { FadeUp } from "@/components/ui/motion";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFetch } from "@/hooks/use-fetch";
import { badgeRarityVariant, type BadgeRarity } from "@/lib/badges/display";
import type { BadgeGallery, BadgeGalleryBadge, BadgeGalleryPerson } from "@/lib/badges/gallery";
import { formatDateFull, formatDateShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import BadgeAwardPanel from "./BadgeAwardPanel";

type GalleryResponse = BadgeGallery & { disabled?: boolean };
type GalleryTab = "gallery" | "team" | "award";
type GalleryFilter = "all" | "earned" | "not_yet" | "rare";
type TeamFilter = "everyone" | "students" | "staff";

const galleryFilterLabels: Record<GalleryFilter, string> = {
  all: "All",
  earned: "You have",
  not_yet: "Not yet",
  rare: "Rare",
};

const teamFilterLabels: Record<TeamFilter, string> = {
  everyone: "Everyone",
  students: "Students",
  staff: "Staff",
};

const RARITY_RANK: Record<BadgeRarity, number> = { Legendary: 3, Rare: 2, Uncommon: 1, Common: 0 };

/** Tiles a section shows before it asks, matching the profile shelves. */
const SECTION_PREVIEW_COUNT = 10;

function rarityOf(badge: BadgeGalleryBadge): BadgeRarity {
  return (badge.rarity in RARITY_RANK ? badge.rarity : "Common") as BadgeRarity;
}

function hasProgress(badge: BadgeGalleryBadge) {
  return !badge.earnedByViewer && badge.progressCurrent !== null && badge.progressTarget !== null && badge.progressTarget > 0;
}

function progressPercent(badge: BadgeGalleryBadge) {
  if (!hasProgress(badge)) return 0;
  return Math.min(100, Math.round((badge.progressCurrent! / badge.progressTarget!) * 100));
}

function holdersLabel(count: number) {
  if (count === 0) return "Nobody yet";
  return count === 1 ? "1 person" : `${count} people`;
}

/** Rarest first, then the fewest holders, so a person's best badges lead. */
function byRarity(a: BadgeGalleryBadge, b: BadgeGalleryBadge) {
  return RARITY_RANK[rarityOf(b)] - RARITY_RANK[rarityOf(a)] || a.holderCount - b.holderCount || a.sortOrder - b.sortOrder;
}

/** Earned first, then goals in motion (nearest first), then catalog order. */
function byViewerProgress(a: BadgeGalleryBadge, b: BadgeGalleryBadge) {
  if (a.earnedByViewer !== b.earnedByViewer) return a.earnedByViewer ? -1 : 1;
  const aShare = hasProgress(a) ? a.progressCurrent! / a.progressTarget! : 0;
  const bShare = hasProgress(b) ? b.progressCurrent! / b.progressTarget! : 0;
  if (aShare !== bShare) return bShare - aShare;
  return a.sortOrder - b.sortOrder;
}

/** Up to three goals the viewer is closest to finishing: furthest along, then fewest to go. */
function closestGoals(badges: BadgeGalleryBadge[], limit = 3) {
  return badges
    .filter((badge) => badge.active && !badge.mystery && hasProgress(badge) && badge.progressCurrent! > 0)
    .sort((a, b) => (
      b.progressCurrent! / b.progressTarget! - a.progressCurrent! / a.progressTarget!
      || (a.progressTarget! - a.progressCurrent!) - (b.progressTarget! - b.progressCurrent!)
      || a.sortOrder - b.sortOrder
    ))
    .slice(0, limit);
}

/** Mirrors the open sheet or compare dialog into the URL so it can be shared or linked to. */
function replaceSearchParam(key: string, value: string | null) {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  window.history.replaceState(null, "", url);
}

function matchesFilter(badge: BadgeGalleryBadge, filter: GalleryFilter) {
  if (filter === "earned") return badge.earnedByViewer;
  if (filter === "not_yet") return !badge.earnedByViewer;
  if (filter === "rare") return rarityOf(badge) === "Rare" || rarityOf(badge) === "Legendary";
  return true;
}

function personMatchesTeamFilter(person: BadgeGalleryPerson, filter: TeamFilter) {
  if (filter === "students") return person.role === "STUDENT";
  if (filter === "staff") return person.role === "STAFF" || person.role === "ADMIN";
  return true;
}

function roleLabel(role: string) {
  return role === "ADMIN" ? "Admin" : role === "STAFF" ? "Staff" : "Student";
}

type GallerySection = {
  key: string;
  title: string;
  description: string;
  badges: BadgeGalleryBadge[];
};

function buildSections(badges: BadgeGalleryBadge[]): GallerySection[] {
  const grouped = new Map<string, BadgeGalleryBadge[]>();
  for (const badge of badges) {
    const key = badge.mystery ? "surprises" : primaryCollectionKey(badge);
    grouped.set(key, [...(grouped.get(key) ?? []), badge]);
  }
  const sections: GallerySection[] = awardCollectionDefinitions.map((definition) => ({
    key: definition.key,
    title: definition.title,
    description: definition.description,
    badges: (grouped.get(definition.key) ?? []).sort(byViewerProgress),
  }));
  sections.push({
    key: "surprises",
    title: "Surprises",
    description: "Found by someone on the team. Earn one to see what it is.",
    badges: (grouped.get("surprises") ?? []).sort((a, b) => b.holderCount - a.holderCount),
  });
  return sections.filter((section) => section.badges.length > 0);
}

export default function BadgesClient({
  isAdmin,
  isStaff,
  badgesAvailable,
  initialTab,
  initialBadgeKey = null,
  initialCompareId = null,
}: {
  isAdmin: boolean;
  isStaff: boolean;
  badgesAvailable: boolean;
  initialTab: GalleryTab;
  /** `?badge=<key>` opens that badge's sheet once the gallery loads. */
  initialBadgeKey?: string | null;
  /** `?compare=<userId>` opens the compare dialog with that person. */
  initialCompareId?: string | null;
}) {
  const [tab, setTab] = useState<GalleryTab>(initialTab === "award" && !isStaff ? "gallery" : initialTab);
  const [selectedBadgeId, setSelectedBadgeIdState] = useState<string | null>(null);
  const [comparePersonId, setComparePersonIdState] = useState<string | null>(null);

  const { data, loading, error, reload } = useFetch<GalleryResponse>({
    url: "/api/badges/gallery",
    returnTo: "/badges",
    refetchOnFocus: false,
    transform: (json) => ({ ...(json.data as BadgeGallery), disabled: json.disabled === true }),
  });

  const peopleById = useMemo(
    () => new Map((data?.people ?? []).map((person) => [person.id, person])),
    [data?.people],
  );
  const selectedBadge = data?.badges.find((badge) => badge.id === selectedBadgeId) ?? null;
  const comparePerson = comparePersonId ? peopleById.get(comparePersonId) ?? null : null;

  function setSelectedBadgeId(id: string | null) {
    setSelectedBadgeIdState(id);
    const badge = id ? data?.badges.find((entry) => entry.id === id) : null;
    // A mystery key is per-viewer noise, so it never lands in a shareable URL.
    replaceSearchParam("badge", badge && !badge.mystery ? badge.key : null);
  }

  function setComparePersonId(id: string | null) {
    setComparePersonIdState(id);
    replaceSearchParam("compare", id);
  }

  // Resolve deep links once, after the gallery arrives. A key the viewer can't
  // see (an unearned surprise, a retired badge) or someone outside their view
  // simply opens nothing.
  const deepLinkResolved = useRef(false);
  useEffect(() => {
    if (!data || deepLinkResolved.current) return;
    deepLinkResolved.current = true;
    if (initialBadgeKey) {
      const badge = data.badges.find((entry) => entry.key === initialBadgeKey && !entry.mystery);
      if (badge) setSelectedBadgeIdState(badge.id);
      else replaceSearchParam("badge", null);
    }
    if (initialCompareId) {
      if (data.canCompare && data.people.some((person) => person.id === initialCompareId)) setComparePersonIdState(initialCompareId);
      else replaceSearchParam("compare", null);
    }
  }, [data, initialBadgeKey, initialCompareId]);

  function changeTab(next: string) {
    const value = next as GalleryTab;
    setTab(value);
    const url = new URL(window.location.href);
    if (value === "gallery") url.searchParams.delete("tab");
    else url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  }

  const disabled = !badgesAvailable || data?.disabled === true;

  return (
    <FadeUp>
      <div className="flex flex-col gap-5">
        <PageHeader title="Badges" description="Every badge on the team, who has it, and how you compare.">
          {isStaff ? (
            <Button asChild variant="outline" size="sm" className="h-10">
              <Link href="/reports/badges">
                <BarChart3 data-icon="inline-start" />
                View report
              </Link>
            </Button>
          ) : null}
        </PageHeader>

        <Tabs value={tab} onValueChange={changeTab}>
          <TabsList aria-label="Badges views">
            <TabsTrigger value="gallery">Gallery</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
            {isStaff ? <TabsTrigger value="award">Award</TabsTrigger> : null}
          </TabsList>

          <TabsContent value="gallery" className="pt-4">
            {disabled ? (
              <DisabledState />
            ) : loading ? (
              <GallerySkeleton />
            ) : error || !data ? (
              <LoadError onRetry={reload} />
            ) : (
              <GalleryView
                data={data}
                peopleById={peopleById}
                onSelectBadge={setSelectedBadgeId}
                onOpenTeam={() => changeTab("team")}
              />
            )}
          </TabsContent>

          <TabsContent value="team" className="pt-4">
            {disabled ? (
              <DisabledState />
            ) : loading ? (
              <TeamSkeleton />
            ) : error || !data ? (
              <LoadError onRetry={reload} />
            ) : (
              <TeamView data={data} onCompare={setComparePersonId} onSelectBadge={setSelectedBadgeId} />
            )}
          </TabsContent>

          {isStaff ? (
            <TabsContent value="award" className="pt-4">
              <BadgeAwardPanel isAdmin={isAdmin} badgesAvailable={badgesAvailable} />
            </TabsContent>
          ) : null}
        </Tabs>

        <BadgeSheet
          badge={selectedBadge}
          viewerId={data?.viewerId ?? null}
          peopleById={peopleById}
          canCompare={data?.canCompare ?? false}
          onOpenChange={(open) => {
            if (!open) setSelectedBadgeId(null);
          }}
        />

        {data ? (
          <CompareDialog
            data={data}
            person={comparePerson}
            onOpenChange={(open) => {
              if (!open) setComparePersonId(null);
            }}
            onSelectBadge={(id) => {
              setComparePersonId(null);
              setSelectedBadgeId(id);
            }}
          />
        ) : null}
      </div>
    </FadeUp>
  );
}

function DisabledState() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Trophy />
        </EmptyMedia>
        <EmptyTitle>Badges are turned off</EmptyTitle>
        <EmptyDescription>The gallery appears here once badges are enabled.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <Info className="size-4" />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>The badge gallery could not be loaded.</span>
        <Button type="button" variant="outline" size="sm" className="h-10" onClick={onRetry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function GallerySkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <Skeleton className="h-[92px] w-full rounded-xl" />
      <Skeleton className="h-10 w-72 max-w-full" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {Array.from({ length: 10 }, (_, index) => (
          <div key={index} className="flex flex-col items-center gap-3 rounded-xl bg-card p-4 shadow-[0_0_0_1px_var(--border)]">
            <Skeleton className="size-14 rounded-full" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-14" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl px-3 py-3">
          <Skeleton className="h-4 w-6" />
          <Skeleton className="size-9 rounded-full" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-10" />
        </div>
      ))}
    </div>
  );
}

function GalleryView({
  data,
  peopleById,
  onSelectBadge,
  onOpenTeam,
}: {
  data: GalleryResponse;
  peopleById: Map<string, BadgeGalleryPerson>;
  onSelectBadge: (id: string) => void;
  onOpenTeam: () => void;
}) {
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const sections = useMemo(() => buildSections(data.badges), [data.badges]);
  const needle = query.trim().toLowerCase();
  const narrowing = filter !== "all" || needle.length > 0;
  const visibleSections = sections
    .map((section) => ({
      ...section,
      badges: section.badges.filter((badge) => (
        matchesFilter(badge, filter)
        && (!needle || `${badge.name} ${badge.description}`.toLowerCase().includes(needle))
      )),
    }))
    .filter((section) => section.badges.length > 0);

  return (
    <div className="flex flex-col gap-6">
      <ViewerSummary data={data} viewer={peopleById.get(data.viewerId) ?? null} onOpenTeam={onOpenTeam} />

      {!narrowing ? <UpNext badges={data.badges} onSelect={onSelectBadge} /> : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as GalleryFilter);
          }}
          className="flex-wrap"
          aria-label="Filter badges"
        >
          {(Object.keys(galleryFilterLabels) as GalleryFilter[]).map((key) => (
            <ToggleGroupItem key={key} value={key} className="h-10 px-3">
              {galleryFilterLabels[key]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="relative sm:w-64">
          <Input
            id="badge-gallery-search"
            name="badge-gallery-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search badges"
            aria-label="Search badges"
            className="h-10 pl-9 pr-10 text-base md:text-sm"
          />
          <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground" aria-hidden="true" />
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute inset-y-0 right-0 my-auto size-10 text-muted-foreground"
              onClick={() => setQuery("")}
              aria-label="Clear badge search"
            >
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {visibleSections.length === 0 ? (
        <Empty className="min-h-[220px]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trophy />
            </EmptyMedia>
            <EmptyTitle>No badges match</EmptyTitle>
            <EmptyDescription>Try another filter or search.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-8">
          {visibleSections.map((section) => {
            const collapsible = !narrowing && section.badges.length > SECTION_PREVIEW_COUNT;
            const open = expanded.has(section.key);
            const shown = collapsible && !open ? section.badges.slice(0, SECTION_PREVIEW_COUNT) : section.badges;
            const earned = section.badges.filter((badge) => badge.earnedByViewer).length;
            return (
              <section key={section.key} aria-label={`${section.title} badges`}>
                <div className="flex items-end justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold leading-6">{section.title}</h2>
                    <p className="text-sm text-muted-foreground">{section.description}</p>
                  </div>
                  <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {section.key === "surprises" ? `${section.badges.length} found` : `You have ${earned} of ${section.badges.length}`}
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                  {shown.map((badge) => (
                    <GalleryTile key={badge.id} badge={badge} peopleById={peopleById} onSelect={onSelectBadge} />
                  ))}
                </div>
                {collapsible ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2.5 h-10 w-full text-xs text-muted-foreground hover:text-foreground"
                    aria-expanded={open}
                    onClick={() => setExpanded((current) => {
                      const next = new Set(current);
                      if (next.has(section.key)) next.delete(section.key);
                      else next.add(section.key);
                      return next;
                    })}
                  >
                    {open ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
                    {open ? "Show less" : `Show ${section.badges.length - SECTION_PREVIEW_COUNT} more in ${section.title}`}
                  </Button>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      {data.undiscoveredSurprises > 0 ? (
        <p className="text-xs text-muted-foreground">
          {data.undiscoveredSurprises === 1
            ? "1 more surprise badge hasn't been found by anyone yet."
            : `${data.undiscoveredSurprises} more surprise badges haven't been found by anyone yet.`}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The one hero number on the page: what you have, and where that puts you.
 * Calm by design: a single bold count, one rank line, one bar.
 */
function ViewerSummary({
  data,
  viewer,
  onOpenTeam,
}: {
  data: GalleryResponse;
  viewer: BadgeGalleryPerson | null;
  onOpenTeam: () => void;
}) {
  const goals = data.badges.filter((badge) => badge.active && !badge.mystery && badge.trigger !== "manual");
  const goalsEarned = goals.filter((badge) => badge.earnedByViewer).length;
  const count = viewer?.count ?? data.badges.filter((badge) => badge.earnedByViewer).length;
  const rank = data.canCompare
    ? data.people.findIndex((person) => person.id === data.viewerId) + 1
    : 0;
  // Ties share a place, so the fifth person with 12 badges is not "#9".
  const place = rank > 0 ? data.people.filter((person) => person.count > count).length + 1 : 0;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-xl bg-card p-5 shadow-[0_0_0_1px_var(--border)]">
      {viewer ? <UserAvatar name={viewer.name} avatarUrl={viewer.avatarUrl} size="lg" className="max-sm:hidden" /> : null}
      <div className="min-w-[180px] flex-1">
        <p className="text-3xl font-black tabular-nums leading-none">
          {count}
          <span className="ml-1.5 text-base font-bold text-muted-foreground">{count === 1 ? "badge" : "badges"}</span>
        </p>
        <Progress
          value={goals.length > 0 ? Math.round((goalsEarned / goals.length) * 100) : 0}
          className="mt-3 h-1.5 max-w-sm"
          aria-label={`${goalsEarned} of ${goals.length} goals earned`}
        />
        <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
          {goalsEarned} of {goals.length} goals
          {place > 0 ? <span className="sm:hidden"> · #{place} of {data.people.length} on the team</span> : null}
        </p>
      </div>
      {place > 0 ? (
        <button
          type="button"
          onClick={onOpenTeam}
          className="rounded-lg px-3 py-2 text-right outline-none max-sm:hidden transition-colors hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <p className="text-xl font-black tabular-nums">#{place}</p>
          <p className="text-xs text-muted-foreground tabular-nums">of {data.people.length} on the team</p>
        </button>
      ) : null}
    </div>
  );
}

/** The three goals you're closest to, so the next one is always one glance away. */
function UpNext({ badges, onSelect }: { badges: BadgeGalleryBadge[]; onSelect: (id: string) => void }) {
  const goals = useMemo(() => closestGoals(badges), [badges]);
  if (goals.length === 0) return null;

  return (
    <section aria-label="Closest to earning">
      <h2 className="text-base font-bold leading-6">Up next</h2>
      <p className="text-sm text-muted-foreground">The badges you&apos;re closest to earning.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {goals.map((badge) => {
          const remaining = badge.progressTarget! - badge.progressCurrent!;
          return (
            <button
              key={badge.id}
              type="button"
              onClick={() => onSelect(badge.id)}
              className="flex w-full items-center gap-3 rounded-xl bg-card px-4 py-3.5 text-left shadow-[0_0_0_1px_var(--border)] outline-none transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_28px_color-mix(in_oklch,var(--foreground)_7%,transparent),0_0_0_1px_var(--border)] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:hover:translate-y-0"
              aria-label={`${badge.name}, ${badge.progressCurrent} of ${badge.progressTarget}, ${remaining} to go. Open details.`}
            >
              <BadgeMedallion icon={badgeIcon(badge.icon)} earned={false} rarity={rarityOf(badge)} className="size-11 shrink-0" iconClassName="size-5" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-bold leading-5">{badge.name}</h3>
                <Progress value={progressPercent(badge)} className="mt-2 h-1.5" aria-hidden="true" />
                <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
                  {badge.progressCurrent}/{badge.progressTarget} · {remaining === 1 ? "1 to go" : `${remaining} to go`}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function HolderStack({ badge, peopleById }: { badge: BadgeGalleryBadge; peopleById: Map<string, BadgeGalleryPerson> }) {
  const shown = badge.holders.slice(0, 3).map((holder) => peopleById.get(holder.userId)).filter(Boolean) as BadgeGalleryPerson[];
  return (
    <div className="flex items-center justify-center gap-1.5">
      {shown.length > 0 ? (
        <span className="flex gap-0.5" aria-hidden="true">
          {shown.map((person) => (
            <UserAvatar key={person.id} name={person.name} avatarUrl={person.avatarUrl} size="sm" />
          ))}
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground tabular-nums">{holdersLabel(badge.holderCount)}</span>
    </div>
  );
}

function GalleryTile({
  badge,
  peopleById,
  onSelect,
}: {
  badge: BadgeGalleryBadge;
  peopleById: Map<string, BadgeGalleryPerson>;
  onSelect: (id: string) => void;
}) {
  const Icon = badge.mystery ? Sparkles : badgeIcon(badge.icon);
  const rarity = rarityOf(badge);
  return (
    <button
      type="button"
      onClick={() => onSelect(badge.id)}
      className={cn(
        "group relative flex h-full w-full flex-col items-center gap-2 rounded-xl bg-card px-3 pb-4 pt-5 text-center shadow-[0_0_0_1px_var(--border)] outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_34px_color-mix(in_oklch,var(--foreground)_8%,transparent),0_0_0_1px_var(--border)] focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0",
        !badge.earnedByViewer && "bg-muted/30",
      )}
      aria-label={`${badge.name}, ${badge.earnedByViewer ? "you have it" : "not earned yet"}, ${holdersLabel(badge.holderCount)}. Open details.`}
    >
      <BadgeMedallion icon={Icon} earned={badge.earnedByViewer} rarity={rarity} className="size-14" iconClassName="size-6" />
      <div className="min-w-0">
        <h3 className={cn("line-clamp-2 min-h-10 text-balance text-sm font-bold leading-5", !badge.earnedByViewer && "text-muted-foreground")}>
          {badge.name}
        </h3>
      </div>
      {hasProgress(badge) ? (
        <div className="flex w-full max-w-[120px] flex-col items-center gap-1">
          <Progress value={progressPercent(badge)} className="h-1 w-full bg-muted" aria-label={`${badge.name} progress`} />
          <span className="text-[11px] text-muted-foreground tabular-nums">{badge.progressCurrent}/{badge.progressTarget}</span>
        </div>
      ) : null}
      <div className="mt-auto pt-1">
        <HolderStack badge={badge} peopleById={peopleById} />
      </div>
    </button>
  );
}

function BadgeSheet({
  badge,
  viewerId,
  peopleById,
  canCompare,
  onOpenChange,
}: {
  badge: BadgeGalleryBadge | null;
  viewerId: string | null;
  peopleById: Map<string, BadgeGalleryPerson>;
  canCompare: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const Icon = badge?.mystery ? Sparkles : badgeIcon(badge?.icon);
  const rarity = badge ? rarityOf(badge) : "Common";

  return (
    <Sheet open={Boolean(badge)} onOpenChange={onOpenChange}>
      <SheetContent className="wc-fresh flex w-full flex-col sm:max-w-md">
        {badge ? (
          <>
            <SheetHeader className="items-center gap-3 pt-8 text-center">
              <BadgeMedallion icon={Icon} earned={badge.earnedByViewer} rarity={rarity} className="size-24" iconClassName="size-10" />
              <div className="flex flex-wrap justify-center gap-1.5">
                <Badge variant={badgeRarityVariant(rarity)}>{badge.rarityProvisional ? `${rarity} (provisional)` : rarity}</Badge>
                {badge.earnedByViewer ? <Badge variant="green">You have it</Badge> : null}
                {!badge.active ? <Badge variant="gray">Retired</Badge> : null}
              </div>
              <SheetTitle className="text-2xl font-black">{badge.name}</SheetTitle>
              <SheetDescription className="max-w-[40ch] text-pretty text-sm leading-6">{badge.description}</SheetDescription>
            </SheetHeader>
            <SheetBody className="flex flex-col gap-5 px-6 pb-8">
              {badge.earnedByViewer && badge.viewerAwardedAt ? (
                <p className="text-center text-sm text-muted-foreground">
                  You earned this {formatDateFull(badge.viewerAwardedAt)}
                </p>
              ) : hasProgress(badge) ? (
                <div className="rounded-xl bg-muted/40 p-4">
                  <div className="mb-2 flex items-center justify-between text-sm">
                    <span className="font-bold">Your progress</span>
                    <span className="text-muted-foreground tabular-nums">{badge.progressCurrent}/{badge.progressTarget}</span>
                  </div>
                  <Progress value={progressPercent(badge)} className="h-2" />
                </div>
              ) : null}

              <div>
                <h3 className="text-sm font-bold">
                  {badge.holderCount === 0 ? "Nobody has this yet" : `Who has it (${badge.holderCount})`}
                </h3>
                {badge.privateHolders && badge.holderCount > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">This one stays private. Only the people who earned it can see it on their own profile.</p>
                ) : !canCompare && badge.holderCount > 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">Team comparisons are turned off, so only the count is shown.</p>
                ) : badge.holderCount === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">Be the first on the team to earn it.</p>
                ) : (
                  <ul className="mt-2 flex flex-col">
                    {badge.holders.map((holder) => {
                      const person = peopleById.get(holder.userId);
                      if (!person) return null;
                      return (
                        <li key={holder.userId}>
                          <Link
                            href={`/staff/${person.id}?tab=badges`}
                            className="-mx-2 flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5 text-foreground no-underline hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          >
                            <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" />
                            <span className="min-w-0 flex-1 truncate text-sm font-bold">
                              {person.name}
                              {person.id === viewerId ? <span className="ml-1.5 font-normal text-muted-foreground">(you)</span> : null}
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatDateFull(holder.awardedAt)}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </SheetBody>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function TeamView({
  data,
  onCompare,
  onSelectBadge,
}: {
  data: GalleryResponse;
  onCompare: (id: string) => void;
  onSelectBadge: (id: string) => void;
}) {
  const [filter, setFilter] = useState<TeamFilter>("everyone");

  // Each person's three rarest public badges, drawn beside their count.
  const topBadgesByPerson = useMemo(() => {
    const map = new Map<string, BadgeGalleryBadge[]>();
    for (const badge of [...data.badges].sort(byRarity)) {
      for (const holder of badge.holders) {
        const list = map.get(holder.userId) ?? [];
        if (list.length < 3) list.push(badge);
        map.set(holder.userId, list);
      }
    }
    return map;
  }, [data.badges]);

  if (!data.canCompare) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Trophy />
          </EmptyMedia>
          <EmptyTitle>Team comparisons are off</EmptyTitle>
          <EmptyDescription>Your own badges are still in the Gallery.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const people = data.people.filter((person) => personMatchesTeamFilter(person, filter));

  return (
    <div className="flex flex-col gap-4">

      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as TeamFilter);
          }}
          aria-label="Filter people"
        >
          {(Object.keys(teamFilterLabels) as TeamFilter[]).map((key) => (
            <ToggleGroupItem key={key} value={key} className="h-10 px-3">
              {teamFilterLabels[key]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-xs text-muted-foreground">Pick someone to compare badges.</p>
      </div>

      <EarnedThisWeek data={data} filter={filter} onSelectBadge={onSelectBadge} />

      <ol className="overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_var(--border)]" aria-label="Team badge ranking">
        {people.map((person) => {
          const isViewer = person.id === data.viewerId;
          const place = people.filter((other) => other.count > person.count).length + 1;
          const top = topBadgesByPerson.get(person.id) ?? [];
          return (
            <li key={person.id} className="border-b border-border/60 last:border-b-0">
              <button
                type="button"
                onClick={() => onCompare(person.id)}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50",
                  isViewer && "bg-[var(--accent-soft)] hover:bg-[var(--accent-soft)]",
                )}
                aria-label={isViewer ? `You, ${person.count} badges, place ${place}` : `Compare with ${person.name}, ${person.count} badges, place ${place}`}
              >
                <span className="w-6 shrink-0 text-right text-sm font-bold text-muted-foreground tabular-nums">{place}</span>
                <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">
                    {person.name}
                    {isViewer ? <span className="ml-1.5 font-normal text-muted-foreground">You</span> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{roleLabel(person.role)}</span>
                </span>
                <span className="hidden items-center gap-1 sm:flex" aria-hidden="true">
                  {top.map((badge) => (
                    <BadgeMedallion
                      key={badge.id}
                      icon={badge.mystery ? Sparkles : badgeIcon(badge.icon)}
                      earned
                      rarity={rarityOf(badge)}
                      className="size-7"
                      iconClassName="size-3.5"
                    />
                  ))}
                </span>
                <span className="w-12 shrink-0 text-right text-base font-black tabular-nums">{person.count}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Rows the strip shows before it asks, so a busy week doesn't push the ranking off screen. */
const RECENT_PREVIEW_COUNT = 5;

/**
 * Who earned what in the last seven days, newest first. Holders are already
 * empty for private badges and when comparisons are off, so nothing here can
 * reveal a blooper or a surprise's name.
 */
function EarnedThisWeek({
  data,
  filter,
  onSelectBadge,
}: {
  data: GalleryResponse;
  filter: TeamFilter;
  onSelectBadge: (id: string) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const peopleById = useMemo(() => new Map(data.people.map((person) => [person.id, person])), [data.people]);

  const recent = useMemo(() => {
    const since = Date.now() - WEEK_MS;
    const rows: { badge: BadgeGalleryBadge; person: BadgeGalleryPerson; awardedAt: string }[] = [];
    for (const badge of data.badges) {
      for (const holder of badge.holders) {
        if (new Date(holder.awardedAt).getTime() < since) continue;
        const person = peopleById.get(holder.userId);
        if (!person || !personMatchesTeamFilter(person, filter)) continue;
        rows.push({ badge, person, awardedAt: holder.awardedAt });
      }
    }
    return rows.sort((a, b) => b.awardedAt.localeCompare(a.awardedAt));
  }, [data.badges, peopleById, filter]);

  if (recent.length === 0) return null;
  const shown = showAll ? recent : recent.slice(0, RECENT_PREVIEW_COUNT);

  return (
    <section aria-label="Earned this week">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-base font-bold leading-6">Earned this week</h2>
        <p className="text-xs text-muted-foreground tabular-nums">{recent.length === 1 ? "1 badge" : `${recent.length} badges`}</p>
      </div>
      <ul className="mt-3 overflow-hidden rounded-xl bg-card shadow-[0_0_0_1px_var(--border)]">
        {shown.map(({ badge, person, awardedAt }) => {
          const isViewer = person.id === data.viewerId;
          return (
            <li key={`${badge.id}:${person.id}`} className="border-b border-border/60 last:border-b-0">
              <button
                type="button"
                onClick={() => onSelectBadge(badge.id)}
                className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <UserAvatar name={person.name} avatarUrl={person.avatarUrl} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  <span className="font-bold">{isViewer ? "You" : person.name}</span>
                  <span className="text-muted-foreground">{badge.mystery ? " found " : " earned "}</span>
                  <span className="font-bold">{badge.mystery ? "a surprise badge" : badge.name}</span>
                </span>
                <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">{formatDateShort(awardedAt)}</span>
                <BadgeMedallion
                  icon={badge.mystery ? Sparkles : badgeIcon(badge.icon)}
                  earned
                  rarity={rarityOf(badge)}
                  className="size-8 shrink-0"
                  iconClassName="size-4"
                />
              </button>
            </li>
          );
        })}
      </ul>
      {recent.length > RECENT_PREVIEW_COUNT ? (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1.5 h-10 w-full text-xs text-muted-foreground hover:text-foreground"
          aria-expanded={showAll}
          onClick={() => setShowAll((open) => !open)}
        >
          {showAll ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
          {showAll ? "Show less" : `Show ${recent.length - RECENT_PREVIEW_COUNT} more`}
        </Button>
      ) : null}
    </section>
  );
}

function CompareDialog({
  data,
  person,
  onOpenChange,
  onSelectBadge,
}: {
  data: GalleryResponse;
  person: BadgeGalleryPerson | null;
  onOpenChange: (open: boolean) => void;
  onSelectBadge: (id: string) => void;
}) {
  const viewer = data.people.find((entry) => entry.id === data.viewerId) ?? null;
  const isSelf = person?.id === data.viewerId;

  const groups = useMemo(() => {
    if (!person) return null;
    const theirs = new Set<string>();
    for (const badge of data.badges) {
      if (badge.holders.some((holder) => holder.userId === person.id)) theirs.add(badge.id);
    }
    const onlyThem: BadgeGalleryBadge[] = [];
    const both: BadgeGalleryBadge[] = [];
    const onlyYou: BadgeGalleryBadge[] = [];
    for (const badge of [...data.badges].sort(byRarity)) {
      if (badge.privateHolders) continue;
      const mine = badge.earnedByViewer;
      const them = theirs.has(badge.id);
      if (isSelf) {
        if (mine) both.push(badge);
      } else if (mine && them) both.push(badge);
      else if (them) onlyThem.push(badge);
      else if (mine) onlyYou.push(badge);
    }
    return { onlyThem, both, onlyYou };
  }, [data.badges, person, isSelf]);

  const firstName = person?.name.split(" ")[0] ?? "";

  return (
    <Dialog open={Boolean(person)} onOpenChange={onOpenChange}>
      <DialogContent className="wc-fresh max-w-[640px]">
        {person && groups ? (
          <>
            <DialogHeader>
              <DialogTitle>{isSelf ? "Your badges" : `You and ${firstName}`}</DialogTitle>
              <DialogDescription className="sr-only">
                {isSelf ? "Every badge you have earned, rarest first." : "Who has what, rarest first."}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="flex flex-col gap-6">
              {!isSelf && viewer ? (
                <div className="grid grid-cols-2 gap-3">
                  {[viewer, person].map((entry) => (
                    <div key={entry.id} className="flex items-center gap-3 rounded-xl bg-muted/40 px-4 py-3">
                      <UserAvatar name={entry.name} avatarUrl={entry.avatarUrl} size="md" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{entry.id === viewer.id ? "You" : entry.name}</p>
                        <p className="text-2xl font-black tabular-nums leading-tight">{entry.count}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {isSelf ? (
                <CompareGroup title="You have" badges={groups.both} onSelect={onSelectBadge} />
              ) : (
                <>
                  <CompareGroup title={`Only ${firstName} has`} badges={groups.onlyThem} onSelect={onSelectBadge} />
                  <CompareGroup title="You both have" badges={groups.both} onSelect={onSelectBadge} />
                  <CompareGroup title="Only you have" badges={groups.onlyYou} onSelect={onSelectBadge} />
                </>
              )}

              <Button asChild variant="outline" className="h-10 self-start">
                <Link href={`/staff/${person.id}?tab=badges`}>{isSelf ? "Open your profile" : `Open ${firstName}'s profile`}</Link>
              </Button>
            </DialogBody>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CompareGroup({
  title,
  badges,
  onSelect,
}: {
  title: string;
  badges: BadgeGalleryBadge[];
  onSelect: (id: string) => void;
}) {
  return (
    <section aria-label={title}>
      <h3 className="text-sm font-bold">
        {title} <span className="font-normal text-muted-foreground tabular-nums">{badges.length}</span>
      </h3>
      {badges.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-2">
          {badges.map((badge) => (
            <li key={badge.id}>
              <button
                type="button"
                onClick={() => onSelect(badge.id)}
                className="flex min-h-10 items-center gap-2 rounded-full bg-muted/50 py-1 pl-1 pr-3 text-sm font-bold outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                <BadgeMedallion
                  icon={badge.mystery ? Sparkles : badgeIcon(badge.icon)}
                  earned
                  rarity={rarityOf(badge)}
                  className="size-8"
                  iconClassName="size-4"
                />
                {badge.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
