"use client";

import { Suspense, useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppTopBar } from "@/components/AppTopBar";
import { BreadcrumbProvider } from "@/components/BreadcrumbContext";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import AppSidebar from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CurrentUser } from "@/hooks/use-current-user";

/** Answers one API path with sample JSON or a Response, or returns undefined to let the real fetch run. */
export type LabRoute = (url: URL, init?: RequestInit) => unknown;

export function labJson(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function installFetchShim(user: CurrentUser, route: LabRoute) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (url.pathname === "/api/me") return labJson({ data: user, user });
    const body = route(url, init);
    if (body instanceof Response) return body;
    return body === undefined ? realFetch(input, init) : labJson(body);
  };
}

function Lab({ fontClass, route, children }: { fontClass: string; route: LabRoute; children: ReactNode }) {
  const params = useSearchParams();
  const student = params.get("role") === "student";
  const [user] = useState(() => ({
    id: student ? "u-maddy" : "dev",
    name: student ? "Maddy Pehler" : "Erik Role",
    email: "dev@example.com",
    role: student ? "STUDENT" : "ADMIN",
    staffingType: "ST",
  }) as CurrentUser);
  const [queryClient] = useState(() => {
    if (typeof window !== "undefined") installFetchShim(user, route);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["me"], user);
    return client;
  });

  useEffect(() => {
    const theme = params.get("theme");
    if (theme) document.documentElement.dataset.theme = theme;
    const list = ["wc-fresh", fontClass];
    document.body.classList.add(...list);
    return () => document.body.classList.remove(...list);
  }, [params, fontClass]);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ConfirmProvider>
          <SidebarProvider>
            <AppSidebar user={user} overdueBadgeCount={1} />
            <BreadcrumbProvider>
              <div className="min-w-0 flex-1 bg-background">
                <AppTopBar isCollaborator={false} onSearch={() => {}} unreadNotifications={3} user={user} />
                <main id="main-content" className={`wc-fresh ${fontClass} px-8 py-5 max-md:p-4 max-md:pb-[calc(96px+env(safe-area-inset-bottom,0px))]`}>
                  {children}
                </main>
              </div>
            </BreadcrumbProvider>
          </SidebarProvider>
        </ConfirmProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** A real app page inside the app shell, with its API calls answered by `route` so it renders without a database. */
export default function LabShell(props: { fontClass: string; route: LabRoute; children: ReactNode }) {
  return (
    <Suspense>
      <Lab {...props} />
    </Suspense>
  );
}
