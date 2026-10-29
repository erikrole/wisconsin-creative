"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Check, Copy, Eye, EyeOff, Maximize2, Printer, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { toast } from "@/lib/toast";

type SharedWifi = { ssid: string; password: string; qrPayload: string };

export function WifiCard() {
  const { data, loading } = useFetch<SharedWifi>({ url: "/api/wifi", refetchOnFocus: false });
  const [qr, setQr] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"ssid" | "password" | null>(null);
  const [enlarged, setEnlarged] = useState(false);

  useEffect(() => {
    if (!data) return;
    let cancelled = false;
    QRCode.toDataURL(data.qrPayload, { margin: 1, width: 640, errorCorrectionLevel: "M" })
      .then((url) => { if (!cancelled) setQr(url); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [data]);

  if (loading) return <Skeleton className="h-48 w-full rounded-lg" />;
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

  function copyButton(kind: "ssid" | "password", label: string, value: string) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={copied === kind ? "size-10 shrink-0 bg-primary/10 text-primary hover:bg-primary/10" : "size-10 shrink-0 text-muted-foreground hover:text-foreground"}
        aria-label={copied === kind ? `${label} — copied` : label}
        onClick={() => copy(kind, value)}
      >
        {copied === kind ? <Check className="size-4" /> : <Copy className="size-4" />}
      </Button>
    );
  }

  const qrAlt = `QR code to join the ${data.ssid} Wi-Fi network`;

  // A one-page sign to tape up: big code, network and password, nothing else.
  function printSign() {
    if (!qr || !data) return;
    const sign = window.open("", "_blank", "width=720,height=960");
    if (!sign) {
      toast.error("Allow pop-ups for this site to print the sign.");
      return;
    }
    const escape = (value: string) => value.replace(/[&<>"]/g, (char) => `&#${char.charCodeAt(0)};`);
    sign.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Wi-Fi: ${escape(data.ssid)}</title>
<style>
  @page { margin: 0.75in; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; color: #111; text-align: center; margin: 0; padding-top: 0.5in; }
  h1 { font-size: 44px; margin: 0 0 8px; }
  p.lead { font-size: 20px; color: #555; margin: 0 0 36px; }
  img { width: 4.5in; height: 4.5in; }
  dl { display: inline-grid; grid-template-columns: auto auto; gap: 10px 24px; margin-top: 36px; font-size: 26px; text-align: left; }
  dt { color: #666; }
  dd { margin: 0; font-weight: 700; font-family: ui-monospace, Menlo, monospace; }
</style></head><body onload="window.print()">
<h1>Join the Wi-Fi</h1>
<p class="lead">Point your phone camera at the code.</p>
<img src="${qr}" alt="">
<dl><dt>Network</dt><dd>${escape(data.ssid)}</dd><dt>Password</dt><dd>${escape(data.password)}</dd></dl>
</body></html>`);
    sign.document.close();
    sign.focus();
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <Wifi className="size-5" />
          </span>
          <div className="min-w-0">
            <CardTitle className="text-base">Wi-Fi</CardTitle>
            <CardDescription className="text-xs">Point your phone camera at the code to join.</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => setEnlarged(true)}
          disabled={!qr}
          className="group relative mx-auto size-40 shrink-0 overflow-hidden rounded-lg border bg-white p-1.5 sm:mx-0"
          aria-label="Show the Wi-Fi QR code larger"
        >
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={qrAlt} className="size-full" />
          ) : (
            <Skeleton className="size-full" />
          )}
          <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
            <Maximize2 className="size-3.5" aria-hidden="true" />
          </span>
        </button>
        <div className="min-w-0 flex-1 divide-y rounded-lg border sm:max-w-md">
          <div className="flex items-center gap-2 py-1 pl-3 pr-1">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Network</p>
              <p className="truncate text-sm text-foreground">{data.ssid}</p>
            </div>
            {copyButton("ssid", "Copy network name", data.ssid)}
          </div>
          <div className="flex items-center gap-2 py-1 pl-3 pr-1">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">Password</p>
              <code className="block break-all font-mono text-sm text-foreground" aria-live="polite">
                {revealed ? data.password : "••••••••••••"}
              </code>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={revealed ? "Hide Wi-Fi password" : "Show Wi-Fi password"}
              aria-pressed={revealed}
              onClick={() => setRevealed((value) => !value)}
            >
              {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
            {copyButton("password", "Copy Wi-Fi password", data.password)}
          </div>
        </div>
      </CardContent>

      <Dialog open={enlarged} onOpenChange={setEnlarged}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="block space-y-1">
            <DialogTitle>Join {data.ssid}</DialogTitle>
            <DialogDescription>Point a phone camera at the code to join the Wi-Fi.</DialogDescription>
          </DialogHeader>
          <div className="p-6">
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={qrAlt} className="mx-auto aspect-square w-full max-w-80 rounded-lg border bg-white p-2" />
            )}
          </div>
          <DialogFooter className="border-t pt-5">
            <Button type="button" variant="outline" onClick={printSign} disabled={!qr}>
              <Printer data-icon="inline-start" />
              Print a sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
