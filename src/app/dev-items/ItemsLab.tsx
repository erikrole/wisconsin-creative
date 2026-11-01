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
import ItemsPage from "@/app/(app)/items/page";
import ItemDetailsPage from "@/app/(app)/items/[id]/page";
import type { Asset } from "@/app/(app)/items/columns";
import type { AssetDetail } from "@/app/(app)/items/[id]/types";

const LOCATIONS = [
  { id: "loc-camp", name: "Camp Randall" },
  { id: "loc-kohl", name: "Kohl Center" },
  { id: "loc-cage", name: "Equipment cage" },
];
const CATEGORIES = [
  { id: "cat-cam", name: "Cameras", parentId: null },
  { id: "cat-lens", name: "Lenses", parentId: null },
  { id: "cat-audio", name: "Audio", parentId: null },
  { id: "cat-drone", name: "Drones", parentId: null },
];
const DEPARTMENTS = [
  { id: "dep-video", name: "Video" },
  { id: "dep-photo", name: "Photo" },
];

const inDays = (days: number, hour = 17) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

function asset(
  assetTag: string,
  brand: string,
  model: string,
  category: (typeof CATEGORIES)[number],
  location: (typeof LOCATIONS)[number],
  computedStatus: string,
  extra: Partial<Asset> = {},
): Asset {
  return {
    id: `dev-${assetTag.toLowerCase()}`,
    assetTag,
    name: null,
    type: category.name,
    brand,
    model,
    serialNumber: `SN${assetTag.length}${assetTag.charCodeAt(0)}7731`,
    status: computedStatus === "MAINTENANCE" || computedStatus === "RETIRED" ? computedStatus : "AVAILABLE",
    computedStatus,
    createdAt: "2025-08-01T12:00:00Z",
    location,
    category: { id: category.id, name: category.name },
    department: DEPARTMENTS[category.id === "cat-lens" ? 1 : 0]!,
    imageUrl: null,
    activeBooking: null,
    isFavorited: false,
    ...extra,
  };
}

const [CAM, LENS, AUDIO, DRONE] = CATEGORIES as [typeof CATEGORIES[number], typeof CATEGORIES[number], typeof CATEGORIES[number], typeof CATEGORIES[number]];
const [CAMP, KOHL, CAGE] = LOCATIONS as [typeof LOCATIONS[number], typeof LOCATIONS[number], typeof LOCATIONS[number]];

const booking = (requesterName: string, endsAt: string, isOverdue = false) => ({
  id: `bk-${requesterName}`,
  kind: "CHECKOUT",
  title: "Football vs. Iowa",
  requesterName,
  requesterAvatarUrl: null,
  isOverdue,
  endsAt,
});

const ASSETS: Asset[] = [
  asset("FX6-A", "Sony", "FX6 Cinema Line", CAM, CAMP, "CHECKED_OUT", { activeBooking: booking("Maddy Pehler", inDays(1)), isFavorited: true }),
  asset("FX6-B", "Sony", "FX6 Cinema Line", CAM, CAGE, "AVAILABLE", { isFavorited: true }),
  asset("FX3-1", "Sony", "FX3", CAM, CAGE, "AVAILABLE"),
  asset("ROAM2", "DJI", "Ronin 4D", CAM, KOHL, "RESERVED", { activeBooking: booking("Jordan Ruiz", inDays(3)) }),
  asset("SLOW1", "Sony", "FX30 slow-motion kit", CAM, CAGE, "CHECKED_OUT", { activeBooking: booking("Tess Olson", inDays(-1), true) }),
  asset("A7S3-2", "Sony", "a7S III", CAM, CAGE, "PENDING_PICKUP", { activeBooking: booking("Sam Becker", inDays(0)) }),
  asset("70-200 3", "Sony", "FE 70-200mm f/2.8 GM II", LENS, CAGE, "AVAILABLE"),
  asset("24-70 1", "Sony", "FE 24-70mm f/2.8 GM II", LENS, CAMP, "CHECKED_OUT", { activeBooking: booking("Maddy Pehler", inDays(1)) }),
  asset("600 1", "Sony", "FE 600mm f/4 GM", LENS, CAGE, "MAINTENANCE"),
  asset("MKH416-2", "Sennheiser", "MKH 416 shotgun", AUDIO, CAGE, "AVAILABLE"),
  asset("WMIC-4", "Sony", "UWP-D21 wireless", AUDIO, KOHL, "AVAILABLE"),
  asset("MAVIC3", "DJI", "Mavic 3 Cine", DRONE, CAGE, "AVAILABLE"),
];

const BREAKDOWN = {
  available: 142,
  checkedOut: 23,
  pendingPickup: 4,
  reserved: 11,
  maintenance: 3,
  retired: 18,
};

const daysAgo = (days: number, hour = 9) => inDays(-days, hour);

function detailFor(base: Asset): AssetDetail {
  const holder = base.activeBooking;
  return {
    ...base,
    updatedAt: daysAgo(1),
    serialNumber: base.serialNumber,
    qrCodeValue: `WC-${base.assetTag}`,
    purchaseDate: "2024-08-12T12:00:00Z",
    purchasePrice: "6498.00",
    warrantyDate: "2027-08-12T12:00:00Z",
    residualValue: null,
    isFavorited: !!base.isFavorited,
    notes: "Keep the top handle and XLR unit with the body. Battery plate is V-mount.",
    linkUrl: null,
    availableForReservation: true,
    availableForCheckout: true,
    availableForCustody: false,
    collaboratorVisible: true,
    metadata: null,
    activeBooking: holder
      ? { id: holder.id, kind: "CHECKOUT", status: "OPEN", title: holder.title, startsAt: daysAgo(1, 8), endsAt: holder.endsAt!, requesterName: holder.requesterName, requesterAvatarUrl: null }
      : null,
    hasBookingHistory: true,
    parentAsset: null,
    firmwareWatch: null,
    accessories: [
      { id: "acc-1", assetTag: "FX6-A HANDLE", name: "Top handle and XLR unit", brand: "Sony", model: "XLR-H1", serialNumber: null, status: "AVAILABLE", type: "Accessory", imageUrl: null },
    ],
    upcomingReservations: [
      { bookingId: "bk-up-1", title: "Volleyball vs. Nebraska", status: "BOOKED", startsAt: inDays(4, 15), endsAt: inDays(5, 11), requesterName: "Jordan Ruiz" },
      { bookingId: "bk-up-2", title: "Hockey vs. Minnesota", status: "BOOKED", startsAt: inDays(9, 16), endsAt: inDays(10, 12), requesterName: "Tess Olson" },
    ],
    history: [
      ["Football vs. Iowa", "Maddy Pehler", 1, -1],
      ["Men's basketball media day", "Sam Becker", 9, 8],
      ["Football at Penn State", "Jordan Ruiz", 16, 13],
    ].map(([title, name, start, end], index) => ({
      id: `h-${index}`,
      createdAt: daysAgo(start as number),
      booking: {
        id: `bk-h-${index}`,
        kind: "CHECKOUT" as const,
        status: index === 0 ? "OPEN" : "COMPLETED",
        title: title as string,
        startsAt: daysAgo(start as number, 8),
        endsAt: daysAgo(end as number, 17),
        requester: { name: name as string },
        location: { name: "Camp Randall" },
      },
    })),
  };
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Answers the Items page's API calls with sample data so the page renders without a database. */
function installFetchShim(user: CurrentUser) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.origin);
    if (url.pathname === "/api/me") return json({ data: user });
    if (url.pathname === "/api/items-page-init") {
      return json({
        data: {
          user: { role: "ADMIN" },
          locations: LOCATIONS,
          departments: DEPARTMENTS,
          categories: CATEGORIES,
          brands: ["DJI", "Sennheiser", "Sony"],
          kits: [{ id: "kit-1", name: "Sideline kit A" }],
        },
        partialFailures: [],
      });
    }
    if (url.pathname === "/api/assets") {
      const statuses = url.searchParams.getAll("status");
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      const favoritesOnly = url.searchParams.get("favorites_only") === "true";
      const data = ASSETS.filter((a) =>
        (statuses.length === 0 || statuses.includes(a.computedStatus))
        && (!favoritesOnly || a.isFavorited)
        && (!q || `${a.assetTag} ${a.brand} ${a.model} ${a.location.name}`.toLowerCase().includes(q)));
      return json({ data, bulkItems: [], itemOrder: data.map((a) => a.id), total: data.length, limit: 25, offset: 0, statusBreakdown: BREAKDOWN });
    }
    const detail = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
    if (detail) {
      const base = ASSETS.find((a) => a.id === detail[1]);
      if (base) return json({ data: detailFor(base) });
    }
    if (url.pathname.startsWith("/api/budget/for-asset/")) return json({ data: null });
    if (url.pathname === "/api/categories") return json({ data: CATEGORIES });
    if (url.pathname === "/api/departments") return json({ data: DEPARTMENTS });
    if (url.pathname === "/api/locations") return json({ data: LOCATIONS });
    return realFetch(input, init);
  };
}

function Lab({ fontClass, detail }: { fontClass: string; detail: boolean }) {
  const params = useSearchParams();
  const user = { id: "dev", name: "Erik Role", email: "dev@example.com", role: "ADMIN" } as CurrentUser;
  const [queryClient] = useState(() => {
    if (typeof window !== "undefined") installFetchShim(user);
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
                {detail ? <ItemDetailsPage /> : <ItemsPage />}
              </main>
            </div>
          </BreadcrumbProvider>
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default function ItemsLab({ fontClass, detail = false }: { fontClass: string; detail?: boolean }) {
  return (
    <Suspense>
      <Lab fontClass={fontClass} detail={detail} />
    </Suspense>
  );
}
