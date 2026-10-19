"use client";

import { usePathname } from "next/navigation";
import { SectionNav, SectionNavLink, SectionNavList } from "@/components/SectionNav";

export default function WorkforceNav() {
  const pathname = usePathname();
  return (
    <SectionNav aria-label="Workforce sections">
      <SectionNavList>
        <SectionNavLink href="/staff/workforce" active={pathname === "/staff/workforce"}>
          Overview
        </SectionNavLink>
        <SectionNavLink href="/staff/workforce/hiring" active={pathname.startsWith("/staff/workforce/hiring")}>
          Hiring
        </SectionNavLink>
        <SectionNavLink href="/staff/workforce/planning" active={pathname.startsWith("/staff/workforce/planning")}>
          Planning
        </SectionNavLink>
      </SectionNavList>
    </SectionNav>
  );
}
