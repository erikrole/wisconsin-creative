import Link from "next/link";
import type { CSSProperties } from "react";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type OperationalTone = "red" | "orange" | "green" | "blue" | "purple" | "muted";

/**
 * Change against a comparison window. `percent` is a ratio (0.18 renders as
 * +18%) and is null when the prior window was empty, in which case the raw
 * `absolute` difference is shown instead — "+12 vs 0" is honest where "+∞%"
 * is not.
 */
export type OperationalMetricDelta = {
  percent: number | null;
  absolute: number;
  /** Unit for the raw difference, e.g. " pts" when the metric is itself a rate. */
  absoluteSuffix?: string;
  /** What the comparison is against, e.g. "vs prior 30d". */
  comparisonLabel: string;
  /** Which direction reads as good. "neutral" renders without color. */
  goodDirection?: "up" | "down" | "neutral";
};

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatDeltaText(delta: OperationalMetricDelta) {
  if (delta.percent === null) {
    const sign = delta.absolute > 0 ? "+" : "";
    return `${sign}${delta.absolute.toLocaleString()}${delta.absoluteSuffix ?? ""}`;
  }
  const pct = delta.percent * 100;
  const sign = pct > 0 ? "+" : "";
  // Sub-1% moves round to 0% and read as "no change", so keep one decimal there.
  const rounded = Math.abs(pct) < 10 ? pct.toFixed(1) : Math.round(pct).toString();
  return `${sign}${rounded}%`;
}

function MetricDelta({ delta }: { delta: OperationalMetricDelta }) {
  const direction = delta.absolute > 0 ? "up" : delta.absolute < 0 ? "down" : "flat";
  const goodDirection = delta.goodDirection ?? "up";

  const toneClass =
    direction === "flat" || goodDirection === "neutral"
      ? "text-muted-foreground"
      : direction === goodDirection
        ? "text-[var(--green-text)]"
        : "text-[var(--red-text)]";

  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;
  const text = direction === "flat" ? "No change" : formatDeltaText(delta);

  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tabular-nums", toneClass)}>
      <Icon aria-hidden="true" className="size-3" />
      <span>{text}</span>
      <span className="font-normal text-muted-foreground">{delta.comparisonLabel}</span>
    </span>
  );
}

/**
 * Dependency-free trend line. Charting libraries are too heavy for a card that
 * renders a dozen times per report grid.
 */
function MetricSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;

  const width = 64;
  const height = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values
    .map((value, index) => {
      const x = index * step;
      const y = height - ((value - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      className="shrink-0 text-muted-foreground/60"
      focusable="false"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export function OperationalMetricCard({
  ariaPressed,
  badge,
  className,
  delta,
  helper,
  href,
  label,
  onClick,
  sparkline,
  tone = "muted",
  value,
  valueStyle,
  tooltip,
}: {
  ariaPressed?: boolean;
  badge?: { text: string; variant: BadgeProps["variant"] };
  className?: string;
  delta?: OperationalMetricDelta;
  helper?: string;
  href?: string;
  label: string;
  onClick?: () => void;
  sparkline?: number[];
  tone?: OperationalTone;
  value: number | string;
  valueStyle?: CSSProperties;
  tooltip?: string;
}) {
  const toneClass = {
    red: "text-[var(--red-text)]",
    orange: "text-[var(--orange-text)]",
    green: "text-[var(--green-text)]",
    blue: "text-[var(--blue-text)]",
    purple: "text-[var(--purple-text)]",
    muted: "text-foreground",
  }[tone];

  const card = (
    <Card
      className={cn(
        "h-full min-h-[104px] border-border/40 shadow-none",
        (href || onClick) && "cursor-pointer transition-[background-color,box-shadow,scale] hover:bg-muted/50 hover:shadow-xs active:scale-[0.99]",
        ariaPressed && "border-primary/40 bg-primary/5 shadow-[inset_3px_0_0_var(--primary)]",
        className,
      )}
    >
      <CardContent className="flex h-full flex-col justify-center p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <div className={cn("text-2xl font-semibold tabular-nums", toneClass)} style={valueStyle}>
            {value}
          </div>
          <div className="flex items-center gap-2">
            {sparkline ? <MetricSparkline values={sparkline} /> : null}
            {badge ? <Badge variant={badge.variant}>{badge.text}</Badge> : null}
          </div>
        </div>
        {delta ? (
          <div className="mt-1">
            <MetricDelta delta={delta} />
          </div>
        ) : null}
        {helper ? (
          <div className="mt-1 text-xs text-muted-foreground">
            {helper}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );

  const wrapped = href ? (
    <Link href={href} className="block h-full min-h-10 rounded-md no-underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
      {card}
    </Link>
  ) : onClick ? (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ariaPressed}
      className="block h-full min-h-10 w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      {card}
    </button>
  ) : card;

  if (!tooltip) return wrapped;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{wrapped}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export function OperationalPartialResultsAlert({
  className,
  failureLabel = "Failed checks",
  failures,
  noun = "check",
  recoveryCopy = "Refresh before treating a clean result as final.",
  title = "Some checks did not load",
  actionLabel,
  onAction,
}: {
  className?: string;
  failureLabel?: string;
  failures: string[];
  noun?: string;
  recoveryCopy?: string;
  title?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  if (failures.length === 0) return null;

  return (
    <Alert className={cn("border-[var(--orange)]/40 bg-[var(--orange-bg)]", className)}>
      <AlertTriangle className="size-4 text-[var(--orange-text)]" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-end justify-between gap-3 text-muted-foreground">
        <span>
          {pluralize(failures.length, noun)} could not finish. {recoveryCopy}
          <span className="block pt-1 text-xs">
            {failureLabel}: {failures.join(", ")}.
          </span>
        </span>
        {actionLabel && onAction && (
          <Button type="button" variant="outline" size="sm" className="h-10 shrink-0" onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
