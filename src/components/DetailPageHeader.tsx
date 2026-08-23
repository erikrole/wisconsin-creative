"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DetailPageHeaderProps {
  /** Identity title. Rendered inside the shared `h1`, so it inherits the global heading scale. */
  title: ReactNode;
  /** Avatar, thumbnail, or other identity media shown beside the title. */
  media?: ReactNode;
  /** Status badges shown above the title. */
  status?: ReactNode;
  /** Single supporting line directly under the title. */
  subtitle?: ReactNode;
  /** Stacked supporting facts under the subtitle. */
  meta?: ReactNode;
  /** Right-side controls. Keep targets at the 40px operational baseline. */
  actions?: ReactNode;
  /**
   * Summary content below the identity row, separated by a rule. Use for
   * at-a-glance facts that belong to the entity rather than to the page body.
   */
  footer?: ReactNode;
  /**
   * Width at which media/title and actions sit on one row.
   *
   * `lg` (default) suits a wide action column that would crowd the title.
   * `sm` suits a couple of compact buttons, and keeps the header from
   * costing extra vertical space at tablet widths.
   */
  sideBySideAt?: "sm" | "lg";
  className?: string;
}

const ROW_LAYOUT = {
  sm: "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
  lg: "flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between",
} as const;

const ACTION_LAYOUT = {
  sm: "flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end",
  lg: "flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end",
} as const;

/**
 * Standardized header for entity detail routes.
 *
 * Detail routes carry identity media and a meta stack that `PageHeader` has no
 * slots for, so they share this shell instead of each inventing one. The title
 * is a bare `h1` so it inherits the single heading treatment defined in
 * `globals.css` rather than redefining a per-route family, weight, and size.
 */
export function DetailPageHeader({
  title,
  media,
  status,
  subtitle,
  meta,
  actions,
  footer,
  sideBySideAt = "lg",
  className,
}: DetailPageHeaderProps) {
  return (
    <header
      className={cn(
        "mb-4 rounded-lg border border-border/50 bg-card px-4 py-4 shadow-xs sm:px-5",
        className
      )}
    >
      <div className={ROW_LAYOUT[sideBySideAt]}>
        <div className="flex min-w-0 gap-4">
          {media && <div className="shrink-0 self-start">{media}</div>}

          <div className="flex min-w-0 flex-1 flex-col">
            {status && (
              <div className="mb-2 flex flex-wrap items-center gap-2">{status}</div>
            )}

            <h1 className="min-w-0 break-words">{title}</h1>

            {subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            )}

            {meta && <div className="mt-3 flex flex-col gap-1">{meta}</div>}
          </div>
        </div>

        {actions && (
          <div className={ACTION_LAYOUT[sideBySideAt]}>
            {actions}
          </div>
        )}
      </div>

      {footer && (
        <div className="mt-4 border-t border-border/50 pt-4">{footer}</div>
      )}
    </header>
  );
}
