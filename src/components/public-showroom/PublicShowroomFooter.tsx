import Link from "next/link";
import { publicShowroomNav } from "@/lib/public-showroom";

export function PublicShowroomFooter() {
  return (
    <footer className="border-t border-border bg-white px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 text-sm text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
        <p>
          &copy; {new Date().getFullYear()} Wisconsin Creative. Product mockups on these pages use fictional data.
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
  );
}
