import { Lato } from "next/font/google";

const lato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

/** wc-fresh for surfaces that render in a portal, outside any themed layout. */
export const FRESH_THEME_CLASS = `wc-fresh ${lato.variable}`;
