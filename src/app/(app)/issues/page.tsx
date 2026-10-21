import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { IssuesView } from "./IssuesView";

export const metadata = { title: "Issues" };

/** Admin-only triage for crashes, errors, and "Report a problem" submissions from every app. */
export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ tab?: string; report?: string }> }) {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/");
  const { tab, report } = await searchParams;
  return <IssuesView initialTab={tab === "reports" ? "reports" : "issues"} focusReportId={report ?? null} />;
}
