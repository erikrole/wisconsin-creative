"use client";

import Image from "next/image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { displayBookingTitle } from "@/lib/booking-display-title";
import type { AssetDetail } from "../types";

export function ItemConditionReports({ asset, busy, onClearHold, onSelectBooking }: {
  asset: AssetDetail;
  busy: boolean;
  onClearHold: () => void;
  onSelectBooking: (id: string) => void;
}) {
  const reports = asset.checkinReports ?? [];
  if (reports.length === 0) return null;
  const held = asset.status === "MAINTENANCE";

  return (
    <Card className="mt-3.5 border-border/60 shadow-none">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle>Condition reports</CardTitle>
          <CardDescription>
            {held ? "Held for staff. Inspect the item and review the evidence before clearing maintenance." : "Recent reports remain here as a record. The item's current status is shown above."}
          </CardDescription>
        </div>
        {held && <Button variant="outline" disabled={busy} onClick={onClearHold}>Clear maintenance hold</Button>}
      </CardHeader>
      <CardContent className="divide-y divide-border/60">
        {reports.map((report) => (
          <article key={report.id} className="flex flex-col gap-4 py-4 first:pt-0 last:pb-0 sm:flex-row">
            {report.imageUrl && (
              <a href={report.imageUrl} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Open evidence photo for ${report.type === "DAMAGED" ? "damage" : "missing item"} report`}>
                <Image src={report.imageUrl} alt="Report evidence" width={112} height={84} unoptimized className="h-21 w-28 rounded-md border border-border object-cover" />
              </a>
            )}
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={report.type === "DAMAGED" ? "orange" : "red"}>{report.type === "DAMAGED" ? "Damage reported" : "Reported missing"}</Badge>
                <span className="text-xs text-muted-foreground">{report.reportedBy.name} · {new Date(report.lastReportedAt ?? report.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Chicago" })}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{report.description || "No description was provided."}</p>
              {!report.imageUrl && <p className="text-xs text-muted-foreground">No photo attached</p>}
              <Button variant="link" className="h-auto max-w-full justify-start whitespace-normal px-0 text-left" onClick={() => onSelectBooking(report.booking.id)}>
                View checkout · {displayBookingTitle(report.booking.title)}
              </Button>
            </div>
          </article>
        ))}
        {reports.length === 5 && <p className="pt-3 text-xs text-muted-foreground">Showing the five most recent reports.</p>}
      </CardContent>
    </Card>
  );
}
