import type { BoardApplication } from "./types";

export type HiringView = "active" | "review" | "round1" | "all";
export type HiringSort = "newest" | "name" | "unreviewed";
export function hiringView(value: string | null): HiringView {
  return value === "review" || value === "round1" || value === "all" ? value : "active";
}
export function hiringSort(value: string | null): HiringSort {
  return value === "name" || value === "unreviewed" ? value : "newest";
}
export function inHiringView(application: BoardApplication, view: HiringView): boolean {
  if (view === "review") return !application.reviewed && (application.stage === "APPLIED" || application.stage === "ROUND_1");
  if (view === "round1") return application.stage === "ROUND_1";
  return view === "all" || (application.stage !== "PASSED" && application.stage !== "WITHDRAWN");
}
export function sortHiringApplications(applications: BoardApplication[], sort: HiringSort): BoardApplication[] {
  // The list API returns creation order ascending; reversing preserves newest-first
  // ordering even on older deployments that do not expose createdAt.
  const ordered = [...applications].reverse();
  if (sort === "name") ordered.sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "unreviewed") ordered.sort((a, b) => Number(a.reviewed) - Number(b.reviewed));
  return ordered;
}
