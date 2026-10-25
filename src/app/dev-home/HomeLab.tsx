"use client";

import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CalendarDaysIcon, CameraIcon, ClipboardListIcon, HouseIcon } from "lucide-react";
import { AppTopBar } from "@/components/AppTopBar";
import { BreadcrumbProvider } from "@/components/BreadcrumbContext";
import { MobileTabBar } from "@/components/MobileTabBar";
import AppSidebar from "@/components/Sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { CurrentUser } from "@/hooks/use-current-user";
import { GettingStartedCard } from "@/app/(app)/_home/GettingStartedCard";
import { WrappedBannerView } from "@/components/wrapped/WrappedBanner";
import { CantWorkDialog } from "@/components/availability/CantWorkDialog";
import { LostUnitsDialog } from "@/app/(app)/dashboard/lost-units-dialog";
import { HomeSkeleton, HomeView, type HomeViewProps, type Slot } from "@/app/(app)/_home/HomeView";
import {
  TRADE_BOARD_HREF,
  buildAttention,
  buildSummary,
  buildUpNext,
  coverageRows,
  activityRows,
  crewRows,
  daySummary,
  gearRows,
  tradeRows,
  type HomeRole,
} from "@/app/(app)/_home/home-model";
import { emptyDashboard, sampleActivity, sampleCrew, sampleDashboard, sampleStats, sampleTrades } from "@/app/(app)/_home/home-fixtures";

const ROLES: HomeRole[] = ["STUDENT", "STAFF", "ADMIN", "COLLABORATOR"];
const STATES = ["ready", "empty", "loading", "partial", "error"] as const;
type LabState = (typeof STATES)[number];

const NAMES: Record<HomeRole, string> = {
  STUDENT: "Maya Chen",
  STAFF: "Jordan Ruiz",
  ADMIN: "Erik Role",
  COLLABORATOR: "Taylor Kim",
};

function ready<T>(rows: T): Slot<T> {
  return { state: "ready", rows };
}

function buildProps(role: HomeRole, state: LabState, now: Date): Omit<HomeViewProps, "onTarget" | "onSelectBooking"> {
  const base = { role, name: NAMES[role], now, canReserve: role === "STAFF" || role === "ADMIN" };
  const loading = { state: "loading" } as const;
  const error = { state: "error", onRetry: () => {} } as const;

  if (role === "COLLABORATOR") {
    const data = sampleDashboard("STUDENT", now);
    if (state === "loading") return { ...base, upNext: loading, myGear: loading };
    if (state === "error") return { ...base, upNext: error, myGear: error };
    const empty = state === "empty";
    return {
      ...base,
      canReserve: true,
      upNext: ready(empty ? [] : data.upcomingEvents.map((e) => ({
        id: e.id, kind: "event" as const, startsAt: e.startsAt, allDay: false,
        time: new Date(e.startsAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
        title: e.title, detail: e.location ?? "Published schedule", badge: null,
        target: { kind: "link" as const, href: "/schedule" },
      }))),
      upNextEmpty: { title: "No published events", description: "Events appear here once the schedule is published.", href: "/schedule", action: "Open Schedule" },
      myGear: ready(empty ? [] : gearRows(data.myCheckouts.items.slice(0, 2), now, false)),
      myGearHref: "/bookings",
    };
  }

  const sync = { label: "Live sync", live: true };
  if (state === "loading") {
    return { ...base, sync, dayLine: null, summary: loading, attention: loading, upNext: loading, myGear: loading, coverage: role === "STUDENT" ? undefined : loading, crew: loading, activity: role === "STUDENT" ? undefined : loading, teamGear: loading, trades: role === "STUDENT" ? loading : undefined };
  }
  if (state === "error") return { ...base, pageError: "server" };

  const data = state === "empty" ? emptyDashboard(role) : sampleDashboard(role, now);
  const trades = sampleTrades(now);
  const claimable = state === "empty" ? [] : trades.open.filter((t) => t.viewerCanClaim);
  const partial = state === "partial";
  return {
    ...base,
    sync: partial ? { label: "Counts may be stale", live: false } : sync,
    updatedLabel: "Updated just now",
    onRefresh: () => {},
    summary: ready(buildSummary({ role, data, stats: state === "empty" ? null : sampleStats(role), openTradeCount: claimable.length })),
    attention: ready(buildAttention({ role, data, claimedTrades: state === "empty" ? [] : trades.claimed, now })),
    upNext: ready(buildUpNext(data, now)),
    upNextEmpty: role === "STUDENT"
      ? { title: "Nothing scheduled yet", description: "Shifts show up here once the team schedules you. You can also pick one up on the Trade Board.", href: TRADE_BOARD_HREF, action: "Open Trade Board" }
      : undefined,
    myGear: ready(gearRows(data.myCheckouts.items, now, false)),
    dayLine: daySummary(role, data, now),
    coverage: role === "STUDENT" ? undefined : ready(coverageRows(data, now)),
    crew: partial ? error : ready(state === "empty" ? [] : crewRows(sampleCrew(now))),
    activity: role === "STUDENT" ? undefined : partial ? error : ready(state === "empty" ? [] : activityRows(sampleActivity(now), now)),
    teamGear: ready({ rows: gearRows(data.teamCheckouts.items.slice(0, 5), now, true), total: data.teamCheckouts.total }),
    trades: role === "STUDENT" ? (partial ? error : ready(tradeRows(claimable.slice(0, 3), now))) : undefined,
    tradesHref: TRADE_BOARD_HREF,
    cantWork: role === "STUDENT"
      ? ready(state === "empty" ? { away: [], weekly: [] } : {
        away: [
          { id: "a1", title: "Trip home", when: "Wed, Nov 25 – Sun, Nov 29" },
          { id: "a2", title: "Chem midterm", when: "Tue, Dec 8 · 6 PM – 9 PM" },
        ],
        weekly: ["COMM 201", "Job at the Union"],
      })
      : undefined,
  };
}

function Lab({ fontClass }: { fontClass: string }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const role = (ROLES.includes(params.get("role") as HomeRole) ? params.get("role") : "ADMIN") as HomeRole;
  const state = (STATES.includes(params.get("state") as LabState) ? params.get("state") : "ready") as LabState;
  const at = params.get("at");
  const [now] = useState(() => (at ? new Date(at) : new Date()));
  const [cantWorkOpen, setCantWorkOpen] = useState(false);
  const [lostTarget, setLostTarget] = useState<{ kind: "lost-units"; skuName: string; bulkSkuId: string; units: number[] } | null>(null);
  const [reminded, setReminded] = useState<ReadonlySet<string>>(() => new Set());
  const user = { id: "dev", name: NAMES[role], email: "dev@example.com", role } as CurrentUser;

  useEffect(() => {
    const theme = params.get("theme");
    if (theme) document.documentElement.dataset.theme = theme;
    const list = ["wc-fresh", fontClass];
    document.body.classList.add(...list);
    return () => document.body.classList.remove(...list);
  }, [params, fontClass]);

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params.toString());
    next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`);
  };

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar
          user={user}
          overdueBadgeCount={role === "COLLABORATOR" ? 0 : 1}
          attentionCounts={role === "ADMIN" ? { "/wishlist": { count: 4, suffix: "waiting on a decision" }, "/issues": { count: 3, suffix: "open" } } : undefined}
        />
        <BreadcrumbProvider>
          <div className="min-w-0 flex-1 bg-background">
            <AppTopBar isCollaborator={role === "COLLABORATOR"} onSearch={() => {}} unreadNotifications={3} user={user} />
            <main className={`wc-fresh ${fontClass} px-8 py-5 max-md:p-4 max-md:pb-[calc(96px+env(safe-area-inset-bottom,0px))]`}>
              {params.get("chrome") !== "off" && (
                <div className="mx-auto mb-4 flex max-w-[1120px] flex-wrap gap-1.5 text-xs" data-lab-controls>
                  {ROLES.map((r) => (
                    <button key={r} type="button" onClick={() => set("role", r)} aria-pressed={role === r}
                      className={`rounded-md border px-2.5 py-1 ${role === r ? "bg-muted font-bold" : ""}`}>{r}</button>
                  ))}
                  <span className="mx-1 self-center text-muted-foreground">·</span>
                  {STATES.map((s) => (
                    <button key={s} type="button" onClick={() => set("state", s)} aria-pressed={state === s}
                      className={`rounded-md border px-2.5 py-1 ${state === s ? "bg-muted font-bold" : ""}`}>{s}</button>
                  ))}
                </div>
              )}
              {state === "loading" && params.get("skeleton") === "route" ? (
                <HomeSkeleton />
              ) : (
                <><HomeView {...buildProps(role, state, now)} onAddCantWork={() => setCantWorkOpen(true)} banners={<>{params.get("firstrun") === "1" && <GettingStartedCard />}{(params.get("wrapped") === "preview" || params.get("wrapped") === "open") && <WrappedBannerView state={params.get("wrapped") as "preview" | "open"} />}</>} onTarget={(t) => { if (t.kind === "lost-units") setLostTarget(t); }} onSelectBooking={() => {}} onQuick={() => {}} onRemind={(id) => setReminded((prev) => new Set(prev).add(id))} remindedIds={reminded} /><LostUnitsDialog target={lostTarget} onClose={() => setLostTarget(null)} /></>
              )}
              <CantWorkDialog userId="dev" open={cantWorkOpen} onOpenChange={setCantWorkOpen} />
            </main>
          </div>
        </BreadcrumbProvider>
        <MobileTabBar
          items={[
            { label: "Home", href: "/", icon: HouseIcon },
            { label: "Schedule", href: "/schedule", icon: CalendarDaysIcon },
            { label: "Bookings", href: "/bookings", icon: ClipboardListIcon, badge: "overdue" },
            { label: "Items", href: "/items", icon: CameraIcon },
          ]}
          pathname="/"
          overdueCount={1}
          showMore={role !== "COLLABORATOR"}
        />
      </SidebarProvider>
    </TooltipProvider>
  );
}

export default function HomeLab({ fontClass }: { fontClass: string }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    // `?wrapped=preview|open` shows the Creative Wrapped banner. `?firstrun=1` shows the new-student Getting started card for a 3-day-old student account.
    client.setQueryData(["me"], { id: "dev", name: "Maya Chen", email: "maya@wisc.edu", role: "STUDENT", accountCreatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() });
    client.setQueryData(["profile-completion"], { profile: { role: "STUDENT" }, completion: { profileComplete: false } });
    return client;
  });
  return (
    <QueryClientProvider client={queryClient}>
      <Suspense>
        <Lab fontClass={fontClass} />
      </Suspense>
    </QueryClientProvider>
  );
}
