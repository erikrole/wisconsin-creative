import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import CaseChecklistLab from "./CaseChecklistLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the shared case checklist on a booking and in Settings, reviewable without a database.
export default function DevCaseChecklistPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <CaseChecklistLab fontClass={lato.variable} />;
}
