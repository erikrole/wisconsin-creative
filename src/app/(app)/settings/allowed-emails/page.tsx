"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import OnboardingDialog from "@/components/onboarding/OnboardingDialog";
import { OperationalMetricCard } from "@/components/OperationalFeedback";
import { OperationalStatusRail, type OperationalStatusRailItem } from "@/components/OperationalStatusRail";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  ClipboardList,
  RefreshCw,
  Trash2,
  UserPlus,
  WifiOff,
} from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useFetch } from "@/hooks/use-fetch";
import { useLastAudit } from "@/hooks/use-last-audit";
import { LastEditedHint } from "@/components/LastEditedHint";
import { handleAuthRedirect, classifyError, isAbortError, parseErrorMessage } from "@/lib/errors";
import { SettingsPageShell } from "../SettingsPageShell";

type AllowedEmail = {
  id: string;
  email: string;
  role: "ADMIN" | "STAFF" | "STUDENT" | "COLLABORATOR";
  claimedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  claimedBy: { id: string; name: string } | null;
};

type AllowedEmailsResponse = { data: AllowedEmail[]; total: number };

const ROLE_BADGE_META: Record<AllowedEmail["role"], { label: string; variant: BadgeProps["variant"] }> = {
  ADMIN: { label: "Admin", variant: "purple" },
  STAFF: { label: "Staff", variant: "blue" },
  STUDENT: { label: "Student", variant: "gray" },
  COLLABORATOR: { label: "Collaborator", variant: "blue" },
};

export default function AllowedEmailsPage() {
  const confirm = useConfirm();

  // Filter (client-side so the count badges always reflect the unfiltered totals)
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: emailsData, loading, error, reload } = useFetch<AllowedEmailsResponse>({
    url: "/api/allowed-emails?limit=500",
    returnTo: "/settings/allowed-emails",
    transform: (json) => ({ data: (json.data as AllowedEmail[]) ?? [], total: (json.total as number) ?? 0 }),
  });

  const { data: meData } = useFetch<{ id: string; role: AllowedEmail["role"] }>({
    url: "/api/me",
    transform: (json) => (json as Record<string, unknown>).user as { id: string; role: AllowedEmail["role"] },
    refetchOnFocus: false,
  });
  const currentUserRole = meData?.role ?? null;

  // Local state for optimistic mutation updates
  const [localItems, setLocalItems] = useState<AllowedEmail[] | null>(null);
  const allItems = localItems ?? emailsData?.data ?? [];
  const [prevData, setPrevData] = useState(emailsData);
  if (emailsData !== prevData) {
    setPrevData(emailsData);
    setLocalItems(null);
  }

  const lastEdited = useLastAudit("allowed_email", allItems.map((i) => i.id));

  const totalAll = allItems.length;
  const totalPending = allItems.filter((i) => !i.claimedAt).length;
  const totalClaimed = totalAll - totalPending;
  const items = statusFilter === "unclaimed"
    ? allItems.filter((i) => !i.claimedAt)
    : statusFilter === "claimed"
      ? allItems.filter((i) => i.claimedAt)
      : allItems;

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const railItems: OperationalStatusRailItem[] = totalPending > 0 ? [{
    id: "pending",
    label: "Pending",
    value: totalPending,
    detail: "Allowlist entries waiting for registration.",
    icon: UserPlus,
    tone: "info",
    onSelect: () => setStatusFilter("unclaimed"),
  }] : [];

  async function handleDelete(item: AllowedEmail) {
    const ok = await confirm({
      title: "Remove from allowlist",
      message: `Remove ${item.email} from the registration allowlist? This only affects unclaimed registration access; existing users are not changed.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;

    setDeletingId(item.id);
    try {
      const res = await fetch(`/api/allowed-emails/${item.id}`, {
        method: "DELETE",
      });
      if (handleAuthRedirect(res, "/settings/allowed-emails")) return;
      if (res.ok) {
        setLocalItems((prev) => (prev ?? allItems).filter((i) => i.id !== item.id));
        toast.success("Email removed from allowlist");
      } else {
        const msg = await parseErrorMessage(res, "Failed to remove email");
        toast.error(msg);
      }
    } catch (err) {
      if (isAbortError(err)) return;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You\u2019re offline. Check your connection." : "Failed to remove email");
    }
    setDeletingId(null);
  }

  const description = "Manage which email addresses can register for an account. Only pre-approved emails can sign up.";

  if (loading) {
    return (
      <SettingsPageShell href="/settings/allowed-emails" description={description} mainClassName="flex flex-col gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 rounded-md border p-4">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            ))}
      </SettingsPageShell>
    );
  }

  if (error) {
    const Icon = error === "network" ? WifiOff : AlertTriangle;
    return (
      <SettingsPageShell href="/settings/allowed-emails" description={description}>
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <Icon className="size-10 text-muted-foreground" />
                <div>
                  <p className="font-semibold">
                    {error === "network" ? "Connection Failed" : "Something Went Wrong"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {error === "network"
                      ? "Could not connect to server. Check your connection."
                      : "Failed to load allowed emails. Please try again."}
                  </p>
                </div>
                <Button variant="outline" onClick={reload}>
                  <RefreshCw className="size-4" />
                  Retry
                </Button>
              </CardContent>
            </Card>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell href="/settings/allowed-emails" description={description} mainClassName="flex flex-col gap-4">
        {/* Onboarding overview */}
        <OperationalStatusRail
          orientation={{
            label: "Allowlist",
            value: `${totalAll} ${totalAll === 1 ? "entry" : "entries"}`,
            icon: ClipboardList,
          }}
          items={railItems}
          allClearLabel={railItems.length === 0 ? "All allowlist entries are claimed" : undefined}
          details={(
            <div className="grid gap-2 sm:grid-cols-3">
              <OperationalMetricCard label="Total" value={totalAll} helper="on the allowlist" onClick={() => setStatusFilter("all")} ariaPressed={statusFilter === "all"} />
              <OperationalMetricCard label="Pending" value={totalPending} tone={totalPending ? "blue" : "muted"} helper="awaiting sign-up" onClick={() => setStatusFilter("unclaimed")} ariaPressed={statusFilter === "unclaimed"} />
              <OperationalMetricCard label="Claimed" value={totalClaimed} helper="registered" onClick={() => setStatusFilter("claimed")} ariaPressed={statusFilter === "claimed"} />
            </div>
          )}
        />

        {/* Controls row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger
              id="allowed-email-status-filter"
              name="allowedEmailStatusFilter"
              className="h-10 w-[160px]"
              aria-label="Allowed email status filter"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="unclaimed">Pending</SelectItem>
              <SelectItem value="claimed">Claimed</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex flex-wrap items-center gap-2">
            <Button className="min-h-10" onClick={() => setShowOnboarding(true)}>
              <UserPlus data-icon="inline-start" />
              Add users
            </Button>
            <Button asChild variant="outline" className="min-h-10">
              <Link href="/users/onboarding-status">
                <ClipboardList data-icon="inline-start" />
                Status
              </Link>
            </Button>
          </div>
        </div>

        <OnboardingDialog
          open={showOnboarding}
          onOpenChange={setShowOnboarding}
          currentUserRole={currentUserRole}
          onInvitesChanged={() => reload()}
        />

        {/* Table */}
        <Card>
          <CardHeader className="pb-0">
            <CardTitle className="text-base">
              {statusFilter === "unclaimed"
                ? "Pending invitations"
                : statusFilter === "claimed"
                  ? "Claimed invitations"
                  : "All allowed emails"}
            </CardTitle>
          </CardHeader>
          {items.length === 0 ? (
            <CardContent className="py-0">
              <EmptyState
                inline
                icon={statusFilter === "all" ? "users" : "search"}
                title={statusFilter === "all" ? "No allowed emails yet" : "No emails match this filter"}
                description={
                  statusFilter === "all"
                    ? "Add an address to let someone register with the assigned role."
                    : "Switch filters to review pending or claimed allowlist entries."
                }
              />
            </CardContent>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added by</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-0.5">
                        <span>{item.email}</span>
                        <LastEditedHint info={lastEdited[item.id]} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={ROLE_BADGE_META[item.role].variant} size="sm">
                        {ROLE_BADGE_META[item.role].label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {item.claimedAt ? (
                        <Badge variant="gray" size="sm">Claimed</Badge>
                      ) : (
                        <Badge variant="blue" size="sm">Pending</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {item.createdBy.name}
                    </TableCell>
                    <TableCell className="text-right">
                      <OperationalRowActions
                        label={`Actions for ${item.email}`}
                        icon={deletingId === item.id ? <Spinner /> : undefined}
                      >
                        <DropdownMenuItem
                          onSelect={() => handleDelete(item)}
                          disabled={!!item.claimedAt || deletingId === item.id}
                          variant="destructive"
                        >
                          <Trash2 className="size-4" />
                          {item.claimedAt ? "Claimed entries stay for audit" : "Remove from allowlist"}
                        </DropdownMenuItem>
                      </OperationalRowActions>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
    </SettingsPageShell>
  );
}
