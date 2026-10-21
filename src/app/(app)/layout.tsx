import type { Metadata } from "next";
import { MotionConfig } from "motion/react";
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import AppShell from "@/components/AppShell";
import { QueryProvider } from "@/components/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmProvider } from "@/components/ConfirmDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { OfflineBanner } from "@/components/OfflineBanner";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { loginPathWithReturnTo } from "@/lib/return-to";
import { ProductUsageTracker } from "@/components/ProductUsageTracker";
import { canViewUsageAnalytics } from "@/lib/usage-analytics";
import { AnnouncementSplash } from "@/components/announcements/AnnouncementSplash";
import { InstallAppPrompt } from "@/components/InstallAppPrompt";
import WebMCPProvider from "@/components/WebMCPProvider";

// Safari's native Smart App Banner on iPhone, signed-in pages only (login and kiosk stay clean).
// Safari remembers a dismissal itself and hides the banner once the app is installed.
export const metadata: Metadata = {
  itunes: { appId: "6763456945" },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await requireAuth();
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) {
      redirect(loginPathWithReturnTo((await headers()).get("x-pathname")));
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
            {!user.preview && <InstallAppPrompt />}
            <AnnouncementSplash enabled={!user.preview && user.role !== "COLLABORATOR"} />
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
