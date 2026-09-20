"use client";

import Link from "next/link";
import React, { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import {
  SectionNav,
  SectionNavLink,
} from "@/components/SectionNav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SETTINGS_GROUP_ORDER,
  SETTINGS_SECTIONS,
  findSettingsSection,
  getSettingsRouteAccess,
  isSectionVisible,
  type SettingsGroup,
  type SettingsSection,
} from "@/lib/nav-sections";
import { SettingsCommand } from "./SettingsCommand";
import { settingsSectionIcon } from "./_components/settings-meta";
import { useCurrentUser } from "@/hooks/use-current-user";

const LAST_TAB_STORAGE_KEY = "settings:last-tab";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: currentUser, isLoading } = useCurrentUser();
  const role = currentUser?.role ?? null;
  const canViewOwnerReport = currentUser?.canViewUsageAnalytics === true;
  const currentSection = findSettingsSection(pathname);

  useEffect(() => {
    if (!isLoading && !currentUser) router.replace("/login");
  }, [currentUser, isLoading, router]);

  const visibleSections = role
    ? SETTINGS_SECTIONS.filter((s) => isSectionVisible(s, role, canViewOwnerReport))
    : [];
  const groupedSections = SETTINGS_GROUP_ORDER.map((group) => ({
    group,
    sections: visibleSections.filter((section) => section.group === group),
  })).filter((entry) => entry.sections.length > 0);

  // Remember which sub-tab the user is on, so /settings can resume it next visit.
  useEffect(() => {
    if (pathname === "/settings") return;
    const match = findSettingsSection(pathname);
    if (!match) return;
    try {
      localStorage.setItem(LAST_TAB_STORAGE_KEY, match.href);
    } catch {
      // ignore quota / privacy-mode failures
    }
  }, [pathname]);

  return (
    <>
      <div className="mb-5 flex items-center justify-between gap-4">
        <PageHeader
          title="Settings"
          description={currentSection ? undefined : "Personal preferences and operational configuration."}
          className="mb-0"
        />
        <SettingsCommand visibleSections={visibleSections} />
      </div>

      <SettingsMobilePicker pathname={pathname} groupedSections={groupedSections} />

      <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[220px_minmax(0,1fr)] xl:items-start">
        <SettingsRail pathname={pathname} groupedSections={groupedSections} />

        <div className="min-w-0">
          <SettingsRouteContent
            pathname={pathname}
            role={role}
            ownerAccess={canViewOwnerReport}
            isLoading={isLoading}
          >
            {children}
          </SettingsRouteContent>
        </div>
      </div>
    </>
  );
}

function SettingsRouteContent({
  pathname,
  role,
  ownerAccess,
  isLoading,
  children,
}: {
  pathname: string;
  role: string | null;
  ownerAccess: boolean;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    );
  }

  if (!role) return null;

  const access = getSettingsRouteAccess(pathname, role, ownerAccess);
  if (access.allowed) return children;

  const unknownRoute = access.kind === "unknown";
  return (
    <Alert>
      <AlertTitle>{unknownRoute ? "Settings page unavailable" : "Access denied"}</AlertTitle>
      <AlertDescription className="flex flex-col gap-4">
        <p>
          {unknownRoute
            ? "This Settings address does not match an available page."
            : `Your account does not have permission to open ${access.section.label}.`}
        </p>
        <Button asChild variant="outline" className="h-10">
          <Link href="/settings">Back to Settings</Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function isActiveSection(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SettingsMobilePicker({
  pathname,
  groupedSections,
}: {
  pathname: string;
  groupedSections: Array<{ group: SettingsGroup; sections: SettingsSection[] }>;
}) {
  const router = useRouter();
  const current = findSettingsSection(pathname);

  return (
    <div className="mb-4 xl:hidden">
      <Select value={current?.href ?? "/settings"} onValueChange={(href) => router.push(href)}>
        <SelectTrigger className="h-11 w-full" aria-label="Choose Settings page">
          <SelectValue placeholder="Overview" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Settings</SelectLabel>
            <SelectItem value="/settings">Overview</SelectItem>
          </SelectGroup>
          {groupedSections.map(({ group, sections }) => (
            <SelectGroup key={group}>
              <SelectLabel>{group}</SelectLabel>
              {sections.map((section) => (
                <SelectItem key={section.href} value={section.href}>{section.label}</SelectItem>
              ))}
            </SelectGroup>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function SettingsRail({
  pathname,
  groupedSections,
}: {
  pathname: string;
  groupedSections: Array<{ group: SettingsGroup; sections: SettingsSection[] }>;
}) {
  return (
    <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto xl:block">
      <SectionNav aria-label="Settings sections" orientation="vertical">
        <div className="flex flex-col gap-4">
          <div>
            <SectionNavLink
              href="/settings"
              active={pathname === "/settings"}
              orientation="vertical"
            >
              Overview
            </SectionNavLink>
          </div>

          {groupedSections.map(({ group, sections }) => (
            <div key={group}>
              <div className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {group}
              </div>
              <div className="flex flex-col gap-0.5">
                {sections.map((section) => {
                  const active = isActiveSection(pathname, section.href);
                  const Icon = settingsSectionIcon(section.href);
                  return (
                    <SectionNavLink
                      key={section.href}
                      href={section.href}
                      title={section.description}
                      active={active}
                      orientation="vertical"
                      className="gap-2"
                    >
                      <Icon className="size-3.5 shrink-0 opacity-70" />
                      {section.label}
                    </SectionNavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </SectionNav>
    </aside>
  );
}
