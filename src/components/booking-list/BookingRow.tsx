"use client";

import { formatDateShort } from "@/lib/format";
import { formatDateCol, formatDuration, getStatusVisual, type BookingItem } from "./types";
import { BookingContextMenuWrapper, BookingOverflowMenu, type BookingMenuProps } from "./BookingContextMenu";
import { GearAvatarStack } from "./BookingCard";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { TableRow, TableCell } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { operationalBookingStatus } from "@/lib/booking-status-display";

/* ───── Desktop table row ───── */

export type BookingTableRowProps = {
  item: BookingItem;
  overdueStatus: string;
  onClick: () => void;
  menuProps: Omit<BookingMenuProps, "item">;
};

export function BookingTableRow({
  item,
  overdueStatus,
  onClick,
  menuProps,
}: BookingTableRowProps) {
  const now = new Date();
  const displayStatus = operationalBookingStatus(item, now);
  const isOverdue = item.status === overdueStatus && new Date(item.endsAt) < now;
  const sv = getStatusVisual(displayStatus, isOverdue, item.kind);
  const from = formatDateCol(item.startsAt);
  const to = formatDateCol(item.endsAt);

  return (
    <BookingContextMenuWrapper item={item} {...menuProps}>
      <TableRow
        className={cn(
          "cursor-pointer",
          sv.rowClass,
        )}
        onClick={onClick}
      >
        <TableCell>
          <button
            type="button"
            className="flex w-full flex-col gap-1 rounded-sm bg-transparent text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            aria-label={`View booking: ${item.title}`}
            onClick={(e) => {
              e.stopPropagation();
              onClick();
            }}
          >
            <span
              className={cn("leading-snug", sv.titleClass)}
              style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "13.5px" }}
            >
              {item.title}
            </span>
            <span className="inline-flex items-center gap-2">
              <Badge variant={sv.variant} size="sm">{sv.label}</Badge>
              {item.refNumber && (
                <span
                  className="text-[10px] tabular-nums text-muted-foreground/60"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  #{item.refNumber}
                </span>
              )}
            </span>
          </button>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <div className="flex flex-col gap-px">
            <span className="text-[13px] font-medium tabular-nums">
              {from.date}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {from.day} {from.time}
            </span>
          </div>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <div className="flex flex-col gap-px">
            <span className="text-[13px] font-medium tabular-nums">
              {to.date}
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {to.day} {to.time}
            </span>
          </div>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <span className="text-[13px] text-muted-foreground">
            {formatDuration(item.startsAt, item.endsAt)}
          </span>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <div className="flex items-center gap-2">
            <UserAvatar
              name={item.requester?.name ?? "Unknown"}
              avatarUrl={item.requester?.avatarUrl}
              className="outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
            />
            <span
              className="text-[13px]"
              style={{ fontFamily: "var(--font-heading)", fontWeight: 500 }}
            >
              {item.requester?.name ?? "Unknown"}
            </span>
          </div>
        </TableCell>
        <TableCell className="hidden md:table-cell">
          <div className="flex items-center gap-2">
            <GearAvatarStack items={item.serializedItems} bulkItems={item.bulkItems} />
            <span className="text-[13px] text-muted-foreground tabular-nums">
              {(item.serializedItems?.length ?? 0) + (item.bulkItems?.reduce((sum, bulkItem) => sum + (bulkItem.plannedQuantity || 0), 0) ?? 0)}
            </span>
          </div>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <BookingOverflowMenu item={item} {...menuProps} />
        </TableCell>
      </TableRow>
    </BookingContextMenuWrapper>
  );
}

/* ───── Mobile card ───── */

export type BookingMobileCardProps = {
  item: BookingItem;
  overdueStatus: string;
  onClick: () => void;
  menuProps: Omit<BookingMenuProps, "item">;
};

export function BookingMobileCard({
  item,
  overdueStatus,
  onClick,
  menuProps,
}: BookingMobileCardProps) {
  const now = new Date();
  const displayStatus = operationalBookingStatus(item, now);
  const isOverdue = item.status === overdueStatus && new Date(item.endsAt) < now;
  const sv = getStatusVisual(displayStatus, isOverdue, item.kind);

  return (
    <div
      className={cn(
        "relative flex flex-col gap-1 overflow-hidden border-b border-border px-4 py-3 transition-[background-color,scale] active:scale-[0.96] active:bg-muted last:border-b-0",
        sv.rowClass,
      )}
    >
      <button
        type="button"
        className="absolute inset-0 z-10 cursor-pointer bg-transparent outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
        aria-label={`View booking: ${item.title}`}
        onClick={onClick}
      />

      {/* Status left accent */}
      <div
        className="absolute left-0 top-0 bottom-0 z-0 w-[3px]"
        style={{ background: sv.dot }}
        aria-hidden="true"
      />

      <div className="pointer-events-none relative z-20 flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <span
            className={cn("overflow-hidden text-ellipsis whitespace-nowrap", sv.titleClass)}
            style={{ fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: "13.5px" }}
          >
            {item.title}
          </span>
          <span className="inline-flex items-center gap-2">
            <Badge variant={sv.variant} size="sm">{sv.label}</Badge>
            {item.refNumber && (
              <span
                className="text-[10px] tabular-nums text-muted-foreground/60"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                #{item.refNumber}
              </span>
            )}
          </span>
        </div>
        <div className="pointer-events-auto relative z-20" onClick={(e) => e.stopPropagation()}>
          <BookingOverflowMenu item={item} {...menuProps} />
        </div>
      </div>

      <div
        className="pointer-events-none relative z-0 flex flex-wrap items-center gap-1 text-muted-foreground/55"
        style={{ fontFamily: "var(--font-mono)", fontSize: "11px" }}
      >
        <span className="tabular-nums">{formatDateShort(item.startsAt)} – {formatDateShort(item.endsAt)}</span>
        <span aria-hidden="true">·</span>
        <UserAvatar
          name={item.requester?.name ?? "Unknown"}
          avatarUrl={item.requester?.avatarUrl}
          size="sm"
          className="outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
        />
        <span>{item.requester?.name ?? "Unknown"}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{formatDuration(item.startsAt, item.endsAt)}</span>
      </div>
    </div>
  );
}
