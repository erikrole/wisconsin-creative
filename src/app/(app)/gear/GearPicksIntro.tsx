"use client";

import Image from "next/image";
import { CheckCircle2Icon, PaletteIcon, RulerIcon, ShirtIcon, WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const SEEN_KEY_PREFIX = "gear-picks-intro-seen:";

/** Whether this person has dismissed the intro for this cycle. Storage can throw (private mode); treat that as unseen. */
export function gearIntroSeen(cycleId: string) {
  try {
    return window.localStorage.getItem(SEEN_KEY_PREFIX + cycleId) === "1";
  } catch {
    return false;
  }
}

function markGearIntroSeen(cycleId: string) {
  try {
    window.localStorage.setItem(SEEN_KEY_PREFIX + cycleId, "1");
  } catch {
    // Not remembering it only means the intro shows again next visit.
  }
}

/**
 * A short splash on someone's first visit this cycle (usually from the dashboard banner):
 * what the allowance covers, then a handful of tips for the catalog.
 */
export function GearPicksIntro({
  open,
  onOpenChange,
  cycleId,
  allowance,
  remaining,
  deadline,
  kitCount,
  sizeFromProfile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cycleId: string;
  allowance: string;
  /** Set when a draft already spends some of the allowance. */
  remaining: string | null;
  deadline: string | null;
  kitCount: number;
  /** False when the profile has no top size, so nothing is prefilled. */
  sizeFromProfile: boolean;
}) {
  const close = (next: boolean) => {
    if (!next) markGearIntroSeen(cycleId);
    onOpenChange(next);
  };

  const tips = [
    {
      icon: ShirtIcon,
      title: `You already get ${kitCount} items`,
      body: "They're covered. They don't use your budget.",
    },
    {
      icon: WalletIcon,
      title: remaining ? `You have ${remaining} left` : `You have ${allowance} to spend`,
      body: "“Fits my budget” is on, so you only see what you can afford.",
    },
    {
      icon: PaletteIcon,
      title: "Tap a photo to see it bigger",
      body: "Tap a color dot to change the color.",
    },
    {
      icon: RulerIcon,
      title: "Check your size",
      body: sizeFromProfile
        ? "Your size is filled in from your profile. Change it if it's wrong."
        : "Pick a size for each item before you submit.",
    },
    {
      icon: CheckCircle2Icon,
      title: "Submit when you're done",
      body: deadline ? `You can still make changes until ${deadline}.` : "You can still make changes until picks close.",
    },
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-0 overflow-hidden sm:max-w-md">
        <div className="relative isolate overflow-hidden bg-[linear-gradient(115deg,#7a0000_0%,var(--wi-red)_45%,#1a0505_100%)] px-6 pb-5 pt-6 text-white">
          <Image
            src="/gear/ua-logo-white.svg"
            alt=""
            aria-hidden="true"
            width={201}
            height={119}
            className="pointer-events-none absolute -right-6 top-1/2 -z-10 h-[140%] w-auto -translate-y-1/2 opacity-[0.07]"
          />
          <Image src="/gear/ua-logo-white.svg" alt="Under Armour" width={201} height={119} className="mb-4 h-8 w-auto" />
          <DialogTitle className="text-2xl font-bold leading-tight tracking-tight text-white" style={{ fontFamily: "var(--font-heading)" }}>
            How it works
          </DialogTitle>
          <DialogDescription className="mt-1 text-[13px] text-white/75">
            {deadline ? `Pick your 2027–28 gear by ${deadline}.` : "Pick your 2027–28 gear."}
          </DialogDescription>
        </div>
        <ol className="flex flex-col gap-4 px-6 py-5">
          {tips.map(({ icon: Icon, title, body }) => (
            <li key={title} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--wi-red)]/10 text-[var(--wi-red)]">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-snug">{title}</p>
                <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="border-t px-6 py-4">
          <Button className="min-h-11 w-full font-semibold" onClick={() => close(false)} autoFocus>
            Start picking
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
