"use client";

import { use, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ArrowLeftIcon, BanIcon, RefreshCwIcon } from "lucide-react";
import { BreadcrumbLabel } from "@/components/BreadcrumbContext";
import { PageHeader } from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { UserAvatar } from "@/components/UserAvatar";
import { useConfirm } from "@/components/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFetch } from "@/hooks/use-fetch";
import { classifyError, isAbortError, parseErrorMessage, handleAuthRedirect, ERROR_MESSAGES } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { SEVERITY_LABEL, SEVERITY_VARIANT, type BlastSeverity } from "../_severity";

type PushStatus = "PENDING" | "SENT" | "SKIPPED_PREFS" | "NO_DEVICE" | "FAILED";

const PUSH_LABEL: Record<PushStatus, string> = {
  PENDING: "Sending",
  SENT: "Sent",
  // Deliberately explicit: an admin chasing an unacknowledged urgent blast needs to
  // know whether the push never went out or went out and was ignored.
  SKIPPED_PREFS: "Skipped — notifications paused",
  NO_DEVICE: "No device",
  FAILED: "Failed",
};

const PUSH_VARIANT: Record<PushStatus, "green" | "gray" | "orange" | "red"> = {
  PENDING: "gray",
  SENT: "green",
  SKIPPED_PREFS: "orange",
  NO_DEVICE: "gray",
  FAILED: "red",
};

type Recipient = {
  userId: string;
  pushStatus: PushStatus;
  deliveredAt: string | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  user: {
    id: string;
    name: string;
    role: string;
    primaryArea: string | null;
    staffingType: string;
    avatarUrl: string | null;
  };
};

type BlastDetail = {
  id: string;
  title: string;
  body: string;
  severity: BlastSeverity;
  status: "SENDING" | "SENT" | "CANCELLED";
  targetSummary: string;
  requiresAck: boolean;
  expiresAt: string | null;
  recipientCount: number;
  sentAt: string | null;
  cancelledAt: string | null;
  createdBy: { id: string; name: string } | null;
  cancelledBy: { id: string; name: string } | null;
  event: { id: string; summary: string; startsAt: string } | null;
  recipients: Recipient[];
  addedSinceSend: Array<{ id: string; name: string }>;
};

type Filter = "all" | "unacked" | "unread" | "push_problem";

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unacked", label: "Not acknowledged" },
  { value: "unread", label: "Not read" },
  { value: "push_problem", label: "Push problem" },
];

function time(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";
}

function ackDuration(sentAt: string | null, acknowledgedAt: string | null): string {
  if (!sentAt || !acknowledgedAt) return "—";
  const minutes = Math.round(
    (new Date(acknowledgedAt).getTime() - new Date(sentAt).getTime()) / 60_000,
  );
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function RecipientCard({
  recipient,
  sentAt,
}: {
  recipient: Recipient;
  sentAt: string | null;
}) {
  return (
    <div className="space-y-2 border-b p-4 last:border-b-0">
      <div className="flex items-center gap-2">
        <UserAvatar
          name={recipient.user.name}
          avatarUrl={recipient.user.avatarUrl}
          size="xs"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{recipient.user.name}</p>
          <p className="text-xs text-muted-foreground">
            {recipient.user.primaryArea ?? "No area"}
          </p>
        </div>
        <Badge variant={PUSH_VARIANT[recipient.pushStatus]} size="sm">
          {PUSH_LABEL[recipient.pushStatus]}
        </Badge>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <div>
          <dt className="inline">Delivered </dt>
          <dd className="inline">{time(recipient.deliveredAt)}</dd>
        </div>
        <div>
          <dt className="inline">Read </dt>
          <dd className="inline">{time(recipient.readAt)}</dd>
        </div>
        <div>
          <dt className="inline">Acknowledged </dt>
          <dd className={cn("inline", recipient.acknowledgedAt && "text-foreground")}>
            {time(recipient.acknowledgedAt)}
          </dd>
        </div>
        <div className="text-right tabular-nums">
          <dt className="inline">Time to ack </dt>
          <dd className="inline">{ackDuration(sentAt, recipient.acknowledgedAt)}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function BlastDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const confirm = useConfirm();
  const [filter, setFilter] = useState<Filter>("all");
  const [cancelling, setCancelling] = useState(false);

  const { data, loading, refreshing, error, reload } = useFetch<BlastDetail | null>({
    url: `/api/blasts/${id}`,
    returnTo: `/blasts/${id}`,
    transform: (json) => (json.data as BlastDetail) ?? null,
  });

  const stats = useMemo(() => {
    const recipients = data?.recipients ?? [];
    return {
      acknowledged: recipients.filter((r) => r.acknowledgedAt).length,
      read: recipients.filter((r) => r.readAt).length,
      pushSent: recipients.filter((r) => r.pushStatus === "SENT").length,
      skipped: recipients.filter((r) => r.pushStatus === "SKIPPED_PREFS").length,
      noDevice: recipients.filter(
        (r) => r.pushStatus === "NO_DEVICE" || r.pushStatus === "FAILED",
      ).length,
    };
  }, [data]);

  const visible = useMemo(() => {
    const recipients = data?.recipients ?? [];
    switch (filter) {
      case "unacked":
        return recipients.filter((r) => !r.acknowledgedAt);
      case "unread":
        return recipients.filter((r) => !r.readAt);
      case "push_problem":
        return recipients.filter(
          (r) => r.pushStatus !== "SENT" && r.pushStatus !== "PENDING",
        );
      default:
        return recipients;
    }
  }, [data, filter]);

  async function cancel() {
    if (!data) return;
    const ok = await confirm({
      title: "Cancel this blast?",
      message:
        "The banner disappears for everyone who has not acknowledged it yet. Push alerts already delivered to phones cannot be recalled.",
      confirmLabel: "Cancel blast",
      variant: "danger",
    });
    if (!ok) return;

    setCancelling(true);
    try {
      const res = await fetch(`/api/blasts/${id}/cancel`, { method: "POST" });
      if (handleAuthRedirect(res, `/blasts/${id}`)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not cancel that blast."));
        return;
      }
      toast.success("Blast cancelled.");
      reload();
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error(ERROR_MESSAGES[classifyError(err)].description);
    } finally {
      setCancelling(false);
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <>
        <div className="mb-4">
          <Button asChild variant="ghost" className="h-10 px-2">
            <Link href="/blasts">
              <ArrowLeftIcon aria-hidden="true" />
              Back to blasts
            </Link>
          </Button>
        </div>
        <EmptyState
          icon={error === "network" ? "wifi-off" : "bell"}
          title={error === "network" ? "Blast detail is offline" : "Could not load this blast"}
          description={
            error === "network"
              ? "Check your connection and try again."
              : "Acknowledgment status is temporarily unavailable."
          }
          actionLabel="Try again"
          onAction={reload}
        />
      </>
    );
  }

  if (!data) {
    return (
      <>
        <div className="mb-4">
          <Button asChild variant="ghost" className="h-10 px-2">
            <Link href="/blasts">
              <ArrowLeftIcon aria-hidden="true" />
              Back to blasts
            </Link>
          </Button>
        </div>
        <EmptyState
          icon="bell"
          title="Blast not found"
          description="It may have been removed, or the link is no longer valid."
          actionLabel="Back to blasts"
          actionHref="/blasts"
        />
      </>
    );
  }

  const ackPercent =
    data.recipientCount > 0
      ? Math.round((stats.acknowledged / data.recipientCount) * 100)
      : 0;

  return (
    <>
      <BreadcrumbLabel label={data.title} />
      <PageHeader
        title={data.title}
        description={data.targetSummary}
        titleAccessory={
          <Badge variant={SEVERITY_VARIANT[data.severity]}>{SEVERITY_LABEL[data.severity]}</Badge>
        }
      >
        <Button
          variant="outline"
          className="h-10"
          onClick={reload}
          disabled={loading || refreshing || cancelling}
        >
          <RefreshCwIcon
            aria-hidden="true"
            className={cn(refreshing && "animate-spin")}
          />
          Refresh
        </Button>
        {!data.cancelledAt && (
          <Button variant="outline" className="h-10" onClick={cancel} disabled={cancelling}>
            <BanIcon aria-hidden="true" />
            Cancel blast
          </Button>
        )}
      </PageHeader>

      <div className={cn("space-y-4", refreshing && "opacity-70")} aria-busy={refreshing}>
        <Card>
          <CardContent className="space-y-3 p-4">
            <p className="text-sm">{data.body}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {data.createdBy && <span>Sent by {data.createdBy.name}</span>}
              <span>{time(data.sentAt)}</span>
              {data.expiresAt && <span>Banner expires {time(data.expiresAt)}</span>}
              {data.cancelledAt && (
                <span className="text-destructive">
                  Cancelled {time(data.cancelledAt)}
                  {data.cancelledBy ? ` by ${data.cancelledBy.name}` : ""}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              <span className="font-semibold tabular-nums">
                {stats.acknowledged}/{data.recipientCount} acknowledged
              </span>
              <span className="text-muted-foreground tabular-nums">Read {stats.read}</span>
              <span className="text-muted-foreground tabular-nums">Push sent {stats.pushSent}</span>
              {stats.skipped > 0 && (
                <span className="text-[var(--orange-text)] tabular-nums">
                  Paused {stats.skipped}
                </span>
              )}
              {stats.noDevice > 0 && (
                <span className="text-muted-foreground tabular-nums">
                  No device {stats.noDevice}
                </span>
              )}
            </div>
            <Progress value={ackPercent} aria-label={`${ackPercent}% acknowledged`} />
            {data.addedSinceSend.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {data.addedSinceSend.length}{" "}
                {data.addedSinceSend.length === 1 ? "person was" : "people were"} added to this
                target after the blast was sent and did not receive it:{" "}
                {data.addedSinceSend.map((u) => u.name).join(", ")}.
              </p>
            )}
          </CardContent>
        </Card>

        <ToggleGroup
          type="single"
          value={filter}
          onValueChange={(value) => {
            if (value) setFilter(value as Filter);
          }}
          className="flex flex-wrap justify-start gap-1.5"
          aria-label="Filter recipients"
        >
          {FILTERS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="h-10 px-3">
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <Card>
          <CardContent className="p-0">
            {visible.length === 0 ? (
              <EmptyState
                icon="users"
                title="Nobody matches that filter"
                description="Try another filter to inspect delivery or acknowledgments."
                compact
              />
            ) : (
              <>
                <div className="md:hidden">
                  {visible.map((recipient) => (
                    <RecipientCard
                      key={recipient.userId}
                      recipient={recipient}
                      sentAt={data.sentAt}
                    />
                  ))}
                </div>
                <div className="hidden md:block">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Person</TableHead>
                        <TableHead>Area</TableHead>
                        <TableHead>Push</TableHead>
                        <TableHead>Delivered</TableHead>
                        <TableHead>Read</TableHead>
                        <TableHead>Acknowledged</TableHead>
                        <TableHead className="text-right">Time to ack</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {visible.map((recipient) => (
                        <TableRow key={recipient.userId}>
                          <TableCell>
                            <span className="flex items-center gap-2">
                              <UserAvatar
                                name={recipient.user.name}
                                avatarUrl={recipient.user.avatarUrl}
                                size="xs"
                              />
                              <span className="truncate">{recipient.user.name}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {recipient.user.primaryArea ?? "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={PUSH_VARIANT[recipient.pushStatus]} size="sm">
                              {PUSH_LABEL[recipient.pushStatus]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {time(recipient.deliveredAt)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {time(recipient.readAt)}
                          </TableCell>
                          <TableCell
                            className={recipient.acknowledgedAt ? "" : "text-muted-foreground"}
                          >
                            {time(recipient.acknowledgedAt)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {ackDuration(data.sentAt, recipient.acknowledgedAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
