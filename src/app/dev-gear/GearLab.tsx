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
import { GearPicker } from "@/app/(app)/gear/GearPicker";
import { GEAR_PICKS_ME_QUERY_KEY } from "@/hooks/use-gear-picks";
import { GEAR_MY_KIT_QUERY_KEY } from "@/app/(app)/gear/MyKit";
import { gearSku, findGearSku, GEAR_CATALOG } from "@/lib/gear-picks/catalog";
import type { GearMyKitDto, GearPicksMeResponse } from "@/lib/gear-picks/types";

const PICKS = [
  { style: "6021626", code: "005", size: "L", quantity: 1 },
  { style: "6021649", code: "834", size: "L", quantity: 2 },
  { style: "6021630", code: "286", size: null, quantity: 1 },
];

function sampleData(state: string): { me: GearPicksMeResponse; kit: GearMyKitDto } {
  const empty = state === "empty";
  const closed = state === "closed";
  const lines = empty
    ? []
    : PICKS.map((pick) => {
        const entry = findGearSku(gearSku(pick.style, pick.code))!;
        return {
          sku: entry.sku, style: pick.style, colorCode: pick.code, size: pick.size, quantity: pick.quantity,
          unitPriceCents: entry.unitPriceCents, lineTotalCents: entry.unitPriceCents * pick.quantity,
          itemName: entry.item.name, colorLabel: entry.color.label, category: entry.item.category,
        };
      });
  const me: GearPicksMeResponse = {
    cycle: { id: "2027-28", title: "2027–28 UA staff gear", deadline: "2026-11-14T23:59:00-06:00", isOpen: !closed, launchedAt: "2026-10-20T12:00:00Z" },
    participant: { id: "dev-participant", fit: "MEN", allowanceCents: 30000 },
    submission: lines.length ? { version: 1, totalCents: lines.reduce((s, l) => s + l.lineTotalCents, 0), submittedAt: closed ? "2026-11-01T12:00:00Z" : null, updatedAt: "2026-10-22T12:00:00Z", lines } : null,
    profile: { topSize: "L", topSizeFit: "MENS", shoeSize: null, shoeSizeSystem: null },
    isAdmin: false,
  };
  const kitEntries = GEAR_CATALOG.kits.MEN.slice(0, 4);
  const kit: GearMyKitDto = {
    cycleTitle: "2027–28 UA staff gear",
    group: "Staff",
    order: { placedAt: state === "ordered" ? "2026-10-20T12:00:00Z" : null, expectedAt: state === "ordered" ? "2027-07-15T12:00:00Z" : null, poNumber: null, orderNumber: null },
    pieces: [
      ...kitEntries.map((entry, index) => ({
        sku: gearSku(entry.style, entry.code), itemName: entry.name, colorLabel: findGearSku(gearSku(entry.style, entry.code))?.color.label ?? "",
        source: entry.kind, size: index === 3 ? "Size needed" : "L", quantity: 1, handed: state === "handed" && index < 2, handedOutAt: state === "handed" && index < 2 ? "2026-07-20T12:00:00Z" : null,
      })),
    ],
  };
  return { me, kit };
}

function Lab({ fontClass }: { fontClass: string }) {
  const params = useSearchParams();
  const user = { id: "dev", name: "Jordan Ruiz", email: "dev@example.com", role: "STAFF" } as CurrentUser;
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    const { me, kit } = sampleData(params.get("state") ?? "ready");
    client.setQueryData(GEAR_PICKS_ME_QUERY_KEY, me);
    client.setQueryData(GEAR_MY_KIT_QUERY_KEY, kit);
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
          <AppSidebar user={user} overdueBadgeCount={0} />
          <BreadcrumbProvider>
            <div className="min-w-0 flex-1 bg-background">
              <AppTopBar isCollaborator={false} onSearch={() => {}} unreadNotifications={0} user={user} />
              <main className={`wc-fresh ${fontClass} px-8 py-5 max-md:p-4 max-md:pb-[calc(96px+env(safe-area-inset-bottom,0px))]`}>
                <GearPicker />
              </main>
            </div>
          </BreadcrumbProvider>
        </SidebarProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default function GearLab({ fontClass }: { fontClass: string }) {
  return (
    <Suspense>
      <Lab fontClass={fontClass} />
    </Suspense>
  );
}
