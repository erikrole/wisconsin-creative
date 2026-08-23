"use client";

import { useState } from "react";
import { SaveIcon } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import { handleAuthRedirect, parseJsonSafely } from "@/lib/errors";
import { AREAS, AREA_LABELS, type Area, type NonGameScheduleDefaults } from "./types";

const CALL_TIME_OPTIONS = [0, 15, 30, 45, 60, 90, 120, 150, 180, 210, 240];

function formatMinutes(minutes: number) {
  if (minutes === 0) return "None";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}min`;
  if (remainder === 0) return hours === 1 ? "1 hr" : `${hours} hrs`;
  return `${hours}h ${remainder}m`;
}

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

  if (loading) return <Skeleton className="h-72 w-full rounded-xl" />;
  if (error || !value) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-4 py-6">
          <p className="text-sm text-muted-foreground">Non-game defaults could not be loaded.</p>
          <Button variant="outline" onClick={reload}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">Non-game</CardTitle>
              <Badge variant="blue" size="sm">All non-game events</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Used when an event has no opponent, including meetings, shoots, and special coverage.</p>
          </div>
          {draft ? (
            <Button className="h-10" disabled={saving} onClick={save}>
              <SaveIcon data-icon="inline-start" />
              {saving ? "Saving..." : "Save"}
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-0">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm [&_th]:border-b [&_th]:bg-muted/40 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-semibold [&_th]:text-muted-foreground [&_td]:border-b [&_td]:border-border/40 [&_td]:px-3 [&_td]:py-2 [&_tr:last-child_td]:border-b-0">
            <thead><tr><th>Area</th><th className="text-center">Staff</th><th className="text-center">Student</th><th className="text-center">Total</th></tr></thead>
            <tbody>
              {AREAS.map((area) => {
                const row = value.shiftConfigs.find((item) => item.area === area) ?? { area, staffCount: 0, studentCount: 0 };
                return (
                  <tr key={area}>
                    <td className="font-medium">{AREA_LABELS[area]}</td>
                    {(["staffCount", "studentCount"] as const).map((field) => (
                      <td key={field} className="text-center">
                        <Input
                          type="number"
                          min={0}
                          max={20}
                          value={row[field]}
                          onChange={(event) => updateCount(area, field, Math.max(0, Number.parseInt(event.target.value, 10) || 0))}
                          className="inline-block w-14 text-center"
                          aria-label={`Non-game ${AREA_LABELS[area]} ${field === "staffCount" ? "Staff" : "Student"} count`}
                        />
                      </td>
                    ))}
                    <td className="text-center font-semibold tabular-nums">{row.staffCount + row.studentCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium text-muted-foreground">Student call time</span>
          {(["shiftStartOffset", "shiftEndOffset"] as const).map((field) => (
            <div key={field} className="flex items-center gap-2">
              <Select value={String(value[field])} onValueChange={(next) => updateOffset(field, Number.parseInt(next, 10))}>
                <SelectTrigger size="sm" className="w-[110px]"><SelectValue /></SelectTrigger>
                <SelectContent>{CALL_TIME_OPTIONS.map((minutes) => <SelectItem key={minutes} value={String(minutes)}>{formatMinutes(minutes)}</SelectItem>)}</SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">{field === "shiftStartOffset" ? "before" : "after"}</span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">Staff and collaborators use the event start and end.</p>
        </div>
      </CardContent>
    </Card>
  );
}
