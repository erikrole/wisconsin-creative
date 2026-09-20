"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ResourceType, Role, ShiftArea } from "@prisma/client";
import type { LucideIcon } from "lucide-react";
import {
  BookOpenIcon,
  BriefcaseBusinessIcon,
  Building2Icon,
  ChevronRightIcon,
  ClipboardListIcon,
  FileTextIcon,
  FolderTreeIcon,
  FolderOpenIcon,
  HardDriveIcon,
  LayoutGridIcon,
  ListIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  PlusIcon,
  SlackIcon,
  UsersIcon,
  VideoIcon,
  WrenchIcon,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import {
  OperationalActiveFilterChips,
  OperationalToolbar,
  type OperationalActiveFilter,
} from "@/components/OperationalToolbar";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  inferResourceTypeFromCategory,
  RESOURCE_TYPE_LABELS,
} from "@/lib/guide-categories";
import type { GuideListItem } from "@/lib/guides";
import { splitFeaturedGuides } from "@/lib/resource-search";
import { sportLabel } from "@/lib/sports";
import { cn } from "@/lib/utils";
import {
  parseResourceFilter,
  parseResourceLayout,
  parseResourceSort,
  type ResourceFilterKey as FilterKey,
  type ResourceLayoutKey as LayoutKey,
  type ResourceSortKey as SortKey,
} from "./filters";

type MeResponse = { id: string; role: Role };
type ContactUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  slackHandle: string | null;
  slackProfileUrl: string | null;
  primaryArea: ShiftArea | null;
  location: string | null;
  avatarUrl: string | null;
  active?: boolean;
  title: string | null;
  gradYear: number | null;
  studentYearOverride: "FRESHMAN" | "SOPHOMORE" | "JUNIOR" | "SENIOR" | "GRAD" | null;
  sportAssignments: {
    sportCode: string;
    defaultTraveler: boolean;
  }[];
};

type ContactUsersResponse = {
  data: ContactUser[];
  total: number;
};

type ContactRoleFilter = "ALL" | Role;
type ContactAreaFilter = "ALL" | ShiftArea | "UNASSIGNED";
type ContactHygieneFilter = "ALL" | "MISSING_PHONE" | "MISSING_SLACK";

type ScopeOption = {
  value: FilterKey;
  label: string;
  description?: string;
};

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "personalized", label: "Recommended" },
  { value: "recent", label: "Recently updated" },
  { value: "title", label: "Title A-Z" },
];

const CONTACT_ROLE_FILTERS: { value: ContactRoleFilter; label: string }[] = [
  { value: "ALL", label: "All roles" },
  { value: Role.STAFF, label: "Staff" },
  { value: Role.STUDENT, label: "Students" },
  { value: Role.ADMIN, label: "Admins" },
];

const CONTACT_AREA_FILTERS: { value: ContactAreaFilter; label: string }[] = [
  { value: "ALL", label: "All areas" },
  { value: ShiftArea.VIDEO, label: "Video" },
  { value: ShiftArea.PHOTO, label: "Photo" },
  { value: ShiftArea.GRAPHICS, label: "Graphics" },
  { value: ShiftArea.SOCIAL, label: "Social" },
  { value: ShiftArea.COMMS, label: "Comms" },
  { value: ShiftArea.LIVE_PRODUCTION, label: "Live Production" },
  { value: "UNASSIGNED", label: "No area" },
];

const CONTACT_HYGIENE_FILTERS: { value: ContactHygieneFilter; label: string }[] = [
  { value: "ALL", label: "All contacts" },
  { value: "MISSING_PHONE", label: "Missing phone" },
  { value: "MISSING_SLACK", label: "Missing Slack" },
];

const RESOURCE_TYPE_FILTERS: { key: FilterKey; type: ResourceType; icon: LucideIcon }[] = [
  { key: "contacts", type: ResourceType.CONTACTS, icon: PhoneIcon },
  { key: "building-numbers", type: ResourceType.BUILDING_NUMBERS, icon: Building2Icon },
  { key: "media-drive", type: ResourceType.MEDIA_DRIVE, icon: HardDriveIcon },
  { key: "server-paths", type: ResourceType.SERVER_PATHS, icon: FolderTreeIcon },
  { key: "sop", type: ResourceType.SOP, icon: ClipboardListIcon },
  { key: "how-to", type: ResourceType.HOW_TO, icon: BookOpenIcon },
  { key: "troubleshooting", type: ResourceType.TROUBLESHOOTING, icon: WrenchIcon },
  { key: "account-note", type: ResourceType.ACCOUNT_NOTE, icon: BriefcaseBusinessIcon },
  { key: "event-ops", type: ResourceType.EVENT_OPS, icon: VideoIcon },
  { key: "general", type: ResourceType.GENERAL, icon: FileTextIcon },
];

const AREA_FILTERS: (ScopeOption & { area: ShiftArea })[] = [
  { value: "area-video", label: "Video", area: ShiftArea.VIDEO },
  { value: "area-photo", label: "Photo", area: ShiftArea.PHOTO },
  { value: "area-graphics", label: "Graphics", area: ShiftArea.GRAPHICS },
  { value: "area-social", label: "Social", area: ShiftArea.SOCIAL },
  { value: "area-comms", label: "Comms", area: ShiftArea.COMMS },
  { value: "area-live-production", label: "Live Production", area: ShiftArea.LIVE_PRODUCTION },
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

function contactSearchText(user: ContactUser) {
  return [
    user.name,
    user.email,
    user.phone,
    user.slackHandle,
    user.slackProfileUrl,
    user.title,
    user.role,
    user.primaryArea,
    user.location,
    ...(user.sportAssignments ?? []).flatMap((assignment) => [
      assignment.sportCode,
      sportLabel(assignment.sportCode),
      assignment.defaultTraveler ? "default traveler" : null,
    ]),
    user.gradYear ? String(user.gradYear) : null,
    user.studentYearOverride,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatArea(area: ShiftArea | null) {
  if (!area) return null;
  const labels: Record<ShiftArea, string> = {
    VIDEO: "Video",
    PHOTO: "Photo",
    GRAPHICS: "Graphics",
    SOCIAL: "Social",
    COMMS: "Comms",
    LIVE_PRODUCTION: "Live Production",
  };
  return labels[area];
}

function formatRole(role: Role) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function formatStudentYear(user: ContactUser) {
  if (user.studentYearOverride) {
    return user.studentYearOverride.charAt(0) + user.studentYearOverride.slice(1).toLowerCase();
  }
  if (!user.gradYear) return null;
  return `Class of ${user.gradYear}`;
}

function contactSubtitle(user: ContactUser) {
  return user.role === Role.STUDENT ? formatStudentYear(user) : user.title;
}

function displaySlackHandle(value: string | null) {
  if (!value) return null;
  const normalized = value.trim().replace(/^@+/, "");
  return normalized ? `@${normalized}` : null;
}

function hasSlackContact(user: ContactUser) {
  return Boolean(displaySlackHandle(user.slackHandle) || user.slackProfileUrl);
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
  if (area) return guide.targetAreas.includes(area);
  const type = typeForFilter(filter);
  if (type) return resourceTypeOf(guide) === type;
  return true;
}

function getFilterLabel(filter: FilterKey) {
  return SCOPE_OPTIONS.find((option) => option.value === filter)?.label ?? "Filtered";
}

const LIBRARY_TYPE_ORDER: ResourceType[] = [
  ResourceType.HOW_TO,
  ResourceType.SOP,
  ResourceType.TROUBLESHOOTING,
  ResourceType.MEDIA_DRIVE,
  ResourceType.SERVER_PATHS,
  ResourceType.EVENT_OPS,
  ResourceType.BUILDING_NUMBERS,
  ResourceType.CONTACTS,
  ResourceType.ACCOUNT_NOTE,
  ResourceType.GENERAL,
];

function groupGuidesByType(guides: GuideListItem[]) {
  const groups = new Map<ResourceType, GuideListItem[]>();
  for (const guide of guides) {
    const type = resourceTypeOf(guide);
    const list = groups.get(type) ?? [];
    list.push(guide);
    groups.set(type, list);
  }
  return LIBRARY_TYPE_ORDER.flatMap((type) => {
    const items = groups.get(type);
    if (!items?.length) return [];
    return [{ type, label: RESOURCE_TYPE_LABELS[type], guides: items }];
  });
}

function ResourceTypeIcon({ type, className }: { type: ResourceType; className?: string }) {
  const Icon = RESOURCE_TYPE_FILTERS.find((item) => item.type === type)?.icon ?? FileTextIcon;
  return <Icon className={cn("size-4", className)} aria-hidden="true" />;
}

function ResourceMark({ type }: { type: ResourceType }) {
  return (
    <span className="resource-mark">
      <ResourceTypeIcon type={type} />
    </span>
  );
}

function ResourcesSkeleton({ layout }: { layout: LayoutKey }) {
  if (layout === "list") {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-40 w-full rounded-lg" />
        <div className="overflow-hidden rounded-lg border border-border/80">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full rounded-none" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-40 w-full rounded-lg" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-40 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

function GuideMeta({
  type,
  published,
}: {
  type: ResourceType;
  published: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Badge variant="secondary" size="sm">
        {RESOURCE_TYPE_LABELS[type]}
      </Badge>
      {!published && (
        <Badge variant="outline" size="sm">
          Draft
        </Badge>
      )}
    </div>
  );
}

function GuideCard({ guide, showType = true }: { guide: GuideListItem; showType?: boolean }) {
  const type = resourceTypeOf(guide);

  return (
    <Link
      href={`/resources/${guide.slug}`}
      className="resource-tile group no-underline hover:no-underline transition-[background-color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
    >
      <div className="flex items-start justify-between gap-3">
        <ResourceMark type={type} />
        <ChevronRightIcon
          className="mt-1 size-4 shrink-0 text-muted-foreground/55 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-foreground group-focus-visible:text-foreground"
          aria-hidden="true"
        />
      </div>
      {showType ? (
        <GuideMeta type={type} published={guide.published} />
      ) : !guide.published ? (
        <Badge variant="outline" size="sm">
          Draft
        </Badge>
      ) : (
        <span className="sr-only">{RESOURCE_TYPE_LABELS[type]}</span>
      )}
      <h3 className="resource-tile-title line-clamp-3">{guide.title}</h3>
      {guide.summary ? (
        <p className="resource-tile-summary line-clamp-1">{guide.summary}</p>
      ) : null}
    </Link>
  );
}

function GuideListRow({ guide, showType = true }: { guide: GuideListItem; showType?: boolean }) {
  const type = resourceTypeOf(guide);

  return (
    <Link
      href={`/resources/${guide.slug}`}
      className="resource-index-row group no-underline hover:no-underline transition-[background-color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
    >
      <ResourceMark type={type} />
      <div className="min-w-0">
        <h3 className="resource-index-title line-clamp-1">{guide.title}</h3>
        {guide.summary ? (
          <p className="resource-index-summary line-clamp-1">{guide.summary}</p>
        ) : null}
        {showType ? (
          <div className="mt-1">
            <GuideMeta type={type} published={guide.published} />
          </div>
        ) : !guide.published ? (
          <Badge variant="outline" size="sm" className="mt-1">
            Draft
          </Badge>
        ) : (
          <span className="sr-only">{RESOURCE_TYPE_LABELS[type]}</span>
        )}
      </div>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground/55 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-foreground group-focus-visible:text-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

function FeaturedLead({ guide }: { guide: GuideListItem }) {
  const type = resourceTypeOf(guide);

  return (
    <Link
      href={`/resources/${guide.slug}`}
      className="resource-featured group no-underline hover:no-underline transition-[background-color,scale] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.96]"
    >
      <div className="flex items-start justify-between gap-3">
        <ResourceMark type={type} />
        <Badge variant="secondary" size="sm">
          Featured
        </Badge>
      </div>
      <GuideMeta type={type} published={guide.published} />
      <h2 className="resource-featured-title">{guide.title}</h2>
      {guide.summary ? (
        <p className="resource-featured-summary line-clamp-1">{guide.summary}</p>
      ) : null}
      <span className="resource-featured-go">
        Open guide
        <ChevronRightIcon
          className="size-4 transition-[color,transform] group-hover:translate-x-0.5 group-hover:text-foreground"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}

function SectionHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground text-pretty">{description}</p>
        )}
      </div>
      {action}
    </div>
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
      <div className="resource-index">
        {guides.map((guide) => (
          <GuideListRow key={guide.id} guide={guide} showType={showType} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {guides.map((guide) => (
        <GuideCard key={guide.id} guide={guide} showType={showType} />
      ))}
    </div>
  );
}

function TypeGroupedGuides({
  guides,
  layout,
}: {
  guides: GuideListItem[];
  layout: LayoutKey;
}) {
  const groups = groupGuidesByType(guides);

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <section key={group.type} className="resource-index-group" aria-labelledby={`guide-type-${group.type}`}>
          <div className="resource-index-heading">
            <h2 id={`guide-type-${group.type}`} className="resource-kicker">
              {group.label}
            </h2>
            <span className="resource-index-count">{group.guides.length}</span>
          </div>
          <GuideResults guides={group.guides} layout={layout} showType={false} />
        </section>
      ))}
    </div>
  );
}

type SportAssignmentGroup = {
  sportCode: string;
  label: string;
  users: ContactUser[];
  defaultTravelers: ContactUser[];
};

function buildSportAssignmentGroups(users: ContactUser[]): SportAssignmentGroup[] {
  const bySport = new Map<string, { users: ContactUser[]; defaultTravelers: ContactUser[] }>();

  for (const user of users) {
    for (const assignment of user.sportAssignments ?? []) {
      const group = bySport.get(assignment.sportCode) ?? { users: [], defaultTravelers: [] };
      group.users.push(user);
      if (assignment.defaultTraveler) group.defaultTravelers.push(user);
      bySport.set(assignment.sportCode, group);
    }
  }

  return [...bySport.entries()]
    .map(([sportCode, group]) => ({
      sportCode,
      label: sportLabel(sportCode),
      users: group.users.sort((a, b) => a.name.localeCompare(b.name)),
      defaultTravelers: group.defaultTravelers.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function totalAssignedPeople(groups: SportAssignmentGroup[]) {
  return new Set(groups.flatMap((group) => group.users.map((user) => user.id))).size;
}

function ResourceSectionSwitcher({ active }: { active: "guides" | "brand-assets" }) {
  return (
    <div className="inline-flex items-center rounded-md border border-border/80 p-0.5" aria-label="Resource section">
      <Button asChild variant={active === "guides" ? "secondary" : "ghost"} size="sm" className="h-10 rounded-sm">
        <Link href="/resources" aria-current={active === "guides" ? "page" : undefined}>
          <FileTextIcon data-icon="inline-start" />
          Guides
        </Link>
      </Button>
      <Button asChild variant={active === "brand-assets" ? "secondary" : "ghost"} size="sm" className="h-10 rounded-sm">
        <Link href="/resources?tab=brand-assets" aria-current={active === "brand-assets" ? "page" : undefined}>
          <FolderOpenIcon data-icon="inline-start" />
          Brand assets
        </Link>
      </Button>
    </div>
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
  const resourceTab = searchParams.get("tab") === "brand-assets" ? "brand-assets" : "guides";
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

  const { data: guides, loading: guidesLoading, error: guidesError, reload: reloadGuides } = useFetch<GuideListItem[]>({
    url: "/api/resources",
    enabled: resourceTab === "guides",
    transform: (json) => (json as { data: GuideListItem[] }).data ?? [],
  });

  const { data: meData } = useFetch<MeResponse>({
    url: "/api/me",
    transform: (json) => (json as { user: MeResponse }).user,
  });

  const isStaffOrAdmin = meData?.role === Role.STAFF || meData?.role === Role.ADMIN;

  const { data: contactUsers, loading: contactsLoading, error: contactsError, reload: reloadContacts } = useFetch<ContactUsersResponse>({
    url: "/api/users?limit=200&sort=name",
    enabled: resourceTab === "guides",
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
      return [...base].sort((a, b) => (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      ));
    }
    if (sort === "title") {
      return [...base].sort((a, b) => a.title.localeCompare(b.title));
    }
    return base;
  }, [guides, search, activeCategory, activeFilter, sort]);

  // Admin-curated featured guides lead the home hub when present; the block stays
  // hidden entirely when nothing is featured, so a clean library is unaffected.
  const { featured: featuredGuides, library: libraryGuides } = useMemo(
    () => splitFeaturedGuides(filtered),
    [filtered],
  );
  const featuredLead = featuredGuides[0];

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

  return (
    <div className={cn("flex flex-col p-6", resourceTab === "brand-assets" ? "gap-4" : "gap-6")}>
      <PageHeader
        title="Resources"
        className="mb-2"
      >
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <ResourceSectionSwitcher active={resourceTab} />
          {resourceTab === "guides" && isStaffOrAdmin && (
            <Button asChild size="sm" className="h-10">
              <Link href="/resources/new">
                <PlusIcon data-icon="inline-start" />
                New guide
              </Link>
            </Button>
          )}
        </div>
      </PageHeader>

      {resourceTab === "brand-assets" ? (
        <BrandAssetLibrary canManage={isStaffOrAdmin} />
      ) : (
        <>
      <OperationalToolbar aria-label="Guide search and filters">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <DebouncedSearchInput
              value={search}
              onValueChange={setSearchParam}
              placeholder="Search guides, contacts, and assignments…"
              aria-label="Filter resources"
              containerClassName="min-w-0 flex-1"
            />
            <ResourceCommandPalette
              guides={guides ?? []}
              className="h-10 w-10 shrink-0 justify-center px-0 sm:w-auto sm:px-2.5"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:shrink-0">
            <Select value={activeFilter} onValueChange={(value) => setFilter(value as FilterKey)}>
              <SelectTrigger className="h-10 lg:w-[180px]" aria-label="Guide focus">
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
                  <SelectLabel>Guide focus</SelectLabel>
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
              <SelectTrigger className="h-10 lg:w-[170px]" aria-label="Sort guides">
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

            <ToggleGroup
              type="single"
              value={layout}
              onValueChange={(value) => {
                if (value) setLayout(value as LayoutKey);
              }}
              className="min-h-10 justify-self-start [&_svg]:size-4"
              aria-label="Guide layout"
            >
              <ToggleGroupItem value="cards" aria-label="Cards" className="min-h-10 px-3">
                <LayoutGridIcon aria-hidden="true" />
                <span className="hidden sm:inline">Cards</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List" className="min-h-10 px-3">
                <ListIcon aria-hidden="true" />
                <span className="hidden sm:inline">List</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>

        {homeView && (
          <nav className="resource-jump" aria-label="Jump to">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="resource-jump-chip h-10 border border-border/70 px-3"
              onClick={() => setFilter("how-to")}
            >
              How-to
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="resource-jump-chip h-10 border border-border/70 px-3"
              onClick={() => setFilter("media-drive")}
            >
              Media Drive
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="resource-jump-chip h-10 border border-border/70 px-3"
              onClick={() => setFilter("contacts")}
            >
              Contacts
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="resource-jump-chip h-10 border border-border/70 px-3"
              onClick={() => setFilter("assignments")}
            >
              Assignments
            </Button>
          </nav>
        )}

        {(activeFilters.length > 0 || hasAnyFilter) && (
          <div className="flex flex-wrap items-center gap-2">
            <OperationalActiveFilterChips filters={activeFilters} />
            {hasAnyFilter && (
              <Button variant="ghost" size="sm" className="h-10" onClick={clearAll}>
                Clear all
              </Button>
            )}
            {!guidesLoading && !assignmentsView && (
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {filtered.length} of {totalGuides} guides
              </span>
            )}
          </div>
        )}
      </OperationalToolbar>

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
      ) : guidesLoading ? (
        <ResourcesSkeleton layout={layout} />
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
      ) : filtered.length === 0 && !homeView ? (
        <>
          {contactDirectoryVisible && (
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
          )}
          <EmptyState
            icon="search"
            title="No guides match this view"
            description="Try a different keyword, focus area, Creative area, or sort."
            actionLabel="Clear filters"
            onAction={clearAll}
          />
        </>
      ) : homeView ? (
        <div className="flex flex-col gap-10">
          {featuredLead ? (
            <section aria-label="Featured guides">
              <FeaturedLead guide={featuredLead} />
              {featuredGuides.length > 1 && (
                <GuideResults guides={featuredGuides.slice(1)} layout="list" />
              )}
            </section>
          ) : null}

          <section className="flex flex-col gap-3" aria-label="Guide library">
            {filtered.length === 0 ? (
              <EmptyState
                inline
                icon="folder"
                title="No guides yet"
                description="Create focused guides as each area is ready."
              />
            ) : libraryGuides.length > 0 ? (
              <TypeGroupedGuides guides={libraryGuides} layout={layout} />
            ) : (
              <EmptyState
                inline
                icon="folder"
                title="All guides are featured"
                description="Every guide is highlighted above."
              />
            )}
          </section>

          <ReferenceSummaryStrip
            loading={contactsLoading}
            contactStats={contactStats}
            sportAssignmentGroups={sportAssignmentGroups}
            onShowContacts={() => setFilter("contacts")}
            onShowAssignments={() => setFilter("assignments")}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {contactDirectoryVisible && (
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
          )}
          <section className="flex flex-col gap-3">
            <SectionHeader title={getFilterLabel(activeFilter)} />
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

function ResourceToolLink({
  title,
  count,
  description,
  onClick,
}: {
  title: string;
  count: number;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="resource-tool group transition-[background-color,scale] active:scale-[0.96] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="resource-kicker">{title}</span>
          <span className="resource-index-count">{count}</span>
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">{description}</p>
      </div>
      <ChevronRightIcon
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </button>
  );
}

function ReferenceSummaryStrip({
  loading,
  contactStats,
  sportAssignmentGroups,
  onShowContacts,
  onShowAssignments,
}: {
  loading: boolean;
  contactStats: { total: number };
  sportAssignmentGroups: SportAssignmentGroup[];
  onShowContacts: () => void;
  onShowAssignments: () => void;
}) {
  const assignedPeople = totalAssignedPeople(sportAssignmentGroups);
  const hasContacts = contactStats.total > 0;
  const hasAssignments = sportAssignmentGroups.length > 0;

  return (
    <section className="flex flex-col gap-4" aria-label="Tools and references">
      <div className="resource-index-heading">
        <h2 className="resource-kicker">Tools</h2>
      </div>
      {loading ? (
        <div className="resource-tools">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <div className="resource-tools">
          <div className="resource-tool resource-tool-copy">
            <ServerPathCopy path="smb://ath01-nas.uwia.wisc.edu/users/" />
          </div>
          {hasContacts && (
            <ResourceToolLink
              title="Contacts"
              count={contactStats.total}
              description="Team directory"
              onClick={onShowContacts}
            />
          )}
          {hasAssignments && (
            <ResourceToolLink
              title="Assignments"
              count={sportAssignmentGroups.length}
              description={`${assignedPeople} ${assignedPeople === 1 ? "person" : "people"}`}
              onClick={onShowAssignments}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SportAssignmentsDirectory({
  groups,
  loading,
  search,
}: {
  groups: SportAssignmentGroup[];
  loading: boolean;
  search: string;
}) {
  if (loading) {
    return (
      <section className="flex flex-col gap-3">
        <SectionHeader
          title="Sport assignments"
          description="Read-only sport coverage sourced from user profile assignments."
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-36 rounded-lg" />
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title="Sport assignments"
        description="Read-only sport coverage sourced from user profile assignments."
      />
      {groups.length === 0 ? (
        <EmptyState
          inline
          icon="users"
          title="No sport assignments match this view"
          description={
            search.trim()
              ? "Try a different search across people, sport codes, or sport names."
              : "No active user profiles have sport assignments yet."
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <Card key={group.sportCode} elevation="flat" className="min-h-36">
              <CardHeader className="gap-2 p-4 pb-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate text-sm">{group.label}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">{group.sportCode}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0 tabular-nums">
                    {group.users.length}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 p-4">
                {group.defaultTravelers.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {group.defaultTravelers.map((user) => (
                      <Badge key={user.id} variant="outline" className="max-w-full">
                        <span className="truncate">{user.name}</span>
                      </Badge>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {group.users.slice(0, 5).map((user) => (
                    <Link
                      key={user.id}
                      href={`/users/${user.id}`}
                      className="flex min-h-10 min-w-0 items-center gap-2 rounded-md px-1 text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <UserAvatar
                        name={user.name}
                        avatarUrl={user.avatarUrl}
                        size="sm"
                        className="shrink-0"
                      />
                      <span className="truncate">{user.name}</span>
                    </Link>
                  ))}
                  {group.users.length > 5 && (
                    <p className="text-xs text-muted-foreground tabular-nums">
                      +{group.users.length - 5} more
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

function LiveContactsDirectory({
  users,
  loading,
  total,
  search,
  roleFilter,
  areaFilter,
  hygieneFilter,
  onRoleFilterChange,
  onAreaFilterChange,
  onHygieneFilterChange,
  stats,
  canSeeContactHygiene,
  compact,
  onShowAll,
}: {
  users: ContactUser[];
  loading: boolean;
  total: number;
  search: string;
  roleFilter: ContactRoleFilter;
  areaFilter: ContactAreaFilter;
  hygieneFilter: ContactHygieneFilter;
  onRoleFilterChange: (value: ContactRoleFilter) => void;
  onAreaFilterChange: (value: ContactAreaFilter) => void;
  onHygieneFilterChange: (value: ContactHygieneFilter) => void;
  stats: {
    visible: number;
    total: number;
    missingPhone: number;
    missingSlack: number;
  };
  canSeeContactHygiene: boolean;
  compact: boolean;
  onShowAll: () => void;
}) {
  const shownUsers = compact ? users.slice(0, 6) : users;
  const hasContactFilters = roleFilter !== "ALL" || areaFilter !== "ALL" || hygieneFilter !== "ALL";

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <UsersIcon className="size-4 text-muted-foreground" aria-hidden="true" />
            Team contacts
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground text-pretty">
            Profile-backed contacts support the Guide library without duplicating phone and Slack details in Markdown.
          </p>
        </div>
        {!loading && (
          <div className="flex flex-wrap items-center gap-2">
            {canSeeContactHygiene && stats.missingPhone > 0 && (
              <Badge variant="outline" className="tabular-nums">
                {stats.missingPhone} missing phone
              </Badge>
            )}
            {canSeeContactHygiene && stats.missingSlack > 0 && (
              <Badge variant="outline" className="tabular-nums">
                {stats.missingSlack} missing Slack
              </Badge>
            )}
            <Badge variant="secondary" className="tabular-nums">
              {compact ? Math.min(users.length, 6) : stats.visible}/{total} shown
            </Badge>
          </div>
        )}
      </div>

      {!compact && !loading && (
        <ContactDirectoryFilters
          roleFilter={roleFilter}
          areaFilter={areaFilter}
          hygieneFilter={hygieneFilter}
          onRoleFilterChange={onRoleFilterChange}
          onAreaFilterChange={onAreaFilterChange}
          onHygieneFilterChange={onHygieneFilterChange}
          canSeeContactHygiene={canSeeContactHygiene}
        />
      )}

      {loading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: compact ? 3 : 6 }).map((_, index) => (
            <Skeleton key={index} className="h-32 rounded-lg" />
          ))}
        </div>
      ) : shownUsers.length === 0 ? (
        <EmptyState
          inline
          icon="users"
          title="No contacts match this view"
          description={
            search.trim() || hasContactFilters
              ? "Try a different contact search or filter."
              : "No active users are available for the live contact directory."
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shownUsers.map((user) => (
            <ContactCard key={user.id} user={user} />
          ))}
        </div>
      )}

      {compact && users.length > 6 && (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" className="h-10" onClick={onShowAll}>
            Show all contacts
          </Button>
        </div>
      )}
    </section>
  );
}

function ContactDirectoryFilters({
  roleFilter,
  areaFilter,
  hygieneFilter,
  onRoleFilterChange,
  onAreaFilterChange,
  onHygieneFilterChange,
  canSeeContactHygiene,
}: {
  roleFilter: ContactRoleFilter;
  areaFilter: ContactAreaFilter;
  hygieneFilter: ContactHygieneFilter;
  onRoleFilterChange: (value: ContactRoleFilter) => void;
  onAreaFilterChange: (value: ContactAreaFilter) => void;
  onHygieneFilterChange: (value: ContactHygieneFilter) => void;
  canSeeContactHygiene: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-md bg-muted/30 p-3 md:grid-cols-2 xl:grid-cols-3">
      <ContactSelect
        label="Role"
        value={roleFilter}
        options={CONTACT_ROLE_FILTERS}
        onChange={onRoleFilterChange}
      />
      <ContactSelect
        label="Area"
        value={areaFilter}
        options={CONTACT_AREA_FILTERS}
        onChange={onAreaFilterChange}
      />
      {canSeeContactHygiene && (
        <ContactSelect
          label="Cleanup"
          value={hygieneFilter}
          options={CONTACT_HYGIENE_FILTERS}
          onChange={onHygieneFilterChange}
        />
      )}
    </div>
  );
}

function ContactSelect<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: TValue;
  options: { value: TValue; label: string }[];
  onChange: (value: TValue) => void;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <Select value={value} onValueChange={(next) => onChange(next as TValue)}>
        <SelectTrigger className="h-10 bg-background text-foreground" aria-label={`${label} contact filter`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>{label}</SelectLabel>
            {options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}

function ContactCard({ user }: { user: ContactUser }) {
  const subtitle = contactSubtitle(user);
  const area = formatArea(user.primaryArea);
  const slackHandle = displaySlackHandle(user.slackHandle);

  return (
    <Card elevation="flat" className="min-h-32 border-border/80">
      <CardHeader className="p-4 pb-0">
        <div className="flex items-start gap-3">
          <UserAvatar
            name={user.name}
            avatarUrl={user.avatarUrl}
            size="lg"
            className="shrink-0 ring-1 ring-border"
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <CardTitle className="truncate text-sm leading-tight">{user.name}</CardTitle>
                {subtitle && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
                )}
              </div>
              <Badge variant="secondary" size="sm" className="shrink-0">
                {formatRole(user.role)}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="grid flex-1 content-start gap-2 p-4 text-xs text-muted-foreground">
        <ContactLine icon={MailIcon} label={user.email} href={`mailto:${user.email}`} />
        <ContactLine
          icon={PhoneIcon}
          label={user.phone || "No phone on profile"}
          href={user.phone ? `tel:${user.phone.replace(/[^\d+]/g, "")}` : undefined}
        />
        <ContactLine
          icon={SlackIcon}
          label={slackHandle || (user.slackProfileUrl ? "Slack profile" : "No Slack on profile")}
          href={user.slackProfileUrl ?? undefined}
        />
        <div className="flex min-w-0 flex-wrap gap-2">
          {area && (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
              <BriefcaseBusinessIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{area}</span>
            </span>
          )}
          {user.location && (
            <span className="inline-flex min-w-0 items-center gap-1 rounded-md bg-muted px-2 py-1">
              <MapPinIcon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{user.location}</span>
            </span>
          )}
        </div>
      </CardContent>

      <CardFooter className="px-4 pb-4 pt-0">
        <Button asChild variant="outline" size="sm" className="h-10 w-full justify-center">
          <Link href={`/users/${user.id}`}>View profile</Link>
        </Button>
      </CardFooter>
    </Card>
  );
}

function ContactLine({
  icon: Icon,
  label,
  href,
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
}) {
  const content = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label}</span>
    </>
  );

  if (!href) {
    return <div className="flex min-h-6 min-w-0 items-center gap-2">{content}</div>;
  }

  return (
    <a
      href={href}
      className="flex min-h-10 min-w-0 items-center gap-2 rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {content}
    </a>
  );
}
