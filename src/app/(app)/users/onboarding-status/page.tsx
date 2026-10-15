"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import { OperationalMetricCard } from "@/components/OperationalFeedback";
import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { PageHeader } from "@/components/PageHeader";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useFetch } from "@/hooks/use-fetch";
import { classifyError, handleAuthRedirect, isAbortError, parseErrorMessage } from "@/lib/errors";
import { formatDateFull, formatRelativeTime } from "@/lib/format";
import { PROFILE_FIELD_LABELS } from "@/lib/profile-completion";
import { AlertTriangle, ClipboardList, Copy, ExternalLink, RefreshCw, Trash2, UserPlus, WifiOff } from "lucide-react";

type Role = "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";
type StatusFilter = "all" | "pending" | "stale" | "claimed";
type OnboardingStatus = "pending" | "stale" | "claimed";

type AllowedEmail = {
  id: string;
  email: string;
  role: Role;
  affiliation: string | null;
  collaboratorProfile: string | null;
  collaboratorPolicy: {
    id: string;
    status: "ACTIVE" | "SUSPENDED";
    version: number;
    capabilities: string[];
    affiliation: { key: string; displayName: string; badgeLabel: string };
  } | null;
  claimedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  claimedBy: { id: string; name: string } | null;
};

type AllowedEmailsResponse = {
  invitations: AllowedEmail[];
  accounts: ReadinessAccount[];
};

type ReadinessAccount = {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl: string | null;
  operationalReady: boolean;
  profileComplete: boolean;
  missingFields: string[];
  completedCount: number;
  totalCount: number;
};

const STALE_DAYS = 14;
const ROLE_META: Record<Role, { label: string; variant: BadgeProps["variant"] }> = {
  ADMIN: { label: "Admin", variant: "purple" },
  STAFF: { label: "Staff", variant: "blue" },
  STUDENT: { label: "Student", variant: "gray" },
  COLLABORATOR: { label: "Collaborator", variant: "blue" },
};

const READINESS_FIELD_LABELS: Record<string, string> = {
  ...PROFILE_FIELD_LABELS,
  campusEmail: "Campus login",
  anticipatedGraduation: "Graduation",
  photo: "Photo",
};

function statusFor(item: AllowedEmail, now: Date): OnboardingStatus {
  if (item.claimedAt) return "claimed";
  const ageMs = now.getTime() - new Date(item.createdAt).getTime();
  return ageMs >= STALE_DAYS * 24 * 60 * 60 * 1000 ? "stale" : "pending";
}

function statusBadge(status: OnboardingStatus) {
  if (status === "claimed") return <Badge variant="gray">Claimed</Badge>;
  if (status === "stale") return <Badge variant="orange">Stale pending</Badge>;
  return <Badge variant="blue">Pending</Badge>;
}

export default function OnboardingStatusPage() {
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const now = useMemo(() => new Date(), []);

  const {
    data,
    loading,
    error,
    reload,
    lastRefreshed,
  } = useFetch<AllowedEmailsResponse>({
    url: "/api/users/onboarding-readiness",
    returnTo: "/users/onboarding-status",
    transform: (json) => {
      const payload = json.data as AllowedEmailsResponse | undefined;
      return { invitations: payload?.invitations ?? [], accounts: payload?.accounts ?? [] };
    },
  });

  const [localRows, setLocalRows] = useState<AllowedEmail[] | null>(null);
  const [prevData, setPrevData] = useState(data);
  if (data !== prevData) {
    setPrevData(data);
    setLocalRows(null);
  }

  const fetchedRows = data?.invitations;
  const rows = useMemo(() => localRows ?? fetchedRows ?? [], [fetchedRows, localRows]);
  const accounts = useMemo(() => data?.accounts ?? [], [data?.accounts]);
  const enrichedRows = useMemo(
    () => rows.map((row) => ({ ...row, onboardingStatus: statusFor(row, now) })),
    [now, rows],
  );

  const counts = useMemo(() => {
    return enrichedRows.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.onboardingStatus] += 1;
        return acc;
      },
      { total: 0, pending: 0, stale: 0, claimed: 0 },
    );
  }, [enrichedRows]);
  const readinessCounts = useMemo(() => ({
    setupNeeded: accounts.filter((account) => !account.operationalReady).length,
    operational: accounts.filter((account) => account.operationalReady && !account.profileComplete).length,
    complete: accounts.filter((account) => account.profileComplete).length,
  }), [accounts]);
  const visibleAccounts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return accounts;
    return accounts.filter((account) => account.name.toLowerCase().includes(normalizedQuery) || account.email.toLowerCase().includes(normalizedQuery));
  }, [accounts, query]);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return enrichedRows.filter((row) => {
      if (statusFilter !== "all" && row.onboardingStatus !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return row.email.toLowerCase().includes(normalizedQuery) ||
        row.createdBy.name.toLowerCase().includes(normalizedQuery) ||
        (row.claimedBy?.name.toLowerCase().includes(normalizedQuery) ?? false);
    });
  }, [enrichedRows, query, statusFilter]);

  const isInitialLoad = loading && rows.length === 0;
  const railItems: OperationalStatusRailItem[] = [
    ...(counts.stale > 0 ? [{
      id: "stale",
      label: "Stale pending",
      value: counts.stale,
      detail: `Invitations still unclaimed after ${STALE_DAYS} days.`,
      icon: AlertTriangle,
      tone: "warning" as const,
      onSelect: () => setStatusFilter("stale"),
    }] : []),
    ...(counts.pending > 0 ? [{
      id: "pending",
      label: "Pending",
      value: counts.pending,
      detail: "Invitations waiting for first sign-in.",
      icon: UserPlus,
      tone: "info" as const,
      onSelect: () => setStatusFilter("pending"),
    }] : []),
    ...(readinessCounts.setupNeeded > 0 ? [{
      id: "setup-needed",
      label: "Setup needed",
      value: readinessCounts.setupNeeded,
      detail: "Active accounts still missing operational essentials.",
      icon: AlertTriangle,
      tone: "warning" as const,
    }] : []),
  ];

  function loginPath() {
    return "/login";
  }

  async function copyLoginLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${loginPath()}`);
      toast.success("App login link copied");
    } catch {
      toast.error("Could not copy the link. Use Open app login and copy the address instead.");
    }
  }

  async function removeInvite(row: AllowedEmail) {
    const ok = await confirm({
      title: "Remove pending invite",
      message: `Remove ${row.email} from the registration allowlist? Existing users are not changed. You can reissue access from Add users.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;

    setDeletingId(row.id);
    try {
      const response = await fetch(`/api/allowed-emails/${row.id}`, { method: "DELETE" });
      if (handleAuthRedirect(response, "/users/onboarding-status")) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Failed to remove pending invite"));
        return;
      }
      setLocalRows((prev) => (prev ?? rows).filter((item) => item.id !== row.id));
      toast.success("Pending invite removed");
    } catch (error) {
      if (isAbortError(error)) return;
      const kind = classifyError(error);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Failed to remove pending invite");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Onboarding Status"
        description="Track invitations and account readiness. New people sign in at the app login with their invited email, set a password, then finish Welcome setup."
      >
        <Button variant="ghost" size="icon" className="size-10" onClick={reload} disabled={loading} aria-label="Refresh onboarding status">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
        <Button asChild variant="outline">
          <Link href="/settings/allowed-emails">Allowed emails</Link>
        </Button>
        <Button asChild>
          <Link href="/users?onboard=1">
            <UserPlus data-icon="inline-start" />
            Add users
          </Link>
        </Button>
      </PageHeader>

      <OperationalStatusRail
        orientation={{
          label: "Onboarding",
          value: `${accounts.length} active ${accounts.length === 1 ? "account" : "accounts"}`,
          icon: ClipboardList,
        }}
        items={railItems}
        allClearLabel={railItems.length === 0 ? "All invitations and active accounts are ready" : undefined}
        details={(
          <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <OperationalMetricCard label="Invitations" value={counts.total} onClick={() => setStatusFilter("all")} ariaPressed={statusFilter === "all"} />
            <OperationalMetricCard label="Pending" value={counts.pending} tone={counts.pending ? "blue" : "muted"} onClick={() => setStatusFilter("pending")} ariaPressed={statusFilter === "pending"} />
            <OperationalMetricCard label="Stale pending" value={counts.stale} tone={counts.stale > 0 ? "orange" : "muted"} onClick={() => setStatusFilter("stale")} ariaPressed={statusFilter === "stale"} />
            <OperationalMetricCard label="Setup needed" value={readinessCounts.setupNeeded} tone={readinessCounts.setupNeeded ? "orange" : "muted"} />
            <OperationalMetricCard label="Operational" value={readinessCounts.operational} tone={readinessCounts.operational ? "blue" : "muted"} />
            <OperationalMetricCard label="Profile complete" value={readinessCounts.complete} />
          </div>
        )}
      />

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="text-base">Onboarding access</CardTitle>
            {lastRefreshed && (
              <p className="text-xs text-muted-foreground">Updated {formatRelativeTime(lastRefreshed.toISOString(), new Date())}</p>
            )}
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px]">
            <Input
              id="onboarding-status-search"
              name="onboardingStatusSearch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search email, creator, or claimed user"
              className="h-10"
              aria-label="Search onboarding access"
            />
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
              <SelectTrigger id="onboarding-status-filter" className="h-10" aria-label="Onboarding status filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="stale">Stale pending</SelectItem>
                <SelectItem value="claimed">Claimed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        {error ? (
          <CardContent>
            <Alert variant="destructive">
              {error === "network" ? <WifiOff className="size-4" /> : <AlertTriangle className="size-4" />}
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{error === "network" ? "Could not connect to the server." : "Failed to load onboarding status."}</span>
                <Button type="button" variant="outline" onClick={reload} className="h-10 shrink-0">
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          </CardContent>
        ) : isInitialLoad ? (
          <StatusSkeleton />
        ) : visibleRows.length === 0 ? (
          <CardContent>
            <EmptyState
              inline
              icon="search"
              title={rows.length === 0 ? "No onboarding rows yet" : "No onboarding rows match"}
              description={rows.length === 0 ? "Use Add users to create invitations." : "Adjust the search or status filter."}
            />
          </CardContent>
        ) : (
          <>
          <div className="grid gap-2 p-3 md:hidden">
            {visibleRows.map((row) => (
              <Card key={row.id}>
                <CardContent className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{row.email}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant={ROLE_META[row.role].variant} size="sm">{row.collaboratorPolicy?.affiliation.badgeLabel ?? ROLE_META[row.role].label}</Badge>
                        {statusBadge(row.onboardingStatus)}
                      </div>
                    </div>
                    <OperationalRowActions label={`Actions for ${row.email}`}>
                      {!row.claimedAt ? (
                        <>
                          <DropdownMenuItem onClick={copyLoginLink}><Copy />Copy app login link</DropdownMenuItem>
                          <DropdownMenuItem asChild><Link href={loginPath()} target="_blank" rel="noreferrer"><ExternalLink />Open app login</Link></DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" onClick={() => removeInvite(row)} disabled={deletingId === row.id}><Trash2 />{deletingId === row.id ? "Removing" : "Remove pending invite"}</DropdownMenuItem>
                        </>
                      ) : (
                        <DropdownMenuItem disabled>Claimed invites stay for audit</DropdownMenuItem>
                      )}
                    </OperationalRowActions>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                    <div><div className="font-medium text-foreground">Created</div>{formatRelativeTime(row.createdAt, now)} by {row.createdBy.name}</div>
                    <div><div className="font-medium text-foreground">Claimed</div>{row.claimedBy ? row.claimedBy.name : "Not claimed"}</div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Table className="hidden md:table">
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Age</TableHead>
                <TableHead>Created by</TableHead>
                <TableHead>Claimed by</TableHead>
                <TableHead className="w-12"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.email}</TableCell>
                  <TableCell>
                    <Badge variant={ROLE_META[row.role].variant} size="sm">
                      {row.collaboratorPolicy?.affiliation.badgeLabel ?? ROLE_META[row.role].label}
                    </Badge>
                  </TableCell>
                  <TableCell>{statusBadge(row.onboardingStatus)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <div>{formatRelativeTime(row.createdAt, now)}</div>
                    <div className="text-xs">{formatDateFull(row.createdAt)}</div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{row.createdBy.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.claimedBy ? (
                      <div>
                        <div>{row.claimedBy.name}</div>
                        {row.claimedAt && <div className="text-xs">{formatDateFull(row.claimedAt)}</div>}
                      </div>
                    ) : (
                      "Not claimed"
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <OperationalRowActions label={`Actions for ${row.email}`}>
                      {!row.claimedAt && (
                        <>
                          <DropdownMenuItem onClick={copyLoginLink}>
                            <Copy className="size-4" />
                            Copy app login link
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={loginPath()} target="_blank" rel="noreferrer">
                              <ExternalLink className="size-4" />
                              Open app login
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => removeInvite(row)}
                            disabled={deletingId === row.id}
                          >
                            <Trash2 className="size-4" />
                            {deletingId === row.id ? "Removing..." : "Remove pending invite"}
                          </DropdownMenuItem>
                        </>
                      )}
                      {row.claimedAt && (
                        <DropdownMenuItem disabled>
                          Claimed invites stay for audit
                        </DropdownMenuItem>
                      )}
                    </OperationalRowActions>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </>
        )}
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Active account readiness</CardTitle></CardHeader>
        {visibleAccounts.length === 0 ? (
          <CardContent><EmptyState inline icon="search" title="No active accounts match" description="Adjust the search above." /></CardContent>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Role</TableHead><TableHead>Readiness</TableHead><TableHead>Progress</TableHead><TableHead>Missing</TableHead></TableRow></TableHeader>
            <TableBody>
              {visibleAccounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell><Link href={`/users/${account.id}`} className="font-medium hover:underline">{account.name}</Link><div className="text-xs text-muted-foreground">{account.email}</div></TableCell>
                  <TableCell><Badge variant={ROLE_META[account.role].variant} size="sm">{ROLE_META[account.role].label}</Badge></TableCell>
                  <TableCell>{account.profileComplete ? <Badge variant="green">Profile complete</Badge> : account.operationalReady ? <Badge variant="blue">Operationally ready</Badge> : <Badge variant="orange">Setup needed</Badge>}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{account.completedCount}/{account.totalCount}</TableCell>
                  <TableCell className="max-w-sm text-sm text-muted-foreground">{account.missingFields.length ? account.missingFields.map((field) => READINESS_FIELD_LABELS[field] ?? field).join(", ") : "None"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function StatusSkeleton() {
  return (
    <div className="grid gap-2 p-4">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1.5fr)_80px_120px_100px_120px_120px] gap-3 rounded-md border border-border/60 p-3 max-lg:grid-cols-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
