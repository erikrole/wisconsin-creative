"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppTopBar } from "@/components/AppTopBar";
import { BreadcrumbProvider } from "@/components/BreadcrumbContext";
import AppSidebar from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CurrentUser } from "@/hooks/use-current-user";
import BookingsPageClient from "@/app/(app)/bookings/BookingsPageClient";
import type { BookingItem } from "@/components/booking-list";

const at = (days: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const PEOPLE = {
  maddy: { id: "u-maddy", name: "Maddy Pehler" },
  jordan: { id: "u-jordan", name: "Jordan Ruiz" },
  tess: { id: "u-tess", name: "Tess Olson" },
  sam: { id: "u-sam", name: "Sam Becker" },
};
const CAMP = { id: "loc-camp", name: "Camp Randall" };
const KOHL = { id: "loc-kohl", name: "Kohl Center" };

function booking(
  id: string,
  kind: BookingItem["kind"],
  status: string,
  title: string,
  requester: BookingItem["requester"],
  start: [number, number],
  end: [number, number],
  tags: string[],
  extra: Partial<BookingItem> = {},
): BookingItem {
  return {
    id,
    title,
    refNumber: `${kind === "CHECKOUT" ? "CO" : "RS"}-${id.slice(-3).toUpperCase()}`,
    startsAt: at(...start),
    endsAt: at(...end),
    updatedAt: at(0, 8),
    status,
    kind,
    sportCode: null,
    requester,
    location: title.includes("Basketball") || title.includes("Hockey") ? KOHL : CAMP,
    serializedItems: tags.map((assetTag) => ({ asset: { assetTag, brand: "Sony", model: "", imageUrl: null } })),
    bulkItems: [],
    event: null,
    ...extra,
  };
}

const CHECKOUTS: BookingItem[] = [
  booking("co-101", "CHECKOUT", "OPEN", "Football vs. Iowa", PEOPLE.maddy, [-1, 8], [1, 12], ["FX6-A", "24-70 1", "MKH416-2"], { sportCode: "FB" }),
  booking("co-102", "CHECKOUT", "OPEN", "Volleyball practice B-roll", PEOPLE.tess, [-3, 14], [-1, 12], ["SLOW1"], { sportCode: "VB" }),
  booking("co-103", "CHECKOUT", "PENDING_PICKUP", "Men's Basketball media day", PEOPLE.sam, [0, 15], [1, 18], ["A7S3-2", "70-200 3"], { sportCode: "MBB" }),
  booking("co-104", "CHECKOUT", "OPEN", "Hockey vs. Minnesota", PEOPLE.jordan, [0, 9], [0, 23], ["ROAM2", "WMIC-4", "MAVIC3", "FX3-1"], { sportCode: "MHKY" }),
];
const RESERVATIONS: BookingItem[] = [
  booking("rs-201", "RESERVATION", "BOOKED", "Volleyball vs. Nebraska", PEOPLE.jordan, [4, 15], [5, 11], ["FX6-A", "70-200 3"], { sportCode: "VB" }),
  booking("rs-202", "RESERVATION", "BOOKED", "Hockey vs. Minnesota", PEOPLE.tess, [9, 16], [10, 12], ["FX6-B"], { sportCode: "MHKY" }),
  booking("rs-203", "RESERVATION", "BOOKED", "Football at Northwestern", PEOPLE.maddy, [2, 7], [3, 22], ["FX6-B", "600 1", "MAVIC3"], { sportCode: "FB" }),
];

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Answers the Bookings page's list calls with sample data so the page renders without a database. */
function installFetchShim(user: CurrentUser) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    const list = (rows: BookingItem[]) => json({ data: rows, total: rows.length, limit: 20, offset: 0 });
    if (url.pathname === "/api/me") return json({ data: user });
    if (url.pathname === "/api/form-options") {
      return json({ data: { locations: [CAMP, KOHL], departments: [], users: Object.values(PEOPLE), bulkSkus: [] } });
    }
    if (url.pathname === "/api/checkouts") return list(CHECKOUTS);
    if (url.pathname === "/api/reservations") return list(RESERVATIONS);
    if (url.pathname === "/api/bookings") return list([...CHECKOUTS, ...RESERVATIONS]);
    return realFetch(input, init);
  };
}

function Lab({ fontClass }: { fontClass: string }) {
  const params = useSearchParams();
  const user = { id: "dev", name: "Erik Role", email: "dev@example.com", role: "ADMIN" } as CurrentUser;
  const [queryClient] = useState(() => {
    if (typeof window !== "undefined") {
      installFetchShim(user);
      try { localStorage.setItem("bookings-view-mode", params.get("view") === "table" ? "table" : "cards"); } catch { /* ignore */ }
    }
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
        <SidebarProvider>
          <AppSidebar user={user} overdueBadgeCount={1} />
          <BreadcrumbProvider>
            <div className="min-w-0 flex-1 bg-background">
              <AppTopBar isCollaborator={false} onSearch={() => {}} unreadNotifications={0} user={user} />
              <main className={`wc-fresh ${fontClass} px-8 py-5 max-md:p-4 max-md:pb-[calc(96px+env(safe-area-inset-bottom,0px))]`}>
                <BookingsPageClient initialCheckouts={null} />
              </main>
            </div>
          </BreadcrumbProvider>
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default function BookingsLab({ fontClass }: { fontClass: string }) {
  return (
    <Suspense>
      <Lab fontClass={fontClass} />
    </Suspense>
  );
}
