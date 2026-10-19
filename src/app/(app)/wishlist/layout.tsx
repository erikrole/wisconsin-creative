import { Lato } from "next/font/google";
import WishlistTheme from "./WishlistTheme";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export default function WishlistLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`wc-fresh ${lato.variable}`}>
      <WishlistTheme classNames={`wc-fresh ${lato.variable}`} />
      {children}
    </div>
  );
}
