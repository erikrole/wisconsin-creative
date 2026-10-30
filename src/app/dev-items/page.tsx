import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import ItemsLab from "./ItemsLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: the Items list in the app shell with sample inventory, reviewable without a database.
export default function DevItemsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ItemsLab fontClass={lato.variable} />;
}
