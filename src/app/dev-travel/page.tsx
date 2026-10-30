import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import TravelLab from "./TravelLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: an away game's Travel card filled from the crew, reviewable without a database.
export default function DevTravelPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <TravelLab fontClass={lato.variable} />;
}
