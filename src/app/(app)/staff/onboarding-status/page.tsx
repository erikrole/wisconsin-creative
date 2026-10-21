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
import { Card, CardContent } from "@/components/ui/card";
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
import { useFetch } from "@/hooks/use-fetch";
import { classifyError, handleAuthRedirect, isAbortError, parseErrorMessage } from "@/lib/errors";
import { formatDateFull, formatRelativeTime } from "@/lib/format";
import { PROFILE_FIELD_LABELS } from "@/lib/profile-completion";
import { AlertTriangle, ClipboardList, Copy, ExternalLink, Mail, RefreshCw, Send, Trash2, UserPlus, WifiOff } from "lucide-react";

type Role = "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";
type StatusFilter = "all" | "pending" | "stale" | "claimed" | "setup" | "ready";
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


type PersonRow =
  | { kind: "invite"; key: string; sortRank: number; invite: AllowedEmail & { onboardingStatus: OnboardingStatus } }
  | { kind: "account"; key: string; sortRank: number; account: ReadinessAccount };

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function accountStatus(account: ReadinessAccount) {
  if (account.profileComplete) return <Badge variant="green">Profile complete</Badge>;
  if (account.operationalReady) return <Badge variant="blue">Operationally ready</Badge>;
  return <Badge variant="orange">Setup needed</Badge>;
}

const ROW_GRID = "md:grid md:grid-cols-[minmax(0,1.4fr)_150px_minmax(0,1fr)_minmax(0,1.2fr)_44px] md:items-center md:gap-4";

export default function OnboardingStatusPage() {
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [emailingId, setEmailingId] = useState<string | null>(null);
  const [remindingAll, setRemindingAll] = useState(false);
  const now = useMemo(() => new Date(), []);

  const {
    data,
    loading,
    error,
    reload,
    lastRefreshed,
  } = useFetch<AllowedEmailsResponse>({
    url: "/api/users/onboarding-readiness",
    returnTo: "/staff/onboarding-status",
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

  const visibleRows = useMemo<PersonRow[]>(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const matches = (...values: (string | undefined)[]) =>
      !normalizedQuery || values.some((value) => value?.toLowerCase().includes(normalizedQuery));
    const people: PersonRow[] = [];

    for (const invite of enrichedRows) {
      const claimed = invite.onboardingStatus === "claimed";
      // A claimed invite is already an account row below; it only shows when asked for.
      if (claimed ? statusFilter !== "claimed" : statusFilter !== "all" && statusFilter !== invite.onboardingStatus) continue;
      if (!matches(invite.email, invite.createdBy.name, invite.claimedBy?.name)) continue;
      people.push({ kind: "invite", key: `invite-${invite.id}`, sortRank: invite.onboardingStatus === "stale" ? 0 : claimed ? 9 : 1, invite });
    }
    for (const account of visibleAccounts) {
      const state = account.profileComplete ? "ready" : account.operationalReady ? "ready" : "setup";
      if (statusFilter === "all" || statusFilter === state || (statusFilter === "setup" && !account.operationalReady)) {
        if (statusFilter === "ready" && !account.operationalReady) continue;
        if (statusFilter === "setup" && account.operationalReady) continue;
        people.push({ kind: "account", key: `account-${account.id}`, sortRank: account.operationalReady ? (account.profileComplete ? 4 : 3) : 2, account });
      }
    }
    return people.sort((a, b) => a.sortRank - b.sortRank);
  }, [enrichedRows, statusFilter, visibleAccounts, query]);

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

  async function emailInvite(row: AllowedEmail) {
    const ok = await confirm({
      title: "Email login link",
      message: `Send ${row.email} an email with the app login link?`,
      confirmLabel: "Send email",
    });
    if (!ok) return;
    setEmailingId(row.id);
    try {
      const response = await fetch(`/api/allowed-emails/${row.id}/resend`, { method: "POST" });
      if (handleAuthRedirect(response, "/staff/onboarding-status")) return;
      if (!response.ok) {
        toast.error(await parseErrorMessage(response, "Could not send the email"));
        return;
      }
      const json = (await response.json().catch(() => null)) as { data?: { emailStatus?: string } } | null;
      if (json?.data?.emailStatus === "not_configured") {
        toast.warning("Email isn't set up on this site yet. Copy the login link and send it yourself.");
        return;
      }
      toast.success(`Login link emailed to ${row.email}`);
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error(classifyError(error) === "network" ? "You\u2019re offline. Check your connection." : "Could not send the email");
    } finally {
      setEmailingId(null);
    }
  }

  /** One email per unclaimed invitation, sent one after another through the single-invite route. */
  async function remindEveryoneWaiting() {
    const waiting = rows.filter((row) => !row.claimedAt);
    if (waiting.length === 0) return;
    const ok = await confirm({
      title: "Remind everyone waiting",
      message: `Email the app login link to ${waiting.length} ${waiting.length === 1 ? "person" : "people"} who have not signed in yet?`,
      confirmLabel: "Send reminders",
    });
    if (!ok) return;
    setRemindingAll(true);
    let sent = 0;
    let skipped = 0;
    try {
      for (const row of waiting) {
        const response = await fetch(`/api/allowed-emails/${row.id}/resend`, { method: "POST" });
        if (handleAuthRedirect(response, "/staff/onboarding-status")) return;
        if (!response.ok) {
          skipped += 1;
          continue;
        }
        const json = (await response.json().catch(() => null)) as { data?: { emailStatus?: string } } | null;
        if (json?.data?.emailStatus === "not_configured") {
          toast.warning("Email isn't set up on this site yet. Copy the login link and send it yourself.");
          return;
        }
        sent += 1;
      }
      if (sent > 0) {
        toast.success(`Reminded ${sent} ${sent === 1 ? "person" : "people"}${skipped ? `. ${skipped} could not be emailed (sent too recently, or failed).` : ""}`);
      } else {
        toast.error("No reminders went out. Invites can be emailed 3 times an hour, so try again later.");
      }
    } catch (error) {
      if (isAbortError(error)) return;
      toast.error(classifyError(error) === "network" ? "You\u2019re offline. Check your connection." : "Could not send the reminders");
    } finally {
      setRemindingAll(false);
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
      if (handleAuthRedirect(response, "/staff/onboarding-status")) return;
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
          <Link href="/staff?onboard=1">
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

      <div className="flex flex-wrap items-center gap-2">
        <Input
          id="onboarding-status-search"
          name="onboardingStatusSearch"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, email, creator, or claimed user"
          className="h-10 min-w-64 flex-1 sm:max-w-sm"
          aria-label="Search onboarding access"
        />
        <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
          <SelectTrigger id="onboarding-status-filter" className="h-10 w-48" aria-label="Onboarding status filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="stale">Stale pending</SelectItem>
            <SelectItem value="setup">Setup needed</SelectItem>
            <SelectItem value="ready">Operationally ready</SelectItem>
            <SelectItem value="claimed">Claimed</SelectItem>
          </SelectContent>
        </Select>
        {rows.some((row) => !row.claimedAt) && (
          <Button type="button" variant="outline" className="h-10 px-3 text-sm" onClick={remindEveryoneWaiting} disabled={remindingAll}>
            <Send data-icon="inline-start" />
            {remindingAll ? "Sending..." : "Remind everyone waiting"}
          </Button>
        )}
        {lastRefreshed && (
          <p className="ml-auto text-xs text-muted-foreground">Updated {formatRelativeTime(lastRefreshed.toISOString(), new Date())}</p>
        )}
      </div>

      {error ? (
        <Alert variant="destructive">
          {error === "network" ? <WifiOff className="size-4" /> : <AlertTriangle className="size-4" />}
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>{error === "network" ? "Could not connect to the server." : "Failed to load onboarding status."}</span>
            <Button type="button" variant="outline" onClick={reload} className="h-10 shrink-0">
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      ) : isInitialLoad ? (
        <Card>
          <StatusSkeleton />
        </Card>
      ) : visibleRows.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <EmptyState
              inline
              icon="search"
              title={rows.length === 0 && accounts.length === 0 ? "No onboarding rows yet" : "No onboarding rows match"}
              description={rows.length === 0 && accounts.length === 0 ? "Use Add users to create invitations." : "Adjust the search or status filter."}
            />
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden rounded-xl p-0">
          <div className={`hidden border-b bg-muted/40 px-5 py-2.5 text-xs font-bold text-muted-foreground ${ROW_GRID}`}>
            <span>Person</span>
            <span>Status</span>
            <span>Sent / progress</span>
            <span>Next</span>
            <span className="sr-only">Actions</span>
          </div>
          <ul className="divide-y">
            {visibleRows.map((row) =>
              row.kind === "invite" ? (
                <InviteRow
                  key={row.key}
                  row={row.invite}
                  now={now}
                  deleting={deletingId === row.invite.id}
                  emailing={emailingId === row.invite.id}
                  onEmail={() => emailInvite(row.invite)}
                  onCopy={copyLoginLink}
                  onRemove={() => removeInvite(row.invite)}
                  loginHref={loginPath()}
                />
              ) : (
                <AccountRow key={row.key} account={row.account} />
              ),
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}

function InviteRow({
  row,
  now,
  deleting,
  emailing,
  onEmail,
  onCopy,
  onRemove,
  loginHref,
}: {
  row: AllowedEmail & { onboardingStatus: OnboardingStatus };
  now: Date;
  deleting: boolean;
  emailing: boolean;
  onEmail: () => void;
  onCopy: () => void;
  onRemove: () => void;
  loginHref: string;
}) {
  const next =
    row.onboardingStatus === "claimed"
      ? row.claimedBy
        ? `Claimed by ${row.claimedBy.name}${row.claimedAt ? `, ${formatDateFull(row.claimedAt)}` : ""}`
        : "Not claimed"
      : row.onboardingStatus === "stale"
        ? `Still unclaimed after ${STALE_DAYS} days. Send the login link again.`
        : "Waiting for first sign-in";
  return (
    <li className={`flex flex-col gap-2 px-5 py-3.5 ${ROW_GRID}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground" aria-hidden>
          <Mail className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{row.email}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <Badge variant={ROLE_META[row.role].variant} size="sm">{row.collaboratorPolicy?.affiliation.badgeLabel ?? ROLE_META[row.role].label}</Badge>
            <span>Invited by {row.createdBy.name}</span>
          </div>
        </div>
      </div>
      <div>{statusBadge(row.onboardingStatus)}</div>
      <div className="text-sm text-muted-foreground">
        <div>{formatRelativeTime(row.createdAt, now)}</div>
        <div className="text-xs">{formatDateFull(row.createdAt)}</div>
      </div>
      <div className="text-sm text-muted-foreground">{next}</div>
      <div className="md:text-right">
        <OperationalRowActions label={`Actions for ${row.email}`}>
          {!row.claimedAt ? (
            <>
              <DropdownMenuItem onClick={onEmail} disabled={emailing}><Send className="size-4" />{emailing ? "Sending..." : "Email login link"}</DropdownMenuItem>
              <DropdownMenuItem onClick={onCopy}><Copy className="size-4" />Copy app login link</DropdownMenuItem>
              <DropdownMenuItem asChild><Link href={loginHref} target="_blank" rel="noreferrer"><ExternalLink className="size-4" />Open app login</Link></DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={onRemove} disabled={deleting}>
                <Trash2 className="size-4" />{deleting ? "Removing..." : "Remove pending invite"}
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem disabled>Claimed invites stay for audit</DropdownMenuItem>
          )}
        </OperationalRowActions>
      </div>
    </li>
  );
}

function AccountRow({ account }: { account: ReadinessAccount }) {
  const percent = account.totalCount > 0 ? Math.round((account.completedCount / account.totalCount) * 100) : 0;
  const missing = account.missingFields.map((field) => READINESS_FIELD_LABELS[field] ?? field);
  return (
    <li className={`flex flex-col gap-2 px-5 py-3.5 ${ROW_GRID}`}>
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary" aria-hidden>
          {initialsOf(account.name)}
        </span>
        <div className="min-w-0">
          <Link href={`/staff/${account.id}`} className="block truncate text-sm font-bold text-foreground hover:underline">{account.name}</Link>
          <div className="truncate text-xs text-muted-foreground">{account.email}</div>
        </div>
      </div>
      <div>{accountStatus(account)}</div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`${account.name} profile progress`}>
          <div className={`h-full rounded-full ${account.profileComplete ? "bg-[#218358]" : "bg-primary"}`} style={{ width: `${percent}%` }} />
        </div>
        <span className="tabular-nums">{account.completedCount}/{account.totalCount}</span>
      </div>
      <div className="text-sm text-muted-foreground">{missing.length ? `Missing ${missing.join(", ")}` : "Everything done"}</div>
      <div className="md:text-right">
        <Button asChild variant="ghost" className="h-10 px-3 text-sm">
          <Link href={`/staff/${account.id}`} aria-label={`Open ${account.name}`}>Open</Link>
        </Button>
      </div>
    </li>
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
