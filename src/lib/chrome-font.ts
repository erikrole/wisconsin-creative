import { Lato } from "next/font/google";

/**
 * Typeface for the app chrome (sidebar, top bar, phone tab bar). The chrome loads its own font
 * instead of inheriting the body's, so page-scoped themes such as `.wc-fresh` cannot restyle it.
 */
export const chromeFont = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], display: "swap" });
