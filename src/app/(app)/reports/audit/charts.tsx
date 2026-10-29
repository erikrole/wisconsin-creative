"use client";

import { BarChart, Bar, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { REPORT_BAR_COLOR, ReportChartCard } from "../report-ui";
import { auditSentence } from "@/lib/audit-actions";

function humanize(value: string) {
  const spaced = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._-]+/g, " ").toLowerCase().trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function truncate(label: string) {
  return label.length > 28 ? `${label.slice(0, 27)}\u2026` : label;
}

function formatAction(action: string) {
  return truncate(auditSentence(action, undefined) ?? humanize(action));
}

function formatEntityType(entityType: string) {
  return truncate(humanize(entityType));
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
              width={180}
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
    <ReportChartCard title="By record type">
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
              width={150}
              tickLine={false}
              axisLine={false}
              className="text-xs"
              tickFormatter={formatEntityType}
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
