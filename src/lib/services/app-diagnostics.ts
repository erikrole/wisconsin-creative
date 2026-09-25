import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * MetricKit diagnostic payloads from iOS: crashes, hangs, and resource
 * exceptions. Stored without any user identity, with each call stack capped,
 * and pruned after 90 days.
 */

export const APP_DIAGNOSTIC_RETENTION_DAYS = 90;
const MAX_DIAGNOSTICS_PER_UPLOAD = 20;
const MAX_CALL_STACK_BYTES = 200_000;

const DIAGNOSTIC_KINDS = {
  crashDiagnostics: "crash",
  hangDiagnostics: "hang",
  cpuExceptionDiagnostics: "cpu_exception",
  diskWriteExceptionDiagnostics: "disk_write_exception",
  appLaunchDiagnostics: "app_launch",
} as const;

type DiagnosticRow = {
  platform: string;
  kind: string;
  appVersion: string | null;
  osVersion: string | null;
  signature: string | null;
  metadata: Prisma.InputJsonValue | undefined;
  callStack: Prisma.InputJsonValue | undefined;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown, max = 64): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
  if (typeof value === "number") return String(value);
  return null;
}

/** The most useful one-line grouping key MetricKit offers for this kind. */
function signatureFor(kind: string, meta: Record<string, unknown>): string | null {
  if (kind === "crash") {
    return [text(meta.exceptionType), text(meta.signal), text(meta.terminationReason, 96)].filter(Boolean).join(" · ") || null;
  }
  if (kind === "hang") return text(meta.hangDuration) ? `hang ${text(meta.hangDuration)}` : "hang";
  if (kind === "app_launch") return text(meta.launchDuration) ? `launch ${text(meta.launchDuration)}` : "launch";
  return text(meta.totalCPUTime) ?? text(meta.writesCaused) ?? null;
}

/** Turns one MetricKit `MXDiagnosticPayload` JSON into bounded rows. */
export function parseDiagnosticPayload(payload: unknown, platform = "ios"): DiagnosticRow[] {
  const root = record(payload);
  const rows: DiagnosticRow[] = [];
  for (const [key, kind] of Object.entries(DIAGNOSTIC_KINDS)) {
    const entries = Array.isArray(root[key]) ? root[key] as unknown[] : [];
    for (const entry of entries) {
      if (rows.length >= MAX_DIAGNOSTICS_PER_UPLOAD) return rows;
      const diagnostic = record(entry);
      const meta = record(diagnostic.diagnosticMetaData);
      const stack = diagnostic.callStackTree;
      const stackJson = stack === undefined ? "" : JSON.stringify(stack);
      rows.push({
        platform,
        kind,
        appVersion: text(meta.appVersion, 32),
        osVersion: text(meta.osVersion, 64),
        signature: signatureFor(kind, meta),
        metadata: Object.keys(meta).length > 0 ? meta as Prisma.InputJsonValue : undefined,
        // A stack past the cap is dropped rather than cut, which would make it
        // unreadable; the signature and metadata still group the report.
        callStack: stackJson && stackJson.length <= MAX_CALL_STACK_BYTES ? stack as Prisma.InputJsonValue : undefined,
      });
    }
  }
  return rows;
}

export async function storeDiagnostics(rows: DiagnosticRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const { count } = await db.appDiagnostic.createMany({ data: rows });
  return count;
}

export async function pruneAppDiagnostics(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - APP_DIAGNOSTIC_RETENTION_DAYS * 86_400_000);
  const { count } = await db.appDiagnostic.deleteMany({ where: { receivedAt: { lt: cutoff } } });
  return count;
}
