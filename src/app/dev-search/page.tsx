import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import SearchLab from "./SearchLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the Cmd-K search palette open over the app shell with sample results, reviewable without a database.
export default function DevSearchPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SearchLab fontClass={lato.variable} />;
}
