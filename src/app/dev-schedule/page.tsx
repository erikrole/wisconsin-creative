import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import ScheduleLab from "./ScheduleLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the Schedule in the app shell with sample events and crews, reviewable without a database.
export default function DevSchedulePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ScheduleLab fontClass={lato.variable} />;
}
