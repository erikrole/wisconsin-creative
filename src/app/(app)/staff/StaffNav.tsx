"use client";

import { usePathname } from "next/navigation";
import { SectionNav, SectionNavLink, SectionNavList } from "@/components/SectionNav";

/** Top-level Staff tabs. Workforce is admin-only and omitted for everyone else. */
export default function StaffNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const onWorkforce = pathname === "/staff/workforce" || pathname.startsWith("/staff/workforce/");
  // Profiles, org chart, and onboarding status are detail pages, not tabs.
  if (!isAdmin || (pathname !== "/staff" && !onWorkforce)) return null;
  return (
    <SectionNav aria-label="Staff sections">
      <SectionNavList>
        <SectionNavLink href="/staff" active={pathname === "/staff"}>
          Roster
        </SectionNavLink>
        <SectionNavLink href="/staff/workforce" active={onWorkforce}>
          Workforce
        </SectionNavLink>
      </SectionNavList>
    </SectionNav>
  );
}
