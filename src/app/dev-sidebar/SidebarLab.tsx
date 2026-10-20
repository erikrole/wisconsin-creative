"use client";

import { Suspense, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarDaysIcon, CameraIcon, ClipboardListIcon, HouseIcon } from "lucide-react";
import { AppTopBar } from "@/components/AppTopBar";
import { BreadcrumbProvider } from "@/components/BreadcrumbContext";
import { CommandPalette } from "@/components/CommandPalette";
import { MobileTabBar } from "@/components/MobileTabBar";
import AppSidebar from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { type CurrentUser } from "@/hooks/use-current-user";
import { TooltipProvider } from "@/components/ui/tooltip";

const ROLES = ["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"] as const;

function Lab() {
  const params = useSearchParams();
  const pathname = usePathname();
  const [role, setRole] = useState(params.get("role") ?? "ADMIN");
  const [searchOpen, setSearchOpen] = useState(false);
  const user = { id: "dev", name: "Erik Role", email: "dev@example.com", role } as CurrentUser;
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          user={user}
          overdueBadgeCount={3}
          attentionCounts={
            role === "ADMIN" || role === "STAFF"
              ? {
                  "/wishlist": { count: role === "ADMIN" ? 4 : 0, suffix: "waiting on a decision" },
                  "/licenses": { count: 2, suffix: "reported codes" },
                }
              : undefined
          }
          onSearch={role === "COLLABORATOR" ? undefined : () => setSearchOpen(true)}
        />
        <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} user={user} pathname={pathname} />
        <BreadcrumbProvider>
          <div className="min-w-0 flex-1 bg-background">
            <AppTopBar
              isCollaborator={role === "COLLABORATOR"}
              onSearch={() => setSearchOpen(true)}
              unreadNotifications={5}
              user={user}
            />
            <p className="px-8 pt-6 text-sm text-muted-foreground">Shell lab (dev only). Use the theme control in the account menu.</p>
            <main className="flex flex-wrap gap-2 p-8">
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  aria-pressed={role === r}
                  className={`rounded-md border px-3 py-1.5 text-sm ${role === r ? "bg-muted font-bold" : ""}`}
                >
                  {r}
                </button>
              ))}
            </main>
          </div>
        </BreadcrumbProvider>
        <MobileTabBar
          items={[
            { label: "Home", href: "/", icon: HouseIcon },
            { label: "Schedule", href: "/schedule", icon: CalendarDaysIcon },
            { label: "Bookings", href: "/bookings", icon: ClipboardListIcon, badge: "overdue" },
            { label: "Items", href: "/items", icon: CameraIcon },
          ]}
          pathname={pathname}
          overdueCount={3}
          showMore={role !== "COLLABORATOR"}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default function SidebarLab() {
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    client.setQueryData(["me"], null);
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
