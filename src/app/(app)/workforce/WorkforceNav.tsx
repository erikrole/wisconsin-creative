"use client";

import { usePathname } from "next/navigation";
import { SectionNav, SectionNavLink, SectionNavList } from "@/components/SectionNav";

export default function WorkforceNav() {
  const pathname = usePathname();
  return (
    <SectionNav aria-label="Workforce sections">
      <SectionNavList>
        <SectionNavLink href="/workforce" active={pathname === "/workforce"}>
          Overview
        </SectionNavLink>
        <SectionNavLink href="/workforce/hiring" active={pathname.startsWith("/workforce/hiring")}>
          Hiring
        </SectionNavLink>
        <SectionNavLink href="/workforce/planning" active={pathname.startsWith("/workforce/planning")}>
          Planning
        </SectionNavLink>
      </SectionNavList>
    </SectionNav>
  );
}
