"use client";

import { Sparkles } from "lucide-react";
import { BadgeMedallion } from "@/components/badges/BadgeMedallion";
import { badgeIcon } from "@/components/badges/badge-artwork";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { badgeRarityVariant, formatBadgeCategoryLabel, type BadgeRarity } from "@/lib/badges/display";
import { cn } from "@/lib/utils";

export type EarnedBadgeReward = {
  id: string;
  definitionId: string;
  key: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  rarity: BadgeRarity;
  awardedAt: string;
  /** Served so the celebration and the shelf cut the same silhouette. */
  kind?: string | null;
  trigger?: string | null;
  source?: string | null;
};

const rarityStage: Record<BadgeRarity, string> = {
  Common: "from-primary/16 via-primary/7 to-background",
  Uncommon: "from-[var(--blue-bg)] via-[var(--blue-bg)]/45 to-background",
  Rare: "from-[var(--orange-bg)] via-[var(--orange-bg)]/45 to-background",
  Legendary: "from-[var(--purple-bg)] via-[var(--purple-bg)]/50 to-background",
};

export function BadgeEarnedCelebration({
  reward,
  remaining,
  onDismiss,
}: {
  reward: EarnedBadgeReward;
  remaining: number;
  onDismiss: () => void;
}) {
  const Icon = badgeIcon(reward.icon);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDismiss(); }}>
      <DialogContent className="max-w-md overflow-hidden border-0 shadow-[0_30px_100px_rgba(0,0,0,0.30),0_0_0_1px_var(--border)] sm:rounded-3xl">
        <DialogTitle className="sr-only">Badge earned: {reward.name}</DialogTitle>
        <DialogDescription className="sr-only">{reward.description}</DialogDescription>

        <DialogBody className={cn(
          "relative isolate flex flex-col items-center overflow-hidden bg-gradient-to-b px-7 pb-7 pt-12 text-center",
          rarityStage[reward.rarity],
        )}>
          <div className="pointer-events-none absolute inset-0 opacity-70" aria-hidden="true">
            <Sparkles className="absolute left-[14%] top-[18%] size-5 animate-pulse text-current motion-reduce:animate-none" />
            <Sparkles className="absolute right-[12%] top-[30%] size-4 animate-pulse text-current [animation-delay:450ms] motion-reduce:animate-none" />
            <span className="absolute left-1/2 top-20 size-36 -translate-x-1/2 rounded-full bg-background/45 blur-3xl" />
          </div>

          <p className="relative z-10 text-xs font-bold uppercase tracking-[0.22em] text-foreground/65">
            Badge earned
          </p>
          <BadgeMedallion
            icon={Icon}
            earned
            rarity={reward.rarity}
            className="relative z-10 mt-5 size-28 motion-safe:animate-in motion-safe:zoom-in-75 motion-safe:duration-500"
            iconClassName="size-11"
          />
          <h2 className="relative z-10 mt-6 text-balance text-3xl font-semibold tracking-tight">
            {reward.name}
          </h2>
          <p className="relative z-10 mt-3 max-w-[34ch] text-pretty text-sm leading-6 text-foreground/70">
            {reward.description}
          </p>
          <div className="relative z-10 mt-5 flex flex-wrap items-center justify-center gap-2">
            <Badge variant={badgeRarityVariant(reward.rarity)}>{reward.rarity}</Badge>
            <Badge variant="outline">{formatBadgeCategoryLabel(reward.category)}</Badge>
          </div>
        </DialogBody>

        <DialogFooter className="border-t border-border/50 bg-background px-6 py-5 sm:justify-center">
          <Button className="w-full sm:w-auto sm:min-w-40" onClick={onDismiss}>
            {remaining > 0 ? `Next badge (${remaining})` : "Nice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
