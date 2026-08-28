"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { handleAuthRedirect, parseErrorMessage } from "@/lib/errors";

type WebPushStatus = {
  configured: boolean;
  publicKey: string | null;
  subscribed: boolean;
};

type WebPushSettingsProps = {
  pushEnabled: boolean;
  disabled?: boolean;
};

function browserSupportsPush(): boolean {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}

function urlBase64ToArrayBuffer(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

async function browserServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  // Do not wait forever on localhost, where sw-init deliberately unregisters
  // workers. Production/preview should already have one by the time Settings
  // is opened; a refresh is clearer than a hanging enable button.
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export function WebPushSettings({ pushEnabled, disabled = false }: WebPushSettingsProps) {
  const [status, setStatus] = useState<WebPushStatus | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (browserSupportsPush()) setPermission(Notification.permission);

    void fetch("/api/push/web", { cache: "no-store" })
      .then(async (res) => {
        if (handleAuthRedirect(res, "/settings/notifications") || !res.ok) return;
        const json = await res.json() as { data?: WebPushStatus };
        if (!cancelled && json.data) setStatus(json.data);
      })
      .catch(() => {
        // The existing in-app inbox remains available when this optional
        // device capability cannot be inspected.
      });

    return () => { cancelled = true; };
  }, []);

  async function enable() {
    if (!status?.publicKey || disabled || !pushEnabled) return;
    if (!browserSupportsPush()) {
      setPermission("unsupported");
      toast.error("This browser does not support push notifications.");
      return;
    }
    if (Notification.permission === "denied") {
      setPermission("denied");
      toast.error("Notifications are blocked. Allow them in Chrome site settings, then try again.");
      return;
    }

    setBusy(true);
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        toast.info("Browser notifications were not enabled.");
        return;
      }

      const registration = await browserServiceWorker();
      if (!registration) {
        toast.error("Refresh the deployed app before enabling browser notifications.");
        return;
      }

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToArrayBuffer(status.publicKey),
        });
      }

      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
        throw new Error("The browser returned an incomplete push subscription.");
      }

      const res = await fetch("/api/push/web", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        }),
      });
      if (handleAuthRedirect(res, "/settings/notifications")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Could not enable browser notifications"));
        return;
      }

      setStatus((current) => current ? { ...current, subscribed: true } : current);
      toast.success("Browser notifications enabled");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not enable browser notifications");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (disabled) return;
    setBusy(true);
    try {
      const registration = await browserServiceWorker();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        const res = await fetch("/api/push/web", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (handleAuthRedirect(res, "/settings/notifications")) return;
        if (!res.ok) {
          toast.error(await parseErrorMessage(res, "Could not disable browser notifications"));
          return;
        }
        await subscription.unsubscribe();
      } else {
        await fetch("/api/push/web", { method: "DELETE" });
      }
      setStatus((current) => current ? { ...current, subscribed: false } : current);
      toast.success("Browser notifications disabled");
    } catch {
      toast.error("Could not disable browser notifications");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    if (disabled || !pushEnabled) return;
    setBusy(true);
    try {
      const res = await fetch("/api/push/web/test", { method: "POST" });
      if (handleAuthRedirect(res, "/settings/notifications")) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Test notification failed"));
        return;
      }
      const json = await res.json() as { data?: { devices: number; delivered: number } };
      const delivery = json.data;
      if (!delivery || delivery.devices === 0) {
        toast.info("No browser subscription is registered on this account.");
      } else if (delivery.delivered === 0) {
        toast.error("The browser push service did not accept the notification.");
      } else {
        toast.success("Test notification sent");
      }
    } catch {
      toast.error("Test notification failed");
    } finally {
      setBusy(false);
    }
  }

  if (!status?.configured) return null;

  const actionDisabled = disabled || busy || !pushEnabled;
  const permissionMessage = permission === "denied"
    ? "Notifications are blocked in Chrome. Allow them in this site’s settings, then try again."
    : permission === "unsupported"
      ? "This browser cannot receive push notifications."
      : null;

  return (
    <div className="rounded-md bg-muted/40 p-3 mt-2" data-web-push-settings>
      <div className="flex items-start gap-3">
        <BellRing className="size-4 mt-0.5 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium m-0">This browser</p>
          <p className="text-xs text-muted-foreground m-0 mt-0.5">
            {status.subscribed
              ? "This device can receive alerts even when the app is closed."
              : "Enable alerts on this Android phone, including when the app is closed."}
          </p>
        </div>
      </div>
      {permissionMessage && (
        <p className="text-xs text-muted-foreground m-0 pt-2" role="status">{permissionMessage}</p>
      )}
      {!pushEnabled && (
        <p className="text-xs text-muted-foreground m-0 pt-2" role="status">
          Turn on the Push switch above to receive browser alerts.
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-3">
        {status.subscribed ? (
          <>
            <Button className="h-10" variant="outline" onClick={disable} disabled={disabled || busy}>
              {busy ? "Working…" : "Disable on this browser"}
            </Button>
            <Button className="h-10" variant="outline" onClick={sendTest} disabled={actionDisabled}>
              Send test
            </Button>
          </>
        ) : (
          <Button className="h-10" variant="outline" onClick={enable} disabled={actionDisabled}>
            {busy ? "Working…" : "Enable on this browser"}
          </Button>
        )}
      </div>
    </div>
  );
}
