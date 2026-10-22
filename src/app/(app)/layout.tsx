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
import WebMCPProvider from "@/components/WebMCPProvider";
import { ErrorReporter } from "@/components/error-reporting/ErrorReporter";
import { ReportProblemProvider } from "@/components/error-reporting/ReportProblemDialog";

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
  if (user.onboardingRequired) {
    const pathname = (await headers()).get("x-pathname")?.split("?")[0];
    if (pathname !== "/welcome") redirect("/welcome");
    return (
      <MotionConfig reducedMotion="user">
        <QueryProvider userId={user.id}>
          <TooltipProvider>
            <OfflineBanner />
            <main className="min-h-dvh px-5 py-6 sm:px-8">{children}</main>
            <Toaster position="top-right" duration={4000} />
          </TooltipProvider>
        </QueryProvider>
      </MotionConfig>
    );
  }
  const defaultSidebarOpen = cookieStore.get("sidebar_state")?.value !== "false";

  return (
    <MotionConfig reducedMotion="user">
      <QueryProvider userId={user.id}>
        <ConfirmProvider>
          <TooltipProvider>
            <ReportProblemProvider>
              {!user.preview && <ProductUsageTracker />}
              {!user.preview && <ErrorReporter />}
              <OfflineBanner />
              <AnnouncementSplash enabled={!user.preview && user.role !== "COLLABORATOR"} />
              <AppShell
                initialUser={{ ...user, canViewUsageAnalytics: canViewUsageAnalytics(user) }}
                defaultSidebarOpen={defaultSidebarOpen}
              >
                <WebMCPProvider initialUser={{ ...user, canViewUsageAnalytics: canViewUsageAnalytics(user) }} />
                {children}
              </AppShell>
            </ReportProblemProvider>
          </TooltipProvider>
          <Toaster position="top-right" duration={4000} />
        </ConfirmProvider>
      </QueryProvider>
    </MotionConfig>
  );
}
