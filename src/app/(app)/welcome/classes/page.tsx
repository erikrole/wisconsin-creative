"use client";

import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUser } from "@/hooks/use-current-user";
import { markGettingStartedDone } from "@/app/(app)/_home/GettingStartedCard";
import { ClassTimesSetup } from "./ClassTimesSetup";

export default function ClassTimesPage() {
  const router = useRouter();
  const { data: user } = useCurrentUser();

  if (!user) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10" aria-busy="true">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="mt-6 h-64 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <ClassTimesSetup
      userId={user.id}
      onDone={() => {
        // Skipping counts as looked-at, so the Home card stops asking.
        markGettingStartedDone("availability");
        router.replace("/");
      }}
    />
  );
}
