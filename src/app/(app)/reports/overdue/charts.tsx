"use client";

import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  REPORT_OVERDUE_CHART_COLORS,
  REPORT_SEMANTIC_CHART_COLORS,
} from "../report-ui";

export function OverdueHoursChart({
  rows,
  height,
}: {
  rows: { name: string; hours: number }[];
  height: number;
}) {
  return (
    <ChartContainer
      config={{ hours: { label: "Overdue hours", color: REPORT_SEMANTIC_CHART_COLORS.problem } }}
      className="w-full"
      style={{ height }}
    >
      <BarChart data={rows} layout="vertical" margin={{ left: 0, right: 12 }}>
        <YAxis dataKey="name" type="category" width={100} tickLine={false} axisLine={false} className="text-xs" />
        <XAxis type="number" hide />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="hours" name="Overdue hours" radius={[0, 4, 4, 0]}>
          {rows.map((_, i) => (
            <Cell key={i} fill={REPORT_OVERDUE_CHART_COLORS[i]} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
