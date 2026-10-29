"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LicensesPage from "@/app/(app)/licenses/page";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import FreshTheme from "@/components/FreshTheme";
import { Toaster } from "@/components/ui/sonner";

const updatedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const SAMPLE_LOGINS = [
  { id: "1", name: "Envato Elements", category: "Stock", websiteUrl: "https://elements.envato.com", accountEmail: "creative@athletics.wisc.edu", hasPassword: true, visibleTo: ["STAFF", "STUDENT"], archivedAt: null, updatedAt },
  { id: "2", name: "APM Music", category: "Music", websiteUrl: "https://www.apmmusic.com", accountEmail: "creative@athletics.wisc.edu", hasPassword: true, visibleTo: ["STAFF", "STUDENT"], archivedAt: null, updatedAt },
  { id: "3", name: "Motion Array", category: "Video", websiteUrl: "https://motionarray.com", accountEmail: "video@athletics.wisc.edu", hasPassword: true, visibleTo: ["STAFF", "STUDENT", "COLLABORATOR"], archivedAt: null, updatedAt },
  { id: "4", name: "Frame.io", category: "Review", websiteUrl: "https://frame.io", accountEmail: "creative@athletics.wisc.edu", hasPassword: true, visibleTo: ["STAFF"], archivedAt: null, updatedAt },
  { id: "5", name: "Old Stock Site", category: "Stock", websiteUrl: null, accountEmail: "creative@athletics.wisc.edu", hasPassword: true, visibleTo: ["STAFF"], archivedAt: updatedAt, updatedAt },
];
// `?many=1` adds enough logins to show search and category sections.
const EXTRA_LOGINS = ["Adobe Stock|Stock", "Musicbed|Music", "Artlist|Music", "Storyblocks|Video", "Canva|Design"].map((entry, index) => {
  const [name = "", category = ""] = entry.split("|");
  return { ...SAMPLE_LOGINS[0]!, id: `x${index}`, name, category, websiteUrl: `https://www.${name.toLowerCase().replace(/[^a-z]/g, "")}.com` };
});

if (typeof window !== "undefined") {
  const realFetch = window.fetch.bind(window);
  const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const role = new URLSearchParams(window.location.search).get("role") ?? "ADMIN";
    if (url.includes("/api/me")) return new Response(JSON.stringify({ user: { id: "u1", role } }), { status: 200 });
    if (url.includes("/api/wifi")) return json({ ssid: "creative", password: "bucky2025", qrPayload: "WIFI:T:WPA;S:creative;P:bucky2025;;" });
    if (/\/api\/software\/[^/]+\/secret/.test(url)) return json({ password: "Sample-Pass-2026" });
    if (url.includes("/api/software")) {
      const includeArchived = url.includes("includeArchived=1");
      const logins = new URLSearchParams(window.location.search).get("many") === "1" ? [...SAMPLE_LOGINS, ...EXTRA_LOGINS] : SAMPLE_LOGINS;
      return json(logins.filter((login) => (includeArchived || !login.archivedAt) && (role === "ADMIN" || login.visibleTo.includes(role))));
    }
    return realFetch(input, init);
  };
}

export default function SharedLoginsLab({ fontClass }: { fontClass: string }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const classNames = `wc-fresh ${fontClass}`;
  return (
    <div className={`${classNames} min-h-screen bg-background text-foreground`}>
      <FreshTheme classNames={classNames} />
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <QueryClientProvider client={queryClient}>
          <ConfirmProvider>
            <TooltipProvider>
              <LicensesPage />
            </TooltipProvider>
          </ConfirmProvider>
        </QueryClientProvider>
      </div>
      <Toaster />
    </div>
  );
}
