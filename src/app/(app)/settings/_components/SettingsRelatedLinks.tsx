"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getRelatedSettingsSections } from "@/lib/nav-sections";
import { useCurrentUser } from "@/hooks/use-current-user";
import { settingsSectionIcon } from "./settings-meta";

export function SettingsRelatedLinks({ href }: { href: string }) {
  const { data: currentUser } = useCurrentUser();
  const role = currentUser?.role;
  const related = role
    ? getRelatedSettingsSections(href, role, currentUser?.canViewUsageAnalytics === true)
    : [];

  if (related.length === 0) return null;

  return (
    <nav aria-label="Related settings" className="border-t pt-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Related
      </p>
      <div className="flex flex-wrap gap-2">
        {related.map((section) => {
          const Icon = settingsSectionIcon(section.href);
          return (
            <Link
              key={section.href}
              href={section.href}
              className="inline-flex min-h-10 items-center gap-2 rounded-md border bg-card px-3 text-sm no-underline shadow-xs transition-[background-color,color,scale] hover:bg-muted/50 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Icon className="size-3.5 text-muted-foreground" />
              <span>{section.label}</span>
              <ArrowRight className="size-3.5 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
