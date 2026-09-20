import type { FirmwareSourceType, FirmwareSupportMode } from "@prisma/client";
import { db } from "@/lib/db";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";
import { deferPush, sendPushToUser } from "@/lib/services/notifications";
import { validateFirmwareSourceUrl } from "@/lib/firmware-watch-targets";
import { visibleActiveUserWhere } from "@/lib/user-visibility";

type FirmwareRelease = {
  version: string;
  releaseDate: Date | null;
};

type FirmwareWatchTargetRow = {
  id: string;
  brand: string;
  model: string;
  productName: string | null;
  sourceUrl: string;
  sourceType: FirmwareSourceType;
  supportMode: FirmwareSupportMode;
  supportNote: string | null;
  latestVersion: string | null;
  latestReleaseDate: Date | null;
  lastChangedAt: Date | null;
  baselineEstablishedAt: Date | null;
};

type FirmwareFetch = (
  input: RequestInfo | URL,
  init?: RequestInit & { timeoutMs?: number },
) => Promise<Response>;

type FirmwareWatchResult = {
  checked: number;
  changed: number;
  baselined: number;
  failed: number;
  /** Targets left untouched because the wall-clock deadline was reached. */
  skipped: number;
  notificationsCreated: number;
  errors: Array<{ targetId: string; product: string; error: string }>;
};

/**
 * Each target costs one external fetch with an 8s timeout. Serially that is up
 * to 100 x 8s, well past any function budget, so targets run in waves and the
 * poll stops cleanly at a wall-clock deadline instead of being killed.
 * Mirrors the CONCURRENCY/DEADLINE_MS pattern in the rehost-images cron.
 */
const CONCURRENCY = 5;
const DEADLINE_MS = 30_000;

function parseFirmwareRelease(
  sourceType: FirmwareSourceType,
  html: string,
): FirmwareRelease {
  switch (sourceType) {
    case "SONY_SUPPORT":
      return parseSonySupportFirmware(html);
    default:
      throw new Error(`Unsupported firmware source type: ${sourceType}`);
  }
}

export function parseSonySupportFirmware(html: string): FirmwareRelease {
  const text = htmlToSearchableText(html);
  const version =
    matchFirst(html, /<title[^>]*>[^<]*\bVer\.\s*([0-9][A-Za-z0-9._-]*)\b/i) ??
    matchFirst(html, /"software"\s*:\s*\[[\s\S]*?"name"\s*:\s*"[^"]*?\bVer\.\s*([0-9][A-Za-z0-9._-]*)\b/i) ??
    matchFirst(html, /\\"software\\"\s*:\s*\[[\s\S]*?\\"name\\"\s*:\s*\\"[^"]*?\bVer\.\s*([0-9][A-Za-z0-9._-]*)\b/i) ??
    matchFirst(text, /\bVer\.\s*([0-9][A-Za-z0-9._-]*)\b/i) ??
    matchFirst(text, /\bVersion:\s*([0-9][A-Za-z0-9._-]*)\b/i);
  const releaseDateText =
    matchFirst(html, /"software"\s*:\s*\[[\s\S]*?"releaseDate"\s*:\s*"([^"]+)"/i) ??
    matchFirst(html, /\\"software\\"\s*:\s*\[[\s\S]*?\\"releaseDate\\"\s*:\s*\\"([^"]+)/i) ??
    matchFirst(text, /\bRelease Date:\s*([0-9]{2}[-/.][0-9]{2}[-/.][0-9]{2,4})\b/i);

  if (!version) {
    throw new Error("Sony firmware version not found");
  }

  return {
    version,
    releaseDate: releaseDateText ? parseSonyDate(releaseDateText) : null,
  };
}

export async function pollFirmwareWatchTargets(args: {
  now?: Date;
  fetcher?: FirmwareFetch;
} = {}): Promise<FirmwareWatchResult> {
  const now = args.now ?? new Date();
  const fetcher = args.fetcher ?? fetchWithTimeout;
  const targets = await db.firmwareWatchTarget.findMany({
    where: { enabled: true },
    select: {
      id: true,
      brand: true,
      model: true,
      productName: true,
      sourceUrl: true,
      sourceType: true,
      supportMode: true,
      supportNote: true,
      latestVersion: true,
      latestReleaseDate: true,
      lastChangedAt: true,
      baselineEstablishedAt: true,
    },
    orderBy: [{ brand: "asc" }, { model: "asc" }],
    take: 100,
  });

  const result: FirmwareWatchResult = {
    checked: targets.length,
    changed: 0,
    baselined: 0,
    failed: 0,
    skipped: 0,
    notificationsCreated: 0,
    errors: [],
  };

  const start = Date.now();
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    if (Date.now() - start > DEADLINE_MS) {
      result.skipped = targets.length - i;
      result.checked = i;
      break;
    }
    await Promise.all(targets.slice(i, i + CONCURRENCY).map((target) => checkTarget(target)));
  }

  return result;

  async function checkTarget(target: FirmwareWatchTargetRow) {
    try {
      validateFirmwareSourceUrl(target.sourceType, target.sourceUrl);
      const release = await fetchFirmwareRelease(target, fetcher);
      const wasBaselined = Boolean(target.baselineEstablishedAt && target.latestVersion);
      const changed = wasBaselined && release.version !== target.latestVersion;

      await db.firmwareWatchTarget.update({
        where: { id: target.id },
        data: {
          latestVersion: release.version,
          latestReleaseDate: release.releaseDate,
          lastCheckedAt: now,
          lastChangedAt: changed ? now : target.lastChangedAt,
          baselineEstablishedAt: target.baselineEstablishedAt ?? now,
          lastError: null,
        },
      });

      if (!wasBaselined) {
        result.baselined += 1;
        return;
      }

      if (changed) {
        result.changed += 1;
        result.notificationsCreated += await notifyAdminsOfFirmwareRelease(target, release, now);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown firmware watch error";
      result.failed += 1;
      result.errors.push({
        targetId: target.id,
        product: firmwareProductLabel(target),
        error,
      });
      await db.firmwareWatchTarget.update({
        where: { id: target.id },
        data: {
          lastCheckedAt: now,
          lastError: error,
        },
      });
    }
  }
}

async function fetchFirmwareRelease(
  target: Pick<FirmwareWatchTargetRow, "sourceType" | "sourceUrl">,
  fetcher: FirmwareFetch,
): Promise<FirmwareRelease> {
  const response = await fetcher(target.sourceUrl, {
    timeoutMs: 8_000,
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "GearTrackerFirmwareWatch/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Firmware source returned HTTP ${response.status}`);
  }

  return parseFirmwareRelease(target.sourceType, await response.text());
}

async function notifyAdminsOfFirmwareRelease(
  target: FirmwareWatchTargetRow,
  release: FirmwareRelease,
  now: Date,
): Promise<number> {
  const admins = await db.user.findMany({
    where: visibleActiveUserWhere({ role: "ADMIN" }),
    select: { id: true },
  });
  if (admins.length === 0) return 0;

  const product = firmwareProductLabel(target);
  const releaseDate = release.releaseDate ? formatReleaseDate(release.releaseDate) : "an unknown release date";
  const title = `Firmware update: ${product} ${release.version}`;
  const body = `${product} firmware ${release.version} was released ${releaseDate}. Review the official source before updating field gear.`;
  const payload = {
    firmwareWatchTargetId: target.id,
    brand: target.brand,
    model: target.model,
    productName: target.productName,
    supportMode: target.supportMode,
    supportNote: target.supportNote,
    version: release.version,
    releaseDate: release.releaseDate?.toISOString() ?? null,
    sourceUrl: target.sourceUrl,
    href: `/items?search=${encodeURIComponent(`${target.brand} ${target.model}`)}`,
  };

  const created = await db.notification.createMany({
    skipDuplicates: true,
    data: admins.map((admin) => ({
      userId: admin.id,
      type: "firmware_update_released",
      title,
      body,
      payload,
      channel: "IN_APP" as const,
      sentAt: now,
      dedupeKey: `firmware_release:${target.id}:${release.version}:${admin.id}`,
    })),
  });

  if (created.count > 0) {
    for (const admin of admins) {
      deferPush(sendPushToUser(admin.id, {
        title,
        body,
        payload,
      }));
    }
  }

  return created.count;
}

function htmlToSearchableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function matchFirst(text: string, pattern: RegExp): string | null {
  return text.match(pattern)?.[1] ?? null;
}

function parseUsDate(value: string): Date {
  const match = value.match(/^([0-9]{2})[-/.]([0-9]{2})[-/.]([0-9]{2}|[0-9]{4})$/);
  if (!match) {
    throw new Error(`Unsupported firmware release date: ${value}`);
  }

  const month = Number(match[1]);
  const day = Number(match[2]);
  const rawYear = Number(match[3]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid firmware release date: ${value}`);
  }
  return parsed;
}

function parseSonyDate(value: string): Date {
  if (/^[0-9]{2}[-/.][0-9]{2}[-/.][0-9]{2,4}$/.test(value)) {
    return parseUsDate(value);
  }

  const normalized = value.replace(/\\\//g, "/").replace(/\\"/g, '"');
  const timestamp = Date.parse(normalized);
  if (Number.isNaN(timestamp)) {
    throw new Error(`Unsupported firmware release date: ${value}`);
  }
  const parsed = new Date(timestamp);
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function firmwareProductLabel(target: Pick<FirmwareWatchTargetRow, "brand" | "model" | "productName">): string {
  return target.productName?.trim() || `${target.brand} ${target.model}`.trim();
}

function formatReleaseDate(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
