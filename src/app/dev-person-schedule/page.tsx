import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import { PersonWeekLab } from "./PersonWeekLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the Schedule "By person" week with sample crew, no database.
export default function DevPersonSchedulePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <div className={`wc-fresh ${lato.variable} mx-auto max-w-7xl p-6`}>
      <PersonWeekLab />
    </div>
  );
}
