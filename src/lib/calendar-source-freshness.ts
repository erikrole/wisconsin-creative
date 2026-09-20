import { pluralize } from "@/lib/format";
const CALENDAR_SOURCE_STALE_AFTER_HOURS = 30;

type CalendarSourceFreshnessState =
  | "disabled"
  | "error"
  | "never-synced"
  | "stale"
  | "healthy";

export type CalendarSourceFreshnessInput = {
  id: string;
  name: string;
  enabled: boolean;
  lastFetchedAt: string | Date | null;
  lastError: string | null;
};

type ScheduleSourceEntry = {
  source: { id?: string | null; name: string } | null;
};

export type ScheduleSourceSignal = {
  status: "loading" | "ready" | "unavailable";
  severity: "neutral" | "ok" | "attention";
  label: string;
  detail: string;
  variant: "gray" | "green" | "orange" | "red";
  manualEvents: number;
  importedEvents: number;
  sourceCount: number;
  enabledSourceCount: number;
  healthySourceCount: number;
  errorSourceCount: number;
  staleSourceCount: number;
  neverSyncedSourceCount: number;
  disabledSourceCount: number;
};

type BuildScheduleSourceSignalOptions = {
  status?: "loading" | "ready" | "unavailable";
  now?: Date;
};

function parseTimestamp(value: string | Date | null): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function visibleRowDetail(manualEvents: number, importedEvents: number) {
  if (manualEvents > 0 && importedEvents > 0) {
    return `${pluralize(manualEvents, "manual event")} and ${pluralize(importedEvents, "imported event")} visible.`;
  }
  if (manualEvents > 0) return `${pluralize(manualEvents, "manual event")} visible.`;
  if (importedEvents > 0) return `${pluralize(importedEvents, "imported event")} visible.`;
  return "No visible events in the current Schedule view.";
}

export function getCalendarSourceFreshness(
  source: CalendarSourceFreshnessInput,
  now = new Date(),
  staleAfterHours = CALENDAR_SOURCE_STALE_AFTER_HOURS,
): CalendarSourceFreshnessState {
  if (!source.enabled) return "disabled";
  if (source.lastError?.trim()) return "error";

  const lastFetchedAt = parseTimestamp(source.lastFetchedAt);
  if (!lastFetchedAt) return "never-synced";

  const hoursSince = (now.getTime() - lastFetchedAt.getTime()) / (1000 * 60 * 60);
  return hoursSince > staleAfterHours ? "stale" : "healthy";
}

export function calendarSourceFreshnessLabel(state: CalendarSourceFreshnessState) {
  switch (state) {
    case "disabled":
      return "Disabled";
    case "error":
      return "Error";
    case "never-synced":
      return "Never synced";
    case "stale":
      return "Stale";
    case "healthy":
      return "Healthy";
  }
}

export function buildScheduleSourceSignal(
  entries: ScheduleSourceEntry[],
  sources: CalendarSourceFreshnessInput[],
  options: BuildScheduleSourceSignalOptions = {},
): ScheduleSourceSignal {
  const status = options.status ?? "ready";
  const now = options.now ?? new Date();
  const manualEvents = entries.filter((entry) => !entry.source).length;
  const importedEvents = entries.length - manualEvents;
  const stateCounts = sources.reduce(
    (counts, source) => {
      counts[getCalendarSourceFreshness(source, now)] += 1;
      return counts;
    },
    {
      disabled: 0,
      error: 0,
      "never-synced": 0,
      stale: 0,
      healthy: 0,
    } satisfies Record<CalendarSourceFreshnessState, number>,
  );
  const sourceCount = sources.length;
  const enabledSourceCount = sourceCount - stateCounts.disabled;
  const visibleDetail = visibleRowDetail(manualEvents, importedEvents);

  if (status === "loading") {
    return {
      status,
      severity: "neutral",
      label: "Checking sources",
      detail: `${visibleDetail} Calendar source health is still loading.`,
      variant: "gray",
      manualEvents,
      importedEvents,
      sourceCount,
      enabledSourceCount,
      healthySourceCount: stateCounts.healthy,
      errorSourceCount: stateCounts.error,
      staleSourceCount: stateCounts.stale,
      neverSyncedSourceCount: stateCounts["never-synced"],
      disabledSourceCount: stateCounts.disabled,
    };
  }

  if (status === "unavailable") {
    return {
      status,
      severity: "attention",
      label: "Source status unavailable",
      detail: `${visibleDetail} Source metadata could not be checked, so confirm Calendar Sources before treating the Schedule as current.`,
      variant: "orange",
      manualEvents,
      importedEvents,
      sourceCount,
      enabledSourceCount,
      healthySourceCount: stateCounts.healthy,
      errorSourceCount: stateCounts.error,
      staleSourceCount: stateCounts.stale,
      neverSyncedSourceCount: stateCounts["never-synced"],
      disabledSourceCount: stateCounts.disabled,
    };
  }

  if (stateCounts.error > 0) {
    return {
      status,
      severity: "attention",
      label: "Calendar source error",
      detail: `${visibleDetail} ${pluralize(stateCounts.error, "enabled source")} has sync errors.`,
      variant: "red",
      manualEvents,
      importedEvents,
      sourceCount,
      enabledSourceCount,
      healthySourceCount: stateCounts.healthy,
      errorSourceCount: stateCounts.error,
      staleSourceCount: stateCounts.stale,
      neverSyncedSourceCount: stateCounts["never-synced"],
      disabledSourceCount: stateCounts.disabled,
    };
  }

  const staleLikeCount = stateCounts.stale + stateCounts["never-synced"];
  if (staleLikeCount > 0) {
    const staleParts = [
      stateCounts.stale > 0 ? pluralize(stateCounts.stale, "stale source") : "",
      stateCounts["never-synced"] > 0 ? pluralize(stateCounts["never-synced"], "never-synced source") : "",
    ].filter(Boolean);
    return {
      status,
      severity: "attention",
      label: "Calendar source stale",
      detail: `${visibleDetail} ${staleParts.join(", ")} need attention.`,
      variant: "orange",
      manualEvents,
      importedEvents,
      sourceCount,
      enabledSourceCount,
      healthySourceCount: stateCounts.healthy,
      errorSourceCount: stateCounts.error,
      staleSourceCount: stateCounts.stale,
      neverSyncedSourceCount: stateCounts["never-synced"],
      disabledSourceCount: stateCounts.disabled,
    };
  }

  if (sourceCount > 0 && enabledSourceCount === 0) {
    return {
      status,
      severity: "attention",
      label: "Calendar sources disabled",
      detail: `${visibleDetail} All configured calendar sources are disabled.`,
      variant: "orange",
      manualEvents,
      importedEvents,
      sourceCount,
      enabledSourceCount,
      healthySourceCount: stateCounts.healthy,
      errorSourceCount: stateCounts.error,
      staleSourceCount: stateCounts.stale,
      neverSyncedSourceCount: stateCounts["never-synced"],
      disabledSourceCount: stateCounts.disabled,
    };
  }

  if (importedEvents > 0) {
    return {
      status,
      severity: "ok",
      label: manualEvents > 0 ? "Manual + calendar" : "Calendar fresh",
      detail: sourceCount > 0
        ? `${visibleDetail} ${pluralize(stateCounts.healthy, "enabled source")} fresh.`
        : `${visibleDetail} No configured source metadata was returned.`,
      variant: "green",
      manualEvents,
      importedEvents,
      sourceCount,
      enabledSourceCount,
      healthySourceCount: stateCounts.healthy,
      errorSourceCount: stateCounts.error,
      staleSourceCount: stateCounts.stale,
      neverSyncedSourceCount: stateCounts["never-synced"],
      disabledSourceCount: stateCounts.disabled,
    };
  }

  return {
    status,
    severity: manualEvents > 0 ? "neutral" : "ok",
    label: manualEvents > 0 ? "Manual schedule" : "No visible events",
    detail: sourceCount > 0
      ? `${visibleDetail} ${pluralize(stateCounts.healthy, "enabled source")} fresh.`
      : `${visibleDetail} No calendar sources are configured.`,
    variant: manualEvents > 0 ? "gray" : "green",
    manualEvents,
    importedEvents,
    sourceCount,
    enabledSourceCount,
    healthySourceCount: stateCounts.healthy,
    errorSourceCount: stateCounts.error,
    staleSourceCount: stateCounts.stale,
    neverSyncedSourceCount: stateCounts["never-synced"],
    disabledSourceCount: stateCounts.disabled,
  };
}
