"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { REPORT_SEMANTIC_CHART_COLORS, ReportChartCard, formatDateLabel } from "../report-ui";

const scanConfig: ChartConfig = {
  success: { label: "Success", color: REPORT_SEMANTIC_CHART_COLORS.available },
  fail: { label: "Failed", color: REPORT_SEMANTIC_CHART_COLORS.problem },
};

export function DailyScanVolumeChart({
  dailyScans,
}: {
  dailyScans: { date: string; success: number; fail: number }[];
}) {
  if (dailyScans.length === 0) return null;

  return (
    <ReportChartCard title="Daily scan volume" className="mb-4">
        <ChartContainer config={scanConfig} className="w-full h-[220px]">
          <BarChart
            data={dailyScans}
            margin={{ left: 0, right: 12, top: 4, bottom: 0 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              className="stroke-border"
            />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              className="text-xs"
              tickFormatter={formatDateLabel}
              interval={Math.max(
                0,
                Math.floor(dailyScans.length / 7) - 1
              )}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              className="text-xs"
              width={30}
            />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar
              dataKey="success"
              name="Success"
              stackId="scans"
              fill={REPORT_SEMANTIC_CHART_COLORS.available}
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="fail"
              name="Failed"
              stackId="scans"
              fill={REPORT_SEMANTIC_CHART_COLORS.problem}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer>
    </ReportChartCard>
  );
}
