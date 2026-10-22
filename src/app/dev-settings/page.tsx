import { notFound } from "next/navigation";
import { Lato } from "next/font/google";
import SettingsLab from "./SettingsLab";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Dev-only: renders a Settings page inside the real app chrome without a database.
// /dev-settings?page=profile|security|notifications|appearance|overview&role=&theme=
export default function DevSettingsPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SettingsLab fontClass={lato.variable} />;
}
