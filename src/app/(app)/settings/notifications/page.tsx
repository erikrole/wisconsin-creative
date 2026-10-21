"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useFetch } from "@/hooks/use-fetch";
import {
  classifyError,
  handleAuthRedirect,
  isAbortError,
  parseErrorMessage,
} from "@/lib/errors";
import {
  NOTIFICATION_GROUP_LABELS,
  type NotificationCategory,
  type NotificationCategoryEntry,
  type NotificationCategoryGroup,
  type PushLevel,
} from "@/lib/notification-catalog";
import { cn } from "@/lib/utils";
import { SettingsPageShell } from "../SettingsPageShell";
import { SettingsGroup, SettingsRow } from "../_components/SettingsGroup";
import { SettingsPrefRow } from "../_components/SettingsPrefRow";
import EmptyState from "@/components/EmptyState";
import { WebPushSettings } from "@/components/notifications/WebPushSettings";

type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
  days: number[];
  allowUrgent: boolean;
};

type Prefs = {
  pausedUntil: string | null;
  channels: { email: boolean; push: boolean };
  badges: boolean;
  push: Partial<Record<NotificationCategory, PushLevel>>;
  quietHours: QuietHours;
};

type PrefsPatch = {
  pausedUntil?: string | null;
  channels?: Partial<Prefs["channels"]>;
  badges?: boolean;
  push?: Partial<Record<NotificationCategory, PushLevel>>;
  quietHours?: Partial<QuietHours>;
};

type Loaded = { prefs: Prefs; catalog: NotificationCategoryEntry[] };

const PAUSE_OPTIONS = [
  { id: "1h",  label: "1 hour",   ms: 60 * 60 * 1000 },
  { id: "1d",  label: "1 day",    ms: 24 * 60 * 60 * 1000 },
  { id: "1w",  label: "1 week",   ms: 7 * 24 * 60 * 60 * 1000 },
];

const LEVELS: Array<{ id: PushLevel; label: string }> = [
  { id: "off", label: "Off" },
  { id: "silent", label: "Silent" },
  { id: "standard", label: "Alert" },
];

const GROUP_ORDER: NotificationCategoryGroup[] = ["gear", "schedule", "account", "admin"];

// Monday first, matching the iOS quiet-hours picker. Values are JS days (0 = Sunday).
const DAYS = [
  { index: 1, short: "M", name: "Monday" },
  { index: 2, short: "T", name: "Tuesday" },
  { index: 3, short: "W", name: "Wednesday" },
  { index: 4, short: "T", name: "Thursday" },
  { index: 5, short: "F", name: "Friday" },
  { index: 6, short: "S", name: "Saturday" },
  { index: 0, short: "S", name: "Sunday" },
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
  const { data: fetched, loading, error, reload } = useFetch<Loaded>({
    url: "/api/me/notification-preferences",
    returnTo: "/settings/notifications",
    transform: (json) => ({
      prefs: json.data as Prefs,
      catalog: (json.catalog as NotificationCategoryEntry[] | undefined) ?? [],
    }),
  });

  const [local, setLocal] = useState<Prefs | null>(null);
  const [prevFetched, setPrevFetched] = useState(fetched);
  if (fetched !== prevFetched) {
    setPrevFetched(fetched);
    setLocal(null);
  }
  const prefs = local ?? fetched?.prefs ?? null;
  const catalog = fetched?.catalog ?? [];
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

  function setBadges(value: boolean) {
    if (!prefs) return;
    save({ ...prefs, badges: value }, { badges: value });
  }

  function setLevel(id: NotificationCategory, value: PushLevel) {
    if (!prefs) return;
    save({ ...prefs, push: { ...prefs.push, [id]: value } }, { push: { [id]: value } }, { silent: true });
  }

  function setQuiet(patch: Partial<QuietHours>) {
    if (!prefs) return;
    save({ ...prefs, quietHours: { ...prefs.quietHours, ...patch } }, { quietHours: patch }, { silent: true });
  }

  async function pauseFor(ms: number) {
    if (!prefs) return;
    const until = new Date(Date.now() + ms).toISOString();
    const saved = await save({ ...prefs, pausedUntil: until }, { pausedUntil: until }, { silent: true });
    if (saved) {
      toast.success(`Paused until ${new Date(until).toLocaleString(undefined, { hour: "numeric", minute: "2-digit" })}`);
    }
  }

  async function resumeNow() {
    if (!prefs) return;
    const saved = await save({ ...prefs, pausedUntil: null }, { pausedUntil: null }, { silent: true });
    if (saved) toast.success("Notifications resumed");
  }

  const description = "Choose how gear, shift, and reservation updates reach you. Everything always lands in your in-app inbox.";

  if (loading) {
    return (
      <SettingsPageShell href="/settings/notifications" description={description} mainClassName="flex flex-col gap-7">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-44 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
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
  const quiet = prefs.quietHours;
  const groups = GROUP_ORDER
    .map((group) => ({ group, entries: catalog.filter((entry) => entry.group === group) }))
    .filter(({ entries }) => entries.length > 0);

  return (
    <SettingsPageShell href="/settings/notifications" description={description} mainClassName="flex flex-col gap-7">
      <SettingsGroup
        title="Pause"
        description="Hold email and push for a while, like over a break."
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

      <SettingsGroup
        title="Quiet hours"
        description="On a regular schedule, push arrives silently and email waits."
      >
        <SettingsPrefRow
          label="Quiet hours"
          description={quiet.enabled ? `${formatClock(quiet.start)} to ${formatClock(quiet.end)}` : "Off"}
          checked={quiet.enabled}
          onChange={(v) => setQuiet({ enabled: v })}
          disabled={saving}
        />
        {quiet.enabled ? (
          <>
            <SettingsRow label="From" htmlFor="quiet-start">
              <Input
                id="quiet-start"
                name="quietStart"
                type="time"
                value={quiet.start}
                onChange={(e) => e.target.value && setQuiet({ start: e.target.value })}
                disabled={saving}
                className="h-10"
              />
            </SettingsRow>
            <SettingsRow label="To" htmlFor="quiet-end">
              <Input
                id="quiet-end"
                name="quietEnd"
                type="time"
                value={quiet.end}
                onChange={(e) => e.target.value && setQuiet({ end: e.target.value })}
                disabled={saving}
                className="h-10"
              />
            </SettingsRow>
            <SettingsRow label="Days" description="An overnight window belongs to the day it starts.">
              <div role="group" aria-label="Quiet hours days" className="flex justify-between gap-1">
                {DAYS.map((day) => {
                  const selected = quiet.days.includes(day.index);
                  return (
                    <button
                      key={day.index}
                      type="button"
                      aria-pressed={selected}
                      aria-label={day.name}
                      disabled={saving}
                      onClick={() =>
                        setQuiet({
                          days: selected
                            ? quiet.days.filter((d) => d !== day.index)
                            : [...quiet.days, day.index].sort(),
                        })
                      }
                      className={cn(
                        "size-8 rounded-full text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        selected ? "bg-[var(--accent-soft)] text-[var(--blue-text)]" : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            </SettingsRow>
            <SettingsPrefRow
              label="Let urgent alerts through"
              description="Overdue gear still alerts normally."
              checked={quiet.allowUrgent}
              onChange={(v) => setQuiet({ allowUrgent: v })}
              disabled={saving}
            />
          </>
        ) : null}
      </SettingsGroup>

      {groups.map(({ group, entries }, index) => (
        <SettingsGroup
          key={group}
          title={NOTIFICATION_GROUP_LABELS[group]}
          footer={
            index === groups.length - 1 ? (
              <>
                Silent arrives without sound. Off also stops email for that type. Everything still lands in your{" "}
                <a href="/notifications" className="underline">notifications inbox</a>.
              </>
            ) : undefined
          }
        >
          {entries.map((entry) => (
            <SettingsRow key={entry.id} label={entry.label} description={entry.description}>
              <LevelPicker
                label={entry.label}
                value={prefs.push[entry.id] ?? entry.defaultLevel}
                onChange={(value) => setLevel(entry.id, value)}
                disabled={saving}
              />
            </SettingsRow>
          ))}
          {group === "gear" ? (
            <SettingsPrefRow
              label="Badge awards"
              description="When you earn a badge."
              checked={prefs.badges}
              onChange={setBadges}
              disabled={saving}
            />
          ) : null}
        </SettingsGroup>
      ))}
    </SettingsPageShell>
  );
}

function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const date = new Date(2000, 0, 1, h, m);
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Off / Silent / Alert, as one segmented control. */
function LevelPicker({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: PushLevel;
  onChange: (value: PushLevel) => void;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-3 gap-0.5 rounded-lg bg-muted p-0.5">
      {LEVELS.map((level) => {
        const active = value === level.id;
        return (
          <button
            key={level.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => !active && onChange(level.id)}
            className={cn(
              "min-h-8 rounded-md px-2 text-xs transition-[background-color,box-shadow,color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-card font-bold text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {level.label}
          </button>
        );
      })}
    </div>
  );
}
