"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { syncUrl } from "@/lib/url-sync";
import type { OperationalActiveFilter } from "@/components/OperationalToolbar";

/** Shared across report tabs so a chosen window survives navigation. */
const PERIOD_STORAGE_KEY = "reports:period-days";

/** 0 means "all time" — reports that support it list it in their own values. */
export const ALL_TIME_PERIOD = 0;

export function periodLabel(days: number) {
  return days === ALL_TIME_PERIOD ? "All time" : `${days}d`;
}

function readStoredPeriod(): number | null {
  try {
    const raw = window.sessionStorage.getItem(PERIOD_STORAGE_KEY);
    if (raw === null) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // Private browsing and storage-partitioned contexts throw on access.
    return null;
  }
}

function writeStoredPeriod(days: number) {
  try {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, String(days));
  } catch {
    // Persistence is a convenience; never let it break the report.
  }
}

/**
 * Period state for a report tab, persisted in the URL and carried between tabs.
 *
 * Each report keeps its own param name and allowed values — `days` on
 * checkouts, `period` on scans and audit — so existing links and tests stay
 * valid. A URL param always wins over the remembered cross-tab value.
 */
export function useReportPeriod({
  defaultValue,
  paramName,
  values,
}: {
  defaultValue: number;
  paramName: string;
  values: readonly number[];
}) {
  const searchParams = useSearchParams();

  const parse = useCallback(
    (raw: string | null): number | null => {
      const parsed = Number.parseInt(raw ?? "", 10);
      return values.includes(parsed) ? parsed : null;
    },
    [values],
  );

  const [days, setDaysState] = useState(() => parse(searchParams.get(paramName)) ?? defaultValue);
  const hydratedFromStorage = useRef(false);

  const setDays = useCallback(
    (next: number) => {
      setDaysState(next);
      writeStoredPeriod(next);
      syncUrl({ [paramName]: next === defaultValue ? "" : next });
    },
    [defaultValue, paramName],
  );

  // Adopt the remembered window on first mount only, and only when the URL did
  // not already ask for one. Deferring to an effect keeps SSR markup and the
  // first client render identical.
  useEffect(() => {
    if (hydratedFromStorage.current) return;
    hydratedFromStorage.current = true;
    if (parse(searchParams.get(paramName)) !== null) return;

    const stored = readStoredPeriod();
    if (stored === null || !values.includes(stored) || stored === defaultValue) return;

    setDaysState(stored);
    syncUrl({ [paramName]: stored });
  }, [defaultValue, paramName, parse, searchParams, values]);

  // Track back/forward and in-app links that change the param.
  useEffect(() => {
    const fromUrl = parse(searchParams.get(paramName));
    if (fromUrl === null) return;
    setDaysState((current) => (current === fromUrl ? current : fromUrl));
  }, [paramName, parse, searchParams]);

  const activeFilters: OperationalActiveFilter[] =
    days === defaultValue
      ? []
      : [
          {
            key: "period",
            label: `Period: ${periodLabel(days)}`,
            onRemove: () => setDays(defaultValue),
          },
        ];

  return {
    activeFilters,
    days,
    isAllTime: days === ALL_TIME_PERIOD,
    label: periodLabel(days),
    setDays,
  };
}

/**
 * Delta against the window immediately before the current one. Returns null
 * when there is nothing honest to compare against — all-time has no prior
 * window, and a prior window of zero would render as an infinite increase.
 */
export function buildPeriodDelta({
  current,
  days,
  goodDirection = "up",
  mode = "ratio",
  previous,
}: {
  current: number;
  days: number;
  goodDirection?: "up" | "down" | "neutral";
  /**
   * "points" for metrics that are already percentages — a 95% to 98% move is
   * +3 points, not +3.2%.
   */
  mode?: "ratio" | "points";
  previous: number | null | undefined;
}) {
  if (days === ALL_TIME_PERIOD) return undefined;
  if (previous === null || previous === undefined) return undefined;

  const absolute = current - previous;
  if (mode === "points") {
    return {
      absolute: Math.round(absolute),
      absoluteSuffix: " pts",
      comparisonLabel: `vs prior ${days}d`,
      goodDirection,
      percent: null,
    };
  }

  return {
    absolute,
    comparisonLabel: `vs prior ${days}d`,
    goodDirection,
    percent: previous === 0 ? null : absolute / previous,
  };
}
