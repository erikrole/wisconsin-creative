"use client";

import { useState } from "react";
import { useFetch } from "@/hooks/use-fetch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/lib/toast";
import { formatAppDateTime } from "@/lib/app-time";
import { handleAuthRedirect, parseErrorMessage, parseJsonSafely } from "@/lib/errors";
import type { ChecklistCheck, ChecklistItem } from "@/lib/shared-case-checklist";

export type TripChecklist = {
  tripId: string;
  groups: { section: string | null; items: ChecklistItem[] }[];
  checks: Record<string, ChecklistCheck>;
  names: Record<string, string>;
  total: number;
  checked: number;
};

/**
 * Things packed in the shared case that are not checked out, ticked by hand.
 * Renders nothing for bookings that are not a shared case, or while the list in
 * Settings is empty.
 */
export function SharedCaseChecklistCard({ bookingId }: { bookingId: string }) {
  const { data: fetched } = useFetch<TripChecklist | null>({
    url: `/api/bookings/${bookingId}/checklist`,
    transform: (json) => (json.data as TripChecklist | null) ?? null,
  });
  const [saved, setSaved] = useState<{ from: TripChecklist | null; data: TripChecklist | null } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // A save answers with the whole list; a later refetch replaces it.
  const data = saved && saved.from === fetched ? saved.data : fetched;
  if (!data) return null;

  async function toggle(itemId: string, checked: boolean) {
    setSaving(itemId);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/checklist`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, checked }),
      });
      if (handleAuthRedirect(res)) return;
      if (!res.ok) {
        toast.error(await parseErrorMessage(res, "Couldn't save that"));
        return;
      }
      const json = await parseJsonSafely<{ data?: TripChecklist | null }>(res);
      if (json?.data !== undefined) setSaved({ from: fetched, data: json.data });
    } catch (err) {
      toast.error(err instanceof TypeError ? "You’re offline. Check your connection." : "Couldn't save that");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card elevation="flat" className="rounded-xl border-border/50 shadow-xs">
      <CardHeader className="gap-2 pb-2">
        <div className="flex items-baseline justify-between gap-3">
          <CardTitle className="text-base tracking-tight">Case checklist</CardTitle>
          <span className="text-sm tabular-nums text-muted-foreground">
            {data.checked === data.total ? "All packed" : `${data.checked} of ${data.total} packed`}
          </span>
        </div>
        <Progress value={(data.checked / data.total) * 100} className="h-1.5" aria-label="Packed" />
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {data.groups.map((group, index) => (
          <div key={`${group.section ?? ""}-${index}`} className="flex flex-col">
            {group.section && (
              <p className="pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group.section}</p>
            )}
            {group.items.map((item) => {
              const check = data.checks[item.id];
              return (
                <label key={item.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-1 hover:bg-muted/50">
                  <Checkbox
                    checked={Boolean(check)}
                    disabled={saving === item.id}
                    onCheckedChange={(value) => toggle(item.id, value === true)}
                  />
                  <span className="flex min-w-0 flex-1 flex-col py-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <span className={`text-sm ${check ? "text-muted-foreground line-through decoration-muted-foreground/50" : ""}`}>
                      {item.label}
                    </span>
                    {check && (
                      <span className="text-xs text-muted-foreground sm:shrink-0">
                        {data.names[check.by] ?? "Someone"} · {formatAppDateTime(check.at)}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
