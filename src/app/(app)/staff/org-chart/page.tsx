"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { List, Network } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/EmptyState";
import { UserAvatar } from "@/components/UserAvatar";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { Role } from "../types";
import { AREA_LABELS } from "../types";
import RoleBadge from "../RoleBadge";

type OrgUser = {
  id: string;
  name: string;
  role: Role;
  avatarUrl: string | null;
  title: string | null;
  primaryArea: string | null;
  directReportId: string | null;
  directReportName: string | null;
};

type Tree = { user: OrgUser; children: Tree[] };
type OrgChartResponse = { data?: OrgUser[] };

/**
 * Build the forest of trees from a flat user list.
 * - Edges only form on `directReportId` (FK).
 * - Users with `directReportName` (free-text manager) are rendered as roots
 *   and show a "Reports to: <name>" caption — they do NOT form FK edges.
 * - Users with neither are roots.
 */
function buildForest(users: OrgUser[]): Tree[] {
  const byId = new Map<string, OrgUser>(users.map((u) => [u.id, u]));
  const childrenByParent = new Map<string, OrgUser[]>();
  const roots: OrgUser[] = [];

  for (const u of users) {
    const parentId = u.directReportId;
    if (parentId && byId.has(parentId)) {
      const list = childrenByParent.get(parentId);
      if (list) list.push(u);
      else childrenByParent.set(parentId, [u]);
    } else {
      // FK is null OR points to a user that no longer exists / isn't active.
      roots.push(u);
    }
  }

  function buildNode(u: OrgUser, seen: Set<string>): Tree {
    if (seen.has(u.id)) {
      // Defensive: if directReport cycles ever exist, break them cleanly.
      return { user: u, children: [] };
    }
    seen.add(u.id);
    const kids = childrenByParent.get(u.id) ?? [];
    return {
      user: u,
      children: kids
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((child) => !seen.has(child.id))
        .map((k) => buildNode(k, seen)),
    };
  }

  const forest = roots
    .slice()
    .sort((a, b) => {
      // Admins/staff first, then students; tiebreak by name.
      const order: Record<Role, number> = { ADMIN: 0, STAFF: 1, STUDENT: 2, COLLABORATOR: 3 };
      const r = order[a.role] - order[b.role];
      return r !== 0 ? r : a.name.localeCompare(b.name);
    })
    .map((r) => buildNode(r, new Set()));

  const included = new Set<string>();
  function collect(tree: Tree) {
    if (included.has(tree.user.id)) return;
    included.add(tree.user.id);
    tree.children.forEach(collect);
  }
  forest.forEach(collect);

  // Corrupt legacy cycles have no natural root. Keep those people visible instead
  // of presenting an empty or incomplete chart while write-time guards prevent new cycles.
  for (const user of users) {
    if (!included.has(user.id)) {
      const recovered = buildNode(user, new Set());
      forest.push(recovered);
      collect(recovered);
    }
  }

  return forest;
}

function NodeRow({ tree, depth }: { tree: Tree; depth: number }) {
  const { user, children } = tree;
  const reportsToFreeText = user.directReportName && !user.directReportId;
  return (
    <li className="relative pl-6">
      {depth > 0 && (
        <span
          aria-hidden
          className="absolute left-2 top-0 bottom-0 border-l border-border"
        />
      )}
      <div
        className={
          depth > 0
            ? "before:absolute before:left-2 before:top-5 before:w-4 before:border-t before:border-border relative"
            : "relative"
        }
      >
        <Link
          href={`/staff/${user.id}`}
          className="group flex items-center gap-3 py-2 pr-3 -mx-2 px-2 rounded-md hover:bg-accent transition-colors"
        >
          <UserAvatar
            name={user.name}
            avatarUrl={user.avatarUrl}
            size="default"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="brand-identity truncate font-medium group-hover:underline">
                {user.name}
              </span>
              <RoleBadge role={user.role} />
              {user.primaryArea && (
                <Badge variant="gray" size="sm">
                  {AREA_LABELS[user.primaryArea] ?? user.primaryArea}
                </Badge>
              )}
            </div>
            <div className="text-xs text-muted-foreground truncate">
              {user.title ||
                (reportsToFreeText
                  ? `Reports to ${user.directReportName} (external)`
                  : null)}
            </div>
          </div>
        </Link>
      </div>
      {children.length > 0 && (
        <ul className="ml-1">
          {children.map((c) => (
            <NodeRow key={c.user.id} tree={c} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

const ROLE_LABEL: Record<Role, string> = { ADMIN: "Admin", STAFF: "Staff", STUDENT: "Student", COLLABORATOR: "Collaborator" };

function nodeSubtitle(user: OrgUser) {
  if (user.title) return user.title;
  const area = user.primaryArea ? (AREA_LABELS[user.primaryArea] ?? user.primaryArea) : null;
  return [ROLE_LABEL[user.role], area].filter(Boolean).join(" · ");
}

function PersonCard({ user }: { user: OrgUser }) {
  return (
    <Link
      href={`/staff/${user.id}`}
      className="flex w-44 items-center gap-2.5 rounded-xl border bg-card text-foreground px-3 py-2.5 text-left shadow-xs transition-[box-shadow,border-color] hover:border-primary/40 hover:shadow-sm focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <UserAvatar name={user.name} avatarUrl={user.avatarUrl} size="default" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-bold">{user.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{nodeSubtitle(user)}</span>
      </span>
    </Link>
  );
}

/** One branch of the chart: a person, a stub down, and their reports in a row beneath. */
function ChartBranch({ tree }: { tree: Tree }) {
  const { user, children } = tree;
  return (
    <div className="flex flex-col items-center">
      <PersonCard user={user} />
      {children.length > 0 && (
        <>
          <span aria-hidden className="h-5 w-px bg-border" />
          <div className="flex items-start">
            {children.map((child, index) => (
              <div key={child.user.id} className="relative flex flex-col items-center px-1.5 pt-5">
                <span aria-hidden className="absolute left-1/2 top-0 h-5 w-px bg-border" />
                {children.length > 1 && index > 0 && <span aria-hidden className="absolute left-0 top-0 w-1/2 border-t border-border" />}
                {children.length > 1 && index < children.length - 1 && (
                  <span aria-hidden className="absolute right-0 top-0 w-1/2 border-t border-border" />
                )}
                <ChartBranch tree={child} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OrgChartTree({ forest }: { forest: Tree[] }) {
  const branches = forest.filter((tree) => tree.children.length > 0);
  const alone = forest.filter((tree) => tree.children.length === 0);
  return (
    <div className="flex flex-col gap-8">
      {branches.length > 0 && (
        <div className="overflow-x-auto pb-4">
          <div className="mx-auto flex w-max min-w-full flex-col items-center gap-10">
            {branches.map((tree) => (
              <ChartBranch key={tree.user.id} tree={tree} />
            ))}
          </div>
        </div>
      )}
      {alone.length > 0 && (
        <section aria-label="Not placed in a team yet" className="border-t pt-5">
          <h2 className="text-sm font-bold">
            Not placed yet <span className="ml-1 font-normal tabular-nums text-muted-foreground">{alone.length}</span>
          </h2>
          <p className="mb-3 mt-0.5 text-xs text-muted-foreground">No manager is linked and nobody reports to them. Link a manager on their profile to place them in the chart.</p>
          <ul className="flex flex-wrap gap-2">
            {alone.map((tree) => (
              <li key={tree.user.id}>
                <PersonCard user={tree.user} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export default function OrgChartPage() {
  const [users, setUsers] = useState<OrgUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"chart" | "list">("chart");

  const loadOrgChart = useCallback((signal?: AbortSignal) => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/users/org-chart", { signal });
        if (handleAuthRedirect(res)) return;
        if (!res.ok) {
          setError(await parseErrorMessage(res, "Failed to load org chart"));
          return;
        }
        const json = await parseJsonSafely<OrgChartResponse>(res);
        if (!json || !Array.isArray(json.data)) {
          setError("The org chart response was incomplete. Try again.");
          return;
        }
        setUsers(json.data);
      } catch (e) {
        if ((e as { name?: string }).name === "AbortError") return;
        setError("Network error");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    loadOrgChart(ctrl.signal);
    return () => ctrl.abort();
  }, [loadOrgChart]);

  const forest = useMemo(() => (users ? buildForest(users) : []), [users]);
  const nameOnlyManagers = useMemo(() => (users ?? []).filter((u) => u.directReportName && !u.directReportId).length, [users]);

  return (
    <>
      <PageHeader title="Org chart" description="Reporting relationships for active staff and students." />

      {!loading && !error && nameOnlyManagers > 0 && (
        <div role="status" className="mb-4 flex items-center gap-3 rounded-xl border border-[#f5e29a] bg-[#fff8e1] px-4 py-3 text-sm text-[#5c4400]">
          <span aria-hidden className="size-2 shrink-0 rounded-full bg-[#f5b800]" />
          <span>
            <strong>{nameOnlyManagers} {nameOnlyManagers === 1 ? "person lists" : "people list"}</strong> a manager by name only, so they appear at the top level. Link their manager on their profile to place them.
          </span>
        </div>
      )}

      {!loading && !error && forest.length > 0 && (
        <div className="mb-3 flex justify-end">
          <ToggleGroup type="single" value={view} onValueChange={(next) => next && setView(next as "chart" | "list")} aria-label="Org chart view">
            <ToggleGroupItem value="chart" aria-label="Chart view">
              <Network className="mr-1.5 size-4" aria-hidden /> Chart
            </ToggleGroupItem>
            <ToggleGroupItem value="list" aria-label="List view">
              <List className="mr-1.5 size-4" aria-hidden /> List
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      <Card className="rounded-xl">
        <CardContent className={cn("p-4", view === "chart" && !loading && !error && forest.length > 0 && "sm:p-8")}>
          {loading && (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-8 rounded-full" />
                  <div className="flex-1 flex flex-col gap-1.5">
                    <Skeleton className="h-3.5 w-32" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && error && (
            <EmptyState
              icon="users"
              title="Couldn't load org chart"
              description={error}
              actionLabel="Retry"
              onAction={() => loadOrgChart()}
            />
          )}
          {!loading && !error && forest.length === 0 && (
            <EmptyState
              icon="users"
              title="No users to display"
              description="Add users and set their direct report to populate the org chart."
            />
          )}
          {!loading && !error && forest.length > 0 && view === "chart" && <OrgChartTree forest={forest} />}
          {!loading && !error && forest.length > 0 && view === "list" && (
            <ul className="text-sm">
              {forest.map((root) => (
                <NodeRow key={root.user.id} tree={root} depth={0} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
