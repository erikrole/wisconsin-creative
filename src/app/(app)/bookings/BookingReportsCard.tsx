"use client";

import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Resolution = "REPAIRED" | "REPLACED" | "WRITTEN_OFF" | "FOUND" | "NO_ISSUE";
type Report = { id: string; type: "DAMAGED" | "LOST"; label: string; resolution: Resolution | null; open: boolean; reportedAt: string };

const OUTCOME: Record<Resolution, string> = {
  REPAIRED: "Repaired",
  REPLACED: "Replaced",
  WRITTEN_OFF: "Written off",
  FOUND: "Found",
  NO_ISSUE: "No issue found",
};

/** What was reported on this return and where it stands. Renders nothing when there are no reports. */
export default function BookingReportsCard({ bookingId }: { bookingId: string }) {
  const { data } = useQuery<Report[]>({
    queryKey: ["booking-reports", bookingId],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/bookings/${bookingId}/reports`, { signal });
      if (!res.ok) return [];
      return (await res.json()).data;
    },
  });
  if (!data || data.length === 0) return null;

  return (
    <Card elevation="flat" className="rounded-xl border-border/50 shadow-xs">
      <CardHeader>
        <CardTitle className="text-base tracking-tight">Reported at return</CardTitle>
        <CardDescription>Gear flagged as damaged or missing on this checkout, and what staff did about it.</CardDescription>
      </CardHeader>
      <CardContent className="divide-y divide-border/60 p-0 px-6 pb-4">
        {data.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-medium">{r.label}</p>
              <p className="m-0 text-xs text-muted-foreground">{r.type === "DAMAGED" ? "Reported damaged" : "Reported missing"}</p>
            </div>
            {r.resolution ? (
              <Badge variant="gray">{OUTCOME[r.resolution]}</Badge>
            ) : r.open ? (
              <Badge variant={r.type === "LOST" ? "red" : "orange"}>Staff are looking into it</Badge>
            ) : (
              <Badge variant="gray">Noted</Badge>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
