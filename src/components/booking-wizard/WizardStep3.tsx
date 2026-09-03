"use client";

import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AssetImage } from "@/components/AssetImage";
import {
  AlertCircleIcon,
  CalendarIcon,
} from "lucide-react";
import { sportLabel } from "@/lib/sports";
import { VENUE_TONES, venueBadgeVariant, venueToneFromIsHome } from "@/lib/venue-tone";
import { formatChipTime, formatDateTime } from "@/lib/format";
import { formatCalendarEventDateRange } from "@/lib/calendar-event-dates";
import type { BulkSelection, EquipmentPickerSelectionState, PickerAsset } from "@/components/EquipmentPicker";
import type { FormUser, Location, BulkSkuOption } from "@/components/booking-list/types";
import type { FormState } from "@/components/create-booking/types";
import { MAX_SCROLL_HEIGHT } from "./constants";
import { buildAvailabilityReview, getTurnaroundWarningTotal } from "./flow-summary";

type WizardConfig = {
  kind: "RESERVATION";
  label: string;
  requesterLabel: string;
  startLabel: string;
  endLabel: string;
};

type Props = {
  config: WizardConfig;
  form: FormState;
  users: FormUser[];
  locations: Location[];
  selectedAssetDetails: PickerAsset[];
  selectedBulkItems: BulkSelection[];
  bulkSkus: BulkSkuOption[];
  itemCount: number;
  selectionState: EquipmentPickerSelectionState;
};

function eventDateLabel(ev: FormState["selectedEvents"][number]) {
  return ev.allDay ? formatCalendarEventDateRange(ev) : formatChipTime(ev.startsAt);
}

function eventSummaryLabel(ev: FormState["selectedEvents"][number]) {
  if (ev.opponent) {
    return `${ev.sportCode ? `${sportLabel(ev.sportCode)} ` : ""}${ev.isHome === false ? "at" : "vs"} ${ev.opponent}`;
  }
  return ev.summary;
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-6 px-2 py-3">
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground shrink-0 mt-0.5">
        {label}
      </span>
      <div className="text-sm font-medium text-right min-w-0">{children}</div>
    </div>
  );
}

export function WizardStep3({
  config,
  form,
  users,
  locations,
  selectedAssetDetails,
  selectedBulkItems,
  bulkSkus,
  itemCount,
  selectionState,
}: Props) {
  const locationName = locations.find((l) => l.id === form.locationId)?.name || "";
  const requester = users.find((u) => u.id === form.requester);
  const requesterName = requester?.name || "the requester";
  const availabilityReview = buildAvailabilityReview(selectionState);
  const turnaroundCount = getTurnaroundWarningTotal(selectionState);
  const linkedAllDayWindow =
    form.selectedEvents.length > 0 && form.selectedEvents.every((ev) => ev.allDay);
  const linkedAllDayWindowLabel = linkedAllDayWindow
    ? `${formatCalendarEventDateRange(
        { startsAt: form.startsAt, endsAt: form.endsAt, allDay: true },
        { includeYear: true },
      )} · All day`
    : null;
  const primaryWindowLabel = linkedAllDayWindowLabel ?? formatDateTime(form.startsAt);
  const secondaryWindowLabel = linkedAllDayWindowLabel ? null : (
    `Ends ${formatDateTime(form.endsAt)}`
  );

  const bulkDisplay = selectedBulkItems.map((bi) => {
    const sku = bulkSkus.find((s) => s.id === bi.bulkSkuId);
    return { id: bi.bulkSkuId, name: sku?.name || bi.bulkSkuId, quantity: bi.quantity, imageUrl: sku?.imageUrl };
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="mx-auto w-full max-w-3xl rounded-2xl border border-border/35 bg-background/60 px-5 py-8 text-center shadow-[0_12px_50px_rgba(0,0,0,0.05)] dark:shadow-none md:px-10">
        <div className="mx-auto flex max-w-xl flex-col items-center">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[var(--purple-bg)] text-[var(--purple-text)]"
          >
            <CalendarIcon className="size-6" />
          </div>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight text-balance">
            Review your {config.label}
          </h2>
          <p className="mt-6 text-2xl font-semibold tracking-tight text-balance md:text-3xl">
            {primaryWindowLabel}
          </p>
          {secondaryWindowLabel && (
            <p className="mt-1 text-sm font-medium text-muted-foreground">
              {secondaryWindowLabel}
            </p>
          )}
          <div className="mt-4 flex flex-col items-center gap-1 text-sm text-muted-foreground">
            <span>{form.custodyScope === "SHARED" ? "Shared travel case" : requesterName}</span>
            <span>{locationName}</span>
          </div>

          <div className="mt-7 w-full max-w-lg divide-y divide-border/70 border-y border-border/70">
            <SummaryRow label="Status">
              <Badge variant="purple" size="sm">
                Reserved
              </Badge>
            </SummaryRow>
            {form.custodyScope === "SHARED" && (
              <SummaryRow label="Custody">Shared travel case</SummaryRow>
            )}
            {form.selectedEvents.length > 0 && (
              <SummaryRow label={form.selectedEvents.length > 1 ? "Events" : "Event"}>
                <div className="flex flex-col items-end gap-1.5">
                  {form.selectedEvents.map((ev, idx) => (
                    <div key={ev.id} className="flex flex-wrap items-center justify-end gap-2">
                      {idx === 0 && form.selectedEvents.length > 1 && (
                        <Badge variant="outline" size="sm" className="text-[9px] uppercase tracking-wider">
                          Primary
                        </Badge>
                      )}
                      <span className="text-xs font-medium text-muted-foreground tabular-nums">
                        {eventDateLabel(ev)}
                      </span>
                      <span className="brand-identity">{eventSummaryLabel(ev)}</span>
                      {ev.opponent && (
                        <Badge variant={venueBadgeVariant(ev.isHome)} size="sm">
                          {VENUE_TONES[venueToneFromIsHome(ev.isHome)].label}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </SummaryRow>
            )}
            <SummaryRow label="Equipment">
              <span className="tabular-nums">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
            </SummaryRow>
          </div>
        </div>
      </div>

      {availabilityReview && (
        <Alert
          variant={availabilityReview.tone === "conflict" ? "destructive" : "default"}
          className="mx-auto w-full max-w-3xl"
        >
          <AlertCircleIcon />
          <AlertTitle>{availabilityReview.title}</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>{availabilityReview.description}</p>
            <div className="flex flex-wrap gap-1.5">
              {selectionState.conflictCount > 0 && (
                <Badge variant="orange" size="sm" className="tabular-nums">
                  {selectionState.conflictCount} conflict{selectionState.conflictCount !== 1 ? "s" : ""}
                </Badge>
              )}
              {selectionState.upcomingCommitmentCount > 0 && (
                <Badge variant="blue" size="sm" className="tabular-nums">
                  {selectionState.upcomingCommitmentCount} needed next
                </Badge>
              )}
              {turnaroundCount > 0 && (
                <Badge variant="orange" size="sm" className="tabular-nums">
                  {turnaroundCount} turnaround
                </Badge>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {form.notes.trim() && (
        <div className="mx-auto w-full max-w-3xl overflow-hidden rounded-md border border-border/60 bg-background shadow-xs">
          <SummaryRow label="Notes">
            <span className="whitespace-pre-wrap text-left">{form.notes}</span>
          </SummaryRow>
        </div>
      )}

      {/* ── Equipment ── */}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <h3 className="text-base font-semibold tracking-tight">Equipment</h3>
        </div>

        {itemCount === 0 ? (
          <div className="border border-dashed rounded-sm px-4 py-6 text-center text-sm text-muted-foreground">
            No equipment selected — go back to add items.
          </div>
        ) : (
          <div
            className="overflow-y-auto rounded-xl border border-border/60 bg-background/70 overscroll-contain [touch-action:pan-y]"
            style={{ maxHeight: MAX_SCROLL_HEIGHT }}
          >
            {selectedAssetDetails.map((asset, i) => (
              <div key={asset.id}>
                {i > 0 && <Separator className="opacity-40" />}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <AssetImage
                    src={asset.imageUrl}
                    alt={asset.assetTag}
                    size={40}
                    className="rounded-md shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="brand-identity text-sm font-semibold">{asset.assetTag}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {asset.brand} {asset.model}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {bulkDisplay.map((bi, i) => (
              <div key={bi.id}>
                {(selectedAssetDetails.length > 0 || i > 0) && <Separator className="opacity-40" />}
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <AssetImage
                    src={bi.imageUrl}
                    alt={bi.name}
                    size={40}
                    className="rounded-md shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="brand-identity text-sm font-semibold">{bi.name}</p>
                  </div>
                  <span className="text-xs font-bold text-muted-foreground tabular-nums">
                    &times; {bi.quantity}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
