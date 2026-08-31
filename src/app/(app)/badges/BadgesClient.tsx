"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Award, BarChart3, Info, RefreshCw, UsersRound } from "lucide-react";
import { FadeUp } from "@/components/ui/motion";
import { PageHeader } from "@/components/PageHeader";
import UserFilters from "../users/UserFilters";
import BulkBadgeAwardDialog from "../users/BulkBadgeAwardDialog";
import type { Location } from "../users/types";
import { AREA_LABELS, ROLE_OPTIONS, STUDENT_YEAR_OPTIONS } from "../users/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { useUrlState } from "@/hooks/use-url-state";
import { badgeIcon } from "@/components/badges/badge-artwork";
import { formatBadgeCategoryLabel } from "@/lib/badges/display";
import { MAX_BULK_BADGE_TARGETS } from "@/lib/request-limits";
import { SPORT_CODES, sportLabel } from "@/lib/sports";
import type { UserDirectoryFilters } from "@/lib/user-directory-query";
import { cn } from "@/lib/utils";

type BadgeDefinition = {
  id: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  kind: string;
  trigger: string;
  threshold: number | null;
};

type BadgeCatalogResponse = {
  definitions: BadgeDefinition[];
  disabled: boolean;
};

type DirectoryResponse = {
  stats?: {
    total: number;
    active: number;
    inactive: number;
  };
};

const ROLE_VALUES = new Set(ROLE_OPTIONS.map((option) => option.value));
const YEAR_VALUES = new Set(STUDENT_YEAR_OPTIONS.map((option) => option.value));
const AREA_VALUES = new Set(Object.keys(AREA_LABELS));
const SPORT_VALUES = new Set(SPORT_CODES.map((sport) => sport.code));

function parseStringParam(raw: string | null) {
  return raw?.trim() ?? "";
}

function parseChoiceParam(raw: string | null, values: Set<string>) {
  return raw && values.has(raw) ? raw : "";
}

function parseHiddenParam(raw: string | null) {
  return raw === "1" || raw === "true";
}

function serializeOptionalString(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function serializeBoolean(value: boolean) {
  return value ? "1" : null;
}

function ignoreInactiveFilter() {
  // Badge groups are always resolved against active users.
}

function countLabel(count: number) {
  return `${count.toLocaleString()} active ${count === 1 ? "user" : "users"}`;
}

export default function BadgesClient({
  isAdmin,
  badgesAvailable,
  canShowHiddenUsers,
}: {
  isAdmin: boolean;
  badgesAvailable: boolean;
  canShowHiddenUsers: boolean;
}) {
  const [search, setSearch] = useUrlState("q", parseStringParam, serializeOptionalString);
  const [roleFilter, setRoleFilter] = useUrlState(
    "role",
    (raw) => parseChoiceParam(raw, ROLE_VALUES),
    serializeOptionalString,
  );
  const [locationFilter, setLocationFilter] = useUrlState("locationId", parseStringParam, serializeOptionalString);
  const [yearFilter, setYearFilter] = useUrlState(
    "year",
    (raw) => parseChoiceParam(raw, YEAR_VALUES),
    serializeOptionalString,
  );
  const [sportFilter, setSportFilter] = useUrlState(
    "sport",
    (raw) => parseChoiceParam(raw, SPORT_VALUES),
    serializeOptionalString,
  );
  const [areaFilter, setAreaFilter] = useUrlState(
    "area",
    (raw) => parseChoiceParam(raw, AREA_VALUES),
    serializeOptionalString,
  );
  const [showHiddenUsers, setShowHiddenUsers] = useUrlState(
    "includeHidden",
    parseHiddenParam,
    serializeBoolean,
  );
  const [showAwardDialog, setShowAwardDialog] = useState(false);

  const {
    data: catalog,
    loading: catalogLoading,
    refreshing: catalogRefreshing,
    error: catalogError,
    reload: reloadCatalog,
  } = useFetch<BadgeCatalogResponse>({
    url: "/api/badges?manualOnly=true",
    returnTo: "/badges",
    refetchOnFocus: false,
    transform: (json) => ({
      definitions: Array.isArray(json.data) ? json.data as BadgeDefinition[] : [],
      disabled: json.disabled === true,
    }),
  });

  const {
    data: formOptions,
    loading: formOptionsLoading,
    error: formOptionsError,
    reload: reloadFormOptions,
  } = useFetch<{ locations: Location[] }>({
    url: "/api/form-options",
    returnTo: "/badges",
    refetchOnFocus: false,
    transform: (json) => (json as Record<string, unknown>).data as { locations: Location[] },
  });
  const formOptionLocations = formOptions?.locations;
  const locations = useMemo(() => formOptionLocations ?? [], [formOptionLocations]);

  const audienceUrl = useMemo(() => {
    const params = new URLSearchParams({ limit: "1", active: "all" });
    const query = search.trim();
    if (query) params.set("q", query);
    if (roleFilter) params.set("role", roleFilter);
    if (locationFilter) params.set("locationId", locationFilter);
    if (yearFilter) params.set("year", yearFilter);
    if (sportFilter) params.set("sport", sportFilter);
    if (areaFilter) params.set("area", areaFilter);
    if (canShowHiddenUsers && showHiddenUsers) params.set("includeHidden", "1");
    return `/api/users?${params}`;
  }, [areaFilter, canShowHiddenUsers, locationFilter, roleFilter, search, showHiddenUsers, sportFilter, yearFilter]);

  const {
    data: audience,
    loading: audienceLoading,
    refreshing: audienceRefreshing,
    error: audienceError,
    reload: reloadAudience,
  } = useFetch<DirectoryResponse>({
    url: audienceUrl,
    returnTo: "/badges",
    keepPreviousData: true,
  });

  const targetCount = audience?.stats?.active ?? 0;
  const targetCountOverLimit = targetCount > MAX_BULK_BADGE_TARGETS;
  const awardDisabled = !isAdmin || !badgesAvailable || audienceLoading || Boolean(audienceError) || targetCount <= 0 || targetCountOverLimit;

  const filters = useMemo<UserDirectoryFilters>(() => ({
    q: search.trim() || undefined,
    role: roleFilter || undefined,
    locationId: locationFilter || undefined,
    year: yearFilter || undefined,
    sport: sportFilter || undefined,
    area: areaFilter || undefined,
    includeHidden: canShowHiddenUsers && showHiddenUsers ? true : undefined,
  }), [areaFilter, canShowHiddenUsers, locationFilter, roleFilter, search, showHiddenUsers, sportFilter, yearFilter]);

  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (roleFilter) parts.push(`role: ${ROLE_OPTIONS.find((option) => option.value === roleFilter)?.label ?? roleFilter}`);
    if (locationFilter) parts.push(`location: ${locations.find((location) => location.id === locationFilter)?.name ?? locationFilter}`);
    if (yearFilter) parts.push(`year: ${STUDENT_YEAR_OPTIONS.find((option) => option.value === yearFilter)?.label ?? yearFilter}`);
    if (sportFilter) parts.push(`sport: ${sportLabel(sportFilter)}`);
    if (areaFilter) parts.push(`area: ${AREA_LABELS[areaFilter] ?? areaFilter}`);
    if (search.trim()) parts.push(`search: “${search.trim()}”`);
    if (canShowHiddenUsers && showHiddenUsers) parts.push("hidden included");
    return parts.length > 0 ? parts.join(" · ") : "all active users";
  }, [areaFilter, canShowHiddenUsers, locationFilter, locations, roleFilter, search, showHiddenUsers, sportFilter, yearFilter]);

  function clearFilters() {
    setSearch("");
    setRoleFilter("");
    setLocationFilter("");
    setYearFilter("");
    setSportFilter("");
    setAreaFilter("");
    setShowHiddenUsers(false);
  }

  function reloadAudienceAndCatalog() {
    reloadAudience();
    reloadCatalog();
  }

  const definitions = catalog?.definitions ?? [];
  const featureDisabled = !badgesAvailable || catalog?.disabled === true;

  return (
    <FadeUp>
      <div className="flex flex-col gap-5">
        <PageHeader
          title="Badges"
          description="Recognize a group of people with one consistent, auditable award."
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button asChild variant="outline" size="sm" className="h-10">
              <Link href="/reports/badges">
                <BarChart3 data-icon="inline-start" />
                View report
              </Link>
            </Button>
            {isAdmin && (
              <Button size="sm" className="h-10" onClick={() => setShowAwardDialog(true)} disabled={awardDisabled}>
                <Award data-icon="inline-start" />
                Award a badge
              </Button>
            )}
          </div>
        </PageHeader>

        {featureDisabled && (
          <Alert>
            <Info className="size-4" />
            <AlertDescription>Badges are currently disabled. Badge awards will be unavailable until the feature is enabled.</AlertDescription>
          </Alert>
        )}

        {!isAdmin && !featureDisabled && (
          <Alert>
            <Info className="size-4" />
            <AlertDescription>Badge awards are restricted to administrators. You can still review the catalog and audience counts here.</AlertDescription>
          </Alert>
        )}

        <Card className="border-border/40 shadow-none">
          <CardHeader className="gap-1 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Choose the group</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Filters are URL-owned, so the audience can be reviewed or shared before awarding.</p>
              </div>
              <Badge variant={targetCountOverLimit ? "orange" : "secondary"}>
                {targetCountOverLimit ? `Over ${MAX_BULK_BADGE_TARGETS}` : countLabel(targetCount)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <UserFilters
              search={search}
              onSearchChange={setSearch}
              roleFilter={roleFilter}
              onRoleChange={setRoleFilter}
              locationFilter={locationFilter}
              onLocationChange={setLocationFilter}
              locations={locations}
              locationsLoading={formOptionsLoading}
              locationsError={Boolean(formOptionsError)}
              yearFilter={yearFilter}
              onYearChange={setYearFilter}
              sportFilter={sportFilter}
              onSportChange={setSportFilter}
              areaFilter={areaFilter}
              onAreaChange={setAreaFilter}
              showInactive={false}
              onShowInactiveChange={ignoreInactiveFilter}
              showInactiveFilter={false}
              canShowHiddenUsers={canShowHiddenUsers}
              showHiddenUsers={showHiddenUsers}
              onShowHiddenUsersChange={setShowHiddenUsers}
              onClearAll={clearFilters}
              searching={audienceRefreshing}
            />

            {formOptionsError && (
              <Alert variant="destructive">
                <Info className="size-4" />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>Locations could not load. Location filtering is unavailable until locations are readable.</span>
                  <Button type="button" variant="outline" size="sm" className="h-10" onClick={reloadFormOptions}>
                    Retry locations
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 px-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className={cn(
                  "flex size-10 shrink-0 items-center justify-center rounded-md",
                  targetCountOverLimit ? "bg-[var(--orange-bg)] text-[var(--orange-text)]" : "bg-[var(--blue-bg)] text-[var(--blue-text)]",
                )}>
                  <UsersRound className="size-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{audienceLoading ? "Counting audience…" : countLabel(targetCount)}</p>
                  <p className="truncate text-sm text-muted-foreground">{filterSummary}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="rounded-full border border-border/60 px-2 py-1">Active only</span>
                <span className="rounded-full border border-border/60 px-2 py-1">Max {MAX_BULK_BADGE_TARGETS}</span>
              </div>
            </div>

            {targetCountOverLimit && (
              <Alert>
                <Info className="size-4" />
                <AlertDescription>Narrow the filters before awarding. A single group award can include at most {MAX_BULK_BADGE_TARGETS} active users.</AlertDescription>
              </Alert>
            )}
            {audienceError && (
              <Alert variant="destructive">
                <Info className="size-4" />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>Could not count the matching audience.</span>
                  <Button type="button" variant="outline" size="sm" className="h-10" onClick={reloadAudience}>
                    Retry audience
                  </Button>
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Manual badge catalog</h2>
              <p className="mt-1 text-sm text-muted-foreground">These active badges are available for administrator-led recognition.</p>
            </div>
            <Button type="button" variant="ghost" size="sm" className="h-10" onClick={reloadAudienceAndCatalog} disabled={catalogRefreshing || audienceRefreshing}>
              <RefreshCw data-icon="inline-start" className={cn((catalogRefreshing || audienceRefreshing) && "animate-spin")} />
              Refresh
            </Button>
          </div>

          {catalogError ? (
            <Alert variant="destructive">
              <Info className="size-4" />
              <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                <span>Could not load the manual badge catalog.</span>
                <Button type="button" variant="outline" size="sm" className="h-10" onClick={reloadCatalog}>Retry catalog</Button>
              </AlertDescription>
            </Alert>
          ) : catalogLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, index) => (
                <Card key={index} className="border-border/40 shadow-none">
                  <CardContent className="flex gap-3 p-4">
                    <Skeleton className="size-10 shrink-0 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : definitions.length === 0 ? (
            <Card className="border-border/40 shadow-none">
              <CardContent className="flex min-h-24 items-center gap-3 text-sm text-muted-foreground">
                <Award className="size-5" />
                No active manual badges are available. Administrators can create one from the award dialog.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {definitions.map((definition) => (
                <BadgeCatalogCard key={definition.id} definition={definition} />
              ))}
            </div>
          )}
        </section>

        <BulkBadgeAwardDialog
          open={showAwardDialog}
          onOpenChange={setShowAwardDialog}
          targetCount={targetCount}
          filterSummary={filterSummary}
          filters={filters}
        />
      </div>
    </FadeUp>
  );
}

function BadgeCatalogCard({ definition }: { definition: BadgeDefinition }) {
  const Icon = badgeIcon(definition.icon);

  return (
    <Card className="border-border/40 shadow-none">
      <CardContent className="flex gap-3 p-4">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--purple-bg)] text-[var(--purple-text)]">
          <Icon className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{definition.name}</h3>
            <Badge variant="outline" size="sm">{formatBadgeCategoryLabel(definition.category)}</Badge>
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">{definition.description}</p>
        </div>
      </CardContent>
    </Card>
  );
}
