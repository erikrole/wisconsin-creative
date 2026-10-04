"use client";

import { CircleAlertIcon, CircleCheckIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/ConfirmDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ConnectionStatus } from "@/lib/youtube/connection";

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;

export function ConnectionCard({ status, result }: { status: ConnectionStatus; result: { tone: "ok" | "error"; text: string } | null }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);

  async function handleDisconnect() {
    const proceed = await confirm({
      title: "Disconnect YouTube?",
      message: "The tool will stop reading and editing the Badgers channel until an admin connects it again.",
      confirmLabel: "Disconnect",
      variant: "danger",
    });
    if (!proceed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/youtube/connection", { method: "DELETE" });
      if (!res.ok) throw new Error("Disconnect failed");
      toast.success("YouTube disconnected");
      router.replace("/youtube");
      router.refresh();
    } catch {
      toast.error("Could not disconnect. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const connectedBy = [status.connectedByName, dateTime(status.connectedAt)].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-4">
      {result && (
        <Alert variant={result.tone === "error" ? "destructive" : "default"}>
          {result.tone === "error" ? <CircleAlertIcon /> : <CircleCheckIcon />}
          <AlertDescription>{result.text}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Channel connection</CardTitle>
          <CardDescription>
            {!status.configured
              ? "Google sign-in is not set up for this environment."
              : status.connected
                ? `Connected to ${status.channelTitle}${connectedBy ? ` by ${connectedBy}` : ""}.`
                : status.needsReconnect
                  ? `Google stopped accepting the saved connection to ${status.channelTitle}. Connect again to continue.`
                  : "Not connected. Sign in with a Google account that manages the Wisconsin Badgers channel."}
          </CardDescription>
        </CardHeader>
        {status.configured && (
          <CardContent className="flex flex-wrap gap-2">
            {/* A plain link: the start route redirects the browser to Google. */}
            <Button asChild variant={status.connected ? "outline" : "brand"}>
              <a href="/api/youtube/oauth/start">{status.connected ? "Reconnect" : "Connect YouTube"}</a>
            </Button>
            {(status.connected || status.needsReconnect) && (
              <Button variant="ghost" onClick={handleDisconnect} disabled={busy}>
                Disconnect
              </Button>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
