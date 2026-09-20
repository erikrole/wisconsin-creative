"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, KeyRound, Network, ShoppingCart, Trophy, UserRound } from "lucide-react";
import type { ComponentType } from "react";

type RelatedLink = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

export function ProfileRelatedLinks({
  userId,
  isSelf,
  canOpenStaffTools,
}: {
  userId: string;
  isSelf: boolean;
  canOpenStaffTools: boolean;
}) {
  const links: RelatedLink[] = [
    ...(isSelf
      ? [
          { href: "/settings/profile", label: "Settings profile", icon: UserRound },
          { href: "/settings/security", label: "Security", icon: KeyRound },
        ]
      : []),
    ...(canOpenStaffTools
      ? [
          { href: `/bookings?requesterUserId=${encodeURIComponent(userId)}`, label: "Bookings", icon: ShoppingCart },
          { href: "/users/org-chart", label: "Org chart", icon: Network },
        ]
      : []),
    { href: "/scoreboard", label: "Team Scoreboard", icon: Trophy },
    { href: "/schedule", label: "Schedule", icon: CalendarDays },
  ];

  if (links.length === 0) return null;

  return (
    <nav aria-label="Related" className="border-t pt-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Related
      </p>
      <div className="flex flex-wrap gap-2">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border bg-card px-3 text-sm no-underline shadow-xs transition-[background-color,color,scale] hover:bg-muted/50 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-3.5 text-muted-foreground" />
              <span>{link.label}</span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
