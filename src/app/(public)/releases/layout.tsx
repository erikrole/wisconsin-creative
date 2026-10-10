import type { Metadata } from "next";
import { PublicShowroomFooter } from "@/components/public-showroom/PublicShowroomFooter";
import { PublicShowroomNav } from "@/components/public-showroom/PublicShowroomNav";

const releasesDescription = "Release notes for Wisconsin Creative across web, iOS, the checkout kiosk, and the macOS menu bar app.";

export const metadata: Metadata = {
  metadataBase: new URL("https://wisconsincreative.com"),
  title: "Releases - Wisconsin Creative",
  description: releasesDescription,
  alternates: {
    canonical: "/releases",
    types: { "application/rss+xml": "/releases/feed.xml" },
  },
  openGraph: {
    type: "website",
    siteName: "Wisconsin Creative",
    title: "Wisconsin Creative Releases",
    description: releasesDescription,
    url: "/releases",
  },
  twitter: {
    card: "summary",
    title: "Wisconsin Creative Releases",
    description: releasesDescription,
  },
};

export default function ReleasesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="light" className="min-h-screen bg-white text-foreground antialiased" style={{ colorScheme: "light" }}>
      <a
        href="#showroom-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black focus:shadow-lg"
      >
        Skip to content
      </a>
      <PublicShowroomNav />
      {children}
      <PublicShowroomFooter />
    </div>
  );
}
