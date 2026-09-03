"use client";

import { formatDuration, getStatusVisual, type BookingItem } from "./types";
import { cn } from "@/lib/utils";
import { BookingContextMenuWrapper, BookingOverflowMenu, type BookingMenuProps } from "./BookingContextMenu";
import { ItemThumbnailStack } from "@/components/ItemThumbnailStack";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { operationalBookingStatus } from "@/lib/booking-status-display";

/* ───── Helpers ───── */

function formatCardDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCardTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

/* ───── Gear thumbnail stack ───── */

export function GearAvatarStack({ items, bulkItems }: {
  items: BookingItem["serializedItems"];
  bulkItems: BookingItem["bulkItems"];
}) {
  const totalBulk = bulkItems?.reduce((sum, bi) => sum + (bi.plannedQuantity || 1), 0) ?? 0;
  const totalCount = (items?.length ?? 0) + totalBulk;
  return (
    <ItemThumbnailStack
      items={(items ?? []).map((si) => ({
        id: si.asset.assetTag,
        name: [si.asset.brand, si.asset.model, si.asset.assetTag].filter(Boolean).join(" ") || si.asset.assetTag,
        imageUrl: si.asset.imageUrl,
        fallback: si.asset.brand?.[0] ?? si.asset.assetTag?.[0] ?? "?",
      }))}
      totalCount={totalCount}
      surfaceClassName="border-card bg-muted"
    />
  );
}

/* ───── BookingCard ───── */

export type BookingCardProps = {
  item: BookingItem;
  overdueStatus: string;
  onClick: () => void;
  menuProps: Omit<BookingMenuProps, "item">;
};

export function BookingCard({ item, overdueStatus, onClick, menuProps }: BookingCardProps) {
  const now = new Date();
  const displayStatus = operationalBookingStatus(item, now);
  const isOverdue = item.status === overdueStatus && new Date(item.endsAt) < now;
  const sv = getStatusVisual(displayStatus, isOverdue, item.kind);
  const duration = formatDuration(item.startsAt, item.endsAt);

  return (
    <BookingContextMenuWrapper item={item} {...menuProps}>
      <div
        className={cn(
          "group relative overflow-hidden rounded-lg border bg-card transition-[background-color,box-shadow,scale] hover:bg-muted/30 hover:shadow-sm active:scale-[0.96]",
          isOverdue && "border-[var(--wi-red)]/25 bg-[var(--wi-red)]/[0.02]",
        )}
      >
        <button
          type="button"
          className="absolute inset-0 z-10 cursor-pointer bg-transparent outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
          aria-label={`View booking: ${item.title}`}
          onClick={onClick}
        />

        {/* Status left-border accent */}
        <div
          className="absolute left-0 top-0 bottom-0 z-0 w-[3px]"
          style={{ background: sv.dot }}
          aria-hidden="true"
        />

        <div className="relative z-0 p-4 pl-5">
          {/* Top row: status badge + ref number + duration */}
          <div className="flex items-center justify-between gap-2 mb-2.5 pr-10">
            <div className="flex min-w-0 items-center gap-2">
              <Badge variant={sv.variant} size="sm">{sv.label}</Badge>
              {item.refNumber && (
                <span
                  className="truncate text-[10px] tabular-nums text-muted-foreground/60"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  #{item.refNumber}
                </span>
              )}
            </div>
            <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
              {duration}
            </span>
          </div>

          {/* Title */}
          <h3
            className={cn(
              "text-[14.5px] leading-snug mb-2 line-clamp-2 pr-6",
              sv.titleClass,
            )}
            style={{ fontFamily: "var(--font-heading)", fontWeight: 700 }}
          >
            {item.title}
          </h3>

          {/* Date + location */}
          <div
            className="flex items-center gap-2 text-[11px] text-muted-foreground/60 mb-3"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            <span className="whitespace-nowrap">
              {formatCardDate(item.startsAt)} · {formatCardTime(item.startsAt)}
            </span>
            {item.location?.name && (
              <>
                <span className="text-muted-foreground/30" aria-hidden="true">/</span>
                <span className="truncate">{item.location.name}</span>
              </>
            )}
          </div>

          {/* Bottom row: user + gear */}
          <div className="flex items-center justify-between pt-2.5 border-t border-border/40">
            <div className="flex items-center gap-1.5 min-w-0">
              <UserAvatar
                name={item.requester?.name ?? "?"}
                avatarUrl={item.requester?.avatarUrl}
                size="sm"
                className="shrink-0 outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
              />
              <span
                className="text-[12px] truncate"
                style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}
              >
                {item.requester?.name ?? "Unknown"}
              </span>
            </div>

            <GearAvatarStack
              items={item.serializedItems}
              bulkItems={item.bulkItems}
            />
          </div>
        </div>

        {/* Overflow menu — top-right, always visible on touch, reveal on hover for pointer devices */}
        <div
          className="absolute top-3 right-3 z-20 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <BookingOverflowMenu item={item} {...menuProps} />
        </div>
      </div>
    </BookingContextMenuWrapper>
  );
}
