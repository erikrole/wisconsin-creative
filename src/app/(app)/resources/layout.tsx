import { Lato } from "next/font/google";
import ResourcesTheme from "./ResourcesTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default function ResourcesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <ResourcesTheme classNames={`wc-fresh ${lato.variable}`} />
      {children}
    </div>
  );
}
