"use client";

import { useState } from "react";
import Link from "next/link";
import { MegaphoneIcon, RefreshCwIcon } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { cn } from "@/lib/utils";
import { ComposeBlastDialog } from "./_components/ComposeBlastDialog";
import { SEVERITY_VARIANT, SEVERITY_LABEL, type BlastSeverity } from "./_severity";

type BlastRow = {
  id: string;
  title: string;
  body: string;
  severity: BlastSeverity;
  status: "SENDING" | "SENT" | "CANCELLED";
  targetSummary: string;
  recipientCount: number;
  acknowledgedCount: number;
  sentAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
};

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return date.toLocaleDateString();
}

export default function BlastsPage() {
  const [composeOpen, setComposeOpen] = useState(false);
  const { data, loading, refreshing, error, reload } = useFetch<BlastRow[]>({
    url: "/api/blasts?limit=50",
    returnTo: "/blasts",
    transform: (json) => (json.data as BlastRow[]) ?? [],
  });

  const blasts = data ?? [];
  const waitingCount = blasts.reduce((sum, blast) => {
    if (blast.cancelledAt) return sum;
    return sum + Math.max(0, blast.recipientCount - blast.acknowledgedCount);
  }, 0);

  return (
    <>
      <PageHeader
        title="Blasts"
        description="Broadcast to the people working an event, and see who has acknowledged."
      >
        <Button
          variant="outline"
          className="h-10"
          onClick={reload}
          disabled={loading || refreshing}
        >
          <RefreshCwIcon
            aria-hidden="true"
            className={cn(refreshing && "animate-spin")}
          />
          Refresh
        </Button>
        <Button className="h-10" onClick={() => setComposeOpen(true)}>
          <MegaphoneIcon aria-hidden="true" />
          New blast
        </Button>
      </PageHeader>

      {loading && !data ? (
        <div className="space-y-2" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      ) : error && !data ? (
        <EmptyState
          icon={error === "network" ? "wifi-off" : "bell"}
          title={error === "network" ? "Blasts are offline" : "Could not load blasts"}
          description={
            error === "network"
              ? "Check your connection and try again."
              : "The blast history is temporarily unavailable."
          }
          actionLabel="Try again"
          onAction={reload}
        />
      ) : blasts.length === 0 ? (
        <EmptyState
          icon="bell"
          title="No blasts yet"
          description="Send one when a call time moves, a gate changes, or the crew needs to know something now."
          actionLabel="New blast"
          onAction={() => setComposeOpen(true)}
        />
      ) : (
        <div className="space-y-3">
          {waitingCount > 0 && (
            <p className="text-sm text-muted-foreground">
              <span className="tabular-nums text-[var(--orange-text)]">{waitingCount}</span>
              {" "}
              still waiting to acknowledge across open blasts.
            </p>
          )}
          <div className={cn("space-y-2", refreshing && "opacity-70")} aria-busy={refreshing}>
            {blasts.map((blast) => {
              const pending = blast.recipientCount - blast.acknowledgedCount;
              return (
                <Card key={blast.id} className="transition-colors hover:bg-accent/40">
                  <CardContent className="p-0">
                    <Link
                      href={`/blasts/${blast.id}`}
                      className="block rounded-xl p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={SEVERITY_VARIANT[blast.severity]}>
                          {SEVERITY_LABEL[blast.severity]}
                        </Badge>
                        {blast.status === "SENDING" && <Badge variant="orange">Sending</Badge>}
                        {blast.cancelledAt && <Badge variant="gray">Cancelled</Badge>}
                        <span className="font-semibold">{blast.title}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {relativeTime(blast.sentAt ?? blast.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{blast.body}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span className="truncate">{blast.targetSummary}</span>
                        <span className="tabular-nums">
                          {blast.acknowledgedCount}/{blast.recipientCount} acknowledged
                        </span>
                        {pending > 0 && !blast.cancelledAt && (
                          <span className="tabular-nums text-[var(--orange-text)]">
                            {pending} still waiting
                          </span>
                        )}
                        {blast.createdBy && <span>· {blast.createdBy.name}</span>}
                      </div>
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <ComposeBlastDialog open={composeOpen} onOpenChange={setComposeOpen} onSent={reload} />
    </>
  );
}
