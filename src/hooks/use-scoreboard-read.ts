"use client";

import { useEffect, useState } from "react";
import { useFetch } from "@/hooks/use-fetch";

/** Keep the last successful Scoreboard and its exact scope through failed reads. */
export function useScoreboardRead<T>({ url, returnTo }: { url: string; returnTo: string }) {
  const read = useFetch<T>({ url, returnTo, refetchOnMount: "always" });
  const [lastGood, setLastGood] = useState<{ data: T; url: string } | null>(null);

  useEffect(() => {
    if (read.data) setLastGood({ data: read.data, url });
  }, [read.data, url]);

  const data = read.data ?? lastGood?.data ?? null;
  return {
    ...read,
    data,
    loadedUrl: read.data ? url : lastGood?.url ?? url,
    loading: read.loading && !data,
    refreshing: (read.loading || read.refreshing) && Boolean(data),
  };
}
