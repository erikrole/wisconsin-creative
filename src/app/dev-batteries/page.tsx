import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import BatteriesLab from "./BatteriesLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: renders Battery Ops with sample data (no database or sign-in), so
// the page can be reviewed and screenshotted.
export default function DevBatteriesPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <BatteriesLab fontClass={lato.variable} />;
}
