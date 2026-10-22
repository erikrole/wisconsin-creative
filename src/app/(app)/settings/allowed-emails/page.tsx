"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import EmptyState from "@/components/EmptyState";
import OnboardingDialog from "@/components/onboarding/OnboardingDialog";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import { cn } from "@/lib/utils";
import { SettingsGroup } from "../_components/SettingsGroup";
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
  const filters = [
    { value: "all", label: "All", count: totalAll },
    { value: "unclaimed", label: "Pending", count: totalPending },
    { value: "claimed", label: "Joined", count: totalClaimed },
  ] as const;

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

  const description = "Only people on this list can create an account. Each address joins with the role you pick.";
  const actions = (
    <>
      <Button asChild variant="outline" className="min-h-10">
        <Link href="/staff/onboarding-status">
          <ClipboardList data-icon="inline-start" />
          Status
        </Link>
      </Button>
      <Button className="min-h-10" onClick={() => setShowOnboarding(true)}>
        <UserPlus data-icon="inline-start" />
        Add users
      </Button>
    </>
  );

  if (loading) {
    return (
      <SettingsPageShell href="/settings/allowed-emails" description={description} mainClassName="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-xl border p-4">
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
        <SettingsGroup>
          <div className="flex flex-col items-center gap-4 px-4 py-12 text-center">
            <Icon className="size-8 text-muted-foreground" />
            <div>
              <p className="m-0 text-sm font-bold">
                {error === "network" ? "Connection failed" : "Something went wrong"}
              </p>
              <p className="m-0 mt-1 text-sm text-muted-foreground">
                {error === "network"
                  ? "Could not connect to server. Check your connection."
                  : "Failed to load allowed emails. Please try again."}
              </p>
            </div>
            <Button variant="outline" onClick={reload}>
              <RefreshCw className="size-4" />
              Retry
            </Button>
          </div>
        </SettingsGroup>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell href="/settings/allowed-emails" description={description} actions={actions} mainClassName="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label="Allowed email status filter"
        className="inline-flex w-fit rounded-lg bg-muted p-0.5"
      >
        {filters.map((filter) => {
          const selected = statusFilter === filter.value;
          return (
            <button
              key={filter.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setStatusFilter(filter.value)}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-md px-3 text-sm transition-colors",
                selected ? "bg-background font-bold text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {filter.label}
              <span className="tabular-nums text-muted-foreground">{filter.count}</span>
            </button>
          );
        })}
      </div>

      <OnboardingDialog
        open={showOnboarding}
        onOpenChange={setShowOnboarding}
        currentUserRole={currentUserRole}
        onInvitesChanged={() => reload()}
      />

      <SettingsGroup>
        {items.length === 0 ? (
          <EmptyState
            inline
            icon={statusFilter === "all" ? "users" : "search"}
            title={statusFilter === "all" ? "No allowed emails yet" : "Nothing here"}
            description={
              statusFilter === "all"
                ? "Add an address to let someone register with the assigned role."
                : statusFilter === "unclaimed"
                  ? "Everyone on the list has joined."
                  : "Nobody on the list has joined yet."
            }
          />
        ) : (
          items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-sm font-bold text-foreground">{item.email}</span>
                  <Badge variant={ROLE_BADGE_META[item.role].variant} size="sm">
                    {ROLE_BADGE_META[item.role].label}
                  </Badge>
                </div>
                <p className="m-0 mt-0.5 text-[13px] text-muted-foreground">
                  {item.claimedAt
                    ? `Joined${item.claimedBy ? ` as ${item.claimedBy.name}` : ""}`
                    : <span className="font-bold text-[var(--blue-text)]">Waiting to sign up</span>}
                  {" · "}Added by {item.createdBy.name}
                  {lastEdited[item.id] ? <> · <LastEditedHint info={lastEdited[item.id]} className="text-[13px]" /></> : null}
                </p>
              </div>
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
            </div>
          ))
        )}
      </SettingsGroup>
    </SettingsPageShell>
  );
}
