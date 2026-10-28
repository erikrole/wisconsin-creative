"use client";

import EmptyState from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { useFetch } from "@/hooks/use-fetch";
import type { TeamStudent } from "@/lib/team-availability";
import { TeamAvailabilityGrid } from "./TeamAvailabilityGrid";

export default function StaffAvailabilityPage() {
  const { data, loading, reload } = useFetch<TeamStudent[]>({
    url: "/api/availability/team",
    refetchOnFocus: true,
    transform: (json) => json.data as TeamStudent[],
  });

  if (data) return <TeamAvailabilityGrid students={data} />;
  if (loading) return <Skeleton className="h-64 rounded-xl" />;
  return (
    <EmptyState
      icon="calendar"
      title="Couldn't load availability"
      description="Try again in a moment."
      actionLabel="Retry"
      onAction={reload}
    />
  );
}
