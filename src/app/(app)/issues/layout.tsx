import { Lato } from "next/font/google";
import IssuesTheme from "./IssuesTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default function IssuesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <IssuesTheme classNames={`wc-fresh ${lato.variable}`} />
      {children}
    </div>
  );
}
