"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppTopBar } from "@/components/AppTopBar";
import { BreadcrumbProvider } from "@/components/BreadcrumbContext";
import AppSidebar from "@/components/Sidebar";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { Toaster } from "@/components/ui/sonner";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CurrentUser } from "@/hooks/use-current-user";
import SettingsShell from "@/app/(app)/settings/SettingsShell";
import SettingsTheme from "@/app/(app)/settings/SettingsTheme";
import { SettingsDirectory } from "@/app/(app)/settings/SettingsDirectory";

const PAGES = {
  profile: dynamic(() => import("@/app/(app)/settings/profile/page")),
  security: dynamic(() => import("@/app/(app)/settings/security/page")),
  notifications: dynamic(() => import("@/app/(app)/settings/notifications/page")),
  appearance: dynamic(() => import("@/app/(app)/settings/appearance/page")),
  "reservation-rules": dynamic(() => import("@/app/(app)/settings/reservation-rules/page")),
  "checkout-policies": dynamic(() => import("@/app/(app)/settings/checkout-policies/page")),
  "kiosk-devices": dynamic(() => import("@/app/(app)/settings/kiosk-devices/page")),
  "collaborator-access": dynamic(() => import("@/app/(app)/settings/collaborator-access/page")),
  announcements: dynamic(() => import("@/app/(app)/settings/announcements/page")),
  "quick-links": dynamic(() => import("@/app/(app)/settings/quick-links/page")),
  departments: dynamic(() => import("@/app/(app)/settings/departments/page")),
  escalation: dynamic(() => import("@/app/(app)/settings/escalation/page")),
  locations: dynamic(() => import("@/app/(app)/settings/locations/page")),
  categories: dynamic(() => import("@/app/(app)/settings/categories/page")),
  "calendar-sources": dynamic(() => import("@/app/(app)/settings/calendar-sources/page")),
  sports: dynamic(() => import("@/app/(app)/settings/sports/page")),
  "allowed-emails": dynamic(() => import("@/app/(app)/settings/allowed-emails/page")),
  "data-export": dynamic(() => import("@/app/(app)/settings/data-export/page")),
  database: dynamic(() => import("@/app/(app)/settings/database/page")),
  "reports-audit": dynamic(() => import("@/app/(app)/reports/audit/page")),
} as const;

type PageKey = keyof typeof PAGES | "overview";

const SAMPLE_QUICK_LINKS = [
  { id: "a", label: "APM Music", url: "https://www.apmmusic.com", detail: "Production music", roles: ["ADMIN", "STAFF", "STUDENT"] },
  { id: "b", label: "Greenfly", url: "https://app.greenfly.com", detail: "Send content to athletes", roles: ["ADMIN", "STAFF"] },
  { id: "c", label: "Slate", url: "https://example.com/slate", detail: null, roles: ["ADMIN", "STAFF", "STUDENT"] },
  { id: "d", label: "Budget sheet", url: "https://docs.google.com/spreadsheets/d/sample", detail: "FY27 purchasing", roles: ["ADMIN"] },
];

function Lab({ fontClass }: { fontClass: string }) {
  const params = useSearchParams();
  const raw = params.get("page") ?? "overview";
  const page: PageKey = raw === "overview" || raw in PAGES ? (raw as PageKey) : "overview";
  const role = params.get("role") ?? "ADMIN";
  const user = { id: "dev", name: "Erik Role", email: "dev@example.com", role } as CurrentUser;

  useEffect(() => {
    const theme = params.get("theme");
    if (theme) document.documentElement.dataset.theme = theme;
  }, [params]);

  const Page = page === "overview" ? null : PAGES[page];
  return (
    <TooltipProvider>
      <ConfirmProvider>
        <SidebarProvider>
          <AppSidebar user={user} overdueBadgeCount={0} />
          <BreadcrumbProvider>
            <div className="min-w-0 flex-1 bg-background">
              <AppTopBar isCollaborator={false} onSearch={() => {}} unreadNotifications={0} user={user} />
              <main className="px-8 py-5 max-md:p-4">
                {page === "reports-audit" && Page ? <Page /> : (
                <div data-settings className={`wc-fresh ${fontClass}`}>
                  <SettingsTheme classNames={`wc-fresh ${fontClass}`} />
                  <SettingsShell pathnameOverride={page === "overview" ? "/settings" : `/settings/${page}`}>
                    {Page ? <Page /> : <SettingsDirectory role={role} canViewUsageAnalytics />}
                  </SettingsShell>
                </div>
                )}
              </main>
            </div>
          </BreadcrumbProvider>
        </SidebarProvider>
        <Toaster position="top-right" duration={4000} />
      </ConfirmProvider>
    </TooltipProvider>
  );
}

export default function SettingsLab({ fontClass }: { fontClass: string }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Sample Quick links so the page and the sidebar menu render without a database.
    client.setQueryDefaults(["quick-links"], { staleTime: Infinity });
    client.setQueryData(["quick-links", "manage"], SAMPLE_QUICK_LINKS);
    client.setQueryData(["quick-links"], SAMPLE_QUICK_LINKS);
    // `?page=quick-links` and `?page=security` also seed a signed-in admin so the Settings shell renders DB-free.
    const page = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("page");
    if (page === "quick-links" || page === "security") {
      client.setQueryDefaults(["me"], { staleTime: Infinity });
      client.setQueryData(["me"], { id: "dev", name: "Erik Role", email: "dev@example.com", role: "ADMIN" });
    }
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <Lab fontClass={fontClass} />
      </Suspense>
    </QueryClientProvider>
  );
}
