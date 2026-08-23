"use client";

import Link from "next/link";
import { ArrowUpRightIcon } from "lucide-react";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import {
  CardAction,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  href?: string;
  count?: number;
  countVariant?: BadgeProps["variant"];
  action?: React.ReactNode;
  className?: string;
  actionClassName?: string;
};

export function DashboardFooterLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-10 items-center justify-center border-t border-border/50 px-4 text-center text-xs text-muted-foreground no-underline transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/50"
    >
      {children}
    </Link>
  );
}

export function DashboardSectionHeader({
  title,
  href,
  count,
  countVariant = "gray",
  action,
  className,
  actionClassName,
}: Props) {
  const titleNode = (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{title}</span>
      {href && <ArrowUpRightIcon className="opacity-0 transition-opacity group-hover:opacity-70" />}
    </span>
  );

  return (
    <CardHeader
      className={cn(
        "grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0 border-b border-border/50 px-4 py-2",
        className,
      )}
    >
      <CardTitle className="min-w-0 text-sm! font-semibold!">
        {href ? (
          <Link
            href={href}
            className="group flex min-h-10 min-w-0 items-center rounded-sm text-inherit no-underline outline-none hover:no-underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            {titleNode}
          </Link>
        ) : titleNode}
      </CardTitle>
      <CardAction
        className={cn(
          "col-start-2 row-start-1 flex items-center gap-2 self-center",
          actionClassName,
        )}
      >
        {typeof count === "number" && (
          <Badge variant={countVariant} size="sm">
            {count}
          </Badge>
        )}
        {action}
      </CardAction>
    </CardHeader>
  );
}
