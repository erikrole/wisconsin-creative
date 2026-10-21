"use client";

import { chromeFont } from "@/lib/chrome-font";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  titleAccessory?: React.ReactNode;
  children?: React.ReactNode; // Right-side actions
  className?: string;
}

/**
 * Standardized page header for all routes.
 * Title in the chrome typeface (see `[data-page-header]` in globals.css), optional description,
 * right-aligned actions.
 */
export function PageHeader({
  title,
  description,
  titleAccessory,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header
      data-page-header
      className={cn(
        chromeFont.variable,
        "mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2.5">
          <h1 className="min-w-0 break-words text-wrap-balance">{title}</h1>
          {titleAccessory && <div className="shrink-0">{titleAccessory}</div>}
        </div>
        {description && (
          <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {children && (
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {children}
        </div>
      )}
    </header>
  );
}
