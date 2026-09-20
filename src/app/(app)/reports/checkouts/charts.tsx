"use client";

import { AreaChart, Area, BarChart, Bar, Cell, ReferenceLine, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  REPORT_CHART_COLORS,
  REPORT_SEMANTIC_CHART_COLORS,
  ReportChartCard,
  formatDateLabel,
} from "../report-ui";

const trendConfig: ChartConfig = {
  count: { label: "Checkouts", color: REPORT_SEMANTIC_CHART_COLORS.active },
};

export function CheckoutTrendChart({
  dailyTrend,
  days,
  onSelectDate,
  selectedDate,
}: {
  dailyTrend: { date: string; count: number }[];
  days: number;
  /** Clicking a day narrows the checkout list below to that day. */
  onSelectDate?: (date: string | null) => void;
  selectedDate?: string | null;
}) {
  if (dailyTrend.length <= 1) return null;

  return (
    <ReportChartCard
      title={`Checkout trend (${days}d)`}
      description={onSelectDate ? "Select a day to filter the checkout list" : undefined}
    >
        <ChartContainer config={trendConfig} className="w-full h-[200px]">
          <AreaChart
            data={dailyTrend}
            margin={{ left: 0, right: 12, top: 4, bottom: 0 }}
            onClick={
              onSelectDate
                ? (state) => {
                    const clicked = state?.activeLabel;
                    if (typeof clicked !== "string") return;
                    onSelectDate(clicked === selectedDate ? null : clicked);
                  }
                : undefined
            }
            className={onSelectDate ? "cursor-pointer" : undefined}
          >
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} className="text-xs" tickFormatter={formatDateLabel}
              interval={Math.max(0, Math.floor(dailyTrend.length / 7) - 1)} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} className="text-xs" width={30} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Area
              type="monotone"
              dataKey="count"
              name="Checkouts"
              fill={REPORT_SEMANTIC_CHART_COLORS.activeSoft}
              stroke={REPORT_SEMANTIC_CHART_COLORS.active}
              strokeWidth={2}
            />
            {selectedDate ? (
              <ReferenceLine x={selectedDate} stroke={REPORT_SEMANTIC_CHART_COLORS.active} strokeDasharray="4 2" />
            ) : null}
          </AreaChart>
        </ChartContainer>
    </ReportChartCard>
  );
}

export function TopRequestersChart({ topRequesters, days }: { topRequesters: { name: string; count: number }[]; days: number }) {
  if (topRequesters.length === 0) return null;

  return (
    <ReportChartCard title={`Top requesters (${days}d)`}>
        <ChartContainer config={{ count: { label: "Checkouts" } }} className="w-full" style={{ height: Math.max(150, topRequesters.length * 36) }}>
          <BarChart data={topRequesters} layout="vertical" margin={{ left: 0, right: 12 }}>
            <YAxis dataKey="name" type="category" width={100} tickLine={false} axisLine={false} className="text-xs" />
            <XAxis type="number" hide />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" name="Checkouts" radius={[0, 4, 4, 0]}>
              {topRequesters.map((_, i) => (
                <Cell key={i} fill={REPORT_CHART_COLORS[i % REPORT_CHART_COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>
    </ReportChartCard>
  );
}
