"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppTopBar } from "@/components/AppTopBar";
import { BreadcrumbProvider } from "@/components/BreadcrumbContext";
import FreshLayout from "@/components/FreshLayout";
import AppSidebar from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CurrentUser } from "@/hooks/use-current-user";
import BadgesClient from "@/app/(app)/badges/BadgesClient";
import fixture from "./gallery-fixture.json";

const manualCatalog = fixture.badges
  .filter((badge) => badge.trigger === "manual")
  .map(({ id, key, name, description, icon, category, kind, trigger, threshold }) => ({ id, key, name, description, icon, category, kind, trigger, threshold }));

/** Answers the gallery's own requests from the fixture; everything else is left alone. */
function installFetchShim(peersOff: boolean) {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (url.pathname === "/api/badges/gallery") {
      if (!peersOff) return reply({ data: fixture });
      const viewer = fixture.people.filter((person) => person.id === fixture.viewerId);
      return reply({
        data: {
          ...fixture,
          canCompare: false,
          people: viewer,
          badges: fixture.badges.map((badge) => ({ ...badge, holders: [] })),
        },
      });
    }
    if (url.pathname === "/api/badges") return reply({ data: manualCatalog });
    if (url.pathname === "/api/users") {
      return reply({
        data: fixture.people.map((person) => ({ ...person, email: `${person.name.split(" ")[0]!.toLowerCase()}@wisc.edu` })),
        total: fixture.people.length,
      });
    }
    return original(input, init);
  };
  return () => {
    window.fetch = original;
  };
}

function Lab() {
  const params = useSearchParams();
  const role = (params.get("role") ?? "STUDENT").toUpperCase();
  const tab = params.get("tab");
  const peersOff = params.get("peers") === "off";
  const [ready, setReady] = useState(false);
  const user = { id: "dev", name: "Maya Chen", email: "maya@wisc.edu", role } as CurrentUser;

  useEffect(() => {
    const theme = params.get("theme");
    if (theme) document.documentElement.dataset.theme = theme;
  }, [params]);

  useEffect(() => {
    const restore = installFetchShim(peersOff);
    setReady(true);
    return restore;
  }, [peersOff]);

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar user={user} overdueBadgeCount={0} />
        <BreadcrumbProvider>
          <div className="min-w-0 flex-1 bg-background">
            <AppTopBar isCollaborator={false} onSearch={() => {}} unreadNotifications={0} user={user} />
            <main className="px-8 py-5 max-md:p-4">
              <FreshLayout>
                {ready ? (
                  <BadgesClient
                    isAdmin={role === "ADMIN"}
                    isStaff={role === "ADMIN" || role === "STAFF"}
                    badgesAvailable
                    initialTab={tab === "team" || tab === "award" ? tab : "gallery"}
                    initialBadgeKey={params.get("badge")}
                    initialCompareId={params.get("compare")}
                  />
                ) : null}
              </FreshLayout>
            </main>
          </div>
        </BreadcrumbProvider>
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default function BadgesLab() {
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["me"], { id: "dev", name: "Maya Chen", email: "maya@wisc.edu", role: "STUDENT" });
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <Lab />
      </Suspense>
    </QueryClientProvider>
  );
}
