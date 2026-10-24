"use client";

import {
  ArrowRightLeftIcon,
  CircleDotIcon,
  EyeIcon,
  GlobeIcon,
  LaptopIcon,
  MousePointerClickIcon,
  ServerIcon,
  SmartphoneIcon,
  TabletIcon,
  TerminalIcon,
  type LucideIcon,
} from "lucide-react";
import type { Breadcrumb } from "@/lib/error-reporting/grouping";
import { cn } from "@/lib/utils";

export const PLATFORM_META: Record<string, { label: string; icon: LucideIcon }> = {
  web: { label: "Web", icon: GlobeIcon },
  server: { label: "Server", icon: ServerIcon },
  ios: { label: "iPhone", icon: SmartphoneIcon },
  kiosk: { label: "Kiosk", icon: TabletIcon },
  macos: { label: "Mac", icon: LaptopIcon },
};

export const KIND_LABELS: Record<string, string> = {
  error: "Error",
  unhandled_rejection: "Unhandled promise",
  render_error: "Page crash",
  api_error: "Request failed",
  crash: "Crash",
  hang: "Hang",
  cpu_exception: "CPU exception",
  disk_write_exception: "Disk writes",
  app_launch: "Slow launch",
};

export const CHANNEL_LABELS: Record<string, string> = {
  app_store: "App Store",
  testflight: "TestFlight",
  development: "Development",
  production: "Production",
  preview: "Preview",
  web: "Web",
};

export function PlatformBadge({ platform, className }: { platform: string; className?: string }) {
  const meta = PLATFORM_META[platform] ?? { label: platform, icon: CircleDotIcon };
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground",
        className,
      )}
      title={meta.label}
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="sr-only">{meta.label}</span>
    </span>
  );
}

const STATUS_STYLES: Record<string, string> = {
  open: "bg-[#FFF1E7] text-[#BD4B00] dark:bg-orange-500/15 dark:text-orange-300",
  resolved: "bg-[#E6F6EB] text-[#18794E] dark:bg-emerald-500/15 dark:text-emerald-300",
  ignored: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
  regressed: "bg-[#FFEBEC] text-[#C62A2F] dark:bg-red-500/15 dark:text-red-300",
};
const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  resolved: "Fixed",
  ignored: "Ignored",
  closed: "Closed",
  regressed: "Back again",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={cn("inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold", STATUS_STYLES[status] ?? STATUS_STYLES.ignored)}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

/** Fourteen daily bars; height is relative to the busiest day. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  const max = Math.max(1, ...values);
  const total = values.reduce((sum, value) => sum + value, 0);
  return (
    <div className={cn("flex h-6 items-end gap-[2px]", className)} role="img" aria-label={`${total} in the last 14 days`}>
      {values.map((value, index) => (
        <span
          key={index}
          className={cn("w-[4px] rounded-[1px]", value > 0 ? "bg-[#3E63DD]/70 dark:bg-[#8DA4EF]/70" : "bg-border")}
          style={{ height: value > 0 ? `${Math.max(18, (value / max) * 100)}%` : "2px" }}
        />
      ))}
    </div>
  );
}

const CRUMB_ICONS: Record<Breadcrumb["type"], LucideIcon> = {
  nav: ArrowRightLeftIcon,
  click: MousePointerClickIcon,
  api: ServerIcon,
  log: TerminalIcon,
  lifecycle: EyeIcon,
};

function crumbOffset(at: string, reference: string | null): string | null {
  if (!reference) return null;
  const diff = Math.round((new Date(reference).getTime() - new Date(at).getTime()) / 1000);
  if (!Number.isFinite(diff) || diff < 0) return null;
  if (diff < 60) return `${diff}s before`;
  if (diff < 3600) return `${Math.round(diff / 60)}m before`;
  return `${Math.round(diff / 3600)}h before`;
}

function isFailure(crumb: Breadcrumb): boolean {
  return crumb.type === "log" || (crumb.type === "api" && /→ (failed|[45]\d\d)$/.test(crumb.message));
}

/** Recent actions, oldest first, ending at the moment of the failure. */
export function ActionTimeline({ crumbs, endAt }: { crumbs: Breadcrumb[]; endAt: string | null }) {
  if (crumbs.length === 0) {
    return <p className="m-0 text-sm text-muted-foreground">No recent actions were recorded with this report.</p>;
  }
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {crumbs.map((crumb, index) => {
        const Icon = CRUMB_ICONS[crumb.type] ?? CircleDotIcon;
        const failure = isFailure(crumb);
        const requestId = typeof crumb.data?.requestId === "string" ? crumb.data.requestId : null;
        return (
          <li key={`${crumb.at}-${index}`} className="grid grid-cols-[20px_1fr_auto] items-start gap-3 py-1.5">
            <Icon className={cn("mt-0.5 size-3.5", failure ? "text-[#C62A2F] dark:text-red-400" : "text-muted-foreground")} aria-hidden="true" />
            <div className="min-w-0">
              <p className={cn("m-0 break-words text-[13px] leading-snug", failure && "font-bold text-[#C62A2F] dark:text-red-400")}>
                {crumb.message}
              </p>
              {requestId ? <p className="m-0 mt-0.5 truncate font-mono text-[11px] text-muted-foreground">request {requestId}</p> : null}
            </div>
            <span className="whitespace-nowrap text-[11.5px] tabular-nums text-muted-foreground">{crumbOffset(crumb.at, endAt)}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function versionText(version: string | null, channel?: string | null): string {
  const base = version ?? "Unknown version";
  return channel && CHANNEL_LABELS[channel] ? `${base} · ${CHANNEL_LABELS[channel]}` : base;
}
