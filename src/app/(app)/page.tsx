import { Lato } from "next/font/google";
import { SeedFetchCache } from "@/components/SeedFetchCache";
import { requireAuth } from "@/lib/auth";
import { hasDashboardCountFailure, type DashboardData, type DashboardStatsResponse } from "./dashboard-types";
import { readSeed, type QuerySeed } from "@/lib/server-seed";
import { normalizeDashboard, dashboardQueryKey, dashboardStatsQueryKey } from "@/lib/dashboard-keys";
import { GET as readDashboard } from "@/app/api/dashboard/route";
import { GET as readDashboardStats } from "@/app/api/dashboard/stats/route";
import { GET as readActivity } from "@/app/api/dashboard/activity/route";
import { GET as readTodayCrew } from "@/app/api/users/today/route";
import { GET as readTrades } from "@/app/api/shift-trades/route";
import HomePage from "./_home/HomePage";
import HomeTheme from "./_home/HomeTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

type Json = { data?: unknown; partialFailures?: unknown } | null;

// Home: the landing page after sign-in, in the shared wc-fresh theme. Students, staff and admins get the same
// reads the browser would make, done here so the first paint already holds their gear, crew and trades.
export default async function Home() {
  const user = await requireAuth();
  const wrap = (children: React.ReactNode) => (
    <div className={`wc-fresh ${lato.variable}`}>
      <HomeTheme classNames={`wc-fresh ${lato.variable}`} />
      {children}
    </div>
  );
  if (user.role === "COLLABORATOR") return wrap(<HomePage />);

  const serverNow = new Date().toISOString();
  const tradeStatus = user.role === "STUDENT" ? "OPEN" : user.role === "ADMIN" ? "CLAIMED" : null;
  const [dashboard, stats, crew, activity, trades] = await Promise.all([
    readSeed(readDashboard, "/api/dashboard"),
    readSeed(readDashboardStats, "/api/dashboard/stats"),
    readSeed(readTodayCrew, "/api/users/today"),
    user.role === "STAFF" || user.role === "ADMIN" ? readSeed(readActivity, "/api/dashboard/activity") : null,
    tradeStatus ? readSeed(readTrades, `/api/shift-trades?status=${tradeStatus}&limit=20`) : null,
  ]);

  const list = (json: unknown) => ((json as Json)?.data);
  const queries: (QuerySeed | null)[] = [
    dashboard && list(dashboard.json)
      ? { key: dashboardQueryKey(user.id), data: normalizeDashboard(list(dashboard.json) as DashboardData), fetchedAt: dashboard.fetchedAt }
      : null,
    stats && list(stats.json) && !hasDashboardCountFailure(failures(stats.json))
      ? { key: dashboardStatsQueryKey(user.id), data: (stats.json as DashboardStatsResponse).data, fetchedAt: stats.fetchedAt }
      : null,
    crew
      ? { key: ["home-today-crew", user.id], data: arrayOf((list(crew.json) as { events?: unknown } | undefined)?.events), fetchedAt: crew.fetchedAt }
      : null,
    activity ? { key: ["home-activity", user.id], data: arrayOf(list(activity.json)), fetchedAt: activity.fetchedAt } : null,
    trades && tradeStatus
      ? { key: ["home-trades", user.id, tradeStatus], data: arrayOf(list(trades.json)), fetchedAt: trades.fetchedAt }
      : null,
  ];

  return wrap(
    <SeedFetchCache queries={queries}>
      <HomePage serverNow={serverNow} />
    </SeedFetchCache>,
  );
}

function arrayOf(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function failures(json: unknown) {
  const raw = (json as Json)?.partialFailures;
  return Array.isArray(raw) ? raw.filter((f): f is string => typeof f === "string") : [];
}
