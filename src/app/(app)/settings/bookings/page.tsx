"use client";

import { useEffect, useRef, useState } from "react";
import { useFetch } from "@/hooks/use-fetch";
import { toast } from "sonner";
import EmptyState from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { NativeSelect } from "@/components/ui/native-select";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { handleAuthRedirect, isAbortError, parseErrorMessage } from "@/lib/errors";
import { SettingsPageShell } from "../SettingsPageShell";
import { SettingsSaveBar } from "../_components/SettingsSaveBar";

type Preset = { label: string; minutes: number };

const DURATION_OPTIONS = [
  { label: "15 min", minutes: 15 },
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "4 hours", minutes: 240 },
  { label: "12 hours", minutes: 720 },
  { label: "1 day", minutes: 1440 },
  { label: "2 days", minutes: 2880 },
  { label: "3 days", minutes: 4320 },
  { label: "5 days", minutes: 7200 },
  { label: "1 week", minutes: 10080 },
  { label: "2 weeks", minutes: 20160 },
  { label: "1 month", minutes: 43200 },
];

export default function BookingSettingsPage() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [dirty, setDirty] = useState(false);

  const { data: settingsData, loading, error, reload } = useFetch<{ presets: Preset[] }>({
    url: "/api/settings/extend-presets",
    refetchOnFocus: false,
  });

  // Sync fetched presets into local state (only on initial load)
  useEffect(() => {
    if (settingsData?.presets && !dirty) {
      setPresets(settingsData.presets);
    }
  }, [settingsData, dirty]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  function addPreset() {
    if (presets.length >= 10) return;
    setPresets((prev) => [...prev, { label: "+1 day", minutes: 1440 }]);
    setDirty(true);
  }

  function removePreset(index: number) {
    setPresets((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  }

  function updatePresetLabel(index: number, label: string) {
    setPresets((prev) => prev.map((p, i) => i === index ? { ...p, label } : p));
    setDirty(true);
  }

  function updatePresetMinutes(index: number, minutes: number) {
    setPresets((prev) => prev.map((p, i) => i === index ? { ...p, minutes } : p));
    setDirty(true);
  }

  async function save() {
    if (savingRef.current) return;
    // Validate all labels are non-empty
    if (presets.some((p) => !p.label.trim())) {
      toast.error("All presets need a label");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/extend-presets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presets: presets.map((p) => ({ label: p.label.trim(), minutes: p.minutes })) }),
      });
      if (handleAuthRedirect(res, "/settings/bookings")) return;
      if (!res.ok) {
        const msg = await parseErrorMessage(res, "Failed to save");
        throw new Error(msg);
      }
      toast.success("Extend presets saved");
      setDirty(false);
    } catch (err) {
      if (isAbortError(err)) return;
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <SettingsPageShell
      href="/settings/bookings"
      description="Configure the preset buttons shown when extending a booking's due date."
      mainClassName="flex flex-col gap-6"
    >
        <Card>
          <CardHeader>
            <CardTitle>Extend due date presets</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex flex-col gap-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-10 flex-1" />
                    <Skeleton className="h-10 w-[120px]" />
                    <Skeleton className="size-10" />
                  </div>
                ))}
              </div>
            ) : error && !settingsData ? (
              <EmptyState
                inline
                icon="wifi-off"
                title="Could not load booking extensions"
                description="The current presets are unavailable. Retry before making changes."
                actionLabel="Retry"
                onAction={reload}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {presets.map((preset, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      id={`extend-preset-label-${index}`}
                      name={`extendPresetLabel${index}`}
                      value={preset.label}
                      onChange={(e) => updatePresetLabel(index, e.target.value)}
                      placeholder="Button label"
                      aria-label={`Preset ${index + 1} label`}
                      className="h-10 flex-1"
                      disabled={saving}
                    />
                    <NativeSelect
                      id={`extend-preset-duration-${index}`}
                      name={`extendPresetDuration${index}`}
                      value={preset.minutes}
                      onChange={(e) => updatePresetMinutes(index, Number(e.target.value))}
                      aria-label={`Preset ${index + 1} duration`}
                      disabled={saving}
                    >
                      {DURATION_OPTIONS.map((d) => (
                        <option key={d.minutes} value={d.minutes}>{d.label}</option>
                      ))}
                    </NativeSelect>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removePreset(index)}
                      className="size-10 text-muted-foreground hover:text-destructive"
                      aria-label={`Remove ${preset.label || "preset"}`}
                      disabled={saving}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                ))}

                {presets.length < 10 && (
                  <Button variant="outline" onClick={addPreset} className="mt-2 min-h-10" disabled={saving}>
                    <PlusIcon data-icon="inline-start" />
                    Add preset
                  </Button>
                )}

                {presets.length === 0 && (
                  <EmptyState
                    inline
                    icon="calendar"
                    title="No extend presets configured"
                    description="Users will only see the custom due-date option until a preset is added."
                  />
                )}

                <SettingsSaveBar
                  dirty={dirty}
                  saving={saving}
                  onReset={() => {
                    setPresets(settingsData?.presets ?? []);
                    setDirty(false);
                  }}
                  onSave={() => { void save(); }}
                />
              </div>
            )}
          </CardContent>
        </Card>
    </SettingsPageShell>
  );
}
