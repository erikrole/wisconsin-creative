"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import { VARSITY_OWNERSHIP_AREAS } from "@/lib/sports";
import { AREA_LABELS } from "@/types/areas";

type OwnershipResponse = {
  sportCode: string;
  owners: Array<{ id: string; area: string; startsOn: string; endsOn: string; user: { id: string; name: string } }>;
  students: Array<{ id: string; name: string; areas: string[] }>;
};

function institutionDayKey(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function VarsityOwnershipEditor({ sportCode }: { sportCode: string }) {
  const [data, setData] = useState<OwnershipResponse | null>(null);
  const [area, setArea] = useState<(typeof VARSITY_OWNERSHIP_AREAS)[number]>("VIDEO");
  const [startsOn, setStartsOn] = useState(institutionDayKey);
  const [endsOn, setEndsOn] = useState(() => `${Number(institutionDayKey().slice(0, 4)) + 1}-06-30`);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/schedule/varsity-ownership?sportCode=${encodeURIComponent(sportCode)}`);
      if (handleAuthRedirect(response)) return;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Ownership could not be loaded."));
      const json = await parseJsonSafely<{ data?: OwnershipResponse }>(response);
      if (!json?.data) throw new Error("Ownership could not be loaded.");
      setData(json.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ownership could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [sportCode]);

  useEffect(() => { void load(); }, [load]);

  const eligible = useMemo(() => data?.students.filter((student) => student.areas.includes(area)) ?? [], [area, data]);
  const current = useMemo(() => {
    const today = institutionDayKey();
    return data?.owners.filter((owner) => owner.area === area && owner.startsOn.slice(0, 10) <= today && owner.endsOn.slice(0, 10) >= today) ?? [];
  }, [area, data]);
  const past = useMemo(() => {
    const today = institutionDayKey();
    return data?.owners.filter((owner) => owner.area === area && owner.endsOn.slice(0, 10) < today) ?? [];
  }, [area, data]);
  const scheduled = useMemo(() => {
    const today = institutionDayKey();
    return data?.owners.filter((owner) => owner.area === area && owner.startsOn.slice(0, 10) > today) ?? [];
  }, [area, data]);

  async function save() {
    if (selected.size === 0 || loading) return;
    setLoading(true);
    try {
      const response = await fetch("/api/schedule/varsity-ownership", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sportCode, area, startsOn, endsOn, userIds: [...selected] }),
      });
      if (handleAuthRedirect(response)) return;
      if (!response.ok) throw new Error(await parseErrorMessage(response, "Ownership was not saved."));
      toast.success("Primary coverage handoff saved");
      setSelected(new Set());
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Ownership was not saved.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Primary season coverage</p>
          <p className="text-xs text-muted-foreground">Current owners are preferred for every eligible varsity event. A handoff keeps prior ownership history.</p>
        </div>
        <Button variant="ghost" size="sm" className="size-9 p-0" onClick={() => void load()} disabled={loading} aria-label="Refresh ownership">
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Select value={area} onValueChange={(value) => { setArea(value as typeof area); setSelected(new Set()); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{VARSITY_OWNERSHIP_AREAS.map((value) => <SelectItem key={value} value={value}>{AREA_LABELS[value]}</SelectItem>)}</SelectContent>
        </Select>
        <input aria-label="Ownership starts" type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm" />
        <input aria-label="Ownership ends" type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm" />
      </div>
      <p className="mt-3 text-xs text-muted-foreground">Current: {current.length > 0 ? current.map((owner) => owner.user.name).join(", ") : "No owner configured"}</p>
      {scheduled.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">Scheduled: {scheduled.map((owner) => `${owner.user.name} (${owner.startsOn.slice(0, 10)}–${owner.endsOn.slice(0, 10)})`).join(", ")}</p>
      ) : null}
      {past.length > 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">History: {past.map((owner) => `${owner.user.name} (${owner.startsOn.slice(0, 10)}–${owner.endsOn.slice(0, 10)})`).join(", ")}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {eligible.map((student) => (
          <label key={student.id} className="flex min-h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm">
            <Checkbox checked={selected.has(student.id)} onCheckedChange={(checked) => setSelected((currentSelection) => {
              const next = new Set(currentSelection);
              if (checked === true) next.add(student.id); else next.delete(student.id);
              return next;
            })} />
            {student.name}
          </label>
        ))}
        {eligible.length === 0 ? <span className="text-xs text-muted-foreground">Add an area-matched Student to this sport roster first.</span> : null}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" className="h-10" disabled={selected.size === 0 || loading || endsOn < startsOn} onClick={() => void save()}>Save handoff</Button>
      </div>
    </div>
  );
}
