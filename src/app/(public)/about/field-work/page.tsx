import type { Metadata } from "next";
import { ChapterBand, ExplorePages, FeatureGrid, PageIntro, StakeholderCta } from "@/components/public-showroom/showroom-blocks";
import { fieldWorkMoments, pageMockups } from "@/lib/public-showroom";

export const metadata: Metadata = {
  title: "Field Work",
  description: "How Wisconsin Creative supports native iOS, iPad kiosk, scanner, and game-day field workflows.",
};

export default function FieldWorkPage() {
  return (
    <main id="showroom-content">
      <PageIntro
        eyebrow="Field work"
        title="Native iOS and kiosk cover field work."
        description="The web app handles admin breadth. Native iOS and kiosk flows handle scanner input, counter work, and venue context."
        mockup={pageMockups.field}
      />
      <ChapterBand
        eyebrow="Execution model"
        title="Phone, counter, and web have different jobs."
        description="Students need the next action. The kiosk records custody evidence. Staff use web for broader review without putting desktop tools in the field."
      />
      <FeatureGrid cards={fieldWorkMoments} />
      <StakeholderCta />
      <ExplorePages current="/about/field-work" />
    </main>
  );
}
