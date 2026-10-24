"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { copyTextToClipboard } from "@/lib/clipboard";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { SettingsGroup } from "./SettingsGroup";

type FeedStatus = { hasToken: boolean; feedUrl?: string | null };

const FEED_QUERY_KEY = ["shifts", "ics-token"] as const;

/**
 * Private ICS feed of the viewer's shifts. The token is stored hashed, so the
 * URL is only visible right after it is created; afterwards the only option is
 * a reset, which breaks existing subscriptions (same rule as the iOS sheet).
 */
export function ShiftCalendarFeed() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const feedQuery = useQuery({
    queryKey: FEED_QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/shifts/ics-token", { signal });
      if (handleAuthRedirect(res, "/settings/profile")) throw new DOMException("Auth redirect", "AbortError");
      const json = res.ok ? await parseJsonSafely<{ data?: FeedStatus }>(res) : null;
      if (!json?.data) throw new Error("Calendar feed unavailable");
      return json.data;
    },
    retry: false,
    // The feed URL is shown only right after it is created; drop it on leave.
    gcTime: 0,
  });
  const status = feedQuery.data ?? null;
  const failed = feedQuery.isError;
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (busy) return;
    if (status?.hasToken) {
      const ok = await confirm({
        title: "Reset private link?",
        message: "Existing calendar subscriptions will stop updating. You'll need to subscribe again with the new link.",
        confirmLabel: "Reset link",
        variant: "danger",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/shifts/ics-token", { method: "POST" });
      if (handleAuthRedirect(res, "/settings/profile")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not create the calendar link"));
        return;
      }
      const json = await parseJsonSafely<{ data?: FeedStatus }>(res);
      queryClient.setQueryData<FeedStatus>(FEED_QUERY_KEY, { hasToken: true, feedUrl: json?.data?.feedUrl ?? null });
    } catch {
      toast.error("Could not reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  async function copy(url: string) {
    if (await copyTextToClipboard(url)) toast.success("Link copied");
    else toast.error("Could not copy the link", { description: "Select it and copy it manually." });
  }

  // Collaborators have no shifts; the API refuses them, so the group stays hidden.
  if (failed) return null;

  const feedUrl = status?.feedUrl ?? null;
  return (
    <SettingsGroup
      title="Shift calendar"
      description="Your shifts in Apple Calendar, Google Calendar, or any app that takes a calendar link. It stays in sync."
    >
      {!status ? (
        <div className="px-4 py-3.5"><Skeleton className="h-10 w-48" /></div>
      ) : feedUrl ? (
        <div className="flex flex-col gap-3 px-4 py-3.5">
          <p className="m-0 text-[13px] text-muted-foreground">Copy it now. For your security it is only shown once.</p>
          <div className="flex gap-2">
            <Input
              readOnly
              aria-label="Private calendar link"
              value={feedUrl}
              className="h-10 font-mono text-xs"
              onFocus={(e) => e.target.select()}
            />
            <Button variant="outline" className="h-10" onClick={() => void copy(feedUrl)} aria-label="Copy link">
              <Copy className="size-4" />
            </Button>
          </div>
          <div>
            <Button asChild className="h-10">
              <a href={feedUrl.replace(/^https?/, "webcal")}>Subscribe in Calendar</a>
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <p className="m-0 min-w-0 flex-1 text-sm">
            {status.hasToken ? (
              <>
                <span className="font-bold">Your link is active.</span>{" "}
                <span className="text-muted-foreground">To add another calendar, reset it and subscribe again.</span>
              </>
            ) : (
              <span className="text-muted-foreground">Create a private link to subscribe.</span>
            )}
          </p>
          <Button className="h-10" variant={status.hasToken ? "outline" : "default"} onClick={() => void generate()} disabled={busy}>
            {busy ? <RefreshCw className="size-4 animate-spin" /> : null}
            {status.hasToken ? "Reset link" : "Create link"}
          </Button>
        </div>
      )}
    </SettingsGroup>
  );
}
