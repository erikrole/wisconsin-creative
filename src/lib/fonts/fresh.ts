import { Lato } from "next/font/google";

/** Lato for fresh-theme surfaces that portal outside a fresh page layout (dialogs, popovers). */
const freshLato = Lato({ subsets: ["latin"], weight: ["400", "700", "900"], variable: "--font-lato", display: "swap" });

export const FRESH_SCOPE_CLASS = `wc-fresh ${freshLato.variable}`;
