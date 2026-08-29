import type { Metadata } from "next";
import { ChapterBand, ExplorePages, FeatureGrid, PageIntro, StakeholderCta } from "@/components/public-showroom/showroom-blocks";
import { featurePillars, pageMockups } from "@/lib/public-showroom";

export const metadata: Metadata = {
  title: "Features",
  description: "Public overview of Wisconsin Creative reservations, kiosk custody, Schedule, item families, reports, and notifications.",
};

export default function FeaturesPage() {
  return (
    <main id="showroom-content">
      <PageIntro
        eyebrow="Features"
        title="Features by workflow."
        description="The feature set follows the operational path: who needs gear, where it moves, when it comes back, and what needs review when plans change."
        mockup={pageMockups.features}
      />
      <ChapterBand
        eyebrow="Workflow pillars"
        title="What the public pages cover."
        description="These pages describe shipped operating modes without exposing authenticated access or live production data."
      />
      <FeatureGrid cards={featurePillars} />
      <StakeholderCta />
      <ExplorePages current="/about/features" />
    </main>
  );
}
