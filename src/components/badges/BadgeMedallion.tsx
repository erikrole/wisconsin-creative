import type { ComponentType } from "react";
import type { BadgeRarity } from "@/lib/badges/display";
import { badgeRarityMedallionClass } from "@/lib/badges/display";
import { cn } from "@/lib/utils";

type BadgeMedallionProps = {
  icon: ComponentType<{ className?: string }>;
  earned: boolean;
  rarity: BadgeRarity;
  className?: string;
  iconClassName?: string;
};

/**
 * One disc for every badge, on every web surface that draws one.
 *
 * The silhouette map this replaces is explained in `badgeRarityMedallionClass`:
 * four shapes that all rendered as the same rounded rect. iOS reached the same
 * conclusion in July, so the two clients now cut the same medallion from the
 * same catalog.
 */
export function BadgeMedallion({
  icon: Icon,
  earned,
  rarity,
  className,
  iconClassName,
}: BadgeMedallionProps) {
  return (
    <div
      className={cn(
        "relative flex size-12 shrink-0 items-center justify-center rounded-full transition-[scale,box-shadow,background-color,color] duration-200",
        badgeRarityMedallionClass(rarity, earned),
        className,
      )}
      aria-hidden="true"
    >
      {/* Specular highlight. Earned only -- a locked disc is meant to sit flat. */}
      {earned ? (
        <span className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_22%,rgba(255,255,255,0.38),transparent_56%)]" />
      ) : null}
      {/*
        A locked badge shows its own icon, dimmed -- not a padlock. A shelf of
        identical padlocks tells you nothing about what is left to earn, and it
        is the state a person looks at most. Dimming is carried by the muted
        wash and rim above.
      */}
      <Icon
        className={cn(
          "relative z-10 size-5",
          earned ? "drop-shadow-[0_1px_2px_rgba(0,0,0,0.28)]" : "opacity-60",
          iconClassName,
        )}
      />
    </div>
  );
}
