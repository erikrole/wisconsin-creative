"use client";

import { IconSwap } from "@/components/ui/icon-swap";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import { parseSortParam, toSortParam, type SortKey } from "./types";

export function SortHeader({ label, sortKey, currentSort, onSort }: {
  label: string;
  sortKey: SortKey;
  currentSort: string;
  onSort: (param: string) => void;
}) {
  const parsed = parseSortParam(currentSort);
  const isActive = parsed?.key === sortKey;
  const dir = isActive ? parsed.dir : null;

  function handleClick() {
    if (!isActive) {
      onSort(toSortParam(sortKey, sortKey === "startsAt" ? "desc" : "asc"));
    } else {
      onSort(toSortParam(sortKey, dir === "asc" ? "desc" : "asc"));
    }
  }

  return (
    <TableHead aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="group -ml-3 h-10 transition-[background-color,color,box-shadow,scale] active:scale-[0.96]"
        onClick={handleClick}
        aria-label={`Sort by ${label} ${!isActive || dir === "desc" ? "ascending" : "descending"}`}
      >
        {label}
        <IconSwap swapKey={isActive ? String(dir) : "unsorted"}>
            {!isActive ? (
              <ArrowUpDownIcon className="size-3.5 opacity-20 transition-opacity group-hover:opacity-50 group-focus-visible:opacity-50" aria-hidden="true" />
            ) : dir === "asc" ? (
              <ArrowUpIcon className="size-4 text-foreground" aria-hidden="true" />
            ) : (
              <ArrowDownIcon className="size-4 text-foreground" aria-hidden="true" />
            )}
          </IconSwap>
      </Button>
    </TableHead>
  );
}
