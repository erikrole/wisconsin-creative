import { Lato } from "next/font/google";
import StaffTheme from "../staff/StaffTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default function ScoreboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <StaffTheme classNames={`wc-fresh ${lato.variable}`} />
      {children}
    </div>
  );
}
