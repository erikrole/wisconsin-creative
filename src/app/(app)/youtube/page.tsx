import { Role } from "@prisma/client";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/auth";
import { connectionStatus } from "@/lib/youtube/connection";
import { loadQueue } from "@/lib/youtube/queue";
import { replayDirectory } from "@/lib/youtube/reader";

import { ConnectionCard } from "./ConnectionCard";
import { ReviewQueue } from "./ReviewQueue";

export const metadata = { title: "YouTube" };

const RESULT_MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "The Wisconsin Badgers channel is connected." },
  cancelled: { tone: "error", text: "Google sign-in was cancelled. Nothing changed." },
};

/** Admin-only YouTube metadata tool: the channel connection and the review queue. */
export default async function YouTubePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/");

  const params = await searchParams;
  const result = params.connection
    ? RESULT_MESSAGES[params.connection] ?? { tone: "error" as const, text: params.message ?? "The connection did not complete." }
    : null;

  const [status, queue] = await Promise.all([connectionStatus(), loadQueue()]);
  const replay = Boolean(replayDirectory());

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <PageHeader
        title="YouTube"
        description="Review titles, descriptions, playlists and visibility for Wisconsin Badgers uploads."
      />
      <ConnectionCard status={status} result={result} />
      <ReviewQueue queue={queue} canRefresh={status.connected || replay} replay={replay} />
    </div>
  );
}
