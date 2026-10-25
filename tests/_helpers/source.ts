import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const cache = new Map<string, string>();

/**
 * Read a repository file as UTF-8 for source-contract tests.
 * Accepts a path relative to the repo root (or an absolute path) and memoizes
 * the read so a file inspected by many assertions is loaded once per worker.
 */
export function source(relativeFile: string): string {
  const absolute = path.isAbsolute(relativeFile) ? relativeFile : path.join(process.cwd(), relativeFile);
  const cached = cache.get(absolute);
  if (cached !== undefined) return cached;
  const text = readFileSync(absolute, "utf8");
  cache.set(absolute, text);
  return text;
}

/**
 * The native Schedule surface as one text: `ScheduleView.swift` plus every
 * file under `Views/Schedule/`. Schedule is split across those files, so a
 * contract about "the Schedule" should not depend on which file a view lives
 * in.
 */
export function scheduleSurfaceSource(): string {
  const dir = path.join(process.cwd(), "ios/Wisconsin/Views/Schedule");
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".swift"))
    .sort()
    .map((name) => `ios/Wisconsin/Views/Schedule/${name}`);
  return ["ios/Wisconsin/Views/ScheduleView.swift", ...files].map((file) => source(file)).join("\n");
}

/** The files each split service module was divided into. */
const SPLIT_SERVICE_MODULES: Record<string, string[]> = {
  "bookings-lifecycle": [
    "bookings-lifecycle-shared",
    "booking-create",
    "reservation-lifecycle",
    "booking-event-links",
    "checkout-lifecycle",
  ],
  notifications: [
    "notification-delivery",
    "checkout-escalation-notifications",
    "shift-notifications",
    "booking-notifications",
  ],
  reports: [
    "report-shared",
    "utilization-report",
    "checkout-reports",
    "scan-audit-reports",
    "inventory-loss-reports",
    "badge-report",
  ],
  signatures: [
    "signatures-shared",
    "signature-collections",
    "signature-roster",
    "signature-captures",
    "signature-artifacts",
  ],
};

/**
 * A service module that was split into several files, as one text, so a
 * contract about the service does not depend on which file a function lives
 * in. `name` is the original module, e.g. "notifications".
 */
export function serviceModuleSource(name: keyof typeof SPLIT_SERVICE_MODULES): string {
  return [name, ...SPLIT_SERVICE_MODULES[name]!]
    .map((file) => source(`src/lib/services/${file}.ts`))
    .join("\n");
}

/** Component files that were split; the entry file's text includes these. */
const SPLIT_COMPONENT_FILES: Record<string, string[]> = {
  "src/app/(app)/schedule/_components/ListView.tsx": [
    "src/app/(app)/schedule/_components/ListViewEventRows.tsx",
    "src/app/(app)/schedule/_components/ListViewCrewRows.tsx",
    "src/app/(app)/schedule/_components/ListViewGrid.tsx",
    "src/app/(app)/schedule/_components/ListViewTimeline.tsx",
    "src/app/(app)/schedule/_components/list-view-helpers.ts",
  ],
  "src/app/(app)/items/[id]/ItemInfoTab.tsx": [
    "src/app/(app)/items/[id]/ItemInfoFields.tsx",
    "src/app/(app)/items/[id]/ItemQrModal.tsx",
    "src/app/(app)/items/[id]/FirmwareWatchPanel.tsx",
    "src/app/(app)/items/[id]/item-info-format.ts",
  ],
};

/**
 * A component file plus the files it was split into, as one text, so a
 * contract about the surface does not depend on which file a piece lives in.
 * Files that were never split read as themselves.
 */
export function splitSource(entryFile: string): string {
  return [entryFile, ...(SPLIT_COMPONENT_FILES[entryFile] ?? [])].map((file) => source(file)).join("\n");
}
