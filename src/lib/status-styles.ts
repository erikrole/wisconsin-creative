import { badgeVariants } from "@/components/ui/badge";

/**
 * Maps a color key to dot + badge class strings (for the StatusDot pattern).
 * `badge` is derived from <Badge variant={color}> — single source of truth.
 * Prefer `<Badge variant={color}>` directly when possible; this map is for
 * non-Badge surfaces (raw <div>s with avatar+text) and the StatusDot pairing.
 */
export const STATUS_STYLES = {
  green:  { badge: badgeVariants({ variant: "green"  }), dot: "bg-[var(--green-text)]"  },
  blue:   { badge: badgeVariants({ variant: "blue"   }), dot: "bg-[var(--blue-text)]"   },
  red:    { badge: badgeVariants({ variant: "red"    }), dot: "bg-[var(--red-text)]"    },
  purple: { badge: badgeVariants({ variant: "purple" }), dot: "bg-[var(--purple-text)]" },
  orange: { badge: badgeVariants({ variant: "orange" }), dot: "bg-[var(--orange-text)]" },
  gray:   { badge: badgeVariants({ variant: "gray"   }), dot: "bg-muted-foreground"     },
} as const;

export type StatusColor = keyof typeof STATUS_STYLES;
