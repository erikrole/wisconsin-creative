import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionNavOrientation = "horizontal" | "vertical";

export function SectionNav({
  "aria-label": ariaLabel,
  children,
  className,
  orientation = "horizontal",
}: {
  "aria-label": string;
  children: ReactNode;
  className?: string;
  orientation?: SectionNavOrientation;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className={cn(
        orientation === "horizontal"
          ? "mb-5 overflow-x-auto"
          : "p-0.5",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export function SectionNavList({
  children,
  className,
  orientation = "horizontal",
}: {
  children: ReactNode;
  className?: string;
  orientation?: SectionNavOrientation;
}) {
  return (
    <div
      className={cn(
        orientation === "horizontal"
          ? "flex min-w-max gap-1"
          : "flex flex-col gap-0.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionNavLink({
  href,
  active,
  children,
  title,
  className,
  orientation = "horizontal",
}: {
  href: string;
  active: boolean;
  children: ReactNode;
  title?: string;
  className?: string;
  orientation?: SectionNavOrientation;
}) {
  return (
    <Link
      prefetch={false}
      href={href}
      title={title}
      aria-current={active ? "page" : undefined}
      className={cn(sectionNavLinkClass(active, orientation), className)}
    >
      {children}
    </Link>
  );
}

function sectionNavLinkClass(active: boolean, orientation: SectionNavOrientation) {
  return cn(
    "relative inline-flex min-h-10 items-center rounded-md text-sm font-medium no-underline outline-none transition-[background-color,color,box-shadow,scale] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.96]",
    orientation === "horizontal" ? "px-3 py-2" : "w-full px-2.5 py-2",
    active
      ? orientation === "horizontal"
        ? "brand-identity text-foreground after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:rounded-full after:bg-primary/60"
        : "brand-identity bg-foreground/[0.04] text-foreground before:absolute before:inset-y-2 before:left-1 before:w-0.5 before:rounded-full before:bg-primary/60"
      : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
  );
}
