import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import HomeLab from "./HomeLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: renders Home in the real app shell with sample data for every role
// and state, so it can be reviewed without a database.
export default function DevHomePage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <HomeLab fontClass={lato.variable} />;
}
