"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ResourceType, Role } from "@/lib/client-enums";
import type { LucideIcon } from "lucide-react";
import {
  BookOpenIcon,
  BriefcaseBusinessIcon,
  Building2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileTextIcon,
  FolderTreeIcon,
  HardDriveIcon,
  LayoutGridIcon,
  ListIcon,
  PhoneIcon,
  PlusIcon,
  VideoIcon,
  WrenchIcon,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import {
  OperationalActiveFilterChips,
  type OperationalActiveFilter,
} from "@/components/OperationalToolbar";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ResourceCommandPalette } from "@/components/resources/ResourceCommandPalette";
import { BrandAssetLibrary } from "@/components/resources/BrandAssetLibrary";
import { ServerPathCopy } from "@/components/resources/ServerPathCopy";
import { DebouncedSearchInput } from "@/components/DebouncedSearchInput";
import { OperationalPartialResultsAlert } from "@/components/OperationalFeedback";
import { useFetch } from "@/hooks/use-fetch";
import { useCurrentUser } from "@/hooks/use-current-user";
import {
  inferResourceTypeFromCategory,
  RESOURCE_TYPE_LABELS,
} from "@/lib/guide-categories";
import { guideFreshness } from "@/lib/guide-freshness";
import type { GuideListItem } from "@/lib/guides";
import { splitFeaturedGuides } from "@/lib/resource-search";
import { cn } from "@/lib/utils";
import {
  parseResourceFilter,
  parseResourceLayout,
  parseResourceSort,
  type ResourceFilterKey as FilterKey,
  type ResourceLayoutKey as LayoutKey,
  type ResourceSortKey as SortKey,
} from "./filters";
import {
  buildSportAssignmentGroups,
  contactSearchText,
  hasSlackContact,
  LiveContactsDirectory,
  SectionHeader,
  SportAssignmentsDirectory,
  totalAssignedPeople,
  type ContactAreaFilter,
  type ContactHygieneFilter,
  type ContactRoleFilter,
  type ContactUsersResponse,
} from "./_components/ReferenceDirectories";

type ScopeOption = {
  value: FilterKey;
  label: string;
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "personalized", label: "Recommended" },
  { value: "recent", label: "Recently updated" },
  { value: "title", label: "Title A-Z" },
];

const RESOURCE_TYPE_FILTERS: { key: FilterKey; type: ResourceType; icon: LucideIcon }[] = [
  { key: "how-to", type: ResourceType.HOW_TO, icon: BookOpenIcon },
  { key: "sop", type: ResourceType.SOP, icon: ClipboardListIcon },
  { key: "troubleshooting", type: ResourceType.TROUBLESHOOTING, icon: WrenchIcon },
  { key: "media-drive", type: ResourceType.MEDIA_DRIVE, icon: HardDriveIcon },
  { key: "server-paths", type: ResourceType.SERVER_PATHS, icon: FolderTreeIcon },
  { key: "event-ops", type: ResourceType.EVENT_OPS, icon: VideoIcon },
  { key: "building-numbers", type: ResourceType.BUILDING_NUMBERS, icon: Building2Icon },
  { key: "contacts", type: ResourceType.CONTACTS, icon: PhoneIcon },
  { key: "account-note", type: ResourceType.ACCOUNT_NOTE, icon: BriefcaseBusinessIcon },
  { key: "general", type: ResourceType.GENERAL, icon: FileTextIcon },
];

const AREA_FILTERS: (ScopeOption & { area: string })[] = [
  { value: "area-video", label: "Video", area: "VIDEO" },
  { value: "area-photo", label: "Photo", area: "PHOTO" },
  { value: "area-graphics", label: "Graphics", area: "GRAPHICS" },
  { value: "area-social", label: "Social", area: "SOCIAL" },
  { value: "area-comms", label: "Comms", area: "COMMS" },
  { value: "area-live-production", label: "Live Production", area: "LIVE_PRODUCTION" },
];

const SMART_FILTERS: ScopeOption[] = [
  { value: "all", label: "All guides" },
  { value: "recent", label: "Recently updated" },
  { value: "my-area", label: "My area" },
];

const REFERENCE_FILTERS: ScopeOption[] = [
  { value: "assignments", label: "Sport assignments" },
];

const SCOPE_OPTIONS: ScopeOption[] = [
  ...SMART_FILTERS,
  ...REFERENCE_FILTERS,
  ...RESOURCE_TYPE_FILTERS.map((item) => ({
    value: item.key,
    label: RESOURCE_TYPE_LABELS[item.type],
  })),
  ...AREA_FILTERS,
];

const MEDIA_DRIVE_PATH = "smb://ath01-nas.uwia.wisc.edu/users/";
const FOR_YOU_COUNT = 3;
const RECENT_COUNT = 6;

function resourceTypeOf(guide: GuideListItem) {
  return guide.type ?? inferResourceTypeFromCategory(guide.category);
}

function guideSearchText(guide: GuideListItem) {
  return [
    guide.title,
    guide.category,
    RESOURCE_TYPE_LABELS[resourceTypeOf(guide)],
    guide.author.name,
    guide.summary,
    guide.searchText,
  ].join(" ").toLowerCase();
}

function typeForFilter(filter: FilterKey) {
  return RESOURCE_TYPE_FILTERS.find((item) => item.key === filter)?.type ?? null;
}

function areaForFilter(filter: FilterKey) {
  return AREA_FILTERS.find((item) => item.value === filter)?.area ?? null;
}

function matchesFilter(guide: GuideListItem, filter: FilterKey): boolean {
  if (filter === "all" || filter === "recent") return true;
  if (filter === "assignments") return false;
  if (filter === "my-area") {
    return guide.targetAreas.length > 0 && guide.personalizationReason !== "General";
  }
  const area = areaForFilter(filter);
  if (area) return (guide.targetAreas as string[]).includes(area);
  const type = typeForFilter(filter);
  if (type) return resourceTypeOf(guide) === type;
  return true;
}

function getFilterLabel(filter: FilterKey) {
  return SCOPE_OPTIONS.find((option) => option.value === filter)?.label ?? "Filtered";
}

function byMostRecent(a: GuideListItem, b: GuideListItem) {
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

/**
 * The library's lead row: admin-featured guides first, then guides ranked for
 * the reader's area or role. With neither, the newest guides stand in so the
 * row still says where to start.
 */
function selectForYou(featured: GuideListItem[], library: GuideListItem[]) {
  const personal = library.filter((guide) => guide.personalizationReason !== "General");
  const picks = [...featured, ...personal].slice(0, FOR_YOU_COUNT);
  if (picks.length > 0) {
    const reasons = [...new Set(personal.slice(0, FOR_YOU_COUNT).map((guide) => guide.personalizationReason))];
    return { title: "For you", reason: reasons.join(", ").replace(/For /g, "") || null, guides: picks };
  }
  return { title: "Start here", reason: null, guides: [...library].sort(byMostRecent).slice(0, FOR_YOU_COUNT) };
}

function ResourceTypeIcon({ type, className }: { type: ResourceType; className?: string }) {
  const Icon = RESOURCE_TYPE_FILTERS.find((item) => item.type === type)?.icon ?? FileTextIcon;
  return <Icon className={cn("size-4", className)} aria-hidden="true" />;
}

function FreshnessLabel({ guide, className }: { guide: GuideListItem; className?: string }) {
  const freshness = guideFreshness(guide);
  return (
    <span className={cn("resource-freshness", freshness.stale && "resource-freshness-stale", className)}>
      {freshness.label}
    </span>
  );
}

function TypePill({ type, published }: { type: ResourceType; published: boolean }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="resource-pill">{RESOURCE_TYPE_LABELS[type]}</span>
      {!published && <span className="resource-pill resource-pill-draft">Draft</span>}
    </span>
  );
}

function ResourcesSkeleton() {
  return (
    <div className="flex flex-col gap-10">
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-44 rounded-[14px]" />
        ))}
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-[14px]" />
    </div>
  );
}

function GuideCard({ guide }: { guide: GuideListItem }) {
  const type = resourceTypeOf(guide);

  return (
    <Link
      href={`/resources/${guide.slug}`}
      className="resource-card group no-underline hover:no-underline transition-[background-color,border-color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
    >
      <TypePill type={type} published={guide.published} />
      <h3 className="resource-card-title line-clamp-3">{guide.title}</h3>
      {guide.summary ? (
        <p className="resource-card-summary line-clamp-2">{guide.summary}</p>
      ) : null}
      <span className="resource-card-meta">
        <FreshnessLabel guide={guide} />
        <ChevronRightIcon
          className="size-4 shrink-0 text-muted-foreground/55 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-foreground"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}

function GuideRow({ guide, showType = true }: { guide: GuideListItem; showType?: boolean }) {
  const type = resourceTypeOf(guide);

  return (
    <Link
      href={`/resources/${guide.slug}`}
      className="resource-row group no-underline hover:no-underline transition-[background-color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
    >
      <span className="min-w-0">
        <span className="resource-row-title line-clamp-2">
          {guide.title}
          {!guide.published && <span className="resource-pill resource-pill-draft ml-2 align-middle">Draft</span>}
        </span>
        {guide.summary ? (
          <span className="resource-row-summary line-clamp-1">{guide.summary}</span>
        ) : null}
      </span>
      {showType ? (
        <span className="resource-row-type">{RESOURCE_TYPE_LABELS[type]}</span>
      ) : (
        <span className="sr-only">{RESOURCE_TYPE_LABELS[type]}</span>
      )}
      <FreshnessLabel guide={guide} className="resource-row-fresh" />
    </Link>
  );
}

function GuideResults({
  guides,
  layout,
  showType = true,
}: {
  guides: GuideListItem[];
  layout: LayoutKey;
  showType?: boolean;
}) {
  if (layout === "list") {
    return (
      <div className="resource-list">
        {guides.map((guide) => (
          <GuideRow key={guide.id} guide={guide} showType={showType} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {guides.map((guide) => (
        <GuideCard key={guide.id} guide={guide} />
      ))}
    </div>
  );
}

function HomeSection({
  id,
  title,
  aside,
  children,
}: {
  id: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3.5" aria-labelledby={id}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="resource-kicker">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function TopicList({
  guides,
  onPick,
}: {
  guides: GuideListItem[];
  onPick: (key: FilterKey) => void;
}) {
  const counts = new Map<ResourceType, number>();
  for (const guide of guides) {
    const type = resourceTypeOf(guide);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  const topics = RESOURCE_TYPE_FILTERS.filter((item) => (counts.get(item.type) ?? 0) > 0);
  if (topics.length === 0) return null;

  return (
    <div className="resource-topics">
      {topics.map((item) => {
        const count = counts.get(item.type) ?? 0;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onPick(item.key)}
            className="resource-topic group transition-[background-color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
          >
            <span className="resource-topic-icon">
              <ResourceTypeIcon type={item.type} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="resource-topic-name">{RESOURCE_TYPE_LABELS[item.type]}</span>
              <span className="resource-topic-count">
                {count} {count === 1 ? "guide" : "guides"}
              </span>
            </span>
            <ChevronRightIcon
              className="size-4 shrink-0 text-muted-foreground/55 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-foreground"
              aria-hidden="true"
            />
          </button>
        );
      })}
    </div>
  );
}

function QuickTools({
  loading,
  contactCount,
  sportCount,
  assignedPeople,
  onShowContacts,
  onShowAssignments,
}: {
  loading: boolean;
  contactCount: number;
  sportCount: number;
  assignedPeople: number;
  onShowContacts: () => void;
  onShowAssignments: () => void;
}) {
  return (
    <div className="resource-tools">
      <ServerPathCopy path={MEDIA_DRIVE_PATH} label="Media Drive path" />
      {loading ? (
        <>
          <Skeleton className="h-[3.75rem] w-full rounded-xl" />
          <Skeleton className="h-[3.75rem] w-full rounded-xl" />
        </>
      ) : (
        <>
          {contactCount > 0 && (
            <button
              type="button"
              onClick={onShowContacts}
              className="resource-tool group transition-[background-color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
            >
              <span className="min-w-0 flex-1">
                <span className="resource-tool-name">Contacts</span>
                <span className="resource-tool-detail">{contactCount} people on the team</span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          )}
          {sportCount > 0 && (
            <button
              type="button"
              onClick={onShowAssignments}
              className="resource-tool group transition-[background-color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
            >
              <span className="min-w-0 flex-1">
                <span className="resource-tool-name">Sport assignments</span>
                <span className="resource-tool-detail">
                  {sportCount} {sportCount === 1 ? "sport" : "sports"}, {assignedPeople} {assignedPeople === 1 ? "person" : "people"}
                </span>
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ResourceSectionSwitcher({ active }: { active: "guides" | "brand-assets" }) {
  return (
    <nav className="resource-segmented" aria-label="Resource section">
      <Link
        href="/resources"
        aria-current={active === "guides" ? "page" : undefined}
        className="resource-segment transition-[background-color,color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
      >
        Guides
      </Link>
      <Link
        href="/resources?tab=brand-assets"
        aria-current={active === "brand-assets" ? "page" : undefined}
        className="resource-segment transition-[background-color,color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
      >
        Brand assets
      </Link>
    </nav>
  );
}

export default function ResourcesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.get("q") ?? "";
  const activeCategory = searchParams.get("category") ?? "All";
  const activeFilter = parseResourceFilter(searchParams);
  const sort = parseResourceSort(searchParams.get("sort"));
  const layout = parseResourceLayout(searchParams.get("layout"));
  const { data: currentUser } = useCurrentUser();
  // Collaborators only ever get the brand library; guides and contacts stay internal.
  const isCollaborator = currentUser?.role === "COLLABORATOR";
  const resourceTab = isCollaborator || searchParams.get("tab") === "brand-assets" ? "brand-assets" : "guides";
  const isStaffOrAdmin = currentUser?.role === Role.STAFF || currentUser?.role === Role.ADMIN;
  const [contactRoleFilter, setContactRoleFilter] = useState<ContactRoleFilter>("ALL");
  const [contactAreaFilter, setContactAreaFilter] = useState<ContactAreaFilter>("ALL");
  const [contactHygieneFilter, setContactHygieneFilter] = useState<ContactHygieneFilter>("ALL");

  const replaceParams = (mutate: (params: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams.toString());
    mutate(next);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const setSearchParam = (value: string) => {
    replaceParams((params) => {
      const trimmed = value.trimStart();
      if (trimmed) params.set("q", trimmed);
      else params.delete("q");
    });
  };

  const setFilter = (key: FilterKey) => {
    replaceParams((params) => {
      params.delete("category");
      params.delete("view");
      params.delete("area");
      if (key === "all") params.delete("filter");
      else params.set("filter", key);
    });
  };

  const setSort = (value: SortKey) => {
    replaceParams((params) => {
      if (value === "personalized") params.delete("sort");
      else params.set("sort", value);
    });
  };

  const setLayout = (value: LayoutKey) => {
    replaceParams((params) => {
      if (value === "cards") params.delete("layout");
      else params.set("layout", value);
    });
  };

  // Wait for the role before fetching so a collaborator never requests guides;
  // a failed /api/me resolves to null and still lets the library load.
  const guidesEnabled = resourceTab === "guides" && currentUser !== undefined;

  const { data: guides, loading: guidesLoading, error: guidesError, reload: reloadGuides } = useFetch<GuideListItem[]>({
    url: "/api/resources",
    enabled: guidesEnabled,
    transform: (json) => (json as { data: GuideListItem[] }).data ?? [],
  });

  const { data: contactUsers, loading: contactsLoading, error: contactsError, reload: reloadContacts } = useFetch<ContactUsersResponse>({
    url: "/api/users?limit=200&sort=name",
    enabled: guidesEnabled,
    refetchOnFocus: true,
    transform: (json) => json as unknown as ContactUsersResponse,
  });

  const filtered = useMemo(() => {
    if (!guides) return [];
    const query = search.trim().toLowerCase();
    const base = guides.filter((guide) => {
      const matchesSearch = !query || guideSearchText(guide).includes(query);
      const matchesCategory = activeCategory === "All" || guide.category === activeCategory;
      return matchesSearch && matchesCategory && matchesFilter(guide, activeFilter);
    });
    if (sort === "recent" || activeFilter === "recent") {
      return [...base].sort(byMostRecent);
    }
    if (sort === "title") {
      return [...base].sort((a, b) => a.title.localeCompare(b.title));
    }
    return base;
  }, [guides, search, activeCategory, activeFilter, sort]);

  // Admin-curated featured guides lead the home row when present; with none,
  // the row falls back to guides ranked for the reader's area and role.
  const { featured: featuredGuides, library: libraryGuides } = useMemo(
    () => splitFeaturedGuides(filtered),
    [filtered],
  );
  const forYou = useMemo(() => selectForYou(featuredGuides, libraryGuides), [featuredGuides, libraryGuides]);
  const recentlyUpdated = useMemo(() => [...filtered].sort(byMostRecent).slice(0, RECENT_COUNT), [filtered]);

  const filteredContactUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    const users = contactUsers?.data ?? [];
    return users.filter((user) => {
      const matchesSearch = !query || contactSearchText(user).includes(query);
      const matchesRole = contactRoleFilter === "ALL" || user.role === contactRoleFilter;
      const matchesArea =
        contactAreaFilter === "ALL" ||
        (contactAreaFilter === "UNASSIGNED" ? !user.primaryArea : user.primaryArea === contactAreaFilter);
      const matchesHygiene =
        contactHygieneFilter === "ALL" ||
        (contactHygieneFilter === "MISSING_PHONE" && !user.phone) ||
        (contactHygieneFilter === "MISSING_SLACK" && !hasSlackContact(user));
      return matchesSearch && matchesRole && matchesArea && matchesHygiene;
    });
  }, [contactUsers, search, contactRoleFilter, contactAreaFilter, contactHygieneFilter]);

  const contactStats = useMemo(() => {
    const users = contactUsers?.data ?? [];
    return {
      visible: filteredContactUsers.length,
      total: users.length,
      missingPhone: users.filter((user) => !user.phone).length,
      missingSlack: users.filter((user) => !hasSlackContact(user)).length,
    };
  }, [contactUsers, filteredContactUsers.length]);

  const sportAssignmentGroups = useMemo(
    () => buildSportAssignmentGroups(filteredContactUsers),
    [filteredContactUsers],
  );

  const activeFilters: OperationalActiveFilter[] = [
    ...(activeFilter !== "all"
      ? [{
          key: "filter",
          label: getFilterLabel(activeFilter),
          onRemove: () => setFilter("all"),
        }]
      : []),
    ...(activeCategory !== "All"
      ? [{
          key: "category",
          label: activeCategory,
          onRemove: () => {
            replaceParams((params) => params.delete("category"));
          },
        }]
      : []),
    ...(search
      ? [{
          key: "search",
          label: `"${search}"`,
          onRemove: () => setSearchParam(""),
        }]
      : []),
    ...(sort !== "personalized"
      ? [{
          key: "sort",
          label: SORT_OPTIONS.find((option) => option.value === sort)?.label ?? "Custom sort",
          onRemove: () => setSort("personalized"),
        }]
      : []),
  ];

  const clearAll = () => {
    router.replace(pathname, { scroll: false });
    setContactRoleFilter("ALL");
    setContactAreaFilter("ALL");
    setContactHygieneFilter("ALL");
  };

  const hasAnyFilter =
    Boolean(search) || activeCategory !== "All" || activeFilter !== "all" || sort !== "personalized";
  const homeView = !hasAnyFilter;
  const assignmentsView = activeFilter === "assignments";
  const totalGuides = guides?.length ?? 0;
  const contactDirectoryVisible =
    activeFilter === "contacts" ||
    (Boolean(search.trim()) && !assignmentsView && filteredContactUsers.length > 0);
  const contactDirectoryCompact = activeFilter !== "contacts" && !search.trim();
  const resultsTitle = search.trim() && activeFilter === "all" ? `Results for "${search.trim()}"` : getFilterLabel(activeFilter);

  const contactsDirectory = contactDirectoryVisible && (
    <LiveContactsDirectory
      users={filteredContactUsers}
      loading={contactsLoading}
      total={contactUsers?.total ?? 0}
      search={search}
      roleFilter={contactRoleFilter}
      areaFilter={contactAreaFilter}
      hygieneFilter={contactHygieneFilter}
      onRoleFilterChange={setContactRoleFilter}
      onAreaFilterChange={setContactAreaFilter}
      onHygieneFilterChange={setContactHygieneFilter}
      stats={contactStats}
      canSeeContactHygiene={isStaffOrAdmin}
      compact={contactDirectoryCompact}
      onShowAll={() => setFilter("contacts")}
    />
  );

  return (
    <div className="resource-page mx-auto flex w-full max-w-[1200px] flex-col gap-8 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <PageHeader
        title="Resources"
        description={resourceTab === "brand-assets"
          ? "Logos, fonts and brand files, always the current version."
          : "Everything we know about how Creative works, in one place."}
        className="mb-0 sm:items-end"
      >
        {!isCollaborator && <ResourceSectionSwitcher active={resourceTab} />}
      </PageHeader>

      {resourceTab === "brand-assets" ? (
        <BrandAssetLibrary canManage={isStaffOrAdmin} />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5">
              <DebouncedSearchInput
                value={search}
                onValueChange={setSearchParam}
                placeholder="Search guides, contacts, paths…"
                aria-label="Filter resources"
                className="resource-search-input"
                containerClassName="min-w-0 flex-1"
              />
              <ResourceCommandPalette
                guides={guides ?? []}
                className="resource-search-side hidden md:inline-flex"
              />
              {isStaffOrAdmin && (
                <Button asChild className="resource-search-side shrink-0">
                  <Link href="/resources/new">
                    <PlusIcon data-icon="inline-start" />
                    <span className="hidden sm:inline">New guide</span>
                    <span className="sr-only sm:hidden">New guide</span>
                  </Link>
                </Button>
              )}
            </div>

            {!homeView && (
              <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <OperationalActiveFilterChips filters={activeFilters} />
                  <Button variant="ghost" size="sm" className="h-10" onClick={clearAll}>
                    Clear all
                  </Button>
                  {!guidesLoading && !assignmentsView && (
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {filtered.length} of {totalGuides} guides
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
                  <Select value={activeFilter} onValueChange={(value) => setFilter(value as FilterKey)}>
                    <SelectTrigger className="h-10 sm:w-[170px]" aria-label="Guide topic">
                      <SelectValue placeholder="All guides" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Smart</SelectLabel>
                        {SMART_FILTERS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>References</SelectLabel>
                        {REFERENCE_FILTERS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Topic</SelectLabel>
                        {RESOURCE_TYPE_FILTERS.map((item) => (
                          <SelectItem key={item.key} value={item.key}>
                            {RESOURCE_TYPE_LABELS[item.type]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                      <SelectGroup>
                        <SelectLabel>Creative area</SelectLabel>
                        {AREA_FILTERS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
                    <SelectTrigger className="h-10 sm:w-[170px]" aria-label="Sort guides">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectLabel>Sort</SelectLabel>
                        {SORT_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  {!assignmentsView && (
                    <ToggleGroup
                      type="single"
                      value={layout}
                      onValueChange={(value) => {
                        if (value) setLayout(value as LayoutKey);
                      }}
                      className="col-span-2 min-h-10 justify-self-start [&_svg]:size-4"
                      aria-label="Guide layout"
                    >
                      <ToggleGroupItem value="cards" aria-label="Cards" className="min-h-10 px-3">
                        <LayoutGridIcon aria-hidden="true" />
                      </ToggleGroupItem>
                      <ToggleGroupItem value="list" aria-label="List" className="min-h-10 px-3">
                        <ListIcon aria-hidden="true" />
                      </ToggleGroupItem>
                    </ToggleGroup>
                  )}
                </div>
              </div>
            )}
          </div>

          {contactsError && !assignmentsView && (
            <OperationalPartialResultsAlert
              failures={["Contacts and sport assignments"]}
              noun="source"
              title="Guide library loaded without references"
              recoveryCopy="Guides remain available. Retry before treating Contacts or assignments as complete."
            />
          )}

          {!guidesLoading && guidesError && !guides ? (
            <EmptyState
              icon="wifi-off"
              title="Could not load guides"
              description="The Resources library is unavailable. Check the connection and try again."
              actionLabel="Retry"
              onAction={reloadGuides}
            />
          ) : guidesLoading || !guides ? (
            <ResourcesSkeleton />
          ) : assignmentsView ? (
            contactsError && !contactUsers ? (
              <EmptyState
                icon="wifi-off"
                title="Could not load sport assignments"
                description="Guide data is still available. Retry the user directory before trusting assignment coverage."
                actionLabel="Retry"
                onAction={reloadContacts}
              />
            ) : (
              <SportAssignmentsDirectory
                groups={sportAssignmentGroups}
                loading={contactsLoading}
                search={search}
              />
            )
          ) : homeView ? (
            totalGuides === 0 ? (
              <EmptyState
                icon="folder"
                title="No guides yet"
                description={isStaffOrAdmin ? "Write the first guide for how something gets done here." : "Guides will show up here as the team writes them."}
                actionLabel={isStaffOrAdmin ? "New guide" : undefined}
                onAction={isStaffOrAdmin ? () => router.push("/resources/new") : undefined}
              />
            ) : (
              <div className="flex flex-col gap-11">
                <HomeSection
                  id="resource-for-you"
                  title={forYou.reason ? `${forYou.title} · ${forYou.reason}` : forYou.title}
                >
                  <div className="grid gap-4 md:grid-cols-3">
                    {forYou.guides.map((guide) => (
                      <GuideCard key={guide.id} guide={guide} />
                    ))}
                  </div>
                </HomeSection>

                <HomeSection id="resource-tools" title="Quick tools">
                  <QuickTools
                    loading={contactsLoading}
                    contactCount={contactStats.total}
                    sportCount={sportAssignmentGroups.length}
                    assignedPeople={totalAssignedPeople(sportAssignmentGroups)}
                    onShowContacts={() => setFilter("contacts")}
                    onShowAssignments={() => setFilter("assignments")}
                  />
                </HomeSection>

                <HomeSection id="resource-topics" title="Browse by topic">
                  <TopicList guides={filtered} onPick={setFilter} />
                </HomeSection>

                <HomeSection
                  id="resource-recent"
                  title="Recently updated"
                  aside={
                    <button
                      type="button"
                      onClick={() => setFilter("recent")}
                      className="resource-see-all transition-[color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
                    >
                      All {totalGuides} guides
                    </button>
                  }
                >
                  <div className="resource-list">
                    {recentlyUpdated.map((guide) => (
                      <GuideRow key={guide.id} guide={guide} />
                    ))}
                  </div>
                </HomeSection>
              </div>
            )
          ) : filtered.length === 0 ? (
            <>
              {contactsDirectory}
              <EmptyState
                icon="search"
                title="No guides match this view"
                description="Try a different word, topic, Creative area, or sort."
                actionLabel="Clear filters"
                onAction={clearAll}
              />
            </>
          ) : (
            <div className="flex flex-col gap-8">
              {contactsDirectory}
              <section className="flex flex-col gap-3">
                <SectionHeader title={resultsTitle} />
                <GuideResults
                  guides={filtered}
                  layout={layout}
                  showType={!typeForFilter(activeFilter)}
                />
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}
