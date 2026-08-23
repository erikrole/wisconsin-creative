import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "@fontsource/barlow/400.css";
import "@fontsource/barlow/500.css";
import "@fontsource/barlow/600.css";
import "@fontsource/barlow/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wisconsin Creative",
  description: "Equipment checkout, reservation, and scan tracking for university athletics",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Wisconsin Creative",
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any", type: "image/x-icon" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#A00000",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-sync-scripts -- critical theme boot runs before paint; script body stays CSP-compatible in /public. */}
        <script nonce={nonce} src="/theme-init.js" suppressHydrationWarning />
        <script nonce={nonce} src="/sw-init.js" defer suppressHydrationWarning />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
