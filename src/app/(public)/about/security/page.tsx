import type { Metadata } from "next";
import { ChapterBand, ExplorePages, FeatureGrid, PageIntro, StakeholderCta } from "@/components/public-showroom/showroom-blocks";
import { pageMockups, securityControls } from "@/lib/public-showroom";

export const metadata: Metadata = {
  title: "Security",
  description: "Public-safe security, trust, access, auditability, and reliability overview for Wisconsin Creative.",
};

export default function SecurityPage() {
  return (
    <main id="showroom-content">
      <PageIntro
        eyebrow="Security"
        title="Public pages do not expose operations."
        description="This section describes the security model while keeping authenticated data, thresholds, and internal recovery details out of public view."
        mockup={pageMockups.security}
      />
      <ChapterBand
        eyebrow="Security summary"
        title="Security controls at a high level."
        description="The page covers static public content, role-aware access, kiosk custody, auditability, browser hardening, and transaction safety."
        dark
      />
      <FeatureGrid cards={securityControls} dark />
      <StakeholderCta />
      <ExplorePages current="/about/security" />
    </main>
  );
}
