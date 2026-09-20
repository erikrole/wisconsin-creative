import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/auth";
import { HttpError } from "@/lib/http";
import { requirePermission } from "@/lib/rbac";
import { getCurrentAcademicYearStart } from "@/lib/services/accountability";
import { ReportLoadingState } from "../reports/report-ui";
import AccountabilityClient from "./AccountabilityClient";

export default async function AccountabilityPage() {
  const user = await requireAuth();
  try {
    requirePermission(user.role, "accountability", "view");
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) redirect("/");
    throw error;
  }

  return (
    <>
      <PageHeader
        title="Accountability"
        description="The leaderboard nobody wants to join. Return gear on time and disappear from it."
      />
      <Suspense fallback={<ReportLoadingState metricCount={4} rows={6} />}>
        <AccountabilityClient currentStartYear={getCurrentAcademicYearStart()} />
      </Suspense>
    </>
  );
}
