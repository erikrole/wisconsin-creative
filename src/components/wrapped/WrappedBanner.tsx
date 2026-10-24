"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Gift } from "lucide-react";
import { useCurrentUser } from "@/hooks/use-current-user";
import { wrappedPromoState } from "@/lib/wrapped/dates";

/** The door into Creative Wrapped on Home and the Scoreboard, Dec 1 to mid-January. */
export function WrappedBanner() {
  const { data: user } = useCurrentUser();
  const [now] = useState(() => new Date());
  const state = wrappedPromoState(now, user?.role);
  if (state === "hidden") return null;
  return <WrappedBannerView state={state} />;
}

/**
 * The admin preview is a quiet row (it's a heads-up, not news); the December launch
 * keeps the full Badger red slab because that one is the moment.
 */
export function WrappedBannerView({ state }: { state: "preview" | "open" }) {
  if (state === "preview") {
    return (
      <Link
        href="/wrapped"
        prefetch={false}
        className="group flex items-center gap-3 rounded-xl border bg-card px-4 py-3 text-foreground no-underline shadow-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        data-wrapped-banner="preview"
      >
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#c5050c] text-white">
          <Gift className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1 text-sm">
          <span className="font-bold">Creative Wrapped preview</span>
          <span className="text-muted-foreground max-sm:block"><span className="max-sm:hidden"> · </span>Only admins can see it until December 1.</span>
        </span>
        <span className="flex shrink-0 items-center gap-0.5 text-[13px] font-bold text-muted-foreground transition-colors group-hover:text-foreground">
          <span className="max-sm:sr-only">Open</span>
          <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
        </span>
      </Link>
    );
  }
  return (
    <Link
      href="/wrapped"
      prefetch={false}
      className="group flex items-center gap-4 overflow-hidden rounded-xl bg-[#c5050c] p-4 text-white no-underline shadow-xs transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
      data-wrapped-banner="open"
    >
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/15">
        <Gift className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-black tracking-tight">Your fall in Creative is here</span>
        <span className="block text-sm text-white/80">Tap through your Creative Wrapped.</span>
      </span>
      <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
    </Link>
  );
}
