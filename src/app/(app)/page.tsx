import { Lato } from "next/font/google";
import HomePage from "./_home/HomePage";
import HomeTheme from "./_home/HomeTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

// Home: the landing page after sign-in, in the shared wc-fresh theme.
export default function Home() {
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <HomeTheme classNames={`wc-fresh ${lato.variable}`} />
      <HomePage />
    </div>
  );
}
