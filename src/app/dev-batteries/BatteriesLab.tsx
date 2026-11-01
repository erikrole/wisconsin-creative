"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import BatteryCockpitPage from "@/app/(app)/bulk-inventory/batteries/page";
import FreshTheme from "@/components/FreshTheme";
import { Toaster } from "@/components/ui/sonner";
import { getBatteryOpsFixture } from "@/lib/fixtures/battery-ops";

// Answer the page's one data call from the sample fixture. `?empty=1` shows the
// quiet state with nothing checked out.
if (typeof window !== "undefined") {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/api/bulk-skus/batteries") && !url.includes("repair")) {
      const data = getBatteryOpsFixture();
      if (new URLSearchParams(window.location.search).get("quiet") === "1") {
        for (const sku of data.skus) {
          sku.units = sku.units.map((unit) => ({ ...unit, status: "AVAILABLE" as const, booking: null, checkedOutAt: null, checkedOutDays: null }));
        }
        data.compatibility = [];
        data.integrity = { staleCheckedOutCount: 0, staleCheckedOutUnits: [] };
        data.totals = { ...data.totals, checkedOut: 0, lost: 0, lowSkus: 0, agingCheckedOut: 0 };
      }
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return realFetch(input, init);
  };
}

export default function BatteriesLab({ fontClass }: { fontClass: string }) {
  const classNames = `wc-fresh ${fontClass}`;
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={queryClient}>
      <div className={`${classNames} min-h-screen bg-background text-foreground`}>
        <FreshTheme classNames={classNames} />
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <BatteryCockpitPage />
        </div>
        <Toaster />
      </div>
    </QueryClientProvider>
  );
}
