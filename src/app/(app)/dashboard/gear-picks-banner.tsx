"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { ArrowRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGearPicksMe } from "@/hooks/use-gear-picks";
import { formatUsd } from "@/lib/gear-picks/catalog";
import { formatDateShort } from "@/lib/format";

/**
 * Nudges a gear pick participant who hasn't submitted while the cycle is open.
 * Drafts still count as "not submitted" so a half-finished list isn't forgotten.
 * After submitting it disappears; the profile Gear tab shows the picks and links
 * back to /gear while they can still change.
 */
export function GearPicksBanner() {
  const { data } = useGearPicksMe();

  // Once submitted, the person's picks live on their profile's Gear tab.
  if (!data?.cycle?.isOpen || !data.participant || data.submission?.submittedAt) return null;

  const allowanceCents = data.participant.allowanceCents;
  const allowance = formatUsd(allowanceCents);
  const pickedCents = data.submission?.totalCents ?? 0;
  const hasDraft = Boolean(data.submission && data.submission.lines.length > 0);

  return (
    <Reveal>
      <section
        aria-labelledby="gear-picks-banner-title"
        className="relative isolate overflow-hidden rounded-xl bg-[linear-gradient(115deg,#7a0000_0%,var(--wi-red)_45%,#1a0505_100%)] text-white shadow-sm"
      >
        {/* Oversized mark bleeding off the right edge: texture, not content. */}
        <Image
          src="/gear/ua-logo-white.svg"
          alt=""
          aria-hidden="true"
          width={201}
          height={119}
          className="pointer-events-none absolute -right-8 top-1/2 -z-10 h-[150%] w-auto -translate-y-1/2 opacity-[0.07]"
        />
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:gap-5 sm:px-6">
          <Image
            src="/gear/ua-logo-white.svg"
            alt="Under Armour"
            width={201}
            height={119}
            priority
            className="h-9 w-auto shrink-0 self-start sm:h-11 sm:self-center"
          />
          <div className="min-w-0 flex-1">
            <h2
              id="gear-picks-banner-title"
              className="text-xl font-bold leading-tight tracking-tight sm:text-2xl"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              {hasDraft ? "Finish your 2027–28 gear picks" : "Pick your 2027–28 UA gear"}
            </h2>
            <p className="mt-1 text-[13px] text-white/75">
              {hasDraft ? `${formatUsd(Math.max(0, allowanceCents - pickedCents))} left to spend` : `${allowance} to spend`}
              {data.cycle.deadline ? ` · Due ${formatDateShort(data.cycle.deadline)}` : ""}
            </p>
          </div>
          <Button
            asChild
            className="min-h-11 w-full shrink-0 bg-white px-5 font-semibold text-[#7a0000] shadow-none hover:bg-white/90 sm:w-auto"
          >
            <Link href="/gear">
              {hasDraft ? "Finish picks" : "Choose gear"}
              <ArrowRightIcon data-icon="inline-end" />
            </Link>
          </Button>
        </div>
      </section>
    </Reveal>
  );
}

/**
 * The banner arrives after the dashboard's first paint (it waits on the gear
 * picks query), so it grows open instead of shoving the page down in one jump.
 */
function Reveal({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? false : { height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="overflow-hidden"
    >
      <div className="pb-4">{children}</div>
    </motion.div>
  );
}
