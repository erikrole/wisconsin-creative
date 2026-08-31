"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import EmptyState from "@/components/EmptyState";
import type { Location, Role, SortKey, ListResponse } from "./types";
import { AREA_LABELS, ROLE_OPTIONS, STUDENT_YEAR_OPTIONS } from "./types";
import { UserTableRow, UserMobileCard } from "./UserRow";
import UserFilters from "./UserFilters";
import BulkBadgeAwardDialog from "./BulkBadgeAwardDialog";
import OnboardingDialog from "@/components/onboarding/OnboardingDialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Award, ClipboardList, Download, ImageOff, MoreHorizontal, Network, UserPlus, UserRoundX, WifiOff } from "lucide-react";
import { useFetch } from "@/hooks/use-fetch";
import { PageHeader } from "@/components/PageHeader";
import { FadeUp } from "@/components/ui/motion";
import { useUrlState } from "@/hooks/use-url-state";
import { SPORT_CODES } from "@/lib/sports";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OperationalMetricCard } from "@/components/OperationalFeedback";
import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail";

const LIMIT = 50;
const ROLE_VALUES = new Set<string>(["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"]);
const SORT_VALUES = new Set([
  "",
  "name",
  "name_desc",
  "role",
  "role_desc",
  "email",
  "email_desc",
  "created",
  "created_desc",
  "lastActive",
  "lastActive_desc",
]);
const YEAR_VALUES = new Set<string>(STUDENT_YEAR_OPTIONS.map((option) => option.value));
const AREA_VALUES = new Set(Object.keys(AREA_LABELS));
const SPORT_VALUES = new Set<string>(SPORT_CODES.map((sport) => sport.code));

function parseStringParam(raw: string | null): string {
  return raw?.trim() ?? "";
}

function serializeOptionalString(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseRoleParam(raw: string | null): string {
  return raw && ROLE_VALUES.has(raw) ? raw : "";
}

function parseYearParam(raw: string | null): string {
  return raw && YEAR_VALUES.has(raw) ? raw : "";
}

function parseAreaParam(raw: string | null): string {
  return raw && AREA_VALUES.has(raw) ? raw : "";
}

function parseSportParam(raw: string | null): string {
  return raw && SPORT_VALUES.has(raw) ? raw : "";
}

function parseSortParam(raw: string | null): SortKey | string {
  return raw && SORT_VALUES.has(raw) ? raw : "name";
}

function serializeSortParam(value: SortKey | string): string | null {
  return value && value !== "name" ? value : null;
}

function parseInactiveParam(raw: string | null): boolean {
  return raw === "all";
}

function serializeInactiveParam(value: boolean): string | null {
  return value ? "all" : null;
}

function parseHiddenParam(raw: string | null): boolean {
  return raw === "1" || raw === "true";
}

function serializeHiddenParam(value: boolean): string | null {
  return value ? "1" : null;
}

function parsePageParam(raw: string | null): number {
  const page = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(page) && page > 0 ? page : 0;
}

function serializePageParam(value: number): string | null {
  return value > 0 ? String(value) : null;
}

function parseOnboardParam(raw: string | null): boolean {
  return raw === "1" || raw === "true";
}

function serializeOnboardParam(value: boolean): string | null {
  return value ? "1" : null;
}

/* ── Sort Header ───────────────────────────────────────── */

function SortableHead({
  label,
  sortKey,
  currentSort,
  onSort,
  className,
}: {
  label: string;
  sortKey: string;
  currentSort: string;
  onSort: (s: string) => void;
  className?: string;
}) {
  const isAsc = currentSort === sortKey;
  const isDesc = currentSort === `${sortKey}_desc`;
  const isActive = isAsc || isDesc;

  function handleClick() {
    if (!isActive) onSort(sortKey);
    else if (isAsc) onSort(`${sortKey}_desc`);
    else onSort("");
  }

  return (
    <TableHead className={className} aria-sort={isAsc ? "ascending" : isDesc ? "descending" : "none"}>
      <Button
        variant="ghost"
        size="sm"
        className="group -ml-3 h-10 transition-[background-color,color,box-shadow,scale] active:scale-[0.96]"
        onClick={handleClick}
        aria-label={`Sort by ${label}${isAsc ? " descending" : isDesc ? " clear sorting" : " ascending"}`}
      >
        {label}
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={isAsc ? "ascending" : isDesc ? "descending" : "unsorted"}
            initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
            transition={{ type: "spring", duration: 0.3, bounce: 0 }}
            className="ml-1 inline-flex items-center justify-center"
          >
            {isAsc ? (
              <ArrowUp className="size-4 text-foreground" aria-hidden="true" />
            ) : isDesc ? (
              <ArrowDown className="size-4 text-foreground" aria-hidden="true" />
            ) : (
              <ArrowUpDown className="size-3.5 opacity-20 transition-opacity group-hover:opacity-50 group-focus-visible:opacity-50" aria-hidden="true" />
            )}
          </motion.span>
        </AnimatePresence>
      </Button>
    </TableHead>
  );
}

function RosterSummary({
  stats,
  canEdit,
  onRoleChange,
  onShowInactive,
}: {
  stats: NonNullable<ListResponse["stats"]>;
  canEdit: boolean;
  onRoleChange: (role: string) => void;
  onShowInactive: () => void;
}) {
  const items: OperationalStatusRailItem[] = [
    ...(stats.inactive > 0 ? [{ id: "inactive", label: "Inactive", value: stats.inactive, detail: "People excluded from the active roster.", icon: UserRoundX, tone: "warning" as const, onSelect: onShowInactive }] : []),
    ...(canEdit && stats.missingPhotos > 0 ? [{ id: "missing-photos", label: "Missing photos", value: stats.missingPhotos, detail: "Profiles without a roster photo.", icon: ImageOff, tone: "info" as const }] : []),
  ];
  return (
    <OperationalStatusRail
      orientation={{ label: "Active roster", value: String(stats.active), icon: UserPlus }}
      items={items}
      allClearLabel={items.length === 0 ? "Roster profiles are complete" : undefined}
      detailsLabel="Roster breakdown"
      details={(
        <div className="grid gap-2 sm:grid-cols-5">
          <OperationalMetricCard label="All matching" value={stats.total} />
          <OperationalMetricCard label="Students" value={stats.byRole.STUDENT} onClick={() => onRoleChange("STUDENT")} />
          <OperationalMetricCard label="Staff" value={stats.byRole.STAFF} onClick={() => onRoleChange("STAFF")} />
          <OperationalMetricCard label="Admins" value={stats.byRole.ADMIN} onClick={() => onRoleChange("ADMIN")} />
          <OperationalMetricCard label="Collaborators" value={stats.byRole.COLLABORATOR} onClick={() => onRoleChange("COLLABORATOR")} />
        </div>
      )}
    />
  );
}

/* ── Page Component ────────────────────────────────────── */

export default function UsersPage() {
  // Filters & sort
  const [search, setSearch] = useUrlState<string>(
    "q",
    parseStringParam,
    serializeOptionalString,
  );
  const [roleFilter, setRoleFilter] = useUrlState<string>(
    "role",
    parseRoleParam,
    serializeOptionalString,
  );
  const [locationFilter, setLocationFilter] = useUrlState<string>(
    "locationId",
    parseStringParam,
    serializeOptionalString,
  );
  const [yearFilter, setYearFilter] = useUrlState<string>(
    "year",
    parseYearParam,
    serializeOptionalString,
  );
  const [sportFilter, setSportFilter] = useUrlState<string>(
    "sport",
    parseSportParam,
    serializeOptionalString,
  );
  const [areaFilter, setAreaFilter] = useUrlState<string>(
    "area",
    parseAreaParam,
    serializeOptionalString,
  );
  const [sort, setSort] = useUrlState<SortKey | string>(
    "sort",
    parseSortParam,
    serializeSortParam,
  );
  const [showInactive, setShowInactive] = useUrlState<boolean>(
    "active",
    parseInactiveParam,
    serializeInactiveParam,
  );
  const [showHiddenUsers, setShowHiddenUsers] = useUrlState<boolean>(
    "includeHidden",
    parseHiddenParam,
    serializeHiddenParam,
  );
  const [page, setPage] = useUrlState<number>(
    "page",
    parsePageParam,
    serializePageParam,
  );
  const [onboardRequested, setOnboardRequested] = useUrlState<boolean>(
    "onboard",
    parseOnboardParam,
    serializeOnboardParam,
  );

  // UI
  const [showCreate, setShowCreate] = useState(false);
  const [showBulkAward, setShowBulkAward] = useState(false);
  const didMountRef = useRef(false);

  useEffect(() => {
    if (onboardRequested) setShowCreate(true);
  }, [onboardRequested]);

  // Reset page when filters change
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    setPage(0);
  }, [search, roleFilter, locationFilter, yearFilter, sportFilter, areaFilter, sort, showInactive, showHiddenUsers, setPage]);

  // Auth
  const { data: meData } = useFetch<{ user: { id: string; role: Role }; canViewHiddenUsers: boolean }>({
    url: "/api/me",
    transform: (json) => json as { user: { id: string; role: Role }; canViewHiddenUsers: boolean },
    refetchOnFocus: false,
  });
  const currentUserRole = meData?.user.role ?? null;
  const isCollaboratorDirectory = currentUserRole === "COLLABORATOR";
  const canEdit = currentUserRole === "ADMIN" || currentUserRole === "STAFF";
  const canShowHiddenUsers = meData?.canViewHiddenUsers === true;

  useEffect(() => {
    if (meData && !canShowHiddenUsers && showHiddenUsers) {
      setShowHiddenUsers(false);
    }
  }, [canShowHiddenUsers, meData, setShowHiddenUsers, showHiddenUsers]);

  // ── Build URL for user list fetch ──
  const usersUrl = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", String(LIMIT));
    params.set("offset", String(page * LIMIT));
    const query = search.trim();
    if (query) params.set("q", query);
    if (sort) params.set("sort", sort);
    if (roleFilter) params.set("role", roleFilter);
    if (locationFilter) params.set("locationId", locationFilter);
    if (yearFilter) params.set("year", yearFilter);
    if (sportFilter) params.set("sport", sportFilter);
    if (areaFilter) params.set("area", areaFilter);
    if (showInactive) params.set("active", "all");
    if (canShowHiddenUsers && showHiddenUsers) params.set("includeHidden", "1");
    return `/api/users?${params}`;
  }, [page, search, sort, roleFilter, locationFilter, yearFilter, sportFilter, areaFilter, showInactive, canShowHiddenUsers, showHiddenUsers]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams();
    const query = search.trim();
    if (query) params.set("q", query);
    if (roleFilter) params.set("role", roleFilter);
    if (locationFilter) params.set("locationId", locationFilter);
    if (yearFilter) params.set("year", yearFilter);
    if (sportFilter) params.set("sport", sportFilter);
    if (areaFilter) params.set("area", areaFilter);
    if (showInactive) params.set("active", "all");
    if (canShowHiddenUsers && showHiddenUsers) params.set("includeHidden", "1");
    const qs = params.toString();
    return qs ? `/api/users/export?${qs}` : "/api/users/export";
  }, [search, roleFilter, locationFilter, yearFilter, sportFilter, areaFilter, showInactive, canShowHiddenUsers, showHiddenUsers]);

  const {
    data: listData,
    loading,
    refreshing,
    error: loadError,
    reload,
  } = useFetch<ListResponse>({
    url: usersUrl,
    transform: (json) => json as unknown as ListResponse,
    keepPreviousData: true,
    refetchOnMount: "always",
  });

  const users = listData?.data ?? [];
  const total = listData?.total ?? 0;
  const stats = listData?.stats;

  // Form options
  const {
    data: formOptions,
    loading: formOptionsLoading,
    error: formOptionsError,
    reload: reloadFormOptions,
  } = useFetch<{ locations: Location[] }>({
    url: "/api/form-options",
    enabled: currentUserRole !== null && !isCollaboratorDirectory,
    transform: (json) => (json as Record<string, unknown>).data as { locations: Location[] },
    refetchOnFocus: false,
  });
  const formOptionLocations = formOptions?.locations;
  const locations = useMemo(() => formOptionLocations ?? [], [formOptionLocations]);

  const bulkAwardFilters = useMemo(() => ({
    q: search.trim() || undefined,
    role: roleFilter || undefined,
    locationId: locationFilter || undefined,
    year: yearFilter || undefined,
    sport: sportFilter || undefined,
    area: areaFilter || undefined,
    includeHidden: canShowHiddenUsers && showHiddenUsers ? true : undefined,
  }), [areaFilter, canShowHiddenUsers, locationFilter, roleFilter, search, showHiddenUsers, sportFilter, yearFilter]);

  const bulkAwardTargetCount = stats?.active ?? (showInactive ? 0 : total);
  const bulkAwardFilterSummary = useMemo(() => {
    const parts: string[] = [];
    if (roleFilter) parts.push(`role: ${ROLE_OPTIONS.find((option) => option.value === roleFilter)?.label ?? roleFilter}`);
    if (locationFilter) parts.push(`location: ${locations.find((location) => location.id === locationFilter)?.name ?? locationFilter}`);
    if (yearFilter) parts.push(`year: ${STUDENT_YEAR_OPTIONS.find((option) => option.value === yearFilter)?.label ?? yearFilter}`);
    if (sportFilter) parts.push(`sport: ${sportFilter}`);
    if (areaFilter) parts.push(`area: ${AREA_LABELS[areaFilter] ?? areaFilter}`);
    if (search.trim()) parts.push(`search: “${search.trim()}”`);
    if (canShowHiddenUsers && showHiddenUsers) parts.push("hidden included");
    return parts.length > 0 ? parts.join(" · ") : "all active users";
  }, [areaFilter, canShowHiddenUsers, locationFilter, locations, roleFilter, search, showHiddenUsers, sportFilter, yearFilter]);

  const totalPages = Math.ceil(total / LIMIT);
  const hasFilters = !!search.trim() ||
    !!roleFilter ||
    !!locationFilter ||
    !!yearFilter ||
    !!sportFilter ||
    !!areaFilter ||
    showInactive ||
    (canShowHiddenUsers && showHiddenUsers);
  const isInitialLoad = loading && users.length === 0 && !loadError;

  function clearFilters() {
    setSearch("");
    setRoleFilter("");
    setLocationFilter("");
    setYearFilter("");
    setSportFilter("");
    setAreaFilter("");
    setShowInactive(false);
    setShowHiddenUsers(false);
  }

  useEffect(() => {
    if (loading || page === 0) return;
    if (total === 0 || page >= totalPages) {
      setPage(Math.max(0, totalPages - 1));
    }
  }, [loading, page, setPage, total, totalPages]);

  return (
    <FadeUp>
      {/* Header */}
      <PageHeader title={isCollaboratorDirectory ? "People" : "Users"} className="mb-5">
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,scale]">
                <MoreHorizontal data-icon="inline-start" />
                More
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                {currentUserRole === "ADMIN" && (
                  <DropdownMenuItem onClick={() => setShowBulkAward(true)} disabled={bulkAwardTargetCount <= 0}>
                    <Award />Award badge to matching users
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link href="/users/onboarding-status"><ClipboardList />Onboarding status</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/users/org-chart"><Network />Org chart</Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={exportHref} download><Download />Export current roster</a>
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {canEdit && (
          <Button className="h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,scale]" onClick={() => setShowCreate(true)}>
            <UserPlus data-icon="inline-start" />
            Add users
          </Button>
        )}
      </PageHeader>

      {/* Onboarding Dialog */}
      <OnboardingDialog
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open);
          if (!open && onboardRequested) setOnboardRequested(false);
        }}
        currentUserRole={currentUserRole}
        onInvitesChanged={() => reload()}
      />

      <BulkBadgeAwardDialog
        open={showBulkAward}
        onOpenChange={setShowBulkAward}
        targetCount={bulkAwardTargetCount}
        filterSummary={bulkAwardFilterSummary}
        filters={bulkAwardFilters}
      />

      {/* Users List */}
      <div className="flex flex-col gap-3">
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
          showInactive={showInactive}
          onShowInactiveChange={setShowInactive}
          canShowHiddenUsers={canShowHiddenUsers}
          showHiddenUsers={showHiddenUsers}
          onShowHiddenUsersChange={setShowHiddenUsers}
          searching={refreshing && !loading}
          onClearAll={clearFilters}
          directoryMode={isCollaboratorDirectory}
        />

        {formOptionsError && !isCollaboratorDirectory && (
          <Alert variant="destructive">
            <WifiOff className="size-4" />
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>Locations could not load. User location filters are unavailable until locations are readable.</span>
              <Button type="button" variant="outline" size="sm" onClick={reloadFormOptions} className="h-10 shrink-0 active:scale-[0.96] transition-[background-color,color,box-shadow,scale]">
                Retry locations
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {stats && !isInitialLoad && !loadError && (
          <RosterSummary stats={stats} canEdit={canEdit} onRoleChange={setRoleFilter} onShowInactive={() => setShowInactive(true)} />
        )}

        {isInitialLoad ? (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><Skeleton className="h-4 w-16" /></TableHead>
                  <TableHead><Skeleton className="h-4 w-12" /></TableHead>
                  <TableHead className="hidden md:table-cell"><Skeleton className="h-4 w-24" /></TableHead>
                  <TableHead className="hidden xl:table-cell"><Skeleton className="h-4 w-20" /></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 8 }, (_, r) => (
                  <TableRow key={r}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Skeleton className="size-8 rounded-full shrink-0" />
                        <div className="flex flex-col gap-1.5 flex-1">
                          <Skeleton className="h-3.5" style={{ width: `${55 + (r % 3) * 15}%` }} />
                          <Skeleton className="h-3" style={{ width: `${40 + (r % 4) * 10}%` }} />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                    <TableCell className="hidden md:table-cell"><Skeleton className="h-3.5" style={{ width: `${50 + (r % 3) * 20}%` }} /></TableCell>
                    <TableCell className="hidden xl:table-cell"><Skeleton className="h-3.5 w-16" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : loadError ? (
          <EmptyState
            icon={loadError === "network" ? "wifi-off" : "users"}
            title={loadError === "network" ? "You\u2019re offline" : "Failed to load users"}
            description={loadError === "network"
              ? "Check your internet connection and try again."
              : "Something went wrong \u2014 usually temporary."}
            actionLabel="Retry"
            onAction={reload}
          />
        ) : users.length === 0 ? (
          <EmptyState
            icon="users"
            title={hasFilters ? "No users match your filters" : "No users yet"}
            description={
              hasFilters
                ? "Try adjusting your search or filters."
                : canEdit
                  ? "Add users to grant registration access."
                  : undefined
            }
            actionLabel={hasFilters ? "Clear filters" : canEdit ? "Add users" : undefined}
            onAction={hasFilters ? clearFilters : canEdit ? () => setShowCreate(true) : undefined}
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHead label="Name" sortKey="name" currentSort={sort} onSort={setSort} className="w-[26rem] normal-case tracking-normal" />
                      <SortableHead label="Role" sortKey="role" currentSort={sort} onSort={setSort} className="w-28 normal-case tracking-normal" />
                      <TableHead className="hidden min-w-[18rem] normal-case tracking-normal md:table-cell">Title / area</TableHead>
                      {!isCollaboratorDirectory && (
                        <SortableHead label="Last active" sortKey="lastActive" currentSort={sort} onSort={setSort} className="hidden w-36 normal-case tracking-normal xl:table-cell" />
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {users.map((user) => (
                      <UserTableRow key={user.id} user={user} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Mobile cards */}
            <div className="block sm:hidden flex flex-col gap-2">
              {users.map((user) => (
                <UserMobileCard key={user.id} user={user} />
              ))}
            </div>
          </>
        )}

        {/* Pagination / Count */}
        {!isInitialLoad && !loadError && users.length > 0 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {totalPages > 1
                ? <>Showing {page * LIMIT + 1}&ndash;{Math.min((page + 1) * LIMIT, total)} of {total}</>
                : <>{total} {total === 1 ? "user" : "users"}{hasFilters ? " found" : ""}</>
              }
            </span>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" className="h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,scale]" disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" className="h-10 active:scale-[0.96] transition-[background-color,color,box-shadow,scale]" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
                  Next
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </FadeUp>
  );
}
