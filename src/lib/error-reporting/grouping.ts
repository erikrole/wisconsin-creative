/**
 * Pure grouping rules for crash and error reports. Two reports with the same
 * fingerprint are the same issue, so the parts that go into it must be stable
 * across occurrences (no ids, counts, or timestamps) but specific enough that
 * unrelated failures do not collapse into one row.
 */

export const ERROR_PLATFORMS = ["web", "server", "ios", "kiosk", "macos"] as const;
export type ErrorPlatform = (typeof ERROR_PLATFORMS)[number];

export const BREADCRUMB_TYPES = ["nav", "click", "api", "log", "lifecycle"] as const;
export type Breadcrumb = {
  at: string;
  type: (typeof BREADCRUMB_TYPES)[number];
  message: string;
  data?: Record<string, string | number | boolean | null>;
};

export type ErrorReportInput = {
  platform: ErrorPlatform;
  kind: string;
  name?: string | null;
  message: string;
  stack?: string | null;
  /** Where it happened, already in template form (route, screen, frame). */
  culprit?: string | null;
  /** Extra stable grouping parts, e.g. a MetricKit bundle id. */
  groupingParts?: string[];
  screen?: string | null;
  requestId?: string | null;
  digest?: string | null;
  occurredAt?: Date;
  appVersion?: string | null;
  appBuild?: string | null;
  releaseChannel?: string | null;
  osVersion?: string | null;
  deviceModel?: string | null;
  breadcrumbs?: Breadcrumb[];
  context?: Record<string, unknown>;
  callStack?: unknown;
};

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const CUID = /\bc[a-z0-9]{20,30}\b/g;
const LONG_HEX = /\b(?:0x)?[0-9a-f]{8,}\b/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s'"]+/gi;
const NUMBER = /\b\d+(?:\.\d+)?\b/g;

/** Strips the values that vary between occurrences of the same failure. */
export function normalizeMessage(message: string): string {
  return message
    .replace(URL_PATTERN, "<url>")
    .replace(EMAIL, "<email>")
    .replace(UUID, "<id>")
    .replace(CUID, "<id>")
    .replace(LONG_HEX, "<hex>")
    .replace(NUMBER, "<n>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function isIdSegment(segment: string): boolean {
  if (/^\d+$/.test(segment)) return true;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return true;
  if (/^c[a-z0-9]{20,30}$/.test(segment)) return true;
  if (/^[0-9a-f]{16,}$/i.test(segment)) return true;
  // Long mixed letter+digit tokens are almost always record ids or codes.
  return segment.length >= 16 && /\d/.test(segment) && /[a-z]/i.test(segment);
}

/** `/bookings/clx9.../edit?tab=1` → `/bookings/[id]/edit`. */
export function routeTemplate(path: string | null | undefined): string | null {
  if (!path) return null;
  let pathname = path;
  try {
    pathname = new URL(path, "http://local").pathname;
  } catch {
    pathname = path.split(/[?#]/)[0] ?? path;
  }
  const template = pathname
    .split("/")
    .map((segment) => (segment && isIdSegment(decodeSegment(segment)) ? "[id]" : segment))
    .join("/");
  return template.slice(0, 200) || "/";
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** Path without query or hash, so search text and tokens never get stored. */
export function stripQuery(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.split(/[?#]/)[0]!.slice(0, 300) || "/";
}

export function errorTitle(input: Pick<ErrorReportInput, "name" | "message">): string {
  const message = normalizeMessage(input.message) || "(no message)";
  const name = input.name?.trim();
  if (!name || name === "Error" || message.startsWith(name)) return message.slice(0, 200);
  return `${name}: ${message}`.slice(0, 200);
}

export function versionLabel(appVersion?: string | null, appBuild?: string | null): string | null {
  if (appVersion && appBuild) return `${appVersion} (${appBuild})`;
  return appVersion ?? appBuild ?? null;
}

/** Bounded copy of client breadcrumbs: last 30, short strings, flat data. */
export function boundBreadcrumbs(crumbs: Breadcrumb[] | undefined): Breadcrumb[] | undefined {
  if (!crumbs?.length) return undefined;
  return crumbs.slice(-30).map((crumb) => ({
    at: crumb.at.slice(0, 40),
    type: crumb.type,
    message: crumb.message.slice(0, 200),
    ...(crumb.data
      ? {
          data: Object.fromEntries(
            Object.entries(crumb.data)
              .slice(0, 8)
              .map(([key, value]) => [key.slice(0, 40), typeof value === "string" ? value.slice(0, 120) : value]),
          ),
        }
      : {}),
  }));
}

/** Short "Safari 18 · macOS 15" style summary from a user agent. */
export function summarizeUserAgent(userAgent: string | null | undefined): { browser: string | null; os: string | null } {
  if (!userAgent) return { browser: null, os: null };
  const ua = userAgent;
  const pick = (pattern: RegExp, label: string) => {
    const match = ua.match(pattern);
    return match ? `${label} ${match[1]}` : null;
  };
  const browser =
    pick(/Edg\/(\d+)/, "Edge") ??
    pick(/OPR\/(\d+)/, "Opera") ??
    pick(/Firefox\/(\d+)/, "Firefox") ??
    pick(/CriOS\/(\d+)/, "Chrome") ??
    pick(/Chrome\/(\d+)/, "Chrome") ??
    pick(/Version\/(\d+(?:\.\d+)?).*Safari/, "Safari");
  let os: string | null = null;
  const ios = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/);
  if (ios) os = `iOS ${ios[1]}.${ios[2]}`;
  else if (/Android (\d+)/.test(ua)) os = `Android ${ua.match(/Android (\d+)/)![1]}`;
  // Browsers freeze the macOS version at 10.15, so it carries no signal.
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Windows NT/.test(ua)) os = "Windows";
  else if (/CrOS/.test(ua)) os = "ChromeOS";
  else if (/Linux/.test(ua)) os = "Linux";
  return { browser, os };
}
