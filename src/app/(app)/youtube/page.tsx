import { Role } from "@prisma/client";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/PageHeader";
import { requireAuth } from "@/lib/auth";
import { connectionStatus } from "@/lib/youtube/connection";

import { ConnectionCard } from "./ConnectionCard";

export const metadata = { title: "YouTube" };

const RESULT_MESSAGES: Record<string, { tone: "ok" | "error"; text: string }> = {
  connected: { tone: "ok", text: "The Wisconsin Badgers channel is connected." },
  cancelled: { tone: "error", text: "Google sign-in was cancelled. Nothing changed." },
};

/** Admin-only YouTube metadata tool. This slice holds the channel connection. */
export default async function YouTubePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAuth();
  if (user.role !== Role.ADMIN) redirect("/");

  const params = await searchParams;
  const result = params.connection
    ? RESULT_MESSAGES[params.connection] ?? { tone: "error" as const, text: params.message ?? "The connection did not complete." }
    : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="YouTube"
        description="Review titles, descriptions, playlists and visibility for Wisconsin Badgers uploads."
      />
      <ConnectionCard status={await connectionStatus()} result={result} />
    </div>
  );
}
