import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import ReportsLab from "./ReportsLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the Utilization report in the app shell with sample numbers, reviewable without a database.
export default function DevReportsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ReportsLab fontClass={lato.variable} />;
}
