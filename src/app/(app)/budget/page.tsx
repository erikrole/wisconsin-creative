import { Role } from "@prisma/client";
import { redirect } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { BudgetView } from "./BudgetView";

export const metadata = { title: "Budget" };

/** Admin-only department budgets: planned vs. spent lines by fiscal year and pot (Creative, Football). */
export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ b?: string; line?: string }>;
}) {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/");
  const { b, line } = await searchParams;
  return <BudgetView initialBudgetId={b ?? null} focusLineId={line ?? null} />;
}
