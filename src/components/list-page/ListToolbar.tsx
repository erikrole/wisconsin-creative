import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The one filter row shared by list pages: search first, then filters, then
 * a trailing slot for status ("Updating") or a Clear action. No surrounding card.
 */
export function ListToolbar({
  search,
  filters,
  trailing,
  className,
}: {
  search: ReactNode;
  filters?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mt-4 flex flex-wrap items-center gap-2 border-b border-border/60 pb-3", className)}
      role="search"
    >
      <div className="min-w-[220px] flex-1 sm:max-w-sm">{search}</div>
      {filters}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
