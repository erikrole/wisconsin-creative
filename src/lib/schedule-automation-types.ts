import type { ScheduleQueue } from "@/lib/schedule-queues";

type ScheduleAutomationTone = "critical" | "attention" | "good" | "neutral";

type ScheduleAutomationAction = {
  label: string;
  href?: string;
  queue?: ScheduleQueue;
  openTradeBoard?: boolean;
};

export type ScheduleAutomationCard = {
  id: string;
  label: string;
  value: number | string;
  detail: string;
  tone: ScheduleAutomationTone;
  action?: ScheduleAutomationAction;
  eventIds?: string[];
};

export type ScheduleAutomationDigest = {
  generatedAt: string;
  window: {
    startsAt: string | null;
    endsAt: string | null;
    includePast: boolean;
    includeArchived: boolean;
    sportCode: string | null;
  };
  metrics: {
    openSlots: number;
    eventsWithoutCrew: number;
    pendingRequests: number;
    conflicts: number;
    gearGaps: number;
    readyToPublish: number;
    autoFillCandidates: number;
    staleSources: number;
    sourceErrors: number;
    staleTrades: number;
    syncEventsAdded: number;
    syncEventsUpdated: number;
    syncGroupsCreated: number;
    syncShiftsCreated: number;
    shiftGroupsArchived: number | null;
    eventsArchived: number | null;
    tradesExpired: number | null;
    pendingPickupsExpired: number | null;
  };
  cards: ScheduleAutomationCard[];
  partialFailures: string[];
};

