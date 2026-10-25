"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import type { UserDetail } from "../types";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClockIcon, Copy, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "@/components/ConfirmDialog";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { copyTextToClipboard } from "@/lib/clipboard";
import { formatRelativeTime } from "@/lib/format";
import Link from "next/link";
import { UserAvatar } from "@/components/UserAvatar";
import { type ApiEnvelope } from "./user-info-helpers";

/** Read-only summary: who this person reports to and whether the account is in use. */
export function ProfileGlanceCard({ user }: { user: UserDetail }) {
  const manager = user.directReport;
  return (
    <Card className="rounded-xl shadow-xs">
      <CardHeader>
        <CardTitle className="text-base font-black tracking-tight">At a glance</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pb-5 text-sm">
        <div>
          <p className="mb-1.5 text-xs font-bold text-muted-foreground">Reports to</p>
          {manager ? (
            <Link href={`/staff/${manager.id}`} className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-foreground no-underline transition-colors hover:bg-muted">
              <UserAvatar name={manager.name} avatarUrl={null} size="sm" />
              <span className="min-w-0 truncate font-bold">{manager.name}</span>
            </Link>
          ) : user.directReportName ? (
            <p className="text-muted-foreground">{user.directReportName} <span className="text-xs">(listed by name only)</span></p>
          ) : (
            <p className="text-muted-foreground">No manager linked yet.</p>
          )}
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Account</dt>
          <dd className="text-right font-bold">{user.active === false ? "Inactive" : "Active"}</dd>
          <dt className="text-muted-foreground">Last active</dt>
          <dd className="text-right font-bold">{user.lastActiveAt ? formatRelativeTime(user.lastActiveAt, new Date()) : "Never"}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}

/* ── My Hours Card ──────────────────────────────────────── */

type MyHoursData = {
  thisWeek: number;
  thisMonth: number;
  shiftCountWeek: number;
  shiftCountMonth: number;
};

async function fetchMyHours(): Promise<MyHoursData> {
  const r = await fetch("/api/shifts/my-hours");
  if (handleAuthRedirect(r)) throw new Error("Signed out");
  if (!r.ok) throw new Error("Failed to load hours");
  const j = await parseJsonSafely<ApiEnvelope<MyHoursData>>(r);
  if (!j?.data) throw new Error("Failed to load hours");
  return j.data;
}

export function MyHoursCard() {
  const { data: hours, isPending, isError, refetch } = useQuery({
    queryKey: ["shifts", "my-hours"],
    queryFn: fetchMyHours,
    staleTime: 5 * 60_000,
  });

  return (
    <Card id="hours" className="scroll-mt-16 rounded-xl shadow-xs">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ClockIcon className="size-4" />
          My hours
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-28" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ) : isError ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="m-0 text-sm text-muted-foreground">Hours could not load.</p>
            <Button type="button" variant="outline" className="h-10 shrink-0" onClick={() => void refetch()}>
              Retry hours
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-2xl font-bold tabular-nums">{hours?.thisWeek ?? 0}h</div>
              <div className="text-xs text-muted-foreground">
                This week ({hours?.shiftCountWeek ?? 0} shift{(hours?.shiftCountWeek ?? 0) !== 1 ? "s" : ""})
              </div>
            </div>
            <div>
              <div className="text-2xl font-bold tabular-nums">{hours?.thisMonth ?? 0}h</div>
              <div className="text-xs text-muted-foreground">
                This month ({hours?.shiftCountMonth ?? 0} shift{(hours?.shiftCountMonth ?? 0) !== 1 ? "s" : ""})
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Calendar Subscription Card ─────────────────────────── */

export function CalendarSubscriptionCard({
  initialHasToken,
  onTokenChange,
}: {
  initialHasToken: boolean;
  onTokenChange: () => void;
}) {
  // The feed token is stored as a hash, so the URL is only known right after
  // it is created (or once, when a pre-hashing token is upgraded on read).
  const [hasToken, setHasToken] = useState(initialHasToken);
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const confirm = useConfirm();

  const webcalUrl = feedUrl ? feedUrl.replace(/^https?/, "webcal") : null;

  useEffect(() => {
    if (!initialHasToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/shifts/ics-token");
        if (!res.ok || cancelled) return;
        const json = await parseJsonSafely<ApiEnvelope<{ feedUrl?: string | null }>>(res);
        if (!cancelled && json?.data?.feedUrl) setFeedUrl(json.data.feedUrl);
      } catch {
        // The card still offers Reset without the one-time URL.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialHasToken]);

  async function generateToken() {
    if (generating) return;
    // Rotating breaks every existing subscription, so it asks first -- the
    // same warning the iOS sheet gives.
    if (hasToken) {
      const ok = await confirm({
        title: "Reset private link?",
        message: "Existing calendar subscriptions will stop updating. You'll need to subscribe again with the new link.",
        confirmLabel: "Reset link",
        variant: "danger",
      });
      if (!ok) return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/shifts/ics-token", { method: "POST" });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to generate token");
        toast.error(msg);
      } else {
        const json = await parseJsonSafely<ApiEnvelope<{ feedUrl?: string }>>(res);
        setFeedUrl(json?.data?.feedUrl ?? null);
        setHasToken(true);
        onTokenChange();
      }
    } catch {
      toast.error("Network error");
    } finally {
      setGenerating(false);
    }
  }

  async function copyUrl() {
    if (!feedUrl) return;
    const copied = await copyTextToClipboard(feedUrl);
    if (copied) {
      toast.success("Feed URL copied");
      return;
    }
    toast.error("Could not copy the feed URL", {
      description: "Select the visible URL and copy it manually.",
    });
  }

  return (
    <Card id="calendar" className="scroll-mt-16 rounded-xl shadow-xs">
      <CardHeader>
        <CardTitle className="text-base font-black tracking-tight">Calendar subscription</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {feedUrl ? (
          <>
            <p className="text-sm text-muted-foreground">
              Subscribe to your shifts in Apple Calendar, Google Calendar, or any app that supports ICS feeds.
              The URL stays in sync — no re-subscribing needed. Copy it now: for your security it is only
              shown when it is created.
            </p>
            <div className="flex gap-2">
              <Input
                readOnly
                value={feedUrl ?? ""}
                className="h-10 text-xs font-mono"
                onFocus={(e) => e.target.select()}
              />
              <Button variant="outline" className="h-10" onClick={() => void copyUrl()} title="Copy URL">
                <Copy className="size-4" />
              </Button>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button asChild className="h-10">
                <a href={webcalUrl ?? "#"}>Subscribe in Calendar</a>
              </Button>
              <Button className="h-10"
                variant="outline"
                onClick={generateToken}
                disabled={generating}
                title="Rotate token — invalidates the old URL"
              >
                {generating ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Rotate URL
              </Button>
            </div>
          </>
        ) : hasToken ? (
          <>
            <p className="text-sm text-muted-foreground">
              Your calendar feed is active. The private link is only shown when it is created, so to
              subscribe another calendar, reset it and subscribe again with the new link.
            </p>
            <Button className="h-10" variant="outline" onClick={generateToken} disabled={generating}>
              {generating ? <RefreshCw className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              Reset link
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              Generate a private URL to subscribe to your shifts in any calendar app.
            </p>
            <Button className="h-10" onClick={generateToken} disabled={generating}>
              {generating && <RefreshCw className="size-4 animate-spin mr-2" />}
              Generate feed URL
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
