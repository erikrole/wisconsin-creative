"use client";

import { type ColumnDef, type RowData } from "@tanstack/react-table";
import { IconSwap } from "@/components/ui/icon-swap";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Width class applied to the column header so fixed-purpose columns stop drifting apart on wide screens. */
    thClassName?: string;
  }
}
import {
  ExternalLink,
  Copy,
  Wrench,
  Archive,
  Star,
  Printer,
} from "lucide-react";
import { AssetImage } from "@/components/AssetImage";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { OperationalRowActions } from "@/components/OperationalRowActions";
import { STATUS_STYLES, type StatusColor } from "@/lib/status-styles";
import { UserAvatar } from "@/components/UserAvatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatOperationalDateTime } from "@/lib/format";
import { isBulkRowId } from "./lib/item-href";

type ActiveBooking = {
  id: string;
  kind: string;
  status?: string;
  title: string;
  requesterName: string;
  requesterAvatarUrl?: string | null;
  isOverdue?: boolean;
  endsAt?: string;
};

export type Asset = {
  id: string;
  assetTag: string;
  name: string | null;
  type: string;
  brand: string;
  model: string;
  serialNumber: string;
  status: string;
  computedStatus: string;
  /** Held as an open missing-item case. */
  missing?: boolean;
  createdAt: string;
  location: { id: string; name: string };
  category: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  imageUrl: string | null;
  activeBooking: ActiveBooking | null;
  isFavorited?: boolean;
  isItemFamily?: boolean;
  itemFamilyTrackByNumber?: boolean;
  _count?: { accessories: number };
};

function StatusDot({ color }: { color: StatusColor }) {
  return (
    <span
      className={`size-1.5 shrink-0 rounded-full ${STATUS_STYLES[color].dot}`}
      aria-hidden="true"
    />
  );
}

/** A colored dot and label, with the person holding the item and when it is due on a quiet second line. */
function ItemStatus({
  color,
  label,
  name,
  avatarUrl,
  endsAt,
}: {
  color: StatusColor;
  label: string;
  name?: string;
  avatarUrl?: string | null;
  endsAt?: string;
}) {
  const due = endsAt && !Number.isNaN(new Date(endsAt).getTime())
    ? formatOperationalDateTime(endsAt, new Date(), { month: "short" })
    : null;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${color === "red" ? "text-[var(--red-text)]" : "text-foreground"}`}>
        <StatusDot color={color} />
        {label}
      </span>
      {name && (
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <UserAvatar name={name} avatarUrl={avatarUrl} size="xs" className="shrink-0 outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />
          <span className="truncate">
            {name}
            {due && <span className="tabular-nums"> · {due}</span>}
          </span>
        </span>
      )}
    </div>
  );
}

export function statusBadge(asset: Asset) {
  const { computedStatus, activeBooking } = asset;
  const holder = { name: activeBooking?.requesterName, avatarUrl: activeBooking?.requesterAvatarUrl };

  switch (computedStatus) {
    case "AVAILABLE":
      return <ItemStatus color="green" label="Available" />;
    case "CHECKED_OUT": {
      const isOverdue = !!activeBooking?.isOverdue;
      return <ItemStatus color={isOverdue ? "red" : "blue"} label={isOverdue ? "Overdue" : "Checked out"} {...holder} endsAt={activeBooking?.endsAt} />;
    }
    case "PENDING_PICKUP":
      return <ItemStatus color="orange" label="Pending pickup" {...holder} />;
    case "RESERVED":
      return <ItemStatus color="purple" label="Reserved" {...holder} endsAt={activeBooking?.endsAt} />;
    case "MAINTENANCE":
      return asset.missing
        ? <ItemStatus color="red" label="Missing" />
        : <ItemStatus color="orange" label="Maintenance" />;
    case "RETIRED":
      return <ItemStatus color="gray" label="Retired" />;
    default: {
      // Item families: "43/46 available"
      const familyAvailability = computedStatus.match(/^(\d+)\/(\d+) available$/);
      if (familyAvailability) {
        const qty = parseInt(familyAvailability[1]!, 10);
        return <ItemStatus color={qty === 0 ? "red" : "green"} label={qty === 0 ? "None available" : computedStatus} />;
      }
      return <ItemStatus color="gray" label={computedStatus} />;
    }
  }
}

type ColumnMeta = {
  canEdit: boolean;
  density?: "compact" | "comfortable";
  onRowAction?: (action: string, asset: Asset) => void;
  onToggleFavorite?: (asset: Asset) => void;
};

export function getColumns(meta: ColumnMeta): ColumnDef<Asset>[] {
  const columns: ColumnDef<Asset>[] = [];

  // Checkbox column — available to all users (for favorites and admin bulk actions)
  columns.push({
    id: "select",
    header: ({ table }) => (
      <div className="-m-3 flex size-10 items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => {
      const canSelect = row.getCanSelect();
      if (!canSelect) {
        return <span className="block size-9" aria-hidden="true" />;
      }
      return (
        <div
          className="-m-3 inline-flex size-10 items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            aria-label="Select row"
          />
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
    meta: { thClassName: "w-12" },
  });

  // Favorite star column
  columns.push({
    id: "favorite",
    header: () => <><Star className="size-3.5 text-muted-foreground" aria-hidden="true" /><span className="sr-only">Favorite</span></>,
    enableSorting: false,
    enableHiding: true,
    meta: { thClassName: "w-11" },
    cell: ({ row }) => {
      const asset = row.original;
      return (
        <Button
          variant="ghost"
          size="icon"
          className="size-10"
          onClick={(e) => {
            e.stopPropagation();
            meta.onToggleFavorite?.(asset);
          }}
          aria-label={asset.isFavorited ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={!!asset.isFavorited}
        >
          <IconSwap swapKey={asset.isFavorited ? "favorited" : "not-favorited"}>
              <Star
                className={`size-4 ${
                  asset.isFavorited
                    ? "fill-[var(--yellow-text)] text-[var(--yellow-text)]"
                    : "text-muted-foreground"
                }`}
                aria-hidden="true"
              />
            </IconSwap>
        </Button>
      );
    },
  });

  columns.push(
    {
      header: "Name",
      accessorKey: "assetTag",
      id: "assetTag",
      enableSorting: true,
      cell: ({ row }) => {
        const item = row.original;
        const isCompact = meta.density === "compact";
        const rawSubtitle = item.name || [item.brand, item.model].filter(Boolean).join(" ");
        // Hide subtitle when it duplicates the assetTag.
        const subtitle =
          rawSubtitle && rawSubtitle.trim().toLowerCase() !== item.assetTag.trim().toLowerCase()
            ? rawSubtitle
            : null;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <AssetImage
              src={item.imageUrl}
              alt={item.assetTag}
              size={isCompact ? 32 : 40}
              className={isCompact ? "rounded-md" : "rounded-lg"}
            />
            <div className={isCompact ? "flex min-w-0 items-center gap-2" : "flex min-w-0 flex-col gap-0.5"}>
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={isCompact ? "truncate text-sm font-medium leading-tight" : "truncate text-[15px] font-semibold leading-tight"}
                  style={{ fontFamily: "var(--font-heading)", fontWeight: isCompact ? 600 : 650 }}
                >
                  {item.assetTag}
                </span>
                {(item._count?.accessories ?? 0) > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Badge variant="secondary" size="sm" className="shrink-0 rounded-sm px-1 font-normal">
                        +{item._count!.accessories}
                      </Badge>
                    </TooltipTrigger>
                    <TooltipContent>
                      {item._count!.accessories === 1
                        ? "1 attached child item hidden from normal booking lists"
                        : `${item._count!.accessories} attached child items hidden from normal booking lists`}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              {subtitle && (
                <div className={isCompact ? "max-w-[280px] truncate text-xs text-muted-foreground" : "max-w-[360px] truncate text-xs text-muted-foreground"}>
                  {subtitle}
                </div>
              )}
            </div>
          </div>
        );
      },
      enableHiding: false,
    },
    {
      header: "Status",
      id: "status",
      cell: ({ row }) => (
        <div className="flex items-center">
          {statusBadge(row.original)}
        </div>
      ),
      enableSorting: false,
      meta: { thClassName: "w-[260px]" },
    },
    {
      header: "Category",
      id: "category",
      accessorFn: (row) => row.category?.name || row.type,
      cell: ({ row }) => (
        <span className="block truncate text-sm text-foreground/85">{row.original.category?.name || row.original.type}</span>
      ),
      enableSorting: true,
      meta: { thClassName: "w-[150px]" },
    },
    {
      header: "Department",
      id: "department",
      accessorFn: (row) => row.department?.name ?? "",
      cell: ({ row }) => (
        <span className="block truncate text-sm text-muted-foreground">{row.original.department?.name ?? "—"}</span>
      ),
      enableSorting: true,
      meta: { thClassName: "w-[140px]" },
    },
    {
      header: "Location",
      id: "location",
      accessorFn: (row) => row.location.name,
      cell: ({ row }) => (
        <span className="block truncate text-sm font-medium text-foreground/85">{row.original.location.name}</span>
      ),
      enableSorting: true,
      meta: { thClassName: "w-[150px]" },
    },
  );

  // Row actions
  if (meta.canEdit) {
    columns.push({
      id: "actions",
      meta: { thClassName: "w-12" },
      cell: ({ row }) => {
        const asset = row.original;
        const isBulk = isBulkRowId(asset.id);
        return (
          <OperationalRowActions
            label={`Actions for ${asset.assetTag}`}
            triggerClassName="opacity-0 transition-[opacity,scale] group-hover/row:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 [@media(pointer:coarse)]:opacity-100"
          >
            <DropdownMenuItem onClick={() => meta.onRowAction?.("open", asset)}>
              <ExternalLink className="size-4" />
              Open
            </DropdownMenuItem>
            {isBulk ? (
              <>
                <DropdownMenuItem onClick={() => meta.onRowAction?.("manage-family", asset)}>
                  <ExternalLink className="size-4" />
                  Manage inventory
                </DropdownMenuItem>
                {asset.itemFamilyTrackByNumber && (
                  <DropdownMenuItem onClick={() => meta.onRowAction?.("print-label", asset)}>
                    <Printer className="size-4" />
                    Export unit labels
                  </DropdownMenuItem>
                )}
              </>
            ) : (
              <>
                <DropdownMenuItem onClick={() => meta.onRowAction?.("print-label", asset)}>
                  <Printer className="size-4" />
                  Print label
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => meta.onRowAction?.("add-another", asset)}>
                  <Copy className="size-4" />
                  Add another like this
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => meta.onRowAction?.("maintenance", asset)}>
                  <Wrench className="size-4" />
                  Maintenance
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => meta.onRowAction?.("retire", asset)}
                >
                  <Archive className="size-4" />
                  Retire
                </DropdownMenuItem>
              </>
            )}
          </OperationalRowActions>
        );
      },
    });
  }

  return columns;
}
