import type { Metadata } from "next";
import { PublicShowroomNav } from "@/components/public-showroom/PublicShowroomNav";
import { PublicShowroomFooter } from "@/components/public-showroom/PublicShowroomFooter";

const appsDescription = "Apps and tools from Wisconsin Creative: the iOS app, Offload, and browser tools like QR Studio.";

export const metadata: Metadata = {
  metadataBase: new URL("https://wisconsincreative.com"),
  title: "Apps and tools - Wisconsin Creative",
  description: appsDescription,
  openGraph: {
    type: "website",
    siteName: "Wisconsin Creative",
    title: "Apps and tools - Wisconsin Creative",
    description: appsDescription,
    url: "/apps",
  },
  twitter: {
    card: "summary_large_image",
    title: "Apps and tools - Wisconsin Creative",
    description: appsDescription,
  },
};

export default function AppsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="light" className="min-h-screen bg-[#f4f4f4] text-foreground antialiased" style={{ colorScheme: "light" }}>
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
