import type { ComponentProps, ReactNode } from "react";
import { XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function OperationalToolbar({
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-2",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type OperationalActiveFilter = {
  key: string;
  label: string;
  onRemove: () => void;
};

export function OperationalActiveFilterChips({
  filters,
  className,
}: {
  filters: OperationalActiveFilter[];
  className?: string;
}) {
  if (filters.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} role="group" aria-label="Active filters">
      {filters.map((filter) => (
        <Button
          key={filter.key}
          type="button"
          variant="ghost"
          size="sm"
          className="h-10 max-w-full min-w-0 gap-1.5 rounded-md border border-border/60 bg-background px-2.5 text-xs font-medium text-foreground transition-[background-color,border-color,color,scale] hover:border-border hover:bg-foreground/[0.04] active:scale-[0.96]"
          onClick={filter.onRemove}
          aria-label={`Remove ${filter.label} filter`}
        >
          <span className="truncate">{filter.label}</span>
          <XIcon className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Button>
      ))}
    </div>
  );
}
