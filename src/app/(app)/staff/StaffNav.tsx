"use client";

import { usePathname } from "next/navigation";
import { SectionNav, SectionNavLink, SectionNavList } from "@/components/SectionNav";

/**
 * Top-level Staff tabs: Roster and Today for everyone who can see schedules, Availability for staff and admins, plus Workforce for admins.
 * Collaborators see the roster only, so they get no tab bar.
 */
export default function StaffNav({ isAdmin, canSeeToday, canSeeAvailability }: { isAdmin: boolean; canSeeToday: boolean; canSeeAvailability: boolean }) {
  const pathname = usePathname();
  const onWorkforce = pathname === "/staff/workforce" || pathname.startsWith("/staff/workforce/");
  const onToday = pathname === "/staff/today";
  const onAvailability = pathname === "/staff/availability";
  // Profiles, org chart, and onboarding status are detail pages, not tabs.
  if (!canSeeToday || (pathname !== "/staff" && !onToday && !onAvailability && !(isAdmin && onWorkforce))) return null;
  return (
    <SectionNav aria-label="Staff sections">
      <SectionNavList>
        <SectionNavLink href="/staff" active={pathname === "/staff"}>
          Roster
        </SectionNavLink>
        <SectionNavLink href="/staff/today" active={onToday}>
          Today
        </SectionNavLink>
        {canSeeAvailability && (
          <SectionNavLink href="/staff/availability" active={onAvailability}>
            Availability
          </SectionNavLink>
        )}
        {isAdmin && (
          <SectionNavLink href="/staff/workforce" active={onWorkforce}>
            Workforce
          </SectionNavLink>
        )}
      </SectionNavList>
    </SectionNav>
  );
}
