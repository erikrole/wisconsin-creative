import { MotionConfig } from "motion/react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import AppShell from "@/components/AppShell";
import { QueryProvider } from "@/components/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OfflineBanner } from "@/components/OfflineBanner";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { ProductUsageTracker } from "@/components/ProductUsageTracker";
import { canViewUsageAnalytics } from "@/lib/usage-analytics";
import WebMCPProvider from "@/components/WebMCPProvider";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await requireAuth();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      redirect("/login");
    }
    throw error;
  }
  if (user.forcePasswordChange) {
    redirect("/change-password");
  }
  const cookieStore = await cookies();
  const defaultSidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <MotionConfig reducedMotion="user">
      <QueryProvider userId={user.id}>
        <ConfirmProvider>
          <TooltipProvider>
            {!user.preview && <ProductUsageTracker />}
            <OfflineBanner />
            <AppShell
              initialUser={{ ...user, canViewUsageAnalytics: canViewUsageAnalytics(user) }}
              defaultSidebarOpen={defaultSidebarOpen}
            >
              <WebMCPProvider initialUser={{ ...user, canViewUsageAnalytics: canViewUsageAnalytics(user) }} />
              {children}
            </AppShell>
          </TooltipProvider>
          <Toaster position="top-right" duration={4000} />
        </ConfirmProvider>
      </QueryProvider>
    </MotionConfig>
  );
}
