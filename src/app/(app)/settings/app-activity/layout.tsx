import { redirect } from "next/navigation";
import { Lato } from "next/font/google";
import { requireAuth } from "@/lib/auth";
import { canViewUsageAnalytics } from "@/lib/usage-analytics";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default async function AppActivityLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAuth();
  if (!canViewUsageAnalytics(user)) redirect("/settings");
  return <div className={`wc-fresh ${lato.variable}`}>{children}</div>;
}
