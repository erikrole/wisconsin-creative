import { Lato } from "next/font/google";
import DamageTheme from "./DamageTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default function DamageLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <DamageTheme classNames={`wc-fresh ${lato.variable}`} />
      {children}
    </div>
  );
}
