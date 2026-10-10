"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";

export function FootballResultsRefresh({ onRefresh }: { onRefresh: () => void }) {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function refresh() {
    if (pending) return;
    setPending(true); setMessage(null);
    try {
      const response = await fetch("/api/scoreboard/results/refresh", { method: "POST" });
      if (handleAuthRedirect(response, "/scoreboard")) return;
      const body = await parseJsonSafely<{ data?: { ok: boolean; updated: number }; error?: string }>(response);
      if (!response.ok || !body?.data) {
        setMessage(response.status === 409 ? "Another refresh is running or a game needs review. Try again shortly."
          : "Refresh could not be confirmed. Reload Scoreboard before trying again.");
      } else {
        setMessage(body.data.ok ? "Football sources refreshed." : "Some games could not be verified. Previous scores have been kept where available.");
      }
      onRefresh();
    } catch {
      setMessage("Connection lost. Reload Scoreboard to check whether the refresh finished.");
      onRefresh();
    } finally { setPending(false); }
  }
  return <div className="flex flex-wrap items-center gap-3 border-b border-border/40 px-4 py-2">
    <Button variant="outline" size="sm" className="h-10" disabled={pending} onClick={refresh}>{pending ? "Checking sources…" : "Refresh football scores"}</Button>
    {message && <p role="status" className="text-xs text-muted-foreground">{message}</p>}
  </div>;
}
