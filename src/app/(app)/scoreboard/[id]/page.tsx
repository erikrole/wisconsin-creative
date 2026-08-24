import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { canReadSharedScoreboard } from "@/lib/user-visibility";
import UserScoreboardTab from "../../users/[id]/UserScoreboardTab";

export default async function PersonScoreboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const actor = await requireAuth();
  const { id } = await params;
  const subject = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      avatarUrl: true,
      active: true,
      hiddenFromRoster: true,
    },
  });

  if (!subject || !canReadSharedScoreboard(actor, subject)) notFound();

  return (
    <>
      <PageHeader
        title={`${subject.name} Scoreboard`}
        description="Season record and event coverage shared with everyone signed in."
        titleAccessory={<UserAvatar name={subject.name} avatarUrl={subject.avatarUrl} size="md" />}
        className="mb-5"
      >
        <Button asChild variant="outline" className="h-10">
          <Link prefetch={false} href="/scoreboard">
            <ArrowLeft className="size-4" aria-hidden="true" />
            All leaders
          </Link>
        </Button>
      </PageHeader>
      <UserScoreboardTab
        userId={subject.id}
        returnTo={`/scoreboard/${subject.id}`}
        linkEvents={false}
      />
    </>
  );
}
