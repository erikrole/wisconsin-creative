import { Lato } from "next/font/google";
import FreshTheme from "@/components/FreshTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default function AccountabilityLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <FreshTheme classNames={`wc-fresh ${lato.variable}`} />
      {children}
    </div>
  );
}
