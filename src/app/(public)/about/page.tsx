import { ChapterBand, ExplorePages, FeatureGrid, ShowroomHero, StakeholderCta } from "@/components/public-showroom/showroom-blocks";
import { heroMockup, overviewPillars } from "@/lib/public-showroom";

export default function AboutPage() {
  return (
    <main id="showroom-content">
      <ShowroomHero mockup={heroMockup} />
      <ChapterBand
        eyebrow="Public overview"
        title="Built around physical handoffs."
        description="Wisconsin Creative plans reservations in web and iOS. The kiosk records checkout, pickup, and return. Schedule keeps event and shift context connected to gear."
      />
      <FeatureGrid cards={overviewPillars} />
      <ChapterBand
        eyebrow="What it covers"
        title="Planning, custody, reporting, and review."
        description="The same records support reservations, kiosk handoffs, item-family tracking, Schedule work, notifications, reports, and audit history."
        dark
      />
      <StakeholderCta />
      <ExplorePages current="/about" />
    </main>
  );
}
