import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A titled block of related rows: heading above, one soft card below with hairline dividers. */
export function SettingsGroup({
  title,
  description,
  children,
  footer,
  className,
}: {
  title?: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2.5", className)}>
      {title || description ? (
        <div className="px-1">
          {title ? <h3 className="m-0 text-sm">{title}</h3> : null}
          {description ? (
            <p className="m-0 mt-0.5 text-sm text-muted-foreground text-pretty">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs">
        {children}
      </div>
      {footer ? <div className="px-1 text-xs text-muted-foreground">{footer}</div> : null}
    </section>
  );
}

/** One row: label and help on the left, the control on the right (stacks on phones). */
export function SettingsRow({
  label,
  htmlFor,
  description,
  children,
  stacked,
  className,
}: {
  label: ReactNode;
  htmlFor?: string;
  description?: ReactNode;
  children?: ReactNode;
  /** Put the control under the label at every width (long inputs, button sets). */
  stacked?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex gap-x-6 gap-y-3 px-4 py-3.5",
        stacked ? "flex-col" : "flex-col sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0 sm:max-w-[26rem]">
        <label htmlFor={htmlFor} className="block text-sm font-bold leading-snug text-foreground">
          {label}
        </label>
        {description ? (
          <p className="m-0 mt-0.5 text-[13px] leading-snug text-muted-foreground text-pretty">{description}</p>
        ) : null}
      </div>
      {children ? <div className={cn("min-w-0", stacked ? "w-full" : "sm:w-64 sm:shrink-0")}>{children}</div> : null}
    </div>
  );
}
