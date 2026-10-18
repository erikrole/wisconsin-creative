import { Lato } from "next/font/google";
import BudgetTheme from "./BudgetTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default function BudgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <BudgetTheme classNames={`wc-fresh ${lato.variable}`} />
      {children}
    </div>
  );
}
