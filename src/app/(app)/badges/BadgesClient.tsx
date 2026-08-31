"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Award, BarChart3, Info, RefreshCw, Search, UsersRound, X } from "lucide-react";
import { FadeUp } from "@/components/ui/motion";
import { PageHeader } from "@/components/PageHeader";
import BulkBadgeAwardDialog from "../users/BulkBadgeAwardDialog";
import { UserAvatar } from "@/components/UserAvatar";
import type { UserRow } from "../users/types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { badgeIcon } from "@/components/badges/badge-artwork";
import { formatBadgeCategoryLabel } from "@/lib/badges/display";
import { MAX_BULK_BADGE_TARGETS } from "@/lib/request-limits";
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

type SelectableUser = Pick<UserRow, "id" | "name" | "email" | "role" | "avatarUrl">;

type DirectoryResponse = {
  users: SelectableUser[];
  total: number;
};

function roleLabel(role: string) {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

export default function BadgesClient({
  isAdmin,
  badgesAvailable,
}: {
  isAdmin: boolean;
  badgesAvailable: boolean;
}) {
  const [search, setSearch] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
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
    data: directory,
    loading: directoryLoading,
    refreshing: directoryRefreshing,
    error: directoryError,
    reload: reloadDirectory,
  } = useFetch<DirectoryResponse>({
    url: "/api/users?limit=200&sort=name",
    returnTo: "/badges",
    refetchOnFocus: false,
    transform: (json) => ({
      users: Array.isArray(json.data) ? json.data as SelectableUser[] : [],
      total: typeof json.total === "number" ? json.total : 0,
    }),
  });

  const users = useMemo(() => directory?.users ?? [], [directory?.users]);
  const targetCount = selectedUserIds.length;
  const targetCountOverLimit = targetCount > MAX_BULK_BADGE_TARGETS;
  const awardDisabled = !isAdmin || !badgesAvailable || directoryLoading || Boolean(directoryError) || targetCount <= 0 || targetCountOverLimit;

  const visibleUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((user) => `${user.name} ${user.email}`.toLowerCase().includes(query));
  }, [search, users]);
  const selectedUserSet = useMemo(() => new Set(selectedUserIds), [selectedUserIds]);
  const selectedUsers = useMemo(
    () => users.filter((user) => selectedUserSet.has(user.id)),
    [selectedUserSet, users],
  );
  const allVisibleSelected = visibleUsers.length > 0 && visibleUsers.every((user) => selectedUserSet.has(user.id));
  const selectionSummary = selectedUsers.length === 1
    ? selectedUsers[0]?.name ?? "1 selected user"
    : `${selectedUsers.length} selected users`;

  useEffect(() => {
    if (!directory) return;
    const availableIds = new Set(directory.users.map((user) => user.id));
    setSelectedUserIds((current) => {
      const next = current.filter((id) => availableIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [directory]);

  function toggleUser(userId: string) {
    setSelectedUserIds((current) => {
      if (current.includes(userId)) return current.filter((id) => id !== userId);
      if (current.length >= MAX_BULK_BADGE_TARGETS) return current;
      return [...current, userId];
    });
  }

  function selectAllVisible() {
    setSelectedUserIds((current) => {
      const next = [...current];
      for (const user of visibleUsers) {
        if (!next.includes(user.id) && next.length < MAX_BULK_BADGE_TARGETS) next.push(user.id);
      }
      return next;
    });
  }

  function clearSelection() {
    setSelectedUserIds([]);
  }

  function reloadDirectoryAndCatalog() {
    reloadDirectory();
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
            <AlertDescription>Badge awards are restricted to administrators. You can still review the catalog and select people to preview the award audience here.</AlertDescription>
          </Alert>
        )}

        <Card className="border-border/40 shadow-none">
          <CardHeader className="gap-1 pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">Select the people</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Search the active user directory, then select each person who should receive the award.</p>
              </div>
              <Badge variant={targetCountOverLimit ? "orange" : "secondary"}>
                {targetCountOverLimit ? `Over ${MAX_BULK_BADGE_TARGETS}` : `${targetCount} selected`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Input
                id="badge-user-search"
                name="badge-user-search"
                className="h-10 pl-9 pr-10 text-base md:text-sm"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or email"
                aria-label="Search users"
              />
              <Search className="pointer-events-none absolute inset-y-0 left-3 my-auto size-4 text-muted-foreground" aria-hidden="true" />
              {search && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="absolute inset-y-0 right-0 my-auto size-10 text-muted-foreground"
                  onClick={() => setSearch("")}
                  aria-label="Clear user search"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {directoryLoading
                  ? "Loading active users…"
                  : search.trim()
                    ? `${visibleUsers.length} of ${users.length} active users shown`
                    : `${users.length} active users`}
              </p>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" className="h-9" onClick={selectAllVisible} disabled={directoryLoading || visibleUsers.length === 0 || allVisibleSelected || targetCount >= MAX_BULK_BADGE_TARGETS}>
                  Select all visible
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-9" onClick={clearSelection} disabled={targetCount === 0}>
                  Clear selection
                </Button>
              </div>
            </div>

            {directoryError ? (
              <Alert variant="destructive">
                <Info className="size-4" />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>Could not load the active user directory.</span>
                  <Button type="button" variant="outline" size="sm" className="h-10" onClick={reloadDirectory}>
                    Retry users
                  </Button>
                </AlertDescription>
              </Alert>
            ) : directoryLoading ? (
              <div className="space-y-2 rounded-lg border border-border/60 p-3">
                {Array.from({ length: 6 }, (_, index) => (
                  <div key={index} className="flex items-center gap-3 px-1 py-2">
                    <Skeleton className="size-4" />
                    <Skeleton className="size-8 rounded-full" />
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <Skeleton className="h-3.5 w-40" />
                      <Skeleton className="h-3 w-56 max-w-full" />
                    </div>
                  </div>
                ))}
              </div>
            ) : users.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                No active users are available to select.
              </div>
            ) : visibleUsers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                No active users match this search. Try another name or email.
              </div>
            ) : (
              <div className="max-h-[28rem] overflow-y-auto rounded-lg border border-border/60" role="group" aria-label="Active users">
                {visibleUsers.map((user) => {
                  const checked = selectedUserSet.has(user.id);
                  return (
                    <div key={user.id} className={cn("flex items-center gap-3 border-b border-border/60 px-3 last:border-b-0", checked && "bg-accent/50")}>
                      <Checkbox
                        id={`badge-user-${user.id}`}
                        checked={checked}
                        onCheckedChange={() => toggleUser(user.id)}
                        aria-label={`Select ${user.name}`}
                        disabled={!checked && targetCount >= MAX_BULK_BADGE_TARGETS}
                      />
                      <label htmlFor={`badge-user-${user.id}`} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2.5">
                        <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="sm" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-sm font-medium">{user.name}</span>
                          <span className="truncate text-xs text-muted-foreground">{user.email || "No email listed"}</span>
                        </span>
                        <Badge variant="outline" size="sm" className="shrink-0">{roleLabel(user.role)}</Badge>
                      </label>
                    </div>
                  );
                })}
              </div>
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
                  <p className="font-semibold">{targetCount === 0 ? "No people selected" : `${targetCount} selected`}</p>
                  <p className="text-sm text-muted-foreground">{targetCount === 0 ? "Select one or more people above." : "Only these people will receive the badge."}</p>
                </div>
              </div>
              <span className="rounded-full border border-border/60 px-2 py-1 text-xs text-muted-foreground">Max {MAX_BULK_BADGE_TARGETS}</span>
            </div>

            {selectedUsers.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Selected users">
                {selectedUsers.slice(0, 8).map((user) => (
                  <span key={user.id} className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{user.name}</span>
                ))}
                {selectedUsers.length > 8 && (
                  <span className="px-2.5 py-1 text-xs text-muted-foreground">+{selectedUsers.length - 8} more</span>
                )}
              </div>
            )}

            {targetCountOverLimit && (
              <Alert>
                <Info className="size-4" />
                <AlertDescription>A single badge award can include at most {MAX_BULK_BADGE_TARGETS} people.</AlertDescription>
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
            <Button type="button" variant="ghost" size="sm" className="h-10" onClick={reloadDirectoryAndCatalog} disabled={catalogRefreshing || directoryRefreshing}>
              <RefreshCw data-icon="inline-start" className={cn((catalogRefreshing || directoryRefreshing) && "animate-spin")} />
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
          filterSummary={selectionSummary}
          userIds={selectedUserIds}
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
