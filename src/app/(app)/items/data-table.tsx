"use client";

import { type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  type ColumnDef,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  type OnChangeFn,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Copy,
  ExternalLink,
  Printer,
  Star,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Asset } from "./columns";
import { statusBadge } from "./columns";
import { getItemHref, isBulkRowId } from "./lib/item-href";
import { AssetImage } from "@/components/AssetImage";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export type Density = "compact" | "comfortable";

interface DataTableProps {
  columns: ColumnDef<Asset>[];
  data: Asset[];
  rowSelection: RowSelectionState;
  onRowSelectionChange: OnChangeFn<RowSelectionState>;
  columnVisibility: VisibilityState;
  onColumnVisibilityChange: OnChangeFn<VisibilityState>;
  sorting: SortingState;
  onSortingChange: (sorting: SortingState) => void;
  refreshing?: boolean;
  density?: Density;
  canEdit?: boolean;
  actionBusy?: boolean;
  onRowAction?: (action: string, asset: Asset) => void;
  onToggleFavorite?: (asset: Asset) => void;
}

function RowContextMenu({
  item,
  selected,
  canSelect,
  canEdit,
  actionBusy,
  onOpen,
  onToggleSelected,
  onRowAction,
  onToggleFavorite,
  children,
}: {
  item: Asset;
  selected: boolean;
  canSelect: boolean;
  canEdit: boolean;
  actionBusy: boolean;
  onOpen: (newTab?: boolean) => void;
  onToggleSelected?: () => void;
  onRowAction?: (action: string, asset: Asset) => void;
  onToggleFavorite?: (asset: Asset) => void;
  children: ReactNode;
}) {
  const isBulk = isBulkRowId(item.id);
  const canMutateSerialized = canEdit && !isBulk;

  async function copyTag() {
    try {
      await navigator.clipboard.writeText(item.assetTag);
      toast.success(`Copied ${item.assetTag}`);
    } catch {
      toast.error("Could not copy item tag");
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuLabel className="truncate text-xs text-muted-foreground">
          {item.assetTag}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onOpen()}>
          <ExternalLink />
          Open
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onOpen(true)}>
          <ExternalLink />
          Open in new tab
        </ContextMenuItem>
        {canSelect && (
          <ContextMenuItem onSelect={() => onToggleSelected?.()}>
            {selected ? "Deselect row" : "Select row"}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={copyTag}>
          <Copy />
          Copy tag
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onToggleFavorite?.(item)}>
          <Star className={item.isFavorited ? "fill-current" : undefined} />
          {item.isFavorited ? "Remove favorite" : "Add favorite"}
        </ContextMenuItem>
        {isBulk && (
          <ContextMenuItem onSelect={() => onRowAction?.("manage-family", item)}>
            <ExternalLink />
            Manage inventory
          </ContextMenuItem>
        )}
        {(!isBulk || item.itemFamilyTrackByNumber) && (
          <ContextMenuItem onSelect={() => onRowAction?.("print-label", item)}>
            <Printer />
            {isBulk ? "Export unit labels" : "Print label"}
          </ContextMenuItem>
        )}
        {canMutateSerialized && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={actionBusy} onSelect={() => onRowAction?.("duplicate", item)}>
              <Copy />
              Duplicate
            </ContextMenuItem>
            <ContextMenuItem disabled={actionBusy} onSelect={() => onRowAction?.("maintenance", item)}>
              <Wrench />
              {item.status === "MAINTENANCE" ? "Clear maintenance" : "Needs maintenance"}
            </ContextMenuItem>
            <ContextMenuItem
              disabled={actionBusy}
              variant="destructive"
              onSelect={() => onRowAction?.("retire", item)}
            >
              <Archive />
              Retire
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function DataTable({
  columns,
  data,
  rowSelection,
  onRowSelectionChange,
  columnVisibility,
  onColumnVisibilityChange,
  sorting,
  onSortingChange,
  refreshing = false,
  density = "comfortable",
  canEdit = false,
  actionBusy = false,
  onRowAction,
  onToggleFavorite,
}: DataTableProps) {
  const densityClass =
    density === "compact"
      ? "[&_td]:py-1 [&_td]:px-3 [&_th]:h-10 [&_th]:px-3 [&_tbody_tr]:h-10"
      : "";
  const router = useRouter();

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualSorting: true,
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      onSortingChange(next);
    },
    onRowSelectionChange,
    onColumnVisibilityChange,
    state: {
      sorting,
      rowSelection,
      columnVisibility,
    },
    getRowId: (row) => row.id,
    enableRowSelection: true,
  });

  return (
    <div className={cn("relative rounded-md border", densityClass)} role="region" aria-busy={refreshing}>
        {refreshing && (
          <div className="absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden rounded-t-md">
            <div className="h-full w-1/3 bg-primary/40 animate-[shimmer_1.5s_ease-in-out_infinite]" />
          </div>
        )}

        {/* Mobile card layout */}
        <div className="divide-y sm:hidden">
          {table.getRowModel().rows.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground">
              No items match your filters.
            </div>
          ) : (
            table.getRowModel().rows.map((row) => {
              const item = row.original;
              const subtitle = item.name || [item.brand, item.model].filter(Boolean).join(" ");
              const product = [item.brand, item.model].filter(Boolean).join(" ");
              const showProductMeta = product && product.trim().toLowerCase() !== subtitle.trim().toLowerCase();
              const meta = [item.location?.name, item.category?.name || item.type]
                .filter(Boolean)
                .join(" · ");
              const href = getItemHref(item.id);
              const openItem = (newTab = false) => {
                if (newTab) window.open(href, "_blank", "noopener");
                else router.push(href);
              };
              return (
                <RowContextMenu
                  key={row.id}
                  item={item}
                  selected={row.getIsSelected()}
                  canSelect={row.getCanSelect()}
                  canEdit={canEdit}
                  actionBusy={actionBusy}
                  onOpen={openItem}
                  onToggleSelected={() => row.toggleSelected(!row.getIsSelected())}
                  onRowAction={onRowAction}
                  onToggleFavorite={onToggleFavorite}
                >
                  <div
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className="relative flex items-start gap-3 px-3 py-3 transition-[background-color,scale] active:scale-[0.96] active:bg-muted/50 data-[state=selected]:bg-muted/40"
                  >
                    <button
                      type="button"
                      className="absolute inset-0 z-10 cursor-pointer bg-transparent outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
                      aria-label={`View ${item.assetTag}`}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.button === 1) openItem(true);
                        else openItem();
                      }}
                    />
                    <div className="relative z-20 -m-1 self-center p-1">
                      {row.getCanSelect() ? (
                        <Checkbox
                          checked={row.getIsSelected()}
                          onCheckedChange={(v) => row.toggleSelected(!!v)}
                          aria-label={`Select ${item.assetTag}`}
                        />
                      ) : (
                        <span className="block size-4" aria-hidden="true" />
                      )}
                    </div>
                    <AssetImage
                      src={item.imageUrl}
                      alt={item.assetTag}
                      size={density === "compact" ? 40 : 48}
                      className="shrink-0 rounded-lg"
                    />
                    <div className="relative z-0 min-w-0 flex-1">
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-[15px] font-semibold leading-tight" style={{ fontFamily: "var(--font-heading)" }}>
                            {item.assetTag}
                          </div>
                          {subtitle && (
                            <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
                          )}
                        </div>
                        <div className="shrink-0">{statusBadge(item)}</div>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {showProductMeta && (
                          <span className="truncate text-[11px] font-medium text-foreground/80">{product}</span>
                        )}
                        {meta && (
                          <span className="truncate text-[11px] text-muted-foreground/80">{meta}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </RowContextMenu>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <Table className="hidden sm:table">
          <TableHeader className="bg-muted/95 backdrop-blur supports-[backdrop-filter]:bg-muted/80">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} striped={false} className="bg-transparent">
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead
                      key={header.id}
                      className={cn(
                        "h-10 select-none text-[11px] text-muted-foreground group/th",
                        header.column.columnDef.meta?.thClassName
                      )}
                      aria-sort={canSort ? (sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none") : undefined}
                    >
                      {header.isPlaceholder ? null : (
                        canSort ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="group -ml-3 h-10 transition-[background-color,color,box-shadow,scale] active:scale-[0.96]"
                            onClick={header.column.getToggleSortingHandler()}
                            aria-label={`Sort by ${String(header.column.columnDef.header)} ${sorted === "asc" ? "descending" : "ascending"}`}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <AnimatePresence initial={false} mode="popLayout">
                              <motion.span
                                key={sorted || "unsorted"}
                                initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                                exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
                                transition={{ type: "spring", duration: 0.3, bounce: 0 }}
                                className="inline-flex items-center justify-center"
                              >
                                {sorted === "asc" ? (
                                  <ArrowUp className="size-3.5 text-foreground" aria-hidden="true" />
                                ) : sorted === "desc" ? (
                                  <ArrowDown className="size-3.5 text-foreground" aria-hidden="true" />
                                ) : (
                                  <ArrowUpDown className="size-3.5 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
                                )}
                              </motion.span>
                            </AnimatePresence>
                          </Button>
                        ) : (
                          <div className="flex h-10 items-center gap-1">
                            {flexRender(header.column.columnDef.header, header.getContext())}
                          </div>
                        )
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const item = row.original;
                const href = getItemHref(item.id);
                const openItem = (newTab = false) => {
                  if (newTab) window.open(href, "_blank", "noopener");
                  else router.push(href);
                };
                return (
                  <RowContextMenu
                    key={row.id}
                    item={item}
                    selected={row.getIsSelected()}
                    canSelect={row.getCanSelect()}
                    canEdit={canEdit}
                    actionBusy={actionBusy}
                    onOpen={openItem}
                    onToggleSelected={() => row.toggleSelected(!row.getIsSelected())}
                    onRowAction={onRowAction}
                    onToggleFavorite={onToggleFavorite}
                  >
                    <TableRow
                      data-state={row.getIsSelected() ? "selected" : undefined}
                      className="group/row cursor-pointer transition-colors hover:bg-muted/35 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-2px]"
                      tabIndex={0}
                      role="row"
                      aria-label={`View ${item.assetTag}`}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey || e.button === 1) openItem(true);
                        else openItem();
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(href); } }}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell key={cell.id}>
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      ))}
                    </TableRow>
                  </RowContextMenu>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  No items match your filters. Try adjusting your search or filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
    </div>
  );
}
