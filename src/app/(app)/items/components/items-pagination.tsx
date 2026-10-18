"use client";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

export function ItemsPagination({
  total,
  page,
  totalPages,
  limit,
  offset,
  selectedCount,
  onPageChange,
  onLimitChange,
  rowsPerPageDisabled = false,
}: {
  total: number;
  page: number;
  totalPages: number;
  limit: number;
  offset: number;
  selectedCount: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
  rowsPerPageDisabled?: boolean;
}) {
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + limit, total);
  const canGoForward = totalPages > 0 && page < totalPages - 1;

  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <div className="flex-1 hidden sm:block">
        {selectedCount > 0
          ? `${selectedCount} of ${total} selected`
          : `Showing ${rangeStart}-${rangeEnd} of ${total} items`}
      </div>
      <div className="flex items-center justify-center gap-1.5 lg:gap-8 w-full sm:w-auto">
        {!rowsPerPageDisabled && (
          <div className="hidden md:flex items-center gap-2">
            <p className="text-sm">Rows per page</p>
            <Select
              value={String(limit)}
              onValueChange={(v) => onLimitChange(Number(v))}
            >
              <SelectTrigger size="sm" className="h-10 w-[76px]" aria-label="Rows per page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="text-sm">
          Page {page + 1} of {totalPages || 1}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            className="size-10"
            disabled={page === 0}
            onClick={() => onPageChange(0)}
          >
            <ChevronsLeft className="size-4" />
            <span className="sr-only">Go to first page</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-10 min-w-[86px] active:scale-[0.96] transition-transform"
            disabled={page === 0}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-10 min-w-[72px] active:scale-[0.96] transition-transform"
            disabled={!canGoForward}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-10"
            disabled={!canGoForward}
            onClick={() => onPageChange(Math.max(0, totalPages - 1))}
          >
            <ChevronsRight className="size-4" />
            <span className="sr-only">Go to last page</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
