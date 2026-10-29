"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Eye, EyeOff, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { toast } from "@/lib/toast";

type SharedWifi = { ssid: string; password: string; qrPayload: string };

export function WifiCard() {
  const { data, loading } = useFetch<SharedWifi>({ url: "/api/wifi", refetchOnFocus: false });
  const [qr, setQr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"ssid" | "password" | null>(null);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    QRCode.toDataURL(data.qrPayload, { margin: 1, width: 320, errorCorrectionLevel: "M" })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [data]);

  if (loading) return <Skeleton className="h-44 w-full rounded-lg" />;
  if (!data) return null;

  async function copy(kind: "ssid" | "password", value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 1500);
      toast.success(kind === "ssid" ? "Network name copied" : "Wi-Fi password copied");
    } catch {
      toast.error("Could not copy. Select it and copy manually.");
    }
  }

  function row(label: string, kind: "ssid" | "password", value: string, shown: string, extra?: React.ReactNode) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border bg-muted/30 py-1 pl-3 pr-1">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate font-mono text-sm">{shown}</p>
        </div>
        <div className="flex shrink-0 items-center">
          {extra}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 text-muted-foreground hover:text-foreground"
            aria-label={`Copy ${label.toLowerCase()}`}
            onClick={() => copy(kind, value)}
          >
            {copied === kind ? <Check className="size-4 text-primary" /> : <Copy className="size-4" />}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Wifi className="size-4" aria-hidden="true" />
          Department Wi-Fi
        </CardTitle>
        <CardDescription>Scan with your phone camera to join, or copy the password.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="mx-auto size-36 shrink-0 overflow-hidden rounded-lg border bg-white p-1 sm:mx-0">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={`QR code to join the ${data.ssid} Wi-Fi network`} className="size-full" />
          ) : (
            <Skeleton className="size-full" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {row("Network", "ssid", data.ssid, data.ssid)}
          {row(
            "Password",
            "password",
            data.password,
            revealed ? data.password : "••••••••••",
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 text-muted-foreground hover:text-foreground"
              aria-label={revealed ? "Hide Wi-Fi password" : "Show Wi-Fi password"}
              onClick={() => setRevealed((v) => !v)}
            >
              {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>,
          )}
        </div>
      </CardContent>
    </Card>
  );
}
