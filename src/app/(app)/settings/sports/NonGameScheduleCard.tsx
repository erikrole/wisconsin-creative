"use client";

import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { AREAS, AREA_LABELS, type Area, type NonGameScheduleDefaults } from "./types";
import { CallTimeRow, CrewCount } from "./ShiftConfigTable";
import { SettingsGroup } from "../_components/SettingsGroup";

export default function NonGameScheduleCard() {
  const { data, loading, error, reload } = useFetch<NonGameScheduleDefaults>({
    url: "/api/settings/non-game-schedule",
    returnTo: "/settings/sports",
    transform: (json) => json.data as NonGameScheduleDefaults,
  });
  const [draft, setDraft] = useState<NonGameScheduleDefaults | null>(null);
  const [saving, setSaving] = useState(false);
  const value = draft ?? data;

  function updateCount(area: Area, field: "staffCount" | "studentCount", count: number) {
    if (!value) return;
    setDraft({
      ...value,
      shiftConfigs: value.shiftConfigs.map((row) => row.area === area ? { ...row, [field]: count } : row),
    });
  }

  function updateOffset(field: "shiftStartOffset" | "shiftEndOffset", count: number) {
    if (!value) return;
    setDraft({ ...value, [field]: count });
  }

  async function save() {
    if (!value) return;
    setSaving(true);
    try {
      const response = await fetch("/api/settings/non-game-schedule", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      });
      if (handleAuthRedirect(response, "/settings/sports")) return;
      const body = await parseJsonSafely<{
        data?: NonGameScheduleDefaults;
        generation?: { groupsCreated: number; shiftsCreated: number };
        error?: string;
      }>(response);
      if (!response.ok || !body?.data) {
        toast.error(body?.error ?? "Non-game defaults could not be saved.");
        return;
      }
      setDraft(null);
      reload();
      const created = body.generation?.groupsCreated ?? 0;
      toast.success(created > 0 ? `Saved and created schedules for ${created} upcoming non-game events` : "Non-game defaults saved");
    } catch {
      toast.error("Non-game defaults could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const title = "Non-game events";
  const description = "Meetings, shoots, and other coverage with no opponent.";

  if (loading) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (error || !value) {
    return (
      <SettingsGroup title={title} description={description}>
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <p className="m-0 text-sm text-muted-foreground">Non-game defaults could not be loaded.</p>
          <Button variant="outline" onClick={reload}>Retry</Button>
        </div>
      </SettingsGroup>
    );
  }

  return (
    <SettingsGroup title={title} description={description}>
      <div className="flex flex-col gap-4 px-4 py-4">
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm [&_td]:py-1 [&_td]:pr-2 [&_th]:pb-1.5 [&_th]:pr-2 [&_th]:text-left [&_th]:text-[13px] [&_th]:font-bold [&_th]:text-muted-foreground">
            <thead>
              <tr>
                <th className="min-w-32">Minimum crew</th>
                <th className="!text-center">Staff</th>
                <th className="!text-center">Students</th>
              </tr>
            </thead>
            <tbody>
              {AREAS.map((area) => {
                const row = value.shiftConfigs.find((item) => item.area === area) ?? { area, staffCount: 0, studentCount: 0 };
                return (
                  <tr key={area}>
                    <td className="font-bold">{AREA_LABELS[area]}</td>
                    {(["staffCount", "studentCount"] as const).map((field) => (
                      <td key={field} className="text-center">
                        <CrewCount
                          value={row[field]}
                          onChange={(count) => updateCount(area, field, count)}
                          disabled={saving}
                          label={`Non-game ${AREA_LABELS[area]} ${field === "staffCount" ? "Staff" : "Student"} count`}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <CallTimeRow
          start={value.shiftStartOffset}
          end={value.shiftEndOffset}
          onChange={updateOffset}
          disabled={saving}
        />
        {draft ? (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
              Discard
            </Button>
            <Button disabled={saving} loading={saving} onClick={save}>
              Save
            </Button>
          </div>
        ) : null}
      </div>
    </SettingsGroup>
  );
}
