"use client";

import { type ColumnDef, type RowData } from "@tanstack/react-table";
import { AnimatePresence, motion } from "motion/react";

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
import { isBulkRowId } from "./lib/item-href";

export type ActiveBooking = {
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
      className={`size-1.5 rounded-full ${STATUS_STYLES[color].dot}`}
      aria-hidden="true"
    />
  );
}

function formatDueAt(endsAt: string | undefined): string | null {
  if (!endsAt) return null;
  const d = new Date(endsAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AssigneeStatus({
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
  const dueAt = formatDueAt(endsAt);
  const labelTooltip = dueAt ? `${label} · Due ${dueAt}` : label;

  if (!name) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge className={STATUS_STYLES[color].badge}>
            <StatusDot color={color} />
            {label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{labelTooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className={`inline-flex items-center gap-1 rounded-full pl-[3px] pr-2 py-[3px] ${STATUS_STYLES[color].badge}`}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default">
            <UserAvatar
              name={name}
              avatarUrl={avatarUrl}
              size="xs"
              className="outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10"
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{name}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default text-[11px] font-semibold">
            {name}
          </span>
        </TooltipTrigger>
        <TooltipContent>{labelTooltip}</TooltipContent>
      </Tooltip>
    </div>
  );
}

export function statusBadge(asset: Asset) {
  const { computedStatus, activeBooking } = asset;

  switch (computedStatus) {
    case "AVAILABLE":
      return (
        <Badge className={STATUS_STYLES.green.badge}>
          <StatusDot color="green" />
          Available
        </Badge>
      );
    case "CHECKED_OUT": {
      const isOverdue = activeBooking?.isOverdue;
      const color = isOverdue ? "red" : "blue";
      return (
        <AssigneeStatus
          color={color}
          label={isOverdue ? "Overdue" : "Checked Out"}
          name={activeBooking?.requesterName}
          avatarUrl={activeBooking?.requesterAvatarUrl}
          endsAt={activeBooking?.endsAt}
        />
      );
    }
    case "PENDING_PICKUP": {
      return (
        <AssigneeStatus
          color="orange"
          label="Pending pickup"
          name={activeBooking?.requesterName}
          avatarUrl={activeBooking?.requesterAvatarUrl}
        />
      );
    }
    case "RESERVED": {
      return (
        <AssigneeStatus
          color="purple"
          label="Reserved"
          name={activeBooking?.requesterName}
          avatarUrl={activeBooking?.requesterAvatarUrl}
          endsAt={activeBooking?.endsAt}
        />
      );
    }
    case "MAINTENANCE":
      return (
        <Badge className={STATUS_STYLES.orange.badge}>
          <StatusDot color="orange" />
          Maintenance
        </Badge>
      );
    case "RETIRED":
      return (
        <Badge className={STATUS_STYLES.gray.badge}>
          <StatusDot color="gray" />
          Retired
        </Badge>
      );
    default:
      // Item families: "43/46 available"
      const familyAvailability = computedStatus.match(/^(\d+)\/(\d+) available$/);
      if (familyAvailability) {
        const qty = parseInt(familyAvailability[1]!, 10);
        const color = qty === 0 ? "red" : "green";
        return (
          <Badge className={STATUS_STYLES[color].badge}>
            <StatusDot color={color} />
            {qty === 0 ? "None available" : computedStatus}
          </Badge>
        );
      }
      return (
        <Badge className={STATUS_STYLES.gray.badge}>
          <StatusDot color="gray" />
          {computedStatus}
        </Badge>
      );
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
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={asset.isFavorited ? "favorited" : "not-favorited"}
              initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
              transition={{ type: "spring", duration: 0.3, bounce: 0 }}
              className="inline-flex items-center justify-center"
            >
              <Star
                className={`size-4 ${
                  asset.isFavorited
                    ? "fill-[var(--yellow-text)] text-[var(--yellow-text)]"
                    : "text-muted-foreground"
                }`}
                aria-hidden="true"
              />
            </motion.span>
          </AnimatePresence>
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
      meta: { thClassName: "w-[200px]" },
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
