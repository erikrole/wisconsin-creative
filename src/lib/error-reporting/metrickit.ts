import { boundBreadcrumbs, type Breadcrumb, type ErrorPlatform, type ErrorReportInput } from "./grouping";

/** One recent run of the app, as the app remembers it. */
export type MetricKitSession = {
  pid: number;
  screen?: string | null;
  breadcrumbs: Breadcrumb[];
};

/**
 * Turns Apple MetricKit diagnostic payloads (crashes, hangs, CPU and disk
 * exceptions, slow launches) into error reports. Stacks arrive unsymbolicated,
 * so the frames are kept as binary + offset pairs that `atos` can resolve with
 * the build's dSYM.
 */

const MAX_DIAGNOSTICS_PER_UPLOAD = 20;
const MAX_CALL_STACK_BYTES = 64_000;
const MAX_FRAMES = 16;

const DIAGNOSTIC_KINDS = {
  crashDiagnostics: "crash",
  hangDiagnostics: "hang",
  cpuExceptionDiagnostics: "cpu_exception",
  diskWriteExceptionDiagnostics: "disk_write_exception",
  appLaunchDiagnostics: "app_launch",
} as const;

const EXCEPTION_TYPES: Record<number, string> = {
  1: "EXC_BAD_ACCESS",
  2: "EXC_BAD_INSTRUCTION",
  3: "EXC_ARITHMETIC",
  4: "EXC_EMULATION",
  5: "EXC_SOFTWARE",
  6: "EXC_BREAKPOINT",
  10: "EXC_CRASH",
  11: "EXC_RESOURCE",
  12: "EXC_GUARD",
};

const SIGNALS: Record<number, string> = {
  4: "SIGILL",
  5: "SIGTRAP",
  6: "SIGABRT",
  8: "SIGFPE",
  9: "SIGKILL",
  10: "SIGBUS",
  11: "SIGSEGV",
  13: "SIGPIPE",
};

const KIND_LABELS: Record<string, string> = {
  hang: "Hang",
  cpu_exception: "CPU exception",
  disk_write_exception: "Disk write exception",
  app_launch: "Slow launch",
};

type StackFrame = {
  binaryName: string | null;
  binaryUUID: string | null;
  offset: number | null;
  address: number | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 64): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
  if (typeof value === "number") return String(value);
  return null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** App binaries are ours; everything else is a system framework. */
function isAppBinary(name: string | null): boolean {
  return !!name && /^(Wisconsin|GearOps)/.test(name);
}

/** Frames of the crashing (attributed) thread, top of stack first. */
function attributedFrames(callStackTree: unknown): StackFrame[] {
  const tree = record(callStackTree);
  const stacks = Array.isArray(tree.callStacks) ? (tree.callStacks as unknown[]).map(record) : [];
  const stack = stacks.find((entry) => entry.threadAttributed === true) ?? stacks[0];
  if (!stack) return [];
  const frames: StackFrame[] = [];
  let level = Array.isArray(stack.callStackRootFrames) ? (stack.callStackRootFrames as unknown[]) : [];
  while (level.length > 0 && frames.length < MAX_FRAMES) {
    const frame = record(level[0]);
    frames.push({
      binaryName: text(frame.binaryName, 80),
      binaryUUID: text(frame.binaryUUID, 64),
      offset: num(frame.offsetIntoBinaryTextSegment),
      address: num(frame.address),
    });
    level = Array.isArray(frame.subFrames) ? (frame.subFrames as unknown[]) : [];
  }
  return frames;
}

/**
 * The crashing thread's part of a call stack tree. The other threads are
 * rarely needed and make up most of the size, and up to 50 occurrences are
 * kept per issue.
 */
function attributedCallStackTree(callStackTree: unknown): unknown {
  const tree = record(callStackTree);
  const stacks = Array.isArray(tree.callStacks) ? (tree.callStacks as unknown[]).map(record) : [];
  const stack = stacks.find((entry) => entry.threadAttributed === true) ?? stacks[0];
  if (!stack) return callStackTree;
  return { ...tree, callStacks: [stack] };
}

/** `com.erikrole.Wisconsin.LiveActivities` → `LiveActivities`; the main app → `App`. */
function targetLabel(bundleId: string | null): string | null {
  if (!bundleId) return null;
  const parts = bundleId.split(".");
  return parts.length > 3 ? parts.slice(3).join(".") : "App";
}

function crashName(meta: Record<string, unknown>): string {
  const signal = num(meta.signal);
  const exception = num(meta.exceptionType);
  const signalName = signal !== null ? SIGNALS[signal] ?? `signal ${signal}` : null;
  const exceptionName = exception !== null ? EXCEPTION_TYPES[exception] ?? `exception ${exception}` : null;
  if (signalName && exceptionName) return `${signalName} (${exceptionName})`;
  return signalName ?? exceptionName ?? "Crash";
}

function frameLabel(frame: StackFrame | undefined): string | null {
  if (!frame?.binaryName) return null;
  return frame.offset !== null ? `${frame.binaryName} +${frame.offset}` : frame.binaryName;
}

function payloadTime(root: Record<string, unknown>): Date | undefined {
  const raw = text(root.timeStampEnd, 64) ?? text(root.timeStampBegin, 64);
  if (!raw) return undefined;
  const parsed = new Date(raw.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return undefined;
  // Never trust a device clock into the future.
  return parsed.getTime() > Date.now() ? undefined : parsed;
}

function channelFrom(meta: Record<string, unknown>): string | null {
  if (meta.isTestFlightApp === true) return "testflight";
  if (meta.isTestFlightApp === false) return "app_store";
  return null;
}

/** Turns one MetricKit `MXDiagnosticPayload` JSON into bounded reports. */
export function parseMetricKitPayload(
  payload: unknown,
  platform: ErrorPlatform = "ios",
  sessions: MetricKitSession[] = [],
): ErrorReportInput[] {
  const root = record(payload);
  const occurredAt = payloadTime(root);
  const byPid = new Map(sessions.map((session) => [session.pid, session]));
  const reports: ErrorReportInput[] = [];
  for (const [key, kind] of Object.entries(DIAGNOSTIC_KINDS)) {
    const entries = Array.isArray(root[key]) ? (root[key] as unknown[]) : [];
    for (const entry of entries) {
      if (reports.length >= MAX_DIAGNOSTICS_PER_UPLOAD) return reports;
      const diagnostic = record(entry);
      const report = metricKitDiagnosticToReport(diagnostic, kind, platform, occurredAt);
      const pid = num(record(diagnostic.diagnosticMetaData).pid);
      const session = pid !== null ? byPid.get(pid) : undefined;
      if (session) {
        report.breadcrumbs = boundBreadcrumbs(session.breadcrumbs);
        if (session.screen) report.context = { ...report.context, lastScreen: session.screen };
      }
      reports.push(report);
    }
  }
  return reports;
}

export function metricKitDiagnosticToReport(
  diagnostic: Record<string, unknown>,
  kind: string,
  platform: ErrorPlatform,
  occurredAt?: Date,
): ErrorReportInput {
  const meta = record(diagnostic.diagnosticMetaData);
  const frames = attributedFrames(diagnostic.callStackTree);
  const stack = diagnostic.callStackTree === undefined ? undefined : attributedCallStackTree(diagnostic.callStackTree);
  const stackJson = stack === undefined ? "" : JSON.stringify(stack);
  const topAppFrame = frames.find((frame) => isAppBinary(frame.binaryName));
  const bundleId = text(meta.bundleIdentifier, 120);
  const target = targetLabel(bundleId);
  const terminationReason = text(meta.terminationReason, 160);

  const name = kind === "crash" ? crashName(meta) : KIND_LABELS[kind] ?? kind;
  const detail =
    kind === "crash"
      ? terminationReason ?? text(meta.exceptionReason, 160)
      : text(meta.hangDuration) ?? text(meta.launchDuration) ?? text(meta.totalCPUTime) ?? text(meta.writesCaused);
  const where = frameLabel(topAppFrame) ?? frameLabel(frames[0]);
  const message = [target ? `in ${target}` : null, detail].filter(Boolean).join(" · ") || name;

  return {
    platform,
    kind,
    name,
    message,
    culprit: topAppFrame?.binaryName ?? frames[0]?.binaryName ?? target,
    // Offsets move every build, so grouping uses the binary, not the address:
    // a crash that survives a release stays one issue across builds.
    groupingParts: [bundleId ?? "", topAppFrame?.binaryName ?? ""],
    stack: frames.length
      ? frames
          .map((frame, index) => `${index} ${frame.binaryName ?? "???"} offset ${frame.offset ?? "?"}${frame.binaryUUID ? ` (${frame.binaryUUID})` : ""}`)
          .join("\n")
      : null,
    screen: where,
    occurredAt,
    appVersion: text(meta.appVersion, 32),
    appBuild: text(meta.appBuildVersion, 32),
    releaseChannel: channelFrom(meta),
    osVersion: text(meta.osVersion, 64),
    deviceModel: text(meta.deviceType, 32),
    context: {
      source: "metrickit",
      ...(bundleId ? { bundleId } : {}),
      ...(Object.keys(meta).length > 0 ? { metadata: meta } : {}),
      ...(frames.length ? { frames } : {}),
    },
    // A stack past the cap is dropped rather than cut, which would make it
    // unreadable; the frames above still carry the top of it.
    callStack: stackJson && stackJson.length <= MAX_CALL_STACK_BYTES ? stack : undefined,
  };
}
