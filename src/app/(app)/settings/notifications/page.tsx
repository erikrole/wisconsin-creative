"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
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
import { SettingsGroup } from "../_components/SettingsGroup";
import { SettingsPrefRow } from "../_components/SettingsPrefRow";
import EmptyState from "@/components/EmptyState";
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

type PrefsPatch = {
  pausedUntil?: string | null;
  channels?: Partial<Prefs["channels"]>;
  categories?: Partial<Prefs["categories"]>;
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

  // Sends only the changed fields; the server merges them over what's stored.
  async function save(next: Prefs, patch: PrefsPatch, { silent = false } = {}) {
    if (savingRef.current) return false;
    savingRef.current = true;
    setLocal(next);
    setSaving(true);
    try {
      const res = await fetch("/api/me/notification-preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
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
    const channels = { ...prefs.channels, [channel]: value };
    save({ ...prefs, channels }, { channels: { [channel]: value } });
  }

  function setCategory(key: keyof Prefs["categories"], value: boolean) {
    if (!prefs) return;
    const categories = { ...(prefs.categories ?? DEFAULT_CATEGORIES), [key]: value };
    save({ ...prefs, categories }, { categories: { [key]: value } });
  }

  async function pauseFor(ms: number) {
    if (!prefs) return;
    const until = new Date(Date.now() + ms).toISOString();
    const saved = await save({ ...prefs, pausedUntil: until }, { pausedUntil: until }, { silent: true });
    if (saved) {
      toast.success(`Paused — quiet until ${new Date(until).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })}`);
    }
  }

  async function resumeNow() {
    if (!prefs) return;
    const saved = await save({ ...prefs, pausedUntil: null }, { pausedUntil: null }, { silent: true });
    if (saved) toast.success("Notifications resumed");
  }

  const description = "Control how and when you receive updates about gear, shifts, and reservations. The in-app inbox always stays available regardless of these settings.";

  if (loading) {
    return (
      <SettingsPageShell href="/settings/notifications" description={description} mainClassName="flex flex-col gap-3">
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-44 w-full rounded-xl" />
      </SettingsPageShell>
    );
  }

  if (error || !prefs) {
    return (
      <SettingsPageShell href="/settings/notifications" description={description}>
            <EmptyState
              inline
              icon={error === "network" ? "wifi-off" : "bell"}
              title={error === "network" ? "You are offline" : "Could not load notifications"}
              description={error === "network" ? "Could not connect to the server." : "Failed to load your preferences."}
              actionLabel="Retry"
              onAction={reload}
            />
      </SettingsPageShell>
    );
  }

  const pausedLabel = formatPausedUntil(prefs.pausedUntil);
  const isPaused = !!pausedLabel;

  return (
    <SettingsPageShell href="/settings/notifications" description={description} mainClassName="flex flex-col gap-7">
      <SettingsGroup
        title="Pause"
        description="Hold email and push for a while, like over a break. The in-app inbox keeps recording everything."
      >
        {isPaused ? (
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <p className="m-0 text-sm">
              <span className="font-bold">Paused</span>
              <span className="text-muted-foreground"> until {pausedLabel}</span>
            </p>
            <Button className="h-10" variant="outline" onClick={resumeNow} disabled={saving}>
              {saving ? <Spinner /> : "Resume now"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2 px-4 py-3.5">
            {PAUSE_OPTIONS.map((opt) => (
              <Button
                className="h-10"
                key={opt.id}
                variant="outline"
                onClick={() => pauseFor(opt.ms)}
                disabled={saving}
              >
                Pause for {opt.label}
              </Button>
            ))}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Where to reach you"
        footer={isPaused ? "Your pause is overriding these channels for now." : undefined}
      >
        <SettingsPrefRow
          label="Email"
          description="Off unless you turn it on. Sign-in invites and password resets are always emailed."
          checked={prefs.channels.email}
          onChange={(v) => setChannel("email", v)}
          disabled={saving || isPaused}
        />
        <SettingsPrefRow
          label="Push"
          description="The iOS app or an enrolled browser."
          checked={prefs.channels.push}
          onChange={(v) => setChannel("push", v)}
          disabled={saving || isPaused}
        />
        <WebPushSettings pushEnabled={prefs.channels.push} disabled={saving || isPaused} />
      </SettingsGroup>

      <SettingsGroup title="Gear">
        <SettingsPrefRow
          label="Checkout due reminders"
          description="Before a checkout is due back."
          checked={(prefs.categories ?? DEFAULT_CATEGORIES).checkoutDue}
          onChange={(v) => setCategory("checkoutDue", v)}
          disabled={saving}
        />
        <SettingsPrefRow
          label="Checkout overdue alerts"
          description="When a checkout is past its due date."
          checked={(prefs.categories ?? DEFAULT_CATEGORIES).checkoutOverdue}
          onChange={(v) => setCategory("checkoutOverdue", v)}
          disabled={saving}
        />
        <SettingsPrefRow
          label="Reservation updates"
          description="Confirmation, pickup-ready, and cancellation notices."
          checked={(prefs.categories ?? DEFAULT_CATEGORIES).reservation}
          onChange={(v) => setCategory("reservation", v)}
          disabled={saving}
        />
        <SettingsPrefRow
          label="License expiry reminders"
          description="When a license you hold is close to expiring."
          checked={(prefs.categories ?? DEFAULT_CATEGORIES).licenseExpiry}
          onChange={(v) => setCategory("licenseExpiry", v)}
          disabled={saving}
        />
        <SettingsPrefRow
          label="Gear prep nudges"
          description="Reminders to reserve or prepare gear for a shift."
          checked={(prefs.categories ?? DEFAULT_CATEGORIES).gearPrep}
          onChange={(v) => setCategory("gearPrep", v)}
          disabled={saving}
        />
      </SettingsGroup>

      <SettingsGroup
        title="Schedule"
        footer={
          <>
            Everything always appears in your <a href="/notifications" className="underline">notifications inbox</a>,
            whatever you choose here.
          </>
        }
      >
        <SettingsPrefRow
          label="Schedule updates"
          description="Shift assignments, approvals, removals, and call-time changes."
          checked={(prefs.categories ?? DEFAULT_CATEGORIES).schedule}
          onChange={(v) => setCategory("schedule", v)}
          disabled={saving}
        />
        <SettingsPrefRow
          label="Trade updates"
          description="Claimed, approved, declined, completed, and expired shift trades."
          checked={(prefs.categories ?? DEFAULT_CATEGORIES).trade}
          onChange={(v) => setCategory("trade", v)}
          disabled={saving}
        />
      </SettingsGroup>
    </SettingsPageShell>
  );
}
