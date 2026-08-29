import type { Metadata } from "next";
import Link from "next/link";
import { PublicShowroomNav } from "@/components/public-showroom/PublicShowroomNav";
import { publicShowroomNav } from "@/lib/public-showroom";

const showroomDescription =
  "Public pages about the Wisconsin Creative gear, Schedule, kiosk, and field operations app.";

export const metadata: Metadata = {
  metadataBase: new URL("https://wisconsincreative.com"),
  title: {
    default: "About Wisconsin Creative Wisconsin Creative",
    template: "%s - Wisconsin Creative Wisconsin Creative",
  },
  description: showroomDescription,
  openGraph: {
    type: "website",
    siteName: "Wisconsin Creative Wisconsin Creative",
    title: "About Wisconsin Creative Wisconsin Creative",
    description: showroomDescription,
    url: "/about",
  },
  twitter: {
    card: "summary_large_image",
    title: "About Wisconsin Creative Wisconsin Creative",
    description: showroomDescription,
  },
};

export default function AboutLayout({ children }: { children: React.ReactNode }) {
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
      <footer className="border-t border-border bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
          <p>
            &copy; {new Date().getFullYear()} Wisconsin Creative. Public pages with fictional mockup data only.
          </p>
          <nav aria-label="Footer public page navigation" className="flex flex-wrap gap-x-4 gap-y-2">
            {publicShowroomNav.map((item) => (
              <Link key={item.href} href={item.href} className="min-h-10 rounded-md py-2 font-medium text-foreground outline-none transition-[color,box-shadow] hover:text-[var(--wi-red)] focus-visible:ring-[3px] focus-visible:ring-ring/40 motion-reduce:transition-none">
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
