import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import GearLab from "./GearLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the UA gear page in the app shell with sample picks and kit, reviewable without a database.
export default function DevGearPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <GearLab fontClass={lato.variable} />;
}
