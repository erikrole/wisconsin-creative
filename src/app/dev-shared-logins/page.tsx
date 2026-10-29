import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import SharedLoginsLab from "./SharedLoginsLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: renders Software > Shared logins with sample data (no database or sign-in),
// so the page can be reviewed and screenshotted. `?role=STUDENT` shows the student view.
export default function DevSharedLoginsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SharedLoginsLab fontClass={lato.variable} />;
}
