"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, BellOff, CalendarClock, Mail, PackageCheck, Repeat2, ShoppingBag, Smartphone, Tag, WifiOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useFetch } from "@/hooks/use-fetch";
import {
  classifyError,
  handleAuthRedirect,
  isAbortError,
  parseErrorMessage,
} from "@/lib/errors";
import { SettingsPageShell } from "../SettingsPageShell";
import { WebPushSettings } from "@/components/notifications/WebPushSettings";

type Prefs = {
  pausedUntil: string | null;
  channels: { email: boolean; push: boolean };
  categories: {
    checkoutDue: boolean;
    checkoutOverdue: boolean;
    reservation: boolean;
    licenseExpiry: boolean;
    schedule: boolean;
    trade: boolean;
    gearPrep: boolean;
  };
};

const DEFAULT_CATEGORIES: Prefs["categories"] = {
  checkoutDue: true,
  checkoutOverdue: true,
  reservation: true,
  licenseExpiry: true,
  schedule: true,
  trade: true,
  gearPrep: true,
};

const PAUSE_OPTIONS = [
  { id: "1h",  label: "1 hour",   ms: 60 * 60 * 1000 },
  { id: "1d",  label: "1 day",    ms: 24 * 60 * 60 * 1000 },
  { id: "1w",  label: "1 week",   ms: 7 * 24 * 60 * 60 * 1000 },
];

function formatPausedUntil(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso);
  if (Number.isNaN(t.getTime()) || t.getTime() <= Date.now()) return null;
  return t.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NotificationsSettingsPage() {
  const { data: fetched, loading, error, reload } = useFetch<Prefs>({
    url: "/api/me/notification-preferences",
    returnTo: "/settings/notifications",
    transform: (json) => json.data as Prefs,
  });

  const [local, setLocal] = useState<Prefs | null>(null);
  const [prevFetched, setPrevFetched] = useState(fetched);
  if (fetched !== prevFetched) {
    setPrevFetched(fetched);
    setLocal(null);
  }
  const prefs = local ?? fetched;
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  async function save(next: Prefs, { silent = false } = {}) {
    if (savingRef.current) return false;
    savingRef.current = true;
    setLocal(next);
    setSaving(true);
    try {
      const res = await fetch("/api/me/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (handleAuthRedirect(res, "/settings/notifications")) return false;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to save");
        toast.error(msg);
        reload();
        return false;
      } else if (!silent) {
        toast.success("Saved", { duration: 1200 });
      }
      return true;
    } catch (err) {
      if (isAbortError(err)) return false;
      const kind = classifyError(err);
      toast.error(kind === "network" ? "You’re offline. Check your connection." : "Failed to save");
      reload();
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function setChannel(channel: "email" | "push", value: boolean) {
    if (!prefs) return;
    save({ ...prefs, channels: { ...prefs.channels, [channel]: value } });
  }

  function setCategory(key: keyof Prefs["categories"], value: boolean) {
    if (!prefs) return;
    const categories = { ...(prefs.categories ?? DEFAULT_CATEGORIES), [key]: value };
    save({ ...prefs, categories });
  }

  async function pauseFor(ms: number) {
    if (!prefs) return;
    const until = new Date(Date.now() + ms).toISOString();
    const saved = await save({ ...prefs, pausedUntil: until }, { silent: true });
    if (saved) {
      toast.success(`Paused — quiet until ${new Date(until).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })}`);
    }
  }

  async function resumeNow() {
    if (!prefs) return;
    const saved = await save({ ...prefs, pausedUntil: null }, { silent: true });
    if (saved) toast.success("Notifications resumed");
  }

  const description = "Control how and when you receive updates about gear, shifts, and reservations. The in-app inbox always stays available regardless of these settings.";

  if (loading) {
    return (
      <SettingsPageShell title="Notifications" description={description} mainClassName="flex flex-col gap-3">
            <Skeleton className="h-32 w-full rounded-md" />
            <Skeleton className="h-44 w-full rounded-md" />
      </SettingsPageShell>
    );
  }

  if (error || !prefs) {
    const Icon = error === "network" ? WifiOff : AlertTriangle;
    return (
      <SettingsPageShell title="Notifications" description={description}>
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
                <Icon className="size-10 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {error === "network"
                    ? "Could not connect to the server."
                    : "Failed to load your preferences."}
                </p>
                <Button variant="outline" onClick={reload}>Retry</Button>
              </CardContent>
            </Card>
      </SettingsPageShell>
    );
  }

  const pausedLabel = formatPausedUntil(prefs.pausedUntil);
  const isPaused = !!pausedLabel;

  return (
    <SettingsPageShell title="Notifications" description={description} mainClassName="flex flex-col gap-4">
        {/* Pause */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <BellOff className="size-4" />
              Quiet hours
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {isPaused ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted/40 p-3">
                <div className="text-sm">
                  <span className="font-medium">Paused</span>
                  <span className="text-muted-foreground"> until {pausedLabel}</span>
                </div>
                <Button className="h-10" variant="outline" onClick={resumeNow} disabled={saving}>
                  {saving ? <Spinner /> : "Resume now"}
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground m-0">
                  Pause email and push delivery for a stretch — useful during
                  breaks or weekends. The in-app inbox keeps recording everything.
                </p>
                <div className="flex flex-wrap gap-2">
                  {PAUSE_OPTIONS.map((opt) => (
                    <Button className="h-10"
                      key={opt.id}
                      variant="outline"
                      onClick={() => pauseFor(opt.ms)}
                      disabled={saving}
                    >
                      Pause {opt.label}
                    </Button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Channels */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delivery channels</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <ChannelRow
              icon={<Mail className="size-4" />}
              label="Email"
              description="Send notifications to your registered email address."
              checked={prefs.channels.email}
              onChange={(v) => setChannel("email", v)}
              disabled={saving || isPaused}
            />
            <div className="border-t border-border my-1" />
            <ChannelRow
              icon={<Smartphone className="size-4" />}
              label="Push"
              description="Send push notifications to the iOS app or an enrolled browser."
              checked={prefs.channels.push}
              onChange={(v) => setChannel("push", v)}
              disabled={saving || isPaused}
            />
            <WebPushSettings pushEnabled={prefs.channels.push} disabled={saving || isPaused} />
            {isPaused && (
              <p className="text-xs text-muted-foreground pt-2 m-0">
                Channels are temporarily overridden by your active pause.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Notification types */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notification types</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <ChannelRow
              icon={<ShoppingBag className="size-4" />}
              label="Checkout due reminders"
              description="Notified before a checkout is due back."
              checked={(prefs.categories ?? DEFAULT_CATEGORIES).checkoutDue}
              onChange={(v) => setCategory("checkoutDue", v)}
              disabled={saving}
            />
            <div className="border-t border-border my-1" />
            <ChannelRow
              icon={<ShoppingBag className="size-4" />}
              label="Checkout overdue alerts"
              description="Notified when a checkout is past its due date."
              checked={(prefs.categories ?? DEFAULT_CATEGORIES).checkoutOverdue}
              onChange={(v) => setCategory("checkoutOverdue", v)}
              disabled={saving}
            />
            <div className="border-t border-border my-1" />
            <ChannelRow
              icon={<Tag className="size-4" />}
              label="Reservation updates"
              description="Confirmation, pickup-ready, and cancellation notices for your reservations."
              checked={(prefs.categories ?? DEFAULT_CATEGORIES).reservation}
              onChange={(v) => setCategory("reservation", v)}
              disabled={saving}
            />
            <div className="border-t border-border my-1" />
            <ChannelRow
              icon={<Tag className="size-4" />}
              label="License expiry reminders"
              description="Notified when a license you hold is approaching expiry."
              checked={(prefs.categories ?? DEFAULT_CATEGORIES).licenseExpiry}
              onChange={(v) => setCategory("licenseExpiry", v)}
              disabled={saving}
            />
            <div className="border-t border-border my-1" />
            <ChannelRow
              icon={<CalendarClock className="size-4" />}
              label="Schedule updates"
              description="Published shift assignments, approvals, removals, and call-time changes."
              checked={(prefs.categories ?? DEFAULT_CATEGORIES).schedule}
              onChange={(v) => setCategory("schedule", v)}
              disabled={saving}
            />
            <div className="border-t border-border my-1" />
            <ChannelRow
              icon={<Repeat2 className="size-4" />}
              label="Trade updates"
              description="Claimed, approved, declined, completed, and expired shift trades."
              checked={(prefs.categories ?? DEFAULT_CATEGORIES).trade}
              onChange={(v) => setCategory("trade", v)}
              disabled={saving}
            />
            <div className="border-t border-border my-1" />
            <ChannelRow
              icon={<PackageCheck className="size-4" />}
              label="Gear prep nudges"
              description="Staff-triggered reminders to reserve or prepare gear for an assigned shift."
              checked={(prefs.categories ?? DEFAULT_CATEGORIES).gearPrep}
              onChange={(v) => setCategory("gearPrep", v)}
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground pt-2 m-0">
              In-app notifications always appear regardless of these toggles.
            </p>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground m-0">
          Note: in-app notifications always fire and appear in your{" "}
          <a href="/notifications" className="underline">notifications inbox</a>.
        </p>
    </SettingsPageShell>
  );
}

function ChannelRow({
  icon,
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = `notif-${label.toLowerCase()}`;
  const name = id.replace(/[^a-z0-9]+/g, "-");
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="flex gap-3 min-w-0">
        <span className="text-muted-foreground mt-0.5">{icon}</span>
        <div className="min-w-0">
          <Label htmlFor={id} className="font-medium cursor-pointer">{label}</Label>
          <p className="text-xs text-muted-foreground m-0 mt-0.5">{description}</p>
        </div>
      </div>
      <Switch id={id} name={name} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
