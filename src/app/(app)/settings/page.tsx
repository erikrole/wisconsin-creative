"use client";

import Link from "next/link";
import { ArrowRight, RotateCcw, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FadeUp } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import EmptyState from "@/components/EmptyState";
import {
  SETTINGS_GROUP_ORDER,
  SETTINGS_SECTIONS,
  isSectionVisible,
  type SettingsGroup,
  type SettingsSection,
} from "@/lib/nav-sections";
import { SETTINGS_GROUP_META, settingsSectionIcon } from "./_components/settings-meta";
import { useCurrentUser } from "@/hooks/use-current-user";

const STORAGE_KEY = "settings:last-tab";
const VALID_HREFS = new Set(SETTINGS_SECTIONS.map((section) => section.href));

export default function SettingsPage() {
  const { data: currentUser, isLoading: loading } = useCurrentUser();
  const role = currentUser?.role;
  const canViewOwnerReport = currentUser?.canViewUsageAnalytics === true;
  const [lastHref, setLastHref] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      setLastHref(stored && VALID_HREFS.has(stored) ? stored : null);
    } catch {
      setLastHref(null);
    }
  }, []);

  const visibleSections = useMemo(() => (
    role ? SETTINGS_SECTIONS.filter((section) => isSectionVisible(section, role, canViewOwnerReport)) : []
  ), [canViewOwnerReport, role]);

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return visibleSections;
    return visibleSections.filter((section) => (
      [section.label, section.description, section.group, ...(section.keywords ?? [])]
        .join(" ")
        .toLowerCase()
        .includes(q)
    ));
  }, [query, visibleSections]);

  const groupedSections = useMemo(() => (
    SETTINGS_GROUP_ORDER.map((group) => ({
      group,
      sections: filteredSections.filter((section) => section.group === group),
    })).filter(({ sections }) => sections.length > 0)
  ), [filteredSections]);

  const lastSection = lastHref
    ? visibleSections.find((section) => section.href === lastHref) ?? null
    : null;

  if (loading || !role) {
    return (
      <FadeUp>
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 w-full max-w-md rounded-md" />
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-36 w-full rounded-md" />
            ))}
          </div>
        </div>
      </FadeUp>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <FadeUp>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="settings-directory-search"
              name="settingsDirectorySearch"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a setting — try allowlist, kiosk, or overdue"
              className="h-10 pl-9"
              aria-label="Find a setting — try allowlist, kiosk, or overdue"
            />
          </div>
          {lastSection ? (
            <Button asChild variant="outline" className="h-10">
              <Link href={lastSection.href}>
                <RotateCcw className="size-4" />
                Resume {lastSection.label}
              </Link>
            </Button>
          ) : null}
        </div>
      </FadeUp>

      {groupedSections.length === 0 ? (
        <EmptyState
          icon="search"
          title={`No settings match “${query.trim()}”`}
          description="Try a different term, or clear search to browse every area."
          actionLabel="Clear search"
          onAction={() => setQuery("")}
          compact
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          {groupedSections.map(({ group, sections }, index) => (
            <FadeUp key={group} className="min-w-0" delay={index * 0.05}>
              <SettingsGroupList group={group} sections={sections} />
            </FadeUp>
          ))}
        </div>
      )}
    </div>
  );
}

function SettingsGroupList({
  group,
  sections,
}: {
  group: SettingsGroup;
  sections: SettingsSection[];
}) {
  const meta = SETTINGS_GROUP_META[group];
  const Icon = meta.icon;

  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-start gap-2.5 px-1">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{group}</h2>
          <p className="m-0 text-xs text-muted-foreground text-pretty">{meta.description}</p>
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border bg-card shadow-xs">
        <div className="divide-y">
          {sections.map((section) => {
            const SectionIcon = settingsSectionIcon(section.href);
            return (
              <Link
                key={section.href}
                href={section.href}
                className="group flex min-h-16 items-center gap-3 px-3 py-3 no-underline transition-[background-color,scale] hover:bg-muted/50 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground">
                  <SectionIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-foreground">{section.label}</div>
                  <div className="mt-0.5 text-sm text-muted-foreground text-pretty">{section.description}</div>
                </div>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground opacity-60 transition-[color,opacity,translate] group-hover:translate-x-0.5 group-hover:text-foreground group-hover:opacity-100" />
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
