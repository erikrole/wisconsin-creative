"use client";

import Link from "next/link";
import { ChevronRight, RotateCcw, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FadeUp } from "@/components/ui/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import EmptyState from "@/components/EmptyState";
import {
  SETTINGS_GROUP_ORDER,
  SETTINGS_SECTIONS,
  isSectionVisible,
  type SettingsGroup,
  type SettingsSection,
} from "@/lib/nav-sections";
import { SettingsGroup as SettingsGroupCard } from "./_components/SettingsGroup";
import { SETTINGS_GROUP_META, settingsSectionIcon } from "./_components/settings-meta";

const STORAGE_KEY = "settings:last-tab";
const VALID_HREFS = new Set(SETTINGS_SECTIONS.map((section) => section.href));

export function SettingsDirectory({
  role,
  canViewUsageAnalytics,
}: {
  role: string;
  canViewUsageAnalytics: boolean;
}) {
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
    SETTINGS_SECTIONS.filter((section) => isSectionVisible(section, role, canViewUsageAnalytics))
  ), [canViewUsageAnalytics, role]);

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

  return (
    <div className="flex flex-col gap-7">
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
        <div className="flex flex-col gap-7">
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

  return (
    <SettingsGroupCard
      title={group}
      description={meta.description}
      footer={group === "System" ? (
        <>The audit log lives in <Link href="/reports/audit" className="underline">Reports</Link>.</>
      ) : undefined}
    >
      {sections.map((section) => {
        const SectionIcon = settingsSectionIcon(section.href);
        return (
          <Link
            key={section.href}
            href={section.href}
            className="group flex items-center gap-3.5 px-4 py-3.5 no-underline transition-[background-color] hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <SectionIcon className="size-[18px] shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-foreground">{section.label}</div>
              <div className="mt-0.5 text-[13px] leading-snug text-muted-foreground text-pretty">{section.description}</div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition-[color,translate] group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>
        );
      })}
    </SettingsGroupCard>
  );
}
