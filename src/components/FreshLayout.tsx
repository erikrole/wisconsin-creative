import { Lato } from "next/font/google";
import FreshTheme from "./FreshTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

/** Wraps a route area in the shared scoped wc-fresh theme (Lato). */
export default function FreshLayout({ children }: { children: React.ReactNode }) {
  const classNames = `wc-fresh ${lato.variable}`;
  return (
    <div className={classNames}>
      <FreshTheme classNames={classNames} />
      {children}
    </div>
  );
}
