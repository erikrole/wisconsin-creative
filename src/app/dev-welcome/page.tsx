import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import WelcomeLab from "./WelcomeLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: renders /welcome and its finish screen with sample profiles, so the
// onboarding setup can be reviewed without a database or an invite.
export default function DevWelcomePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <WelcomeLab fontClass={lato.variable} />;
}
