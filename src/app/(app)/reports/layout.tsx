import { redirect } from "next/navigation";
import FreshLayout from "@/components/FreshLayout";
import { PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/auth";
import { requirePermission } from "@/lib/rbac";
import { HttpError } from "@/lib/http";
import { ReportPrintHeader } from "./ReportPrintHeader";
import { ReportsNav } from "./ReportsNav";
import { canViewUsageAnalytics } from "@/lib/usage-analytics";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  try {
    requirePermission(user.role, "report", "view");
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) redirect("/");
    throw error;
  }

  return (
    <FreshLayout>
      <div className="print:hidden">
        <PageHeader
          title="Reports"
          description="Read-only analytics for inventory, checkouts, scan health, missing units, badges, and audit history."
          className="mb-4"
        />

        <ReportsNav role={user.role} canViewUsageAnalytics={canViewUsageAnalytics(user)} />
      </div>

      <ReportPrintHeader />

      {children}
    </FreshLayout>
  );
}
