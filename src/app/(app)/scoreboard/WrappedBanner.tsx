"use client";

import Link from "next/link";
import { ArrowRight, Gift } from "lucide-react";
import { wrappedPromoState } from "@/lib/wrapped/dates";

/** The Scoreboard's door into Creative Wrapped, from Dec 1 to mid-January. */
export function WrappedBanner({ now, isAdmin }: { now: Date; isAdmin: boolean }) {
  const state = wrappedPromoState(now, isAdmin);
  if (state === "hidden") return null;
  return (
    <Link
      href="/wrapped"
      prefetch={false}
      className="group flex items-center gap-4 overflow-hidden rounded-xl bg-[#c5050c] p-4 text-white no-underline shadow-xs transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none motion-reduce:hover:translate-y-0"
    >
      <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/15">
        <Gift className="size-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-black tracking-tight">
          {state === "preview" ? "Preview Creative Wrapped" : "Your fall in Creative is here"}
        </span>
        <span className="block text-sm text-white/80">
          {state === "preview" ? "Admins only until December 1." : "Tap through your Creative Wrapped."}
        </span>
      </span>
      <ArrowRight className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden="true" />
    </Link>
  );
}
