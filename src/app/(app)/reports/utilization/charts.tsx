"use client";

import Link from "next/link";
import { PieChart, Pie, Cell, BarChart, Bar, LabelList, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { statusLabelEquipment } from "@/lib/status-colors";
import {
  REPORT_BAR_COLOR,
  REPORT_SEMANTIC_CHART_COLORS,
  ReportChartCard,
} from "../report-ui";

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: REPORT_SEMANTIC_CHART_COLORS.available,
  CHECKED_OUT: REPORT_SEMANTIC_CHART_COLORS.active,
  PENDING_PICKUP: REPORT_SEMANTIC_CHART_COLORS.waiting,
  RESERVED: REPORT_SEMANTIC_CHART_COLORS.reserved,
  MAINTENANCE: REPORT_SEMANTIC_CHART_COLORS.waiting,
  RETIRED: REPORT_SEMANTIC_CHART_COLORS.neutral,
};

export function StatusDonut({ statusCounts }: { statusCounts: Record<string, number> }) {
  const chartData = Object.entries(statusCounts)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => ({
      status: statusLabelEquipment(status),
      statusKey: status,
      count,
      fill: STATUS_COLORS[status] ?? REPORT_SEMANTIC_CHART_COLORS.neutral,
    }));

  if (chartData.length === 0) return null;

  const config: ChartConfig = Object.fromEntries(
    chartData.map((d) => [d.status, { label: d.status, color: d.fill }])
  );

  return (
    <ReportChartCard title="Status distribution">
        <ChartContainer config={config} className="mx-auto aspect-square max-h-[250px]">
          <PieChart>
            <ChartTooltip content={<ChartTooltipContent />} />
            <Pie data={chartData} dataKey="count" nameKey="status" innerRadius={60} outerRadius={90} paddingAngle={2}>
              {chartData.map((d) => (
                <Cell key={d.status} fill={d.fill} />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>
        {/* The legend doubles as the drill-down: a real link per status beats a
            clickable pie sector for both keyboard and touch targets. */}
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {chartData.map((d) => (
            <Link
              key={d.status}
              href={`/items?status=${d.statusKey}`}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-xs tabular-nums no-underline transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden="true" className="size-2.5 rounded-full" style={{ background: d.fill }} />
              {d.status} ({d.count})
            </Link>
          ))}
        </div>
    </ReportChartCard>
  );
}

export type TopUsedAsset = {
  assetId: string;
  assetTag: string;
  checkouts: number;
  custodyDays: number;
  name: string;
  utilizationRate: number;
};

/**
 * Ranks the gear that actually earns its shelf space. Custody days is the
 * measure rather than checkout count, so one long shoot outranks a dozen
 * same-day grabs.
 */
export function TopUsedChart({ assets, days }: { assets: TopUsedAsset[]; days: number }) {
  if (assets.length === 0) return null;

  const data = assets.map((asset) => ({
    label: asset.assetTag,
    days: Number(asset.custodyDays.toFixed(2)),
    fill: REPORT_BAR_COLOR,
  }));

  const config: ChartConfig = {
    days: { label: "Days in custody", color: REPORT_BAR_COLOR },
  };

  return (
    <ReportChartCard
      title="Most-used gear"
      description={`Days in custody over the past ${days} days`}
    >
      <ChartContainer config={config} className="w-full" style={{ height: Math.max(150, data.length * 32) }}>
        <BarChart data={data} layout="vertical" margin={{ left: 0, right: 40 }}>
          <YAxis dataKey="label" type="category" width={110} tickLine={false} axisLine={false} className="text-xs" />
          <XAxis type="number" hide />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Bar dataKey="days" name="Days in custody" radius={4} barSize={18}>
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
            {/* The number sits at the end of each bar, so reading it doesn't take a hover. */}
            <LabelList dataKey="days" position="right" className="fill-muted-foreground text-xs tabular-nums" formatter={(value) => Math.round(Number(value))} />
          </Bar>
        </BarChart>
      </ChartContainer>
    </ReportChartCard>
  );
}
