"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import AppSidebar from "@/components/Sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

const ROLES = ["ADMIN", "STAFF", "STUDENT", "COLLABORATOR"] as const;

function Lab() {
  const params = useSearchParams();
  const [role, setRole] = useState(params.get("role") ?? "ADMIN");
  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          user={{ id: "dev", name: "Erik Role", email: "dev@example.com", role }}
          overdueBadgeCount={3}
          onSearch={role === "COLLABORATOR" ? undefined : () => window.alert("Search opens here")}
        />
        <div className="min-w-0 flex-1 bg-background">
          <div className="flex h-12 items-center gap-3 border-b px-3">
            <SidebarTrigger />
            <span className="text-sm text-muted-foreground">Sidebar lab (dev only). Use the theme control in the account menu.</span>
          </div>
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
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default function SidebarLab() {
  return (
    <Suspense>
      <Lab />
    </Suspense>
  );
}
