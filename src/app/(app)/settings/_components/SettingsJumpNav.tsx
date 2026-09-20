"use client";

import { cn } from "@/lib/utils";

type SettingsJumpNavProps = {
  items: Array<{ href: string; label: string }>;
  className?: string;
};

export function SettingsJumpNav({ items, className }: SettingsJumpNavProps) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="On this page" className={cn("flex flex-wrap gap-1.5", className)}>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className="inline-flex min-h-10 items-center rounded-md border bg-card px-3 text-sm no-underline shadow-xs transition-[background-color,color,scale] hover:bg-muted/50 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
