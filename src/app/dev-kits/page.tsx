import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import KitsLab from "./KitsLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the Kits list in the app shell with sample kits, reviewable without a database.
export default function DevKitsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <KitsLab fontClass={lato.variable} />;
}
