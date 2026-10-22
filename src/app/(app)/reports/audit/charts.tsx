"use client";

import { BarChart, Bar, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { REPORT_BAR_COLOR, ReportChartCard } from "../report-ui";

function formatAction(action: string) {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/^(.{20}).+$/, "$1\u2026");
}

const chartConfig: ChartConfig = {
  count: { label: "Events" },
};

export function ActionBreakdownChart({
  byAction,
}: {
  byAction: { action: string; count: number }[];
}) {
  if (byAction.length === 0) return null;

  return (
    <ReportChartCard title="By action">
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height: Math.max(150, byAction.length * 32) }}
        >
          <BarChart
            data={byAction}
            layout="vertical"
            margin={{ left: 0, right: 12 }}
          >
            <YAxis
              dataKey="action"
              type="category"
              width={130}
              tickLine={false}
              axisLine={false}
              className="text-xs"
              tickFormatter={formatAction}
            />
            <XAxis type="number" hide />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" name="Events" radius={[0, 4, 4, 0]}>
              {byAction.map((_, i) => (
                <Cell key={i} fill={REPORT_BAR_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
    </ReportChartCard>
  );
}

export function EntityTypeBreakdownChart({
  byEntityType,
}: {
  byEntityType: { entityType: string; count: number }[];
}) {
  if (byEntityType.length === 0) return null;

  return (
    <ReportChartCard title="By entity type">
        <ChartContainer
          config={chartConfig}
          className="w-full"
          style={{ height: Math.max(150, byEntityType.length * 32) }}
        >
          <BarChart
            data={byEntityType}
            layout="vertical"
            margin={{ left: 0, right: 12 }}
          >
            <YAxis
              dataKey="entityType"
              type="category"
              width={90}
              tickLine={false}
              axisLine={false}
              className="text-xs"
            />
            <XAxis type="number" hide />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" name="Events" radius={[0, 4, 4, 0]}>
              {byEntityType.map((_, i) => (
                <Cell key={i} fill={REPORT_BAR_COLOR} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
    </ReportChartCard>
  );
}
