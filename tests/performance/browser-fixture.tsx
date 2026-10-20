import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryProvider } from "../../src/components/QueryProvider";
import { useDashboardStats } from "../../src/hooks/use-dashboard-data";
import { useBookingChangeSync } from "../../src/hooks/use-booking-change-sync";
import { useItemChangeSync } from "../../src/hooks/use-item-change-sync";
import { ScheduleReleaseNotice } from "../../src/components/ScheduleReleaseNotice";

const probe = { mounts: 0, unmounts: 0, scheduleRefreshes: 0 };
Object.assign(window, { performanceProbe: probe });
function Counts({ name }: { name: string }) {
  const { data } = useDashboardStats();
  return <output data-testid={name}>{data?.myOverdueCount ?? "loading"}</output>;
}
function RemountingScheduleNotice() {
  const [loading, setLoading] = useState(false);
  if (loading) return <span>Refreshing schedule</span>;
  return <ScheduleReleaseNotice hasWorkingCopy onRefresh={async () => {
    probe.scheduleRefreshes++;
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 1));
    setLoading(false);
  }} />;
}
function Surface() {
  useBookingChangeSync();
  useItemChangeSync();
  useEffect(() => {
    probe.mounts += 1;
    return () => { probe.unmounts += 1; };
  }, []);
  return <><Counts name="home" /><Counts name="navigation" /><input aria-label="Draft" /><RemountingScheduleNotice /></>;
}
createRoot(document.getElementById("root")!).render(
  <QueryProvider userId="fixture-user"><Surface /></QueryProvider>,
);
