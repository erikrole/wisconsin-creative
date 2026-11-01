import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import ItemsLab from "../ItemsLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: one item's detail page with sample data, for example /dev-items/dev-fx6-a.
export default function DevItemDetailPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <ItemsLab fontClass={lato.variable} detail />;
}
