import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import OnboardingChecklistLab from "./OnboardingChecklistLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the admin onboarding checklist with sample students, no database needed.
export default function DevOnboardingChecklistPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <OnboardingChecklistLab fontClass={lato.variable} />;
}
