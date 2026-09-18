import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DetailPageHeader } from "@/components/DetailPageHeader";
import { UserAvatar } from "@/components/UserAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseTeamScoreboardFilters, parseTeamScoreboardSort, personScoreboardPath, teamScoreboardPath } from "@/lib/scoreboard-explorer";
import { canReadSharedScoreboard } from "@/lib/user-visibility";
import UserScoreboardTab from "../../users/[id]/UserScoreboardTab";

function searchFromNextQuery(query: Record<string, string | string[] | undefined>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") params.set(key, value);
    else if (Array.isArray(value) && value[0]) params.set(key, value[0]);
  }
  return params;
}

export default async function PersonScoreboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAuth();
  const { id } = await params;
  const query = searchFromNextQuery(await searchParams);
  const backHref = teamScoreboardPath(parseTeamScoreboardFilters(query), parseTeamScoreboardSort(query));
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
      <DetailPageHeader
        title={subject.name}
        subtitle="Season Scoreboard shared with everyone signed in."
        sideBySideAt="sm"
        media={<UserAvatar name={subject.name} avatarUrl={subject.avatarUrl} size="lg" />}
        status={<Badge variant="secondary">Current season</Badge>}
        actions={
          <Button asChild variant="outline" className="h-10">
            <Link prefetch={false} href={backHref}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              All leaders
            </Link>
          </Button>
        }
        className="mb-5"
      />
      <UserScoreboardTab
        userId={subject.id}
        returnTo={personScoreboardPath(subject.id, parseTeamScoreboardFilters(query), parseTeamScoreboardSort(query))}
        linkEvents={false}
      />
    </>
  );
}
