"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import type { DashboardData } from "@/app/(app)/dashboard-types";

type UseDashboardFiltersResult = {
  activeSport: string | null;
  activeLocation: string | null;
  setActiveSport: (sport: string | null) => void;
  setActiveLocation: (loc: string | null) => void;
  setFilters: (next: { sport?: string | null; location?: string | null }) => void;
  clearFilters: () => void;
  availableSports: string[];
  availableLocations: string[];
  filtered: FilteredDashboardData | null;
  hasActiveFilter: boolean;
};

export type FilteredDashboardData = {
  myCheckouts: DashboardData["myCheckouts"]["items"];
  teamCheckouts: DashboardData["teamCheckouts"]["items"];
  teamReservations: DashboardData["teamReservations"]["items"];
  pendingPickups: DashboardData["pendingPickups"]["items"];
  staleReservations: DashboardData["staleReservations"]["items"];
  myReservations: DashboardData["myReservations"];
  upcomingEvents: DashboardData["upcomingEvents"];
  myShifts: DashboardData["myShifts"];
  myEventWork: DashboardData["myEventWork"];
  overdueItems: DashboardData["overdueItems"];
};

/**
 * Dashboard filter state hook.
 * - URL-persisted sport + location filters via ?sport=MBB&location=Camp+Randall
 * - Collects available options from dashboard data
 * - Returns pre-filtered views of all sections
 * - Overdue banner intentionally excluded from filtering (safety-critical)
 */
export function useDashboardFilters(data: DashboardData | null): UseDashboardFiltersResult {
  const searchParams = useSearchParams();
  const router = useRouter();
  const activeSport = searchParams.get("sport");
  const activeLocation = searchParams.get("location");

  const setFilterParam = useCallback((key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }, [searchParams, router]);

  const setFilters = useCallback((next: { sport?: string | null; location?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString());
    if ("sport" in next) {
      if (next.sport) params.set("sport", next.sport);
      else params.delete("sport");
    }
    if ("location" in next) {
      if (next.location) params.set("location", next.location);
      else params.delete("location");
    }
    const qs = params.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }, [searchParams, router]);

  const setActiveSport = useCallback((sport: string | null) => setFilterParam("sport", sport), [setFilterParam]);
  const setActiveLocation = useCallback((loc: string | null) => setFilterParam("location", loc), [setFilterParam]);
  const clearFilters = useCallback(() => {
    router.replace("/", { scroll: false });
  }, [router]);

  // Collect distinct sport codes from all dashboard data
  const availableSports = useMemo(() => {
    if (!data) return [];
    const codes = new Set<string>();
    for (const c of data.myCheckouts.items) if (c.sportCode) codes.add(c.sportCode);
    for (const c of data.teamCheckouts.items) if (c.sportCode) codes.add(c.sportCode);
    for (const r of data.teamReservations.items) if (r.sportCode) codes.add(r.sportCode);
    for (const r of data.staleReservations.items) if (r.sportCode) codes.add(r.sportCode);
    for (const r of data.myReservations) if (r.sportCode) codes.add(r.sportCode);
    for (const e of data.upcomingEvents) if (e.sportCode) codes.add(e.sportCode);
    for (const s of data.myShifts) if (s.event.sportCode) codes.add(s.event.sportCode);
    for (const e of data.myEventWork) if (e.event.sportCode) codes.add(e.event.sportCode);
    return [...codes].sort();
  }, [data]);

  // Collect distinct location names
  const availableLocations = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    for (const c of data.myCheckouts.items) if (c.locationName) names.add(c.locationName);
    for (const c of data.teamCheckouts.items) if (c.locationName) names.add(c.locationName);
    for (const r of data.teamReservations.items) if (r.locationName) names.add(r.locationName);
    for (const r of data.staleReservations.items) if (r.locationName) names.add(r.locationName);
    for (const r of data.myReservations) if (r.locationName) names.add(r.locationName);
    for (const e of data.upcomingEvents) if (e.location) names.add(e.location);
    for (const s of data.myShifts) if (s.event.locationName) names.add(s.event.locationName);
    for (const e of data.myEventWork) if (e.event.locationName) names.add(e.event.locationName);
    return [...names].sort();
  }, [data]);

  // Filter helpers
  const matchesFilters = useCallback((sportCode: string | null, locationName: string | null) => {
    const sportOk = !activeSport || sportCode === activeSport;
    const locOk = !activeLocation || locationName === activeLocation;
    return sportOk && locOk;
  }, [activeSport, activeLocation]);

  // Pre-filtered views
  const filtered = useMemo(() => {
    if (!data || (!activeSport && !activeLocation)) return null;
    return {
      myCheckouts: data.myCheckouts.items.filter((c) => matchesFilters(c.sportCode, c.locationName)),
      teamCheckouts: data.teamCheckouts.items.filter((c) => matchesFilters(c.sportCode, c.locationName)),
      teamReservations: data.teamReservations.items.filter((r) => matchesFilters(r.sportCode, r.locationName)),
      pendingPickups: data.pendingPickups.items.filter((p) => matchesFilters(p.sportCode, p.locationName)),
      staleReservations: data.staleReservations.items.filter((r) => matchesFilters(r.sportCode, r.locationName)),
      myReservations: data.myReservations.filter((r) => matchesFilters(r.sportCode, r.locationName)),
      upcomingEvents: data.upcomingEvents.filter((e) => matchesFilters(e.sportCode, e.location)),
      myShifts: data.myShifts.filter((s) => matchesFilters(s.event.sportCode, s.event.locationName)),
      myEventWork: data.myEventWork.filter((e) => matchesFilters(e.event.sportCode, e.event.locationName)),
      overdueItems: data.overdueItems, // overdue banner always shows all — safety-critical
    };
  }, [data, activeSport, activeLocation, matchesFilters]);

  const hasActiveFilter = !!(activeSport || activeLocation);

  return {
    activeSport,
    activeLocation,
    setActiveSport,
    setActiveLocation,
    setFilters,
    clearFilters,
    availableSports,
    availableLocations,
    filtered,
    hasActiveFilter,
  };
}
