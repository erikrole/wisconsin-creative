import type { Metadata } from "next";
import { ChapterBand, ExplorePages, PageIntro, StackGrid, StakeholderCta } from "@/components/public-showroom/showroom-blocks";
import { pageMockups, stackGroups } from "@/lib/public-showroom";

export const metadata: Metadata = {
  title: "Tech Stack",
  description: "Public-safe platform overview for the Wisconsin Creative Wisconsin Creative stack.",
};

export default function TechStackPage() {
  return (
    <main id="showroom-content">
      <PageIntro
        eyebrow="Tech stack"
        title="Web app, Postgres data, native iOS."
        description="The stack uses Next.js, Prisma, Neon Postgres, Vercel, Blob storage, Sentry, Resend, Upstash, and native iOS."
        mockup={pageMockups.tech}
      />
      <ChapterBand
        eyebrow="Platform map"
        title="Major platform pieces."
        description="The public stack page names the main tools without exposing configuration, endpoint internals, or runbook details."
      />
      <StackGrid groups={stackGroups} />
      <StakeholderCta primaryHref="/about/security" primaryLabel="View security" />
      <ExplorePages current="/about/tech-stack" />
    </main>
  );
}
