import { GlobeIcon, LinkIcon, LockIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { PRIVACY_BADGE } from "./status";

const ICONS = { public: GlobeIcon, unlisted: LinkIcon, private: LockIcon } as const;

/** Public, Unlisted and Private read differently at a glance: icon, colour and word. */
export function VisibilityBadge({ privacy, size }: { privacy: string; size?: "sm" }) {
  const entry = PRIVACY_BADGE[privacy] ?? { label: privacy || "Unknown", variant: "gray" as const };
  const Icon = ICONS[privacy as keyof typeof ICONS] ?? LockIcon;
  return (
    <Badge variant={entry.variant} size={size}>
      <Icon className="size-3" aria-hidden="true" />
      {entry.label}
    </Badge>
  );
}
