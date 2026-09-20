import type { AdminFixTodayQueue, AdminFixTodaySeverity } from "@/lib/admin-fix-today";

type OpsCheckLane = "operations" | "hygiene";

export type OpsCheckSeverity = AdminFixTodaySeverity;

type OpsCheckSample = {
  id: string;
  label: string;
  detail: string;
  href: string;
};

export type OpsCheck = {
  key: string;
  lane: OpsCheckLane;
  title: string;
  description: string;
  count: number;
  severity: OpsCheckSeverity;
  href: string;
  ctaLabel: string;
  samples: OpsCheckSample[];
};

type OpsCheckTotals = {
  openItems: number;
  activeChecks: number;
  checksNeedingWork: number;
  criticalChecks: number;
};

// Wire shape of /api/inventory-hygiene. The hygiene route only ships key/title/
// description/count/samples; severity and repair routing live in HYGIENE_CHECK_META.
type HygieneIssuePayload = {
  key: string;
  title: string;
  description: string;
  count: number;
  samples: OpsCheckSample[];
};

export type HygieneQueuePayload = {
  generatedAt: string;
  totals: {
    openIssues: number;
    activeChecks: number;
    checksNeedingWork: number;
  };
  issues: HygieneIssuePayload[];
  partialFailures?: string[];
};

type HygieneCheckMeta = {
  severity: OpsCheckSeverity;
  priority: number;
  href: string;
  ctaLabel: string;
};

// The hygiene feed's low-bulk-stock check duplicates Fix Today's low-batteries
// check and the Battery Ops cockpit itself; the merged queue keeps only one.
const DUPLICATE_HYGIENE_CHECK_KEYS = new Set(["low-bulk-stock"]);

const HYGIENE_CHECK_META: Record<string, HygieneCheckMeta> = {
  "duplicate-scan-identity": {
    severity: "critical",
    priority: 1,
    href: "/items",
    ctaLabel: "Review matching items",
  },
  "retired-in-kits": {
    severity: "critical",
    priority: 2,
    href: "/kits",
    ctaLabel: "Review kits",
  },
  "missing-primary-scan": {
    severity: "warning",
    priority: 3,
    href: "/items",
    ctaLabel: "Open items",
  },
  "camera-missing-attachments": {
    severity: "warning",
    priority: 5,
    href: "/items",
    ctaLabel: "Review attachments",
  },
  "missing-category": {
    severity: "info",
    priority: 6,
    href: "/items",
    ctaLabel: "Open items",
  },
  "missing-department": {
    severity: "info",
    priority: 7,
    href: "/items",
    ctaLabel: "Open items",
  },
  "missing-image": {
    severity: "info",
    priority: 8,
    href: "/items",
    ctaLabel: "Open items",
  },
};

const DEFAULT_HYGIENE_META: HygieneCheckMeta = {
  severity: "info",
  priority: 99,
  href: "/items",
  ctaLabel: "Open items",
};

const SEVERITY_RANK: Record<OpsCheckSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function normalizeFixTodayQueue(queue: AdminFixTodayQueue): OpsCheck[] {
  return queue.sections.map((section) => ({
    key: section.key,
    lane: "operations" as const,
    title: section.title,
    description: section.description,
    count: section.count,
    severity: section.severity,
    href: section.href,
    ctaLabel: section.ctaLabel,
    samples: section.samples,
  }));
}

export function normalizeHygieneQueue(queue: HygieneQueuePayload): OpsCheck[] {
  return queue.issues
    .filter((issue) => !DUPLICATE_HYGIENE_CHECK_KEYS.has(issue.key))
    .map((issue) => {
      const meta = HYGIENE_CHECK_META[issue.key] ?? DEFAULT_HYGIENE_META;
      return {
        key: issue.key,
        lane: "hygiene" as const,
        title: issue.title,
        description: issue.description,
        count: issue.count,
        severity: meta.severity,
        href: meta.href,
        ctaLabel: meta.ctaLabel,
        samples: issue.samples,
      };
    });
}

export function sortOpsChecks(checks: OpsCheck[]): OpsCheck[] {
  return [...checks].sort((a, b) => {
    if (a.count > 0 && b.count === 0) return -1;
    if (a.count === 0 && b.count > 0) return 1;
    return (
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
      || b.count - a.count
      || a.title.localeCompare(b.title)
    );
  });
}

export function summarizeOpsChecks(checks: OpsCheck[]): OpsCheckTotals {
  return {
    openItems: checks.reduce((sum, check) => sum + check.count, 0),
    activeChecks: checks.length,
    checksNeedingWork: checks.filter((check) => check.count > 0).length,
    criticalChecks: checks.filter((check) => check.count > 0 && check.severity === "critical").length,
  };
}
